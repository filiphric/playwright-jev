import { z } from 'zod';
import { jsonFetch, now } from '../shared/runtime.ts';
export async function baselineResponse(input: unknown[], tools: unknown[]) {
  const key = process.env.BASELINE_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Set OPENAI_API_KEY for the GPT-6 Astra baseline');
  const started = now();
  const result = await jsonFetch(`${(process.env.BASELINE_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/responses`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({ model: process.env.BASELINE_MODEL ?? 'gpt-6-astra', reasoning: { effort: process.env.BASELINE_REASONING ?? 'low' },
      input, tools, parallel_tool_calls: false, max_output_tokens: 4096, store: false, include: ['reasoning.encrypted_content'] }),
  });
  const parsed = z.object({ model: z.string(), status: z.string(), output: z.array(z.record(z.unknown())), usage: z.unknown().optional() }).parse(result);
  if (parsed.status !== 'completed') throw new Error(`Baseline response status: ${parsed.status}`);
  return { ...parsed, latencyMs: now() - started };
}
