import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDataSchema } from '../../lib/agent/data.ts';
test('input data must contain bounded named strings and preserves exact values', () => {
  for (const value of [null, ['Ada'], { name: null }, { name: '' }, { name: '   ' }, { '': 'Ada' }, { name: 'x'.repeat(2001) }, { name: { execute: 'click' } }]) assert.throws(() => testDataSchema.parse(value));
  assert.deepEqual(testDataSchema.parse({ name: ' Ada ' }), { name: ' Ada ' });
});
