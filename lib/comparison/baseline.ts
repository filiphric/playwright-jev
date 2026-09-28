import { z } from 'zod';
import { PlaywrightMcp } from '../browser/mcp.ts';
import { baselineResponse } from '../models/responses.ts';
import { policy } from '../models/jev.ts';
import { logger, now } from '../shared/runtime.ts';
import type { TestData } from '../agent/data.ts';
import { NativePlaywrightCli, nativeCliTools } from '../browser/cli-native.ts';
const log = logger.child({ module: 'baseline' });
export const allowedTools = new Set(['browser_snapshot', 'browser_click', 'browser_type', 'browser_fill_form', 'browser_press_key', 'browser_select_option', 'browser_wait_for', 'browser_hover']);
export async function runBaseline(browser: PlaywrightMcp, goal: string, snapshot: unknown, testData: TestData = {}) {
  const catalog = await browser.client.listTools({}, { timeout: 30_000 });
  const tools = catalog.tools.filter(tool => allowedTools.has(tool.name)).map(tool => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.inputSchema, strict: false }));
  return runToolAgent({ name: 'mcp', tools, execute: (name, args) => browser.tool(name, args) }, goal, snapshot, testData);
}
export async function runCliBaseline(browser: NativePlaywrightCli, goal: string, snapshot: unknown, testData: TestData = {}) {
  return runToolAgent({ name: 'cli_llm', tools: nativeCliTools, execute: (name, args) => browser.tool(name, args) }, goal, snapshot, testData);
}
interface ToolDriver {
  name: string;
  tools: { name: string; [key: string]: unknown }[];
  execute(name: string, args: Record<string, unknown>): Promise<unknown>;
}
export async function runToolAgent(driver: ToolDriver, goal: string, snapshot: unknown, testData: TestData = {}, dependencies = { respond: baselineResponse, now }) {
  const tools = [...driver.tools, { type: 'function', name: 'finish', description: 'Stop when the entire goal is visibly complete or progress is blocked.', parameters: { type: 'object', properties: { status: { type: 'string', enum: ['done', 'blocked'] } }, required: ['status'], additionalProperties: false }, strict: false }];
  const offered = new Set(driver.tools.map(tool => tool.name));
  const input: unknown[] = [{ role: 'system', content: `${policy} Use only the browser UI tools. Do not call APIs or inspect app internals. The browser is already on the starting page. Call finish when done. Efficiently use the snapshots returned by actions.` },
    { role: 'user', content: `${goal}\n\nSupplied test data (use these exact values):\n${JSON.stringify(testData)}\n\nInitial browser observation:\n${JSON.stringify(snapshot)}` }];
  const calls: { model: string; latencyMs: number; usage?: unknown }[] = [];
  const history: { tool: string; arguments: unknown; result: unknown; elapsedMs: number }[] = [];
  const started = dependencies.now();
  let status: 'done' | 'blocked' | 'budget_exhausted' | 'error' = 'budget_exhausted', error: string | undefined;
  try {
    for (let step = 0; step < 40 && dependencies.now() - started < 300_000; step++) {
      const response = await dependencies.respond(input, tools);
      calls.push({ model: response.model, latencyMs: response.latencyMs, usage: response.usage });
      input.push(...response.output);
      const actions = response.output.filter(item => item.type === 'function_call');
      if (!actions.length) throw new Error('Baseline ended without calling finish');
      for (const raw of actions) {
        const action = z.object({ name: z.string(), arguments: z.string(), call_id: z.string() }).parse(raw);
        const args = z.record(z.unknown()).parse(JSON.parse(action.arguments));
        log.info({ arm: driver.name, step, tool: action.name }, 'LLM baseline decision');
        if (action.name === 'finish') { status = z.enum(['done', 'blocked']).parse(args.status); break; }
        if (!offered.has(action.name)) throw new Error('Baseline requested an unoffered tool');
        const result = await driver.execute(action.name, args);
        history.push({ tool: action.name, arguments: args, result, elapsedMs: dependencies.now() - started });
        input.push({ type: 'function_call_output', call_id: action.call_id, output: JSON.stringify(result) });
      }
      if (status === 'done' || status === 'blocked') break;
    }
  } catch (cause) { status = 'error'; error = cause instanceof Error ? cause.message : String(cause); }
  return { status, error, elapsedMs: dependencies.now() - started, calls, history };
}
