import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import { observationSchema, type Action, type BrowserAdapter, type Observation, type Receipt } from '../agent/types.ts';
import { now, root, runFile, saveJson, prepareDirectory, browserEnv } from '../shared/runtime.ts';
import { readPage } from './snapshot.ts';

// tsx/esbuild may insert __name in serialized functions; define it in the browser expression.
export const snapshotExpression = `(() => { const __name = (fn) => fn; return (${readPage.toString()})(); })()`;
export class PlaywrightCli implements BrowserAdapter {
  readonly session = `jev-${randomUUID().slice(0, 8)}`;
  calls = 0;
  constructor(readonly directory: string) {}
  async command(args: string[], raw = true): Promise<string> {
    this.calls++;
    const { stdout } = await runFile(process.execPath, [resolve(root, 'node_modules/@playwright/cli/playwright-cli.js'), `-s=${this.session}`, ...(raw ? ['--raw'] : []), ...args], {
      cwd: root, timeout: 45_000, maxBuffer: 4 * 1024 * 1024,
      env: browserEnv(),
    });
    if (/^### Error/m.test(stdout)) throw new Error(stdout.slice(0, 2000));
    return stdout.trim();
  }
  async code<T>(code: string): Promise<T> {
    const output = await this.command(['run-code', code]);
    try { return JSON.parse(output) as T; }
    catch { throw new Error(`Playwright CLI returned invalid JSON: ${output.slice(0, 1000)}`); }
  }
  async open(url: string, snapshotMode: 'none' | 'full' = 'none') {
    await prepareDirectory(this.directory);
    const config = resolve(this.directory, 'cli-config.json');
    await saveJson(config, { browser: { browserName: 'chromium', launchOptions: { channel: 'chrome', headless: true }, contextOptions: { viewport: { width: 1120, height: 780 } } },
      timeouts: { action: 3000, navigation: 15000, settle: 50 }, snapshot: { mode: snapshotMode }, outputDir: this.directory });
    await this.command(['open', url, `--config=${config}`]);
  }
  async observe(): Promise<Observation> {
    return observationSchema.parse(await this.code(`async page => await page.evaluate(${JSON.stringify(snapshotExpression)})`));
  }
  async execute(action: Action, observation: Observation): Promise<Receipt> {
    const started = now();
    const target = observation.elements.find(e => e.id === action.target);
    if (action.target && (!target || !target.operations.includes(action.operation))) throw new Error('Action is outside the observed menu');
    if (action.operation === 'SELECT' && !target?.options?.some(o => o.value === action.option)) throw new Error('Unobserved select option');
    if (action.operation === 'TYPE_TEXT' && (typeof action.text !== 'string' || !action.text.trim() || action.text.length > 2000)) throw new Error('Invalid text value');
    const result = await this.code<unknown>(`async page => {
      const snapshot = async () => await page.evaluate(${JSON.stringify(snapshotExpression)});
      const action = ${JSON.stringify(action)};
      const expected = ${JSON.stringify({ documentId: observation.documentId, url: observation.url, fingerprint: observation.fingerprint })};
      const current = await snapshot();
      if (current.documentId !== expected.documentId || current.url !== expected.url || current.fingerprint !== expected.fingerprint)
        return { status: 'stale', observation: current };
      let handle;
      try {
        if (action.target) {
          handle = await page.evaluateHandle(id => window.__playwrightJev?.nodes.get(id), action.target);
          const element = handle.asElement();
          if (!element || !await element.isVisible() || !await element.isEnabled()) return { status: 'stale', observation: await snapshot() };
          if (action.operation === 'CLICK') await element.click({ timeout: 3000 });
          else if (action.operation === 'TYPE_TEXT') await element.fill(action.text, { timeout: 3000 });
          else if (action.operation === 'PRESS_ENTER') await element.press('Enter', { timeout: 3000 });
          else if (action.operation === 'SELECT') await element.selectOption(action.option, { timeout: 3000 });
          else throw new Error('Unsupported target operation');
        } else if (action.operation === 'SCROLL_DOWN' || action.operation === 'SCROLL_UP') {
          await page.mouse.wheel(0, action.operation === 'SCROLL_DOWN' ? 560 : -560);
        } else if (action.operation !== 'WAIT') throw new Error('Unsupported operation');
      } finally { if (handle) await handle.dispose(); }
      // Mutation completed. Never recast a subsequent observation failure as a retryable action.
      try {
        await page.waitForFunction(previous => {
          const read = ${snapshotExpression};
          return read.fingerprint !== previous;
        }, current.fingerprint, { timeout: action.operation === 'WAIT' ? 250 : 100 }).catch(() => {});
        return { status: 'executed', observation: await snapshot() };
      } catch (error) { return { status: 'executed', observation: current, observationError: 'Action executed but observation failed; do not replay: ' + error.message }; }
    }`);
    const parsed = z.object({ status: z.enum(['executed', 'stale']), observation: observationSchema, observationError: z.string().optional() }).parse(result);
    return { ...parsed, actionMs: now() - started };
  }
  async startVideo(path: string) { await this.command(['video-start', path, '--size=1120x780', '--fps=25']); }
  async stopVideo() { await this.command(['video-stop']); }
  async close() { await this.command(['close']); }
}
