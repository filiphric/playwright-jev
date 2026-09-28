import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { root, runFile } from '../shared/runtime.ts';
import { metricsInputSchema, pricingSchema, resultSchema, summarizeRun } from './metrics.ts';
export async function renderComparison(directory: string) {
  const results = z.object({ mcp: resultSchema, jev: resultSchema, cli_llm: resultSchema.optional() }).parse(JSON.parse(await readFile(resolve(directory, 'results.json'), 'utf8')));
  const arms: ('mcp' | 'jev' | 'cli_llm')[] = results.cli_llm ? ['mcp', 'jev', 'cli_llm'] : ['mcp', 'jev'];
  // Freeze the rate card alongside each video so later re-renders stay reproducible.
  const pricingPath = resolve(directory, 'pricing.json');
  let pricingText: string;
  try { pricingText = await readFile(pricingPath, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    pricingText = await readFile(resolve(root, 'config/pricing.json'), 'utf8');
    await writeFile(pricingPath, pricingText, { flag: 'wx' });
  }
  const pricing = pricingSchema.parse(JSON.parse(pricingText));
  let legacy: z.infer<typeof metricsInputSchema> = { timedBrowserCalls: {} };
  try { legacy = metricsInputSchema.parse(JSON.parse(await readFile(resolve(directory, 'metrics-input.json'), 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const metrics = Object.fromEntries(arms.map(arm => [arm, summarizeRun(results[arm], pricing, legacy.timedBrowserCalls[arm])]));
  await writeFile(resolve(directory, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
  const metadata = JSON.parse(await readFile(resolve(directory, 'metadata.json'), 'utf8')) as { baseline: { model: string }; cliLlm?: { model: string }; jev: { model: string; textModel: string | null } };
  const videos = arms.map(arm => resolve(directory, arm, 'recording.webm'));
  const durations = await Promise.all(videos.map(async video => {
    const { stdout } = await runFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', video], { timeout: 15_000 });
    return Number(stdout.trim());
  }));
  if (durations.some(duration => !Number.isFinite(duration) || duration <= 0)) throw new Error('Invalid recording duration');
  const finalHoldSeconds = 2;
  const duration = Math.max(...durations) + finalHoldSeconds;
  const font = process.platform === 'darwin' ? '/System/Library/Fonts/Supplemental/Arial.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
  const number = (value: number) => value.toLocaleString('en-US');
  const tokenLine = (arm: keyof typeof metrics) => {
    const tokens = metrics[arm].tokens;
    return tokens ? `Tokens: ${number(tokens.input)} in / ${number(tokens.output)} out` : 'Tokens: usage unavailable';
  };
  const costLine = (arm: keyof typeof metrics) => {
    const cost = metrics[arm].estimatedCostUsd;
    return `Final API price (est.): ${cost === null ? 'unavailable' : '$' + cost.toFixed(6)}`;
  };
  const colors = { mcp: '0x86b9ff', jev: '0x7fe0b6', cli_llm: '0xffcd7f' };
  const finalColors = { mcp: '0xff6868', jev: '0x67e89c', cli_llm: '0xffcd7f' };
  const labels = {
    mcp: `Playwright MCP  /  ${metadata.baseline.model}`,
    jev: `Playwright CLI  /  Jev + ${metadata.jev.textModel ?? 'supplied data'}`,
    cli_llm: `Playwright CLI  /  ${metadata.cliLlm?.model ?? metadata.baseline.model}`,
  };
  const lines = arms.flatMap((arm, index) => {
    const x = index * 960 + 32;
    return [
      [`${arm}-label`, labels[arm], x, 58, 28, colors[arm]],
      [`${arm}-calls`, `${results[arm]!.calls.length} model calls`, x, 805, 29, 'white'],
      [`${arm}-tokens`, tokenLine(arm), x, 855, 27, '0xc8d2e0'],
      [`${arm}-tools`, `Tool calls: ${metrics[arm].toolCalls ?? 'unknown'} ${arm === 'mcp' ? 'MCP browser calls' : 'Playwright CLI commands'}`, x, 905, 27, '0xc8d2e0'],
      [`${arm}-price`, costLine(arm), x, 955, 30, colors[arm]],
    ] as const;
  });
  const texts: string[] = [];
  for (const [name, text, x, y, size, color] of lines) {
    const path = resolve(directory, `caption-${name}.txt`); await writeFile(path, text);
    texts.push(`drawtext=fontfile='${font}':textfile='${path}':expansion=none:x=${x}:y=${y}:fontsize=${size}:fontcolor=${color}`);
  }
  const timerFont = process.platform === 'darwin' ? '/System/Library/Fonts/Menlo.ttc' : '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf';
  const runningTimerPath = resolve(directory, 'caption-timer-running.txt');
  await writeFile(runningTimerPath, '%{eif:floor(t):d}.%{eif:mod(floor(t*100+0.000001),100):d:2} s');
  for (const [index, arm] of arms.entries()) {
    const rightEdge = index * 960 + 920, color = finalColors[arm];
    const stop = results[arm]!.elapsedMs / 1000;
    const finalTimerPath = resolve(directory, `caption-timer-${arm}-final.txt`);
    await writeFile(finalTimerPath, `${stop.toFixed(2)} s`);
    const placement = `fontfile='${timerFont}':x=${rightEdge}-text_w:y=44:fontsize=40`;
    texts.push(`drawtext=${placement}:textfile='${runningTimerPath}':fontcolor=white:enable='lt(t,${stop})'`);
    texts.push(`drawtext=${placement}:textfile='${finalTimerPath}':expansion=none:fontcolor=${color}:enable='gte(t,${stop})'`);
  }
  await writeFile(resolve(directory, 'stopwatch.json'), JSON.stringify({
    start: 'Playback time zero',
    finalHoldSeconds,
    stopSeconds: Object.fromEntries(arms.map(arm => [arm, results[arm]!.elapsedMs / 1000])),
    finalColors: Object.fromEntries(arms.map(arm => [arm, finalColors[arm].replace('0x', '#')])),
    basis: 'Timers animate in real seconds from playback start and freeze at the saved decision-loop duration. Original recordings include a short recorder lead-in and verification tail; an exact recorder-to-loop timestamp offset was not captured. The final color appears on the first 25 fps frame at or after the measured duration.',
  }, null, 2) + '\n');
  const filter = arms.map((arm, index) => `[${index}:v]setpts=PTS-STARTPTS,scale=928:646,setsar=1,fps=25,tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration},pad=960:1080:16:110:color=0x101722[${arm}];`).join('') +
    `${arms.map(arm => `[${arm}]`).join('')}hstack=inputs=${arms.length},${texts.join(',')}[out]`;
  const filterPath = resolve(directory, 'render.ffmpeg'); await writeFile(filterPath, filter);
  await runFile('ffmpeg', ['-y', ...videos.flatMap(video => ['-i', video]), '-filter_complex_script', filterPath, '-map', '[out]', '-an', '-c:v', 'libx264', '-crf', '19', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', resolve(directory, 'comparison.mp4')], { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
}
if (process.argv[1] === new URL(import.meta.url).pathname) await renderComparison(resolve(root, process.argv[2] ?? 'artifacts/comparison'));
