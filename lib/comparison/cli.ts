import { parseArgs } from 'node:util';
import { resolve, dirname } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DemoServer } from '../demo/server.ts';
import { resetDemo, scenario, testData, verifyDemo, verifyVisiblePage } from '../demo/scenario.ts';
import { PlaywrightCli } from '../browser/cli.ts';
import { NativePlaywrightCli } from '../browser/cli-native.ts';
import { PlaywrightMcp } from '../browser/mcp.ts';
import { runAgent } from '../agent/loop.ts';
import { runBaseline, runCliBaseline } from './baseline.ts';
import { loadEnv, logger, root, saveJson, now, runFile } from '../shared/runtime.ts';
import { renderComparison } from './render.ts';
const log = logger.child({ module: 'comparison' });
loadEnv();
const { values } = parseArgs({ options: { output: { type: 'string', default: 'artifacts/comparison' }, order: { type: 'string', default: 'mcp-first' }, 'no-render': { type: 'boolean', default: false } } });
if (!['mcp-first', 'jev-first', 'cli-first'].includes(values.order)) throw new Error('--order must be mcp-first, jev-first or cli-first');
if (!process.env.TYPESAFE_API_KEY || !(process.env.BASELINE_API_KEY ?? process.env.OPENAI_API_KEY)) throw new Error('Missing model credentials; see .env.example');
const directory = resolve(root, values.output);
await mkdir(dirname(directory), { recursive: true });
await mkdir(directory, { recursive: false }); // Never overwrite an earlier attempt.
const demo = new DemoServer();
const records: Record<string, unknown> = {};
const order = values.order === 'mcp-first' ? ['mcp', 'jev', 'cli_llm'] : values.order === 'jev-first' ? ['jev', 'cli_llm', 'mcp'] : ['cli_llm', 'mcp', 'jev'];
const metadata = {
  goal: scenario.goal, testData, order, viewport: { width: 1120, height: 780 }, speed: 1,
  baseline: { model: process.env.BASELINE_MODEL ?? 'gpt-6-astra', reasoning: process.env.BASELINE_REASONING ?? 'low' },
  cliLlm: { model: process.env.BASELINE_MODEL ?? 'gpt-6-astra', reasoning: process.env.BASELINE_REASONING ?? 'low', observation: 'Native CLI accessibility snapshots', execution: 'Native CLI commands via validated argv; no Jev model or custom Jev element table' },
  jev: { model: process.env.TYPESAFE_MODEL ?? 'jev-latest', textSource: 'supplied-data', textModel: null },
  timing: 'First decision request through accepted completion. Includes decisions, browser calls, stale retries and waits. Excludes browser setup, initial navigation/observation, recorder startup/shutdown, and independent verification.',
  video: 'Continuous original-speed recordings include a short recording lead-in and verification tail. Shorter recording is frozen at its final frame in the comparison. No animated cursor or action pacing.',
  caveat: 'One run per system, different models and observation/runtime implementations. This is a scenario demonstration, not an isolated MCP-versus-CLI transport benchmark.',
  packages: { playwrightCli: '0.1.21', playwrightMcp: '0.0.82', playwright: '1.64.0-alpha-1789764292000' },
  demoSource: { url: 'https://github.com/filiphric/trelloapp-workshop-app', commit: '40ef2daa837fafca5baeb46b57698480b9b0e329' },
};
await saveJson(resolve(directory, 'metadata.json'), metadata);
// Record a reproducible hash of implementation and lockfiles, without credentials/artifacts.
const { stdout: files } = await runFile('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, timeout: 10_000 });
const { readFile } = await import('node:fs/promises');
const sourceHash = createHash('sha256');
for (const file of files.trim().split('\n').sort()) if (file && !file.startsWith('demo/')) sourceHash.update(file).update(await readFile(resolve(root, file)));
await writeFile(resolve(directory, 'source.sha256'), sourceHash.digest('hex') + '\n');
try {
  await demo.start();
  for (const arm of order) {
    await resetDemo(demo.url);
    const armDir = resolve(directory, arm); await mkdir(armDir);
    const video = resolve(armDir, 'recording.webm');
    log.info({ arm }, 'Starting comparison arm');
    if (arm === 'jev') {
      const browser = new PlaywrightCli(armDir);
      let recording = false;
      try {
        await browser.open(demo.url);
        const initial = await browser.observe(); await saveJson(resolve(armDir, 'initial.json'), initial);
        await browser.startVideo(video); recording = true;
        const browserCallsBeforeRun = browser.calls;
        const result = await runAgent(browser, scenario.goal, initial, { testData });
        const timedBrowserCalls = browser.calls - browserCallsBeforeRun;
        await saveJson(resolve(armDir, 'run.json'), result);
        const verificationStarted = now();
        const verification = await verifyDemo(demo.url);
        const final = await browser.observe();
        await saveJson(resolve(armDir, 'final.json'), final);
        const visible = verifyVisiblePage(final);
        const record = { ...result, timedBrowserCalls, verified: verification.passed && visible && result.status === 'done', verification: { ...verification, visible }, verificationMs: now() - verificationStarted, browserCalls: browser.calls };
        records.jev = record; await saveJson(resolve(armDir, 'result.json'), record);
      } finally {
        try { if (recording) await browser.stopVideo(); } finally { await browser.close(); }
      }
    } else if (arm === 'cli_llm') {
      const browser = new NativePlaywrightCli(armDir);
      let recording = false;
      try {
        await browser.open(demo.url);
        const initial = await browser.native(['snapshot']); await saveJson(resolve(armDir, 'initial.json'), initial);
        await browser.startVideo(video); recording = true;
        const browserCallsBeforeRun = browser.calls;
        const result = await runCliBaseline(browser, scenario.goal, initial, testData);
        const timedBrowserCalls = browser.calls - browserCallsBeforeRun;
        await saveJson(resolve(armDir, 'run.json'), result);
        const verificationStarted = now();
        const verification = await verifyDemo(demo.url);
        const final = await browser.native(['snapshot']);
        await saveJson(resolve(armDir, 'final.json'), final);
        const visible = [scenario.board, scenario.list, scenario.card].every(name => final.includes(name));
        const record = { ...result, timedBrowserCalls, verified: verification.passed && visible && result.status === 'done', verification: { ...verification, visible }, verificationMs: now() - verificationStarted, browserCalls: browser.calls };
        records.cli_llm = record; await saveJson(resolve(armDir, 'result.json'), record);
      } finally {
        try { if (recording) await browser.stopVideo(); } finally { await browser.close(); }
      }
    } else {
      const browser = new PlaywrightMcp(armDir);
      let recording = false;
      try {
        await browser.connect();
        const initial = await browser.checkedTool('browser_navigate', { url: demo.url });
        await saveJson(resolve(armDir, 'initial.json'), initial);
        await browser.startVideo(video); recording = true;
        const browserCallsBeforeRun = browser.calls;
        const result = await runBaseline(browser, scenario.goal, initial, testData);
        const timedBrowserCalls = browser.calls - browserCallsBeforeRun;
        await saveJson(resolve(armDir, 'run.json'), result);
        const verificationStarted = now();
        const verification = await verifyDemo(demo.url);
        const final = await browser.checkedTool('browser_snapshot');
        await saveJson(resolve(armDir, 'final.json'), final);
        const visible = JSON.stringify(final).includes(scenario.list) && JSON.stringify(final).includes(scenario.card);
        const record = { ...result, timedBrowserCalls, verified: verification.passed && visible && result.status === 'done', verification: { ...verification, visible }, verificationMs: now() - verificationStarted, browserCalls: browser.calls };
        records.mcp = record; await saveJson(resolve(armDir, 'result.json'), record);
      } finally {
        try { if (recording) await browser.stopVideo(); } finally { await browser.close(); }
      }
    }
    await saveJson(resolve(directory, 'results.json'), records);
  }
} finally { await demo.close(); }
if (!values['no-render']) await renderComparison(directory);
log.info({ directory }, 'Comparison saved');
if (Object.values(records).some(record => !(record as { verified: boolean }).verified)) process.exitCode = 1;
