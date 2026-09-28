import { z } from 'zod';
import { jsonFetch } from '../shared/runtime.ts';
import type { Observation } from '../agent/types.ts';
import suppliedData from '../../test-data/trello.json' with { type: 'json' };
import { testDataSchema } from '../agent/data.ts';
export const testData = testDataSchema.parse(suppliedData);
export const scenario = {
  board: testData.board, list: testData.list, card: testData.card,
  goal: `Create a board named ${JSON.stringify(testData.board)}, add a list named ${JSON.stringify(testData.list)} to that board, and add a card named ${JSON.stringify(testData.card)} to that list. Stop when the card is visible. Do not create duplicates.`,
};
const entity = z.object({ id: z.union([z.number(), z.string()]), name: z.string() }).passthrough();
export function verifyEntities(raw: unknown) {
  const data = z.object({ boards: z.array(entity), lists: z.array(entity.extend({ boardId: z.union([z.number(), z.string()]) })), cards: z.array(entity.extend({ boardId: z.union([z.number(), z.string()]), listId: z.union([z.number(), z.string()]) })) }).parse(raw);
  const board = data.boards.find(b => b.name === scenario.board);
  const list = data.lists.find(l => l.name === scenario.list && String(l.boardId) === String(board?.id));
  const card = data.cards.find(c => c.name === scenario.card && String(c.listId) === String(list?.id) && String(c.boardId) === String(board?.id));
  const checks = { board: !!board, list: !!list, card: !!card, noDuplicates: data.boards.length === 1 && data.lists.length === 1 && data.cards.length === 1 };
  return { passed: Object.values(checks).every(Boolean), checks, data };
}
export async function resetDemo(url: string) {
  const parsed = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) throw new Error('Demo reset is restricted to localhost');
  await jsonFetch(`${url}/api/reset`, { method: 'POST' });
  const state = await readEntities(url);
  if (Object.values(state).some(rows => rows.length)) throw new Error('Demo reset did not produce an empty state');
}
export async function readEntities(url: string) {
  const values = await Promise.all(['boards', 'lists', 'cards'].map(path => jsonFetch(`${url}/api/${path}`)));
  return { boards: z.array(z.unknown()).parse(values[0]), lists: z.array(z.unknown()).parse(values[1]), cards: z.array(z.unknown()).parse(values[2]) };
}
export async function verifyDemo(url: string) { return verifyEntities(await readEntities(url)); }
export function verifyVisiblePage(page: Observation) {
  const displayed = [page.text, ...page.elements.map(element => element.value || element.label)];
  return new URL(page.url).pathname.startsWith('/board/') && [scenario.board, scenario.list, scenario.card].every(name => displayed.some(value => value.includes(name)));
}
