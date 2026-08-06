// ============================================================
//  test/category-filter.test.js — buildButtonRows нь гүйлгээний ТӨРЛӨӨР
//  шүүх ба ★ ЖИНХЭНЭ ИНДЕКСИЙГ хадгалахыг шалгана.
//
//  Энэ нь config-ийн туслах функцийн БИШ, БОДИТ builder-ийн (discord.js
//  component) гаралт дээрх тест — customId-г задлаад ангиллын нэр рүү
//  буцаана. Индексийн урхинд унасан бол ЭНД баригдана.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildButtonRows, buildComponentsFor } from '../notify.js';
import { categoryByIndex, parseId } from '../categories.js';

/** builder-ийн эгнээнүүдээс [{label, decoded}] гаргана */
function decodeRows(rows) {
  const out = [];
  for (const row of rows) {
    for (const comp of row.components) {
      const json = comp.toJSON();
      const p = parseId(json.custom_id);
      out.push({ label: json.label, decoded: categoryByIndex(p.catIdx) });
    }
  }
  return out;
}

test('ЗАРЛАГА: "Орлого" товч БАЙХГҮЙ, 9 товч', () => {
  const btns = decodeRows(buildButtonRows(42, false, 'expense'));
  assert.equal(btns.length, 9);
  assert.ok(!btns.some((b) => b.label === 'Орлого'), '"Орлого" зарлагад гарах ЁСГҮЙ');
});

test('ОРЛОГО: зөвхөн 3 товч (Орлого / Шилжүүлэг / Бусад)', () => {
  const btns = decodeRows(buildButtonRows(42, false, 'income'));
  assert.deepEqual(btns.map((b) => b.label), ['Орлого', 'Шилжүүлэг & гэр бүл', 'Бусад']);
});

test('★ Товч бүрийн ШОШГО = задарсан АНГИЛАЛ (индекс шилжээгүй)', () => {
  for (const type of ['expense', 'income', null]) {
    for (const b of decodeRows(buildButtonRows(42, false, type))) {
      assert.equal(b.decoded, b.label,
        `${type}: "${b.label}" товч "${b.decoded}" болж задарлаа — ИНДЕКС ШИЛЖСЭН`);
    }
  }
});

test('эгнээнд дээд тал нь 5 товч (Discord-ийн хязгаар), хоосон эгнээгүй', () => {
  for (const type of ['expense', 'income']) {
    const rows = buildButtonRows(42, false, type);
    for (const row of rows) {
      assert.ok(row.components.length > 0, 'хоосон эгнээ байх ёсгүй');
      assert.ok(row.components.length <= 5, 'эгнээнд 5-аас олон товч байж болохгүй');
    }
  }
});

test('type өгөөгүй (хуучин дуудлага) → бүх 10 товч, задаргаа зөв (fail-open)', () => {
  const btns = decodeRows(buildButtonRows(42, false));
  assert.equal(btns.length, 10);
  for (const b of btns) assert.equal(b.decoded, b.label);
});

test('buildComponentsFor нь tx.type-г builder рүү дамжуулна', () => {
  const income = { id: 7, type: 'income', is_pos: 0, status: 'pending_review', category: null };
  const rows = buildComponentsFor(income);
  // сүүлийн эгнээ = "талбар засах"; өмнөх нь ангиллын товчнууд
  const catBtns = decodeRows(rows.slice(0, -1));
  assert.deepEqual(catBtns.map((b) => b.label), ['Орлого', 'Шилжүүлэг & гэр бүл', 'Бусад']);

  const expense = { id: 8, type: 'expense', is_pos: 1, status: 'pending_review', category: null };
  const expBtns = decodeRows(buildComponentsFor(expense).slice(0, -1));
  assert.equal(expBtns.length, 9);
  assert.ok(!expBtns.some((b) => b.label === 'Орлого'));
});
