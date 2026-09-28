import { test, expect } from '@playwright/test';
import { PlaywrightCli } from '../../lib/browser/cli.ts';
import { readPage } from '../../lib/browser/snapshot.ts';
import { resetDemo, scenario, verifyDemo } from '../../lib/demo/scenario.ts';
import type { Action } from '../../lib/agent/types.ts';
import { NativePlaywrightCli } from '../../lib/browser/cli-native.ts';

test.beforeEach(async () => { await resetDemo('http://127.0.0.1:3100'); });
test.afterEach(async () => { await resetDemo('http://127.0.0.1:3100'); });
test('observer discovers pointer div controls and excludes hidden and disabled controls', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByPlaceholder('Name of your first board')).toBeVisible();
  await page.evaluate(() => { document.body.insertAdjacentHTML('afterbegin', '<div style="cursor:pointer;position:fixed;top:50px">Pointer control</div><button disabled>Disabled sentinel</button><button hidden>Hidden sentinel</button>'); });
  await expect.poll(async () => (await page.evaluate(readPage)).elements.some(e => e.label === 'Pointer control')).toBe(true);
  await expect.poll(async () => (await page.evaluate(readPage)).elements.some(e => e.label.includes('sentinel'))).toBe(false);
});
test('native CLI baseline completes the UI using accessibility refs and command snapshots', async () => {
  const browser = new NativePlaywrightCli(process.cwd() + '/artifacts/e2e-native');
  try {
    await browser.open('http://127.0.0.1:3100');
    let snapshot = await browser.native(['snapshot']);
    const call = async (name: string, args: Record<string, unknown>) => {
      const output = await browser.tool(name, args);
      // CLI may omit a snapshot after filling; existing refs remain usable.
      if (/\[ref=e\d+\]/.test(output)) snapshot = output;
      return output;
    };
    const ref = (label: string) => {
      const line = snapshot.split('\n').find(line => line.includes(label) && /\[ref=e\d+\]/.test(line));
      expect(line, snapshot).toBeTruthy();
      return line!.match(/\[ref=(e\d+)\]/)![1];
    };
    await call('cli_fill', { target: ref('Name of your first board'), text: scenario.board, submit: true });
    await call('cli_fill', { target: ref('Enter list title...'), text: scenario.list });
    await call('cli_click', { target: ref('Add list') });
    await call('cli_click', { target: ref('Add another card') });
    await call('cli_fill', { target: ref('Enter a title for this card...'), text: scenario.card });
    await call('cli_click', { target: ref('Add card') });
    expect(snapshot).toContain(scenario.card);
    await expect.poll(async () => (await verifyDemo('http://127.0.0.1:3100')).passed).toBe(true);
  } finally { await browser.close(); }
});
test('CLI adapter completes the real UI and rejects a stale decision without duplicating a mutation', async () => {
  const browser = new PlaywrightCli(process.cwd() + '/artifacts/e2e');
  try {
    await browser.open('http://127.0.0.1:3100');
    let observation = await browser.observe();
    const perform = async (label: string, operation: Action['operation'], text?: string) => {
      try {
        await expect.poll(async () => { observation = await browser.observe(); return observation.elements.some(e => e.label === label); }).toBe(true);
      } catch (error) {
        await test.info().attach('observation', { body: JSON.stringify(observation, null, 2), contentType: 'application/json' });
        await browser.command(['screenshot', '--filename=artifacts/e2e/failure.png']);
        throw new Error(`Missing ${label}; observed: ${observation.elements.map(e => e.label).join(' | ')}`, { cause: error });
      }
      const target = observation.elements.find(e => e.label === label)!;
      const receipt = await browser.execute({ operation, target: target.id, text, confidence: 1, model: 'offline-test', latencyMs: 0 }, observation);
      expect(receipt.status).toBe('executed'); observation = receipt.observation;
    };
    const stale = observation;
    await perform('Name of your first board', 'TYPE_TEXT', scenario.board);
    const create = stale.elements.find(e => e.label === 'Name of your first board')!;
    expect((await browser.execute({ operation: 'PRESS_ENTER', target: create.id, confidence: 1, model: 'test', latencyMs: 0 }, stale)).status).toBe('stale');
    await perform('Name of your first board', 'PRESS_ENTER');
    await perform('Enter list title...', 'TYPE_TEXT', scenario.list);
    await perform('Add list', 'CLICK');
    await perform('Add another card', 'CLICK');
    await perform('Enter a title for this card...', 'TYPE_TEXT', scenario.card);
    await perform('Add card', 'CLICK');
    await expect.poll(async () => (await verifyDemo('http://127.0.0.1:3100')).passed).toBe(true);
  } finally { await browser.close(); }
});
