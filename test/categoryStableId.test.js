// ============================================================
//  test/categoryStableId.test.js — ★ ТОГТМОЛ id-ийн гэрээг түгжих тест
//
//  Энэ refactor-ийн БҮХ утга учир: ангиллыг массив дахь байрлалаар БИШ,
//  тогтмол id-ээр таних. Тиймээс энд гол баталгаа нь — CATEGORIES-ийн
//  ДАРААЛЛЫГ ХОЛЬСОН ч id бүр ЯГ ТЭР ангилал руугаа буусан хэвээр байх.
//
//  ⚠️ Энэ файл CATEGORIES массивыг ЗОРИУДААР газар дээр нь (in place) хольдог.
//  `node --test` файл бүрийг ТУСДАА процессд ажиллуулдаг тул бусад тестэд
//  алдагдахгүй; гэсэн ч төгсгөлд нь анхны дараалалд буцаана.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES, CATEGORY_META, byId, idFor, listCategoriesWithIdFor,
} from '../config/categories.js';

const ORIGINAL_ORDER = [...CATEGORIES];

test('ангилал бүр ТОГТМОЛ id-тай, id нь ДАВХАРДААГҮЙ', () => {
  const ids = ORIGINAL_ORDER.map((c) => CATEGORY_META[c]?.id);
  assert.equal(ids.length, 12);
  for (const id of ids) assert.equal(typeof id, 'string');
  assert.equal(new Set(ids).size, ids.length, 'id давхардсан байна');
});

test('id нь БОГИНО, ASCII, ба ЦЭВЭР ТОО БИШ (payload хязгаар + fail-safe)', () => {
  for (const c of ORIGINAL_ORDER) {
    const id = CATEGORY_META[c].id;
    // Telegram callback_data 64 БАЙТ / Discord customId 100 тэмдэгт — payload-д
    // txnId, isPos, messageId бас багтдаг тул id богино байх ЁСТОЙ.
    assert.ok(id.length <= 12, `"${id}" хэт урт (${id.length})`);
    assert.match(id, /^[a-z][a-z0-9_]*$/, `"${id}" нь богино ASCII түлхүүр байх ёстой`);
    // ★ Хуучин индекс-payload-ыг ЯЛГАХ чадвар яг үүн дээр тогтдог:
    // цэвэр тоон id гарч ирвэл '4' гэх хуучин утга ГЭНЭТ хүчинтэй болно.
    assert.ok(Number.isNaN(Number(id)), `"${id}" цэвэр тоо байж БОЛОХГҮЙ`);
  }
});

test('id ↔ ангилал round-trip (хоёр чиглэлд)', () => {
  for (const category of ORIGINAL_ORDER) {
    const id = idFor(category);
    assert.ok(id, `${category} — id алга`);
    assert.equal(byId(id), category, `${category} → ${id} → буцаад ижил байх ёстой`);
  }
});

test('byId: танихгүй/хуучин/хог утга → null (ХЭЗЭЭ Ч таамаглахгүй)', () => {
  // ★ Нислэг дунд байгаа ХУУЧИН payload: индексээр кодлогдсон утгууд
  for (const legacy of ['0', '3', '4', '9', '99', '-1']) {
    assert.equal(byId(legacy), null, `хуучин индекс "${legacy}" таарах ЁСГҮЙ`);
  }
  // Prototype-ийн түлхүүрүүд (Map ашигласны шалтгаан)
  assert.equal(byId('constructor'), null);
  assert.equal(byId('toString'), null);
  assert.equal(byId('__proto__'), null);
  // Бусад
  assert.equal(byId(''), null);
  assert.equal(byId('DINING'), null, 'id нь том/жижиг үсэгт мэдрэг');
  assert.equal(byId(null), null);
  assert.equal(byId(undefined), null);
  assert.equal(byId(3), null, 'тоо дамжуулсан ч индекслэхгүй');
  assert.equal(idFor('Байхгүй ангилал'), null);
  assert.equal(idFor(null), null);
});

test('★ CATEGORIES-ийн ДАРААЛЛЫГ ХОЛИХОД id бүр ИЖИЛ ангилал руугаа бууна', () => {
  // Энэ бол refactor-ийн БҮХ учир шалтгаан. Хуучин индекс кодлолын үед
  // дараалал өөрчлөгдөхөд товч бүр ӨӨР ангилал руу шилждэг байсан.
  const before = new Map(ORIGINAL_ORDER.map((c) => [idFor(c), c]));

  // Газар дээр нь урвуулж, дараа нь дурын дараалалд оруулна (const нь массивын
  // АГУУЛГЫГ хамгаалдаггүй — жинхэнэ "хэн нэгэн дарааллыг өөрчиллөө" хувилбар).
  CATEGORIES.reverse();
  assert.notDeepEqual([...CATEGORIES], ORIGINAL_ORDER, 'дараалал үнэхээр өөрчлөгдсөн байх ёстой');

  for (const [id, category] of before) {
    assert.equal(byId(id), category, `дараалал холилтын дараа "${id}" шилжсэн`);
    assert.equal(idFor(category), id, `"${category}"-ийн id өөрчлөгдсөн`);
  }

  // Шинэ ангилал ДУНД нь оруулсан ч (жинхэнэ дараагийн ажил — subcategory)
  // одоо байгаа id-ууд хөдлөхгүй.
  CATEGORIES.splice(2, 0, 'Туршилтын шинэ ангилал');
  for (const [id, category] of before) {
    assert.equal(byId(id), category, `дунд нь ангилал нэмэхэд "${id}" шилжсэн`);
  }

  // Анхны байдалд нь буцаана (файл дотор дараагийн тест байвал цэвэр байг)
  CATEGORIES.length = 0;
  CATEGORIES.push(...ORIGINAL_ORDER);
  assert.deepEqual([...CATEGORIES], ORIGINAL_ORDER);
});

test('listCategoriesWithIdFor: хос бүр зөв, дараалал CATEGORIES-ийнх', () => {
  const exp = listCategoriesWithIdFor('expense');
  assert.equal(exp.length, 11);
  assert.ok(!exp.some((o) => o.category === 'Орлого'));
  for (const { category, id } of exp) assert.equal(byId(id), category);

  const inc = listCategoriesWithIdFor('income');
  assert.deepEqual(inc.map((o) => o.id), ['income', 'transfer', 'other']);

  // type-гүй (хуучин дуудлага) → бүх 12 (fail-open)
  assert.equal(listCategoriesWithIdFor().length, 12);
});
