// ============================================================
//  test/categoryApplicability.test.js — ангиллын ХАМААРЛЫН (applicability)
//  ★ single source-ийн тест: аль ангилал аль төрлийн гүйлгээнд утгатай вэ.
//
//  Гурван клиент (Dashboard/Discord/Telegram) БА API-ийн баталгаажуулалт
//  бүгд isCategoryAllowedFor()-оор шийддэг тул дүрмийг ЭНД түгжинэ.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES, CATEGORY_APPLICABILITY, isCategoryAllowedFor,
  categoriesFor, listCategoriesWithIdFor, byId, INCOME_CATEGORY,
} from '../config/categories.js';

test('"Орлого" — ЗӨВХӨН орлогын мөрөнд (энэ фазын гол алдаа)', () => {
  assert.equal(isCategoryAllowedFor('Орлого', 'income'), true);
  assert.equal(isCategoryAllowedFor('Орлого', 'expense'), false);
});

test('"Шилжүүлэг & гэр бүл" ба "Бусад" — ХОЁУЛАНД', () => {
  for (const c of ['Шилжүүлэг & гэр бүл', 'Бусад']) {
    assert.equal(isCategoryAllowedFor(c, 'income'), true, `${c} income`);
    assert.equal(isCategoryAllowedFor(c, 'expense'), true, `${c} expense`);
  }
});

test('үлдсэн 7 ангилал — зөвхөн зарлага', () => {
  const expenseOnly = [
    'Гадуур хооллолт', 'Хүнсний зүйл', 'Тээвэр', 'Захиалга & сервис',
    'Боловсрол', 'Чөлөөт цаг / зугаа цэнгэл', 'Хувцас / гоо сайхан',
  ];
  assert.equal(expenseOnly.length, 7);
  for (const c of expenseOnly) {
    assert.equal(isCategoryAllowedFor(c, 'expense'), true, `${c} expense`);
    assert.equal(isCategoryAllowedFor(c, 'income'), false, `${c} income`);
  }
});

test('FAIL-OPEN: metadata-гүй ангилал → хоёуланд зөвшөөрнө', () => {
  // Шинэ ангилал нэмээд applicability бичихээ мартвал бүх picker-ээс ЧИМЭЭГҮЙ
  // алга болох ёсгүй — алдаа харагдах ёстой, нуугдах биш.
  assert.equal(isCategoryAllowedFor('Огт байхгүй ангилал', 'income'), true);
  assert.equal(isCategoryAllowedFor('Огт байхгүй ангилал', 'expense'), true);
});

test('type тодорхойгүй (null/undefined/танихгүй) → хязгаарлахгүй', () => {
  assert.equal(isCategoryAllowedFor('Орлого', null), true);
  assert.equal(isCategoryAllowedFor('Орлого', undefined), true);
  assert.equal(isCategoryAllowedFor('Орлого', 'huuramch'), true);
});

test('CATEGORY_APPLICABILITY нь 10 ангилал БҮРИЙГ хамарна', () => {
  for (const c of CATEGORIES) {
    assert.ok(Array.isArray(CATEGORY_APPLICABILITY[c]), `${c} — applicability алга`);
    assert.ok(CATEGORY_APPLICABILITY[c].length > 0, `${c} — хоосон олонлог`);
  }
});

test('categoriesFor: зарлагад 9 (Орлого-гүй), орлогод 3', () => {
  const exp = categoriesFor('expense');
  assert.equal(exp.length, 9);
  assert.ok(!exp.includes(INCOME_CATEGORY), 'зарлагад "Орлого" БАЙХ ЁСГҮЙ');

  const inc = categoriesFor('income');
  assert.deepEqual(inc, ['Орлого', 'Шилжүүлэг & гэр бүл', 'Бусад']);
});

test('categoriesFor: дараалал CATEGORIES-ийнхтэй ижил хэвээр', () => {
  const exp = categoriesFor('expense');
  const expected = CATEGORIES.filter((c) => c !== 'Орлого');
  assert.deepEqual(exp, expected);
});

test('listCategoriesWithIdFor: шүүсэн ангилал бүр ТОГТМОЛ id-тайгаа хамт ирнэ', () => {
  // ★ Bot-ийн кодлолын үндэс — массив дахь байрлал ХААНА Ч оролцохгүй.
  const inc = listCategoriesWithIdFor('income');
  assert.deepEqual(inc, [
    { category: 'Орлого', id: 'income' },
    { category: 'Шилжүүлэг & гэр бүл', id: 'transfer' },
    { category: 'Бусад', id: 'other' },
  ]);
  // Дараалал нь categoriesFor()-тэй ижил, id бүр буцаагаад ижил нэр өгнө
  const exp = listCategoriesWithIdFor('expense');
  assert.deepEqual(exp.map((o) => o.category), categoriesFor('expense'));
  for (const { category, id } of exp) {
    assert.equal(byId(id), category);
  }
});
