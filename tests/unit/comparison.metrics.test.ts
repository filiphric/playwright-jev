import { test } from 'node:test';
import assert from 'node:assert/strict';
import pricingData from '../../config/pricing.json' with { type: 'json' };
import { pricingSchema, summarizeRun } from '../../lib/comparison/metrics.ts';

const pricing = pricingSchema.parse(pricingData);
const run = (model: string, usage?: unknown) => ({ elapsedMs: 1, verified: true, status: 'done', calls: [{ model, usage }], timedBrowserCalls: 8 });
test('API price accounts for cached input and cache writes without double counting reasoning', () => {
  const summary = summarizeRun(run('gpt-6-astra', {
    input_tokens: 1000, output_tokens: 100, total_tokens: 1100,
    input_tokens_details: { cached_tokens: 700, cache_write_tokens: 200 },
    output_tokens_details: { reasoning_tokens: 50 },
  }), pricing);
  assert.equal(summary.estimatedCostUsd, 0.0092);
  assert.deepEqual(summary.tokens, { input: 1000, output: 100, total: 1100, cachedInput: 700, cacheWrite: 200, ordinaryInput: 100, reasoning: 50 });
  assert.equal(summary.toolCalls, 8);
});
test('Jev reports output tokens but charges only for input', () => {
  const summary = summarizeRun(run('jev-1.13.0', { input_tokens: 28615, output_tokens: 2721 }), pricing);
  assert.equal(summary.estimatedCostUsd, 0.00120183);
  assert.equal(summary.tokens?.total, 31336);
});
test('missing usage, unknown rates or missing cache details never look free', () => {
  assert.equal(summarizeRun(run('gpt-6-astra'), pricing).tokens, null);
  assert.equal(summarizeRun(run('gpt-6-astra'), pricing).estimatedCostUsd, null);
  assert.equal(summarizeRun(run('unknown-model', { input_tokens: 10, output_tokens: 1 }), pricing).estimatedCostUsd, null);
  assert.equal(summarizeRun(run('gpt-6-astra', { input_tokens: 10, output_tokens: 1 }), pricing).estimatedCostUsd, null);
});
test('inconsistent token reports fail and legacy call counts need an explicit basis', () => {
  assert.throws(() => summarizeRun(run('gpt-6-astra', { input_tokens: 10, output_tokens: 1, input_tokens_details: { cached_tokens: 11 } }), pricing));
  assert.throws(() => summarizeRun(run('jev-1.13.0', { input_tokens: 10, output_tokens: 1, total_tokens: 12 }), pricing));
  const legacy = { ...run('jev-1.13.0', { input_tokens: 10, output_tokens: 1 }), timedBrowserCalls: undefined };
  assert.equal(summarizeRun(legacy, pricing).toolCalls, null);
  const summary = summarizeRun(legacy, pricing, { count: 22, basis: 'Saved counter less documented setup calls' });
  assert.equal(summary.toolCalls, 22); assert.match(summary.toolCallsBasis, /Saved counter/);
});
