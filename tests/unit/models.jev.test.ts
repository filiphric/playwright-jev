import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, decodeDecision, validateChoice } from '../../lib/models/jev.ts';
import type { Observation } from '../../lib/agent/types.ts';
export const observation: Observation = { url: 'http://localhost', title: 'Form', text: 'Name Submit', documentId: 'doc', fingerprint: 'fingerprint', scroll: { y: 0, height: 780, viewport: 780 }, elements: [
  { id: '1', role: 'textbox', label: 'Name', value: '', operations: ['TYPE_TEXT'], guard: 'one' },
  { id: '2', role: 'button', label: 'Submit', value: '', operations: ['CLICK'], guard: 'two' },
] };
const answer = (choice: string, ids: string[]) => ({ choice, confidence: .9, probabilities: Object.fromEntries(ids.map(id => [id, id === choice ? 1 : 0])) });
const testData = { name: 'Ada', city: 'Prague' };
test('operation and speculative target questions share one request', () => {
  const request = buildRequest(observation, 'Create', [], testData);
  assert.deepEqual(Object.keys(request.questions), ['operation', 'type_text_target', 'click_target']);
  assert.ok(!JSON.stringify(request.state).includes('"guard"'));
});
test('only the matching target head can execute', () => {
  const raw = { model: 'test', answers: { operation: answer('CLICK', ['TYPE_TEXT', 'CLICK', 'WAIT', 'DONE', 'BLOCKED']), click_target: answer('2', ['2']), type_text_target: { invalid: true } } };
  assert.equal(decodeDecision(raw, observation, testData).target, '2');
  raw.answers.click_target = answer('1', ['1']);
  assert.throws(() => decodeDecision(raw, observation, testData));
});
test('one choice binds an observed field to an exact supplied value', () => {
  const data = { name: '  Ada  ', city: 'Prague' };
  const request = buildRequest(observation, 'Enter name', [], data);
  const head = request.questions.type_text_target as { criteria: Record<string, { supplied_data_label: string; text_to_enter: string }> };
  const ids = Object.keys(head.criteria);
  const selected = ids.find(id => head.criteria[id].supplied_data_label === 'name')!;
  const raw = { model: 'test', answers: { operation: answer('TYPE_TEXT', ['TYPE_TEXT', 'CLICK', 'WAIT', 'DONE', 'BLOCKED']), type_text_target: answer(selected, ids) } };
  const decoded = decodeDecision(raw, observation, data);
  assert.equal(decoded.target, '1'); assert.equal(decoded.dataKey, 'name'); assert.equal(decoded.text, '  Ada  ');
  raw.answers.type_text_target = answer('invented', ids);
  assert.throws(() => decodeDecision(raw, observation, data));
});
test('typing is not offered without supplied data', () => {
  const request = buildRequest(observation, 'Create', []);
  assert.equal(request.questions.type_text_target, undefined);
  const operation = request.questions.operation as { criteria: Record<string, string> };
  assert.equal(operation.criteria.TYPE_TEXT, undefined);
});
test('reject unknown choices, invalid probabilities and non-maximal selections', () => {
  assert.throws(() => validateChoice(answer('x', ['a']), ['a']));
  assert.throws(() => validateChoice({ choice: 'a', confidence: 1, probabilities: { a: NaN } }, ['a']));
  assert.throws(() => validateChoice({ choice: 'a', confidence: 1, probabilities: { a: .2, b: .8 } }, ['a', 'b']));
});
