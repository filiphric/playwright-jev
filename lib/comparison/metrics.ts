import { z } from 'zod';

const count = z.number().int().nonnegative();
const price = z.number().nonnegative();
export const pricingSchema = z.object({
  currency: z.literal('USD'), verifiedOn: z.string(), basis: z.string(), cacheAccountingSource: z.string().url(),
  models: z.record(z.object({
    inputPerMillion: price, cachedInputPerMillion: price, cacheWritePerMillion: price, outputPerMillion: price,
    maxInputTokens: count, requiresCacheDetails: z.boolean(), source: z.string().url(),
  })),
});
export const resultSchema = z.object({
  elapsedMs: z.number().nonnegative(), verified: z.boolean(), status: z.string(),
  calls: z.array(z.object({ model: z.string(), usage: z.unknown().optional() })),
  timedBrowserCalls: count.optional(),
});
export const metricsInputSchema = z.object({ timedBrowserCalls: z.record(z.object({ count, basis: z.string() })) });
const usageSchema = z.object({
  input_tokens: count, output_tokens: count, total_tokens: count.optional(),
  input_tokens_details: z.object({ cached_tokens: count.optional(), cache_write_tokens: count.optional() }).optional(),
  output_tokens_details: z.object({ reasoning_tokens: count.optional() }).optional(),
});
type Pricing = z.infer<typeof pricingSchema>;
export function summarizeRun(raw: unknown, pricing: Pricing, legacyCount?: { count: number; basis: string }) {
  const result = resultSchema.parse(raw);
  const tokens = { input: 0, output: 0, total: 0, cachedInput: 0, cacheWrite: 0, ordinaryInput: 0, reasoning: 0 };
  const notes: string[] = [];
  let completeUsage = true, completePrice = true, estimatedCostUsd = 0;
  const calls = result.calls.map(call => {
    if (call.usage === undefined || call.usage === null) {
      completeUsage = false; completePrice = false; notes.push(`Missing usage for ${call.model}`);
      return { model: call.model, estimatedCostUsd: null };
    }
    const usage = usageSchema.parse(call.usage);
    const cached = usage.input_tokens_details?.cached_tokens ?? 0;
    const writes = usage.input_tokens_details?.cache_write_tokens ?? 0;
    const ordinary = usage.input_tokens - cached - writes;
    const reasoning = usage.output_tokens_details?.reasoning_tokens ?? 0;
    if (ordinary < 0 || reasoning > usage.output_tokens ||
      (usage.total_tokens !== undefined && usage.total_tokens !== usage.input_tokens + usage.output_tokens)) throw new Error('Inconsistent provider token usage');
    tokens.input += usage.input_tokens; tokens.output += usage.output_tokens;
    tokens.total += usage.input_tokens + usage.output_tokens;
    tokens.cachedInput += cached; tokens.cacheWrite += writes; tokens.ordinaryInput += ordinary; tokens.reasoning += reasoning;
    const rate = pricing.models[call.model];
    if (!rate || usage.input_tokens > rate.maxInputTokens ||
      (rate.requiresCacheDetails && (usage.input_tokens_details?.cached_tokens === undefined || usage.input_tokens_details.cache_write_tokens === undefined))) {
      completePrice = false; notes.push(`No applicable price or complete cache details for ${call.model}`);
      return { model: call.model, estimatedCostUsd: null };
    }
    // Cache reads and writes are subsets of input; reasoning is a subset of output.
    const cost = (ordinary * rate.inputPerMillion + cached * rate.cachedInputPerMillion +
      writes * rate.cacheWritePerMillion + usage.output_tokens * rate.outputPerMillion) / 1_000_000;
    estimatedCostUsd += cost;
    return { model: call.model, estimatedCostUsd: cost };
  });
  return {
    modelCalls: result.calls.length,
    toolCalls: result.timedBrowserCalls ?? legacyCount?.count ?? null,
    toolCallsBasis: result.timedBrowserCalls !== undefined ? 'Adapter counter difference immediately around the timed decision loop.' : legacyCount?.basis ?? 'Not recorded for this run.',
    tokens: completeUsage ? tokens : null,
    estimatedCostUsd: completePrice ? estimatedCostUsd : null,
    currency: pricing.currency, pricingVerifiedOn: pricing.verifiedOn, pricingBasis: pricing.basis,
    notes: [...new Set(notes)], calls,
  };
}
