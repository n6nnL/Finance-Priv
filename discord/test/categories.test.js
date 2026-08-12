// ============================================================
//  test/categories.test.js — customId кодлол + ангилал mapping
//  (discord.js шаардахгүй цэвэр логик)
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, categoryById, idOfCategory, encodeButtonId, encodeModalId, parseId } from '../categories.js';

test('12 ангилал (018-д 2 нэмэгдсэн, ТӨГСГӨЛД)', () => {
  assert.equal(CATEGORIES.length, 12);
  assert.equal(CATEGORIES[0], 'Гадуур хооллолт');
  assert.equal(CATEGORIES[9], 'Бусад');          // хуучин эрэмбэ ХӨДӨЛӨӨГҮЙ
  assert.equal(CATEGORIES[10], 'Эрүүл мэнд');
  assert.equal(CATEGORIES[11], 'Орон сууц & коммунал');
});

test('categoryById / idOfCategory', () => {
  assert.equal(categoryById('dining'), 'Гадуур хооллолт');
  assert.equal(categoryById('subs'), 'Захиалга & сервис');
  assert.equal(categoryById('nosuch'), null);
  assert.equal(categoryById(''), null);
  assert.equal(idOfCategory('Тээвэр'), 'transport');
  assert.equal(idOfCategory('Байхгүй'), null);
});

test('★ ХУУЧИН индекс-payload-ыг ХҮЛЭЭЖ АВАХГҮЙ (fail-safe)', () => {
  // Deploy-ийн өмнөх товч: 'c|123|4|1'. Массив руу индекслэх fallback БАЙХГҮЙ.
  assert.equal(categoryById('4'), null);
  assert.equal(categoryById('0'), null);
  assert.equal(categoryById(parseId('c|123|4|1').catId), null);
});

test('button customId encode/parse roundtrip', () => {
  const id = encodeButtonId(123, 'transfer', true);
  assert.equal(id, 'c|123|transfer|1');
  const p = parseId(id);
  assert.deepEqual({ kind: p.kind, txnId: p.txnId, catId: p.catId, isPos: p.isPos },
    { kind: 'c', txnId: 123, catId: 'transfer', isPos: true });
  assert.equal(categoryById(p.catId), 'Шилжүүлэг & гэр бүл');
});

test('modal customId encode/parse (messageId-тэй)', () => {
  const id = encodeModalId(77, 'dining', false, '1234567890123456789');
  const p = parseId(id);
  assert.equal(p.kind, 'm');
  assert.equal(p.txnId, 77);
  assert.equal(p.catId, 'dining');
  assert.equal(p.isPos, false);
  assert.equal(p.messageId, '1234567890123456789');
  assert.ok(id.length <= 100, 'Discord customId хязгаар');
});

test('parseId буруу → null', () => {
  assert.equal(parseId('garbage'), null);
  assert.equal(parseId(''), null);
  assert.equal(parseId(null), null);
});
