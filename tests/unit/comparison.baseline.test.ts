import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativeCommand, nativeCliTools } from '../../lib/browser/cli-native.ts';
import { runToolAgent } from '../../lib/comparison/baseline.ts';

test('native commands preserve text as argv and reject code, arbitrary selectors and extra options', () => {
  const text = 'A name with "quotes" and $(shell syntax)';
  assert.deepEqual(nativeCommand('cli_fill', { target: 'e16', text }), ['fill', 'e16', text]);
  assert.throws(() => nativeCommand('run-code', { code: 'page.evaluate(...)' }));
  assert.throws(() => nativeCommand('cli_click', { target: '#private' }));
  assert.deepEqual(nativeCommand('cli_fill', { target: 'e16', text, submit: true }), ['fill', 'e16', text, '--submit']);
  assert.throws(() => nativeCommand('cli_fill', { target: 'e16', text, code: 'unexpected' }));
});
test('LLM receives supplied data and each native command result before deciding again', async () => {
  let requests = 0, commands = 0;
  const result = await runToolAgent({ name: 'test', tools: nativeCliTools, execute: async (name, args) => {
    assert.equal(name, 'cli_fill'); assert.deepEqual(args, { target: 'e16', text: 'Product launch' }); commands++;
    return 'Updated snapshot: board field contains Product launch';
  } }, 'Create board', 'Initial snapshot', { board: 'Product launch' }, {
    now: () => 0, respond: async (input) => {
      assert.ok(JSON.stringify(input).includes('Product launch'));
      if (requests++) assert.ok(JSON.stringify(input).includes('Updated snapshot'));
      return { model: 'fake', status: 'completed', latencyMs: 0, output: [{ type: 'function_call', call_id: String(requests), name: requests === 1 ? 'cli_fill' : 'finish', arguments: JSON.stringify(requests === 1 ? { target: 'e16', text: 'Product launch' } : { status: 'done' }) }] };
    },
  });
  assert.equal(result.status, 'done'); assert.equal(result.calls.length, 2); assert.equal(commands, 1); assert.equal(result.history.length, 1);
});
test('native baseline stops after an uncertain command failure instead of replaying it', async () => {
  let commands = 0;
  const result = await runToolAgent({ name: 'test', tools: nativeCliTools, execute: async () => { commands++; throw new Error('Uncertain action'); } }, 'Create', 'Page', {}, {
    now: () => 0, respond: async () => ({ model: 'fake', status: 'completed', latencyMs: 0, output: [{ type: 'function_call', call_id: '1', name: 'cli_click', arguments: '{"target":"e16"}' }] }),
  });
  assert.equal(result.status, 'error'); assert.equal(commands, 1); assert.equal(result.calls.length, 1);
});
