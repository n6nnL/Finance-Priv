// ============================================================
//  test/categories.test.js — customId кодлол + ангилал mapping
//  (discord.js шаардахгүй цэвэр логик)
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, categoryByIndex, indexOfCategory, encodeButtonId, encodeModalId, parseId } from '../categories.js';

test('10 ангилал', () => {
  assert.equal(CATEGORIES.length, 10);
  assert.equal(CATEGORIES[0], 'Гадуур хооллолт');
  assert.equal(CATEGORIES[9], 'Бусад');
});

test('categoryByIndex / indexOfCategory', () => {
  assert.equal(categoryByIndex(0), 'Гадуур хооллолт');
  assert.equal(categoryByIndex(5), 'Захиалга & сервис');
  assert.equal(categoryByIndex(99), null);
  assert.equal(categoryByIndex(-1), null);
  assert.equal(indexOfCategory('Тээвэр'), 2);
});

test('button customId encode/parse roundtrip', () => {
  const id = encodeButtonId(123, 4, true);
  assert.equal(id, 'c|123|4|1');
  const p = parseId(id);
  assert.deepEqual({ kind: p.kind, txnId: p.txnId, catIdx: p.catIdx, isPos: p.isPos }, { kind: 'c', txnId: 123, catIdx: 4, isPos: true });
});

test('modal customId encode/parse (messageId-тэй)', () => {
  const id = encodeModalId(77, 0, false, '1234567890123456789');
  const p = parseId(id);
  assert.equal(p.kind, 'm');
  assert.equal(p.txnId, 77);
  assert.equal(p.catIdx, 0);
  assert.equal(p.isPos, false);
  assert.equal(p.messageId, '1234567890123456789');
});

test('parseId буруу → null', () => {
  assert.equal(parseId('garbage'), null);
  assert.equal(parseId(''), null);
  assert.equal(parseId(null), null);
});
