import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { PlaywrightCli } from '../browser/cli.ts';
import { loadEnv, root, saveJson, logger } from '../shared/runtime.ts';
import { runAgent } from './loop.ts';
import { readTestData } from './data.ts';
const log = logger.child({ module: 'cli' });
loadEnv();
const { values } = parseArgs({ options: { url: { type: 'string' }, goal: { type: 'string' }, data: { type: 'string' }, output: { type: 'string', default: 'artifacts/run' } } });
if (!values.url || !values.goal) throw new Error('Usage: npm run jev -- --url URL --goal "Task" [--data test-data/trello.json] [--output artifacts/run]');
const testData = values.data ? await readTestData(resolve(root, values.data)) : {};
const browser = new PlaywrightCli(resolve(root, values.output));
try {
  await browser.open(values.url);
  const initial = await browser.observe();
  const result = await runAgent(browser, values.goal, initial, { testData });
  await saveJson(resolve(browser.directory, 'result.json'), { ...result, goal: values.goal, testData });
  log.info({ status: result.status, elapsedMs: result.elapsedMs, error: result.error }, 'Run finished; DONE is not independent verification');
  if (result.status !== 'done') process.exitCode = 1;
} finally { await browser.close(); }
