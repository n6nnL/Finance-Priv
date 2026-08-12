// ============================================================
//  test/subcategories.test.js — ДЭД АНГИЛЛЫН таксономи (018) — цэвэр логик
//
//  Энд шалгах зүйлс:
//    • шинэ хоёр ангилал (Эрүүл мэнд / Орон сууц & коммунал) нь applicability-ийн
//      ЖИНХЭНЭ замаар ЗӨВХӨН ЗАРЛАГА болох,
//    • subcategoriesFor()/subcategoryValid() round-trip,
//    • дэд ангилалгүй ангилал ХООСОН массив буцаах (throw/null БИШ),
//    • дэд ангиллын id/label-ийн гэрээ (эцэг доторх давхардалгүй, ascii id).
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES, CATEGORY_META, SUBCATEGORIES, byId, idFor,
  isCategoryAllowedFor, categoriesFor, listCategoriesWithIdFor,
  subcategoriesFor, subcategoriesForCategory, subcategoryValid, subcategoryLabel,
} from '../config/categories.js';

// ---------- Шинэ хоёр ангилал ----------

test('018: хоёр шинэ ангилал ТӨГСГӨЛД нэмэгдсэн, хуучин эрэмбэ хөдлөөгүй', () => {
  assert.equal(CATEGORIES.length, 12);
  assert.equal(CATEGORIES[10], 'Эрүүл мэнд');
  assert.equal(CATEGORIES[11], 'Орон сууц & коммунал');
  // Хуучин 10-ын эрэмбэ ЯГ хэвээр
  assert.deepEqual(CATEGORIES.slice(0, 10), [
    'Гадуур хооллолт', 'Хүнсний зүйл', 'Тээвэр', 'Орлого', 'Шилжүүлэг & гэр бүл',
    'Захиалга & сервис', 'Боловсрол', 'Чөлөөт цаг / зугаа цэнгэл', 'Хувцас / гоо сайхан', 'Бусад',
  ]);
});

test('018: шинэ ангиллын id/emoji/hex', () => {
  assert.deepEqual(CATEGORY_META['Эрүүл мэнд'], { id: 'health', emoji: '🏥', hex: '#C05746' });
  assert.deepEqual(CATEGORY_META['Орон сууц & коммунал'], { id: 'housing', emoji: '🏠', hex: '#5B7B9A' });
  assert.equal(byId('health'), 'Эрүүл мэнд');
  assert.equal(byId('housing'), 'Орон сууц & коммунал');
  assert.equal(idFor('Эрүүл мэнд'), 'health');
  assert.equal(idFor('Орон сууц & коммунал'), 'housing');
});

test('★ 018: шинэ хоёр ангилал ЗӨВХӨН ЗАРЛАГА (applicability-ийн ЖИНХЭНЭ зам)', () => {
  for (const c of ['Эрүүл мэнд', 'Орон сууц & коммунал']) {
    assert.equal(isCategoryAllowedFor(c, 'expense'), true, `${c} зарлагад байх ёстой`);
    assert.equal(isCategoryAllowedFor(c, 'income'), false, `${c} ОРЛОГОД гарах ЁСГҮЙ`);
  }
  // Picker-ийн бодит гаралт дээр ч мөн адил
  const inc = categoriesFor('income');
  assert.deepEqual(inc, ['Орлого', 'Шилжүүлэг & гэр бүл', 'Бусад'], 'орлогын жагсаалт өсөх ЁСГҮЙ');
  const exp = categoriesFor('expense');
  assert.equal(exp.length, 11);
  assert.ok(exp.includes('Эрүүл мэнд') && exp.includes('Орон сууц & коммунал'));
  // Bot-ын id-тай хосууд дээр ч
  assert.ok(listCategoriesWithIdFor('expense').some((o) => o.id === 'health'));
  assert.ok(!listCategoriesWithIdFor('income').some((o) => o.id === 'housing'));
});

// ---------- Таксономи ----------

test('seed-ийн бүх дэд ангилал яг тохирсон эцэгтэйгээ', () => {
  assert.deepEqual(subcategoriesFor('health').map((s) => s.label),
    ['Даатгал', 'Эмнэлэг', 'Эм/эмийн сан', 'Шүд', 'Оношилгоо']);
  assert.deepEqual(subcategoriesFor('housing').map((s) => s.label),
    ['Түрээс/зээл', 'Цахилгаан', 'Дулаан', 'Ус']);
  assert.deepEqual(subcategoriesFor('dining').map((s) => s.label),
    ['Ресторан', 'Кафе/кофе', 'Хүргэлт']);
  assert.deepEqual(subcategoriesFor('grocery').map((s) => s.label),
    ['Супермаркет', 'Дэлгүүр', 'Зах']);
  assert.deepEqual(subcategoriesFor('transport').map((s) => s.label),
    ['Түлш', 'Такси', 'Нийтийн тээвэр', 'Засвар']);
  assert.deepEqual(subcategoriesFor('income').map((s) => s.label),
    ['Цалин', 'Зээл', 'Side job', 'Бэлэг/Буцаалт']);
  assert.deepEqual(subcategoriesFor('transfer').map((s) => s.label),
    ['Гэр бүл', 'Найз', 'Хадгаламж руу']);
  assert.deepEqual(subcategoriesFor('subs').map((s) => s.label),
    ['Streaming', 'Апп/SaaS', 'Гишүүнчлэл']);
});

