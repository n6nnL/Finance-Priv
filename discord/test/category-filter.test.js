// ============================================================
//  test/category-filter.test.js — buildButtonRows нь гүйлгээний ТӨРЛӨӨР
//  шүүх ба товч бүр ЗӨВ ангилал руу задрахыг шалгана.
//
//  Энэ нь config-ийн туслах функцийн БИШ, БОДИТ builder-ийн (discord.js
//  component) гаралт дээрх тест — customId-г задлаад ангиллын нэр рүү
//  буцаана (тогтмол id-ээр).
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildButtonRows, buildComponentsFor } from '../notify.js';
import { categoryById, parseId } from '../categories.js';

/** builder-ийн эгнээнүүдээс [{label, decoded}] гаргана */
function decodeRows(rows) {
  const out = [];
  for (const row of rows) {
    for (const comp of row.components) {
      const json = comp.toJSON();
      const p = parseId(json.custom_id);
      out.push({ label: json.label, decoded: categoryById(p.catId) });
    }
  }
  return out;
}

test('ЗАРЛАГА: "Орлого" товч БАЙХГҮЙ, 11 товч', () => {
  const btns = decodeRows(buildButtonRows(42, false, 'expense'));
  assert.equal(btns.length, 11); // 018: 12 ангилал − Орлого
  assert.ok(!btns.some((b) => b.label === 'Орлого'), '"Орлого" зарлагад гарах ЁСГҮЙ');
});

test('ОРЛОГО: зөвхөн 3 товч (Орлого / Шилжүүлэг / Бусад)', () => {
  const btns = decodeRows(buildButtonRows(42, false, 'income'));
  assert.deepEqual(btns.map((b) => b.label), ['Орлого', 'Шилжүүлэг & гэр бүл', 'Бусад']);
});

test('★ Товч бүрийн ШОШГО = задарсан АНГИЛАЛ (id зөв кодлогдсон)', () => {
  for (const type of ['expense', 'income', null]) {
    for (const b of decodeRows(buildButtonRows(42, false, type))) {
      assert.equal(b.decoded, b.label,
        `${type}: "${b.label}" товч "${b.decoded}" болж задарлаа`);
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

// ★ 018-д ангилал 10 → 12 болсон тул мессежийн ЭГНЭЭНИЙ ТОО Discord-ийн
// хатуу хязгаарт (мессежид 5 action row, нийт 25 товч) багтахыг ЗААВАЛ шалгана.
// Зарлага: 11 ангилал → 3 эгнээ + "талбар засах" 1 эгнээ = 4 ≤ 5. Нөөц: 1 эгнээ,
// өөрөөр хэлбэл ангилал 20 хүрэхэд энэ тест УНАНА (тэр үед хуудаслалт хэрэгтэй).
test('★ мессежийн эгнээ ≤5, товч ≤25 (12 ангилал дээр ч багтана)', () => {
  for (const type of ['expense', 'income']) {
    const tx = { id: 9, type, is_pos: 0, status: 'pending_review', category: null };
    const comps = buildComponentsFor(tx);
    assert.ok(comps.length <= 5,
      `${type}: мессежид ${comps.length} эгнээ — Discord дээд тал нь 5`);
    const total = comps.reduce((n, r) => n + r.components.length, 0);
    assert.ok(total <= 25, `${type}: нийт ${total} товч — Discord дээд тал нь 25`);
  }
  // Зарлага дээрх бодит тоо (регресс — өсөхөд анхаарал татна)
  const expense = buildComponentsFor({ id: 9, type: 'expense', is_pos: 0, status: 'pending_review', category: null });
  assert.equal(expense.length, 4, '11 ангилал → 3 эгнээ + талбарын эгнээ');
});

test('type өгөөгүй (хуучин дуудлага) → бүх 12 товч, задаргаа зөв (fail-open)', () => {
  const btns = decodeRows(buildButtonRows(42, false));
  assert.equal(btns.length, 12);
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
  assert.equal(expBtns.length, 11);
  assert.ok(!expBtns.some((b) => b.label === 'Орлого'));
});
