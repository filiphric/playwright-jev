import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenario, verifyEntities } from '../../lib/demo/scenario.ts';
test('verification requires correct names, parent relationships and no duplicates', () => {
  const data = { boards: [{ id: 1, name: scenario.board }], lists: [{ id: 2, boardId: 1, name: scenario.list }], cards: [{ id: 3, boardId: 1, listId: 2, name: scenario.card }] };
  assert.equal(verifyEntities(data).passed, true);
  assert.equal(verifyEntities({ ...data, cards: [{ ...data.cards[0], listId: 7 }] }).passed, false);
  assert.equal(verifyEntities({ ...data, cards: [...data.cards, data.cards[0]] }).passed, false);
});

test('visible form values count as visible titles, while missing card text fails', async () => {
  const { verifyVisiblePage } = await import('../../lib/demo/scenario.ts');
  const page = { url: 'http://localhost/board/1', title: 'Trello', text: scenario.card, documentId: 'd', fingerprint: 'f', scroll: { y: 0, height: 780, viewport: 780 }, elements: [scenario.board, scenario.list].map((value, index) => ({ id: String(index), role: 'textbox', label: '', value, guard: '', operations: [] })) };
  assert.equal(verifyVisiblePage(page), true);
  assert.equal(verifyVisiblePage({ ...page, text: '' }), false);
});