test('★ дэд ангилалгүй ангилал → ХООСОН массив (throw/null БИШ)', () => {
  for (const id of ['other', 'apparel', 'edu', 'leisure']) {
    const subs = subcategoriesFor(id);
    assert.ok(Array.isArray(subs), `${id} массив буцаах ёстой`);
    assert.equal(subs.length, 0, `${id}-д одоогоор дэд ангилал БАЙХГҮЙ`);
  }
  // Танихгүй эцэг ч мөн адил — унахгүй
  assert.deepEqual(subcategoriesFor('nosuchcat'), []);
  assert.deepEqual(subcategoriesFor(null), []);
  assert.deepEqual(subcategoriesFor(undefined), []);
});

test('дэд ангиллын id гэрээ: эцэг дотроо давхардаагүй, ascii, тоо БИШ', () => {
  for (const [parentId, subs] of Object.entries(SUBCATEGORIES)) {
    assert.ok(byId(parentId), `"${parentId}" эцэг ангилал байх ёстой`);
    const ids = subs.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `${parentId}: id давхардсан`);
    const labels = subs.map((s) => s.label);
    assert.equal(new Set(labels).size, labels.length, `${parentId}: label давхардсан`);
    for (const id of ids) {
      assert.match(id, /^[a-z][a-z0-9_]*$/, `${parentId}/${id} — ascii түлхүүр байх ёстой`);
      assert.ok(Number.isNaN(Number(id)), `${parentId}/${id} цэвэр тоо байж БОЛОХГҮЙ`);
    }
  }
});

test('эцэг ӨӨР бол ижил id зэрэгцэн орших боломжтой (түлхүүр нь ХОС)', () => {
  // 'family' (transfer) ба 'rent' (housing) хоорондоо огт саад болохгүй
  assert.equal(subcategoryLabel('transfer', 'family'), 'Гэр бүл');
  assert.equal(subcategoryLabel('housing', 'rent'), 'Түрээс/зээл');
  assert.equal(subcategoryLabel('housing', 'family'), null, 'өөр эцгийн id энд хүчингүй');
});

// ---------- Валидатор ----------

test('subcategoryValid: харьяалагдах бүх хос → true (нэрээр Ч, id-ээр Ч)', () => {
  for (const [parentId, subs] of Object.entries(SUBCATEGORIES)) {
    const label = byId(parentId);
    for (const s of subs) {
      assert.equal(subcategoryValid(parentId, s.label), true, `${parentId}/${s.label} (id-ээр)`);
      assert.equal(subcategoryValid(label, s.label), true, `${label}/${s.label} (нэрээр)`);
    }
  }
});

test('★ subcategoryValid: FAIL-CLOSED — харьяалагдахгүй бүхэн false', () => {
  // Өөр эцгийн дэд ангилал
  assert.equal(subcategoryValid('Эрүүл мэнд', 'Такси'), false);
  assert.equal(subcategoryValid('Тээвэр', 'Шүд'), false);
  // Дэд ангилалгүй ангилал — ЮУ Ч зөвшөөрөхгүй
  assert.equal(subcategoryValid('Бусад', 'Шүд'), false);
  assert.equal(subcategoryValid('other', 'Ресторан'), false);
  // Танихгүй ангилал
  assert.equal(subcategoryValid('Байхгүй ангилал', 'Шүд'), false);
  // Хоосон/буруу төрөл
  assert.equal(subcategoryValid('Эрүүл мэнд', ''), false);
  assert.equal(subcategoryValid('Эрүүл мэнд', null), false);
  assert.equal(subcategoryValid('Эрүүл мэнд', undefined), false);
  assert.equal(subcategoryValid('Эрүүл мэнд', 42), false);
  assert.equal(subcategoryValid(null, 'Шүд'), false);
  // id-г label-ийн байранд өгвөл ч ХҮЧИНГҮЙ (DB-д label хадгалагддаг)
  assert.equal(subcategoryValid('health', 'dental'), false, 'DB нь label хадгална — id хүчингүй');
});

test('subcategoriesForCategory: нэр ба id хоёулаа ажиллана', () => {
  assert.deepEqual(subcategoriesForCategory('Эрүүл мэнд'), subcategoriesFor('health'));
  assert.deepEqual(subcategoriesForCategory('health'), subcategoriesFor('health'));
  assert.deepEqual(subcategoriesForCategory('Бусад'), []);
  assert.deepEqual(subcategoriesForCategory('байхгүй'), []);
});

test('subcategoriesFor нь ХУУЛБАР буцаана (гадны мутаци config-ыг эвдэхгүй)', () => {
  const a = subcategoriesFor('health');
  a.push({ id: 'hack', label: 'Хакердсан' });
  assert.equal(subcategoriesFor('health').length, 5, 'дотоод таксономи хөндөгдөх ЁСГҮЙ');
});
