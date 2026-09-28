import { z } from 'zod';
export const operationSchema = z.enum(['CLICK', 'TYPE_TEXT', 'SELECT', 'PRESS_ENTER', 'SCROLL_UP', 'SCROLL_DOWN', 'WAIT', 'DONE', 'BLOCKED']);
export type Operation = z.infer<typeof operationSchema>;
export const elementSchema = z.object({
  id: z.string(), role: z.string(), label: z.string(), value: z.string(),
  operations: z.array(operationSchema), checked: z.boolean().optional(),
  options: z.array(z.object({ id: z.string(), label: z.string(), value: z.string() })).optional(),
  guard: z.string(),
});
export const observationSchema = z.object({
  url: z.string(), title: z.string(), text: z.string(), documentId: z.string(),
  elements: z.array(elementSchema), fingerprint: z.string(),
  scroll: z.object({ y: z.number(), height: z.number(), viewport: z.number() }),
});
export type Element = z.infer<typeof elementSchema>;
export type Observation = z.infer<typeof observationSchema>;
export interface Decision {
  operation: Operation; target?: string; option?: string; text?: string; dataKey?: string;
  confidence: number; latencyMs: number; usage?: unknown; model: string;
}
export type Action = Decision;
export interface Receipt { status: 'executed' | 'stale'; observation: Observation; actionMs: number; observationError?: string }
export interface BrowserAdapter {
  observe(): Promise<Observation>;
  execute(action: Action, observation: Observation): Promise<Receipt>;
  close(): Promise<void>;
}
export interface ModelCall { kind: string; model: string; latencyMs: number; usage?: unknown }
export interface HistoryEntry { operation: Operation; label?: string; text?: string; elapsedMs: number }
export interface AgentResult {
  status: 'done' | 'blocked' | 'budget_exhausted' | 'error';
  elapsedMs: number; history: HistoryEntry[]; calls: ModelCall[];
  staleDecisions: number; error?: string;
}
