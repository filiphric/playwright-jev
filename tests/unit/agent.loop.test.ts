import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../../lib/agent/loop.ts';
import type { BrowserAdapter, Decision, Observation } from '../../lib/agent/types.ts';
const page: Observation = { url: 'http://localhost', title: 'Form', text: 'Name', documentId: 'doc', fingerprint: 'one', scroll: { y: 0, height: 780, viewport: 780 }, elements: [{ id: '1', role: 'textbox', label: 'Name', value: '', operations: ['TYPE_TEXT'], guard: 'one' }] };
const testData = { name: 'Ada' };
const decision: Decision = { operation: 'TYPE_TEXT', target: '1', dataKey: 'name', text: 'Ada', confidence: 1, model: 'fake', latencyMs: 0 };
test('an uncertain mutation stops without replaying it', async () => {
  let executions = 0;
  const browser: BrowserAdapter = { observe: async () => page, close: async () => {}, execute: async () => { executions++; throw new Error('Action outcome uncertain'); } };
  const result = await runAgent(browser, 'Enter a name', page, { testData }, {
    now: () => 0, choose: async () => decision,
  });
  assert.equal(result.status, 'error'); assert.equal(executions, 1);
});
test('reconsider stale decisions with supplied data and no text helper', async () => {
  let executions = 0, choices = 0;
  const browser: BrowserAdapter = { observe: async () => page, close: async () => {}, execute: async action => {
    assert.equal(action.text, 'Ada');
    return { status: ++executions === 1 ? 'stale' : 'executed', observation: page, actionMs: 0 };
  } };
  const result = await runAgent(browser, 'Enter a name', page, { testData }, {
    now: () => 0, choose: async (_page, _goal, _history, data) => {
      assert.deepEqual(data, testData);
      return ++choices < 3 ? decision : { ...decision, operation: 'DONE', target: undefined, text: undefined, dataKey: undefined };
    },
  });
  assert.equal(result.status, 'done'); assert.equal(result.staleDecisions, 1); assert.equal(result.history.length, 1);
  assert.equal(result.calls.length, 3); assert.ok(result.calls.every(call => call.kind === 'jev'));
});
test('reject invented text before any browser mutation', async () => {
  let executions = 0;
  const browser: BrowserAdapter = { observe: async () => page, close: async () => {}, execute: async () => { executions++; throw new Error('Must not execute'); } };
  const result = await runAgent(browser, 'Enter a name', page, { testData }, { now: () => 0, choose: async () => ({ ...decision, text: 'Invented' }) });
  assert.equal(result.status, 'error'); assert.match(result.error!, /outside the supplied test data/); assert.equal(executions, 0);
});
