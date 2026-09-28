import { choose } from '../models/jev.ts';
import { testDataSchema, type TestData } from './data.ts';
import { logger, now } from '../shared/runtime.ts';
import type { AgentResult, BrowserAdapter, Observation } from './types.ts';
const log = logger.child({ module: 'agent' });
export async function runAgent(browser: BrowserAdapter, goal: string, initial: Observation, options: { testData?: TestData; maxDecisions?: number; maxActions?: number; maxMs?: number } = {}, dependencies = { choose, now }): Promise<AgentResult> {
  const testData = testDataSchema.parse(options.testData ?? {});
  const clock = dependencies.now;
  const started = clock();
  const result: AgentResult = { status: 'budget_exhausted', elapsedMs: 0, history: [], calls: [], staleDecisions: 0 };
  let page = initial;
  try {
    for (let step = 0; step < (options.maxDecisions ?? 60) && result.history.length < (options.maxActions ?? 40); step++) {
      if (clock() - started > (options.maxMs ?? 180_000)) break;
      // CLI action responses can contain a snapshot captured before its own
      // post-action settling completed. Read the current state before deciding.
      if (step > 0) page = await browser.observe();
      const decision = await dependencies.choose(page, goal, result.history, testData);
      result.calls.push({ kind: 'jev', model: decision.model, latencyMs: decision.latencyMs, usage: decision.usage });
      log.info({ step, operation: decision.operation, target: decision.target }, 'Jev decision');
      if (decision.operation === 'DONE' || decision.operation === 'BLOCKED') {
        const current = await browser.observe();
        if (current.fingerprint !== page.fingerprint) { result.staleDecisions++; page = current; continue; }
        result.status = decision.operation === 'DONE' ? 'done' : 'blocked'; break;
      }
      const target = page.elements.find(e => e.id === decision.target);
      const text = decision.text;
      if (decision.operation === 'TYPE_TEXT') {
        if (!target) throw new Error('Missing observed field');
        if (!decision.dataKey || !Object.hasOwn(testData, decision.dataKey) || text !== testData[decision.dataKey]) throw new Error('Text is outside the supplied test data');
        const current = await browser.observe();
        if (current.fingerprint !== page.fingerprint) { result.staleDecisions++; page = current; continue; }
      }
      const receipt = await browser.execute({ ...decision, text }, page);
      if (receipt.status === 'executed') {
        result.history.push({ operation: decision.operation, label: target?.label, text, elapsedMs: clock() - started });
      } else result.staleDecisions++;
      if (receipt.observationError) throw new Error(receipt.observationError);
      page = receipt.observation;
    }
  } catch (error) { result.status = 'error'; result.error = error instanceof Error ? error.message : String(error); }
  result.elapsedMs = clock() - started;
  return result;
}
