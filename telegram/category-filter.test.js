// ============================================================
//  category-filter.test.js — buildCategoryKeyboard нь гүйлгээний ТӨРЛӨӨР
//  шүүх ба ★ ЖИНХЭНЭ ИНДЕКСИЙГ хадгалахыг шалгана (discord-ийн ижил тест).
//
//  БОДИТ builder-ийн (telegraf inline keyboard) гаралт дээр — callback_data-г
//  задлаад ангиллын нэр рүү буцаана. Индексийн урхинд унасан бол ЭНД баригдана.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCategoryKeyboard, keyboardFor } from './notify.js';
import { categoryByIndex, parseId } from './categories.js';

/** inline_keyboard-оос [{label, decoded, kind}] гаргана */
function decodeKb(kb) {
  const out = [];
  for (const row of kb.reply_markup.inline_keyboard) {
    for (const btn of row) {
      const p = parseId(btn.callback_data);
      out.push({ label: btn.text, decoded: p ? categoryByIndex(p.catIdx) : null, kind: p?.kind });
    }
  }
  return out;
}

test('ЗАРЛАГА: "Орлого" товч БАЙХГҮЙ, 9 товч', () => {
  const btns = decodeKb(buildCategoryKeyboard(42, false, 'c', 'expense'));
  assert.equal(btns.length, 9);
  assert.ok(!btns.some((b) => b.label === 'Орлого'), '"Орлого" зарлагад гарах ЁСГҮЙ');
});

test('ОРЛОГО: зөвхөн 3 товч (Орлого / Шилжүүлэг / Бусад)', () => {
  const btns = decodeKb(buildCategoryKeyboard(42, false, 'c', 'income'));
  assert.deepEqual(btns.map((b) => b.label), ['Орлого', 'Шилжүүлэг & гэр бүл', 'Бусад']);
});

test('★ Товч бүрийн ШОШГО = задарсан АНГИЛАЛ (индекс шилжээгүй)', () => {
  for (const type of ['expense', 'income', null]) {
    for (const kind of ['c', 'ec']) {
      for (const b of decodeKb(buildCategoryKeyboard(42, false, kind, type))) {
        assert.equal(b.decoded, b.label,
          `${type}/${kind}: "${b.label}" товч "${b.decoded}" болж задарлаа — ИНДЕКС ШИЛЖСЭН`);
        assert.equal(b.kind, kind, 'kind (c/ec) хадгалагдах ёстой');
      }
    }
  }
});

test('эгнээнд дээд тал нь 5 товч, хоосон эгнээгүй', () => {
  for (const type of ['expense', 'income']) {
    for (const row of buildCategoryKeyboard(42, false, 'c', type).reply_markup.inline_keyboard) {
      assert.ok(row.length > 0 && row.length <= 5);
    }
  }
});

test('type өгөөгүй (хуучин дуудлага) → бүх 10 товч, задаргаа зөв (fail-open)', () => {
  const btns = decodeKb(buildCategoryKeyboard(42, false));
  assert.equal(btns.length, 10);
  for (const b of btns) assert.equal(b.decoded, b.label);
});

test('keyboardFor нь tx.type-г builder рүү дамжуулна (pending мөр)', () => {
  const income = { id: 7, type: 'income', is_pos: 0, status: 'pending_review', category: null };
  // сүүлийн эгнээ = "талбар засах" (ангиллын товч биш) — parseId нь 'n' kind өгнө
  const cats = decodeKb(keyboardFor(income)).filter((b) => b.kind === 'c');
  assert.deepEqual(cats.map((b) => b.label), ['Орлого', 'Шилжүүлэг & гэр бүл', 'Бусад']);

  const expense = { id: 8, type: 'expense', is_pos: 1, status: 'pending_review', category: null };
  const expCats = decodeKb(keyboardFor(expense)).filter((b) => b.kind === 'c');
  assert.equal(expCats.length, 9);
  assert.ok(!expCats.some((b) => b.label === 'Орлого'));
});
