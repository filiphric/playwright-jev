import { readFile } from 'node:fs/promises';
import { z } from 'zod';

// Labels describe the meaning of values, not selectors or an action sequence.
export const testDataSchema = z.record(
  z.string().min(1).max(100).refine(label => !!label.trim()),
  z.string().min(1).max(2000).refine(value => !!value.trim()),
).refine(data => Object.keys(data).length <= 50, 'At most 50 named input values are supported');
export type TestData = z.infer<typeof testDataSchema>;
export async function readTestData(path: string): Promise<TestData> {
  return testDataSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}
