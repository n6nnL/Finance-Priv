// ============================================================
//  test/categoryButtonIndex.test.js — ★ ИНДЕКСИЙН УРХИЙГ түгжих тест
//
//  Discord/Telegram нь сонгосон ангиллыг customId/callback_data дотор
//  CATEGORIES массив дахь ИНДЕКСЭЭР дамжуулж, categoryByIndex()-ээр задалдаг.
//  Ангиллыг гүйлгээний төрлөөр ШҮҮХ үед энгийн .filter() хийвэл индекс
//  шилжиж, товч бүр БУРУУ ангилал илгээнэ (алдаа мэдэгдэхгүй — applyToAll нь
//  мерчантын бүх түүхэнд тараана).
//
//  Энд шүүсэн олонлогоос кодолсон утгыг ЭГЭЭД задлаад ЗӨВ нэр гарахыг шалгана.
//  discord.js / telegraf ШААРДАХГҮЙ — цэвэр кодлол/задлалын логик.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, listCategoriesWithIndexFor } from '../config/categories.js';
import * as dc from '../discord/categories.js';
import * as tg from '../telegram/categories.js';

// Bot-ийн builder-үүд яг ингэж давтдаг (notify.js — index кодолж, pos-оор эгнээ таслана)
function encodedPairs(encode, type) {
  return listCategoriesWithIndexFor(type).map(({ category, index }) => ({
    category,
    encoded: encode(777, index, false),
  }));
}

test('Discord: шүүсэн олонлогоос кодолсон товч → ЗӨВ ангилал болж задарна', () => {
  for (const type of ['expense', 'income']) {
    for (const { category, encoded } of encodedPairs(dc.encodeButtonId, type)) {
      const p = dc.parseId(encoded);
      assert.ok(p, `parse амжилтгүй: ${encoded}`);
      assert.equal(dc.categoryByIndex(p.catIdx), category,
        `${type}: "${category}" → ${encoded} → буруу задаргаа`);
    }
  }
});

test('Telegram: шүүсэн олонлогоос кодолсон товч → ЗӨВ ангилал болж задарна', () => {
  for (const type of ['expense', 'income']) {
    for (const kind of ['c', 'ec']) {
      for (const { category, index } of listCategoriesWithIndexFor(type)) {
        const encoded = tg.encodeButtonId(777, index, false, kind);
        const p = tg.parseId(encoded);
        assert.ok(p, `parse амжилтгүй: ${encoded}`);
        assert.equal(p.kind, kind);
        assert.equal(tg.categoryByIndex(p.catIdx), category,
          `${type}/${kind}: "${category}" → ${encoded} → буруу задаргаа`);
      }
    }
  }
});

test('ОРЛОГЫН шүүлт: "Орлого"-гийн индекс 3 хэвээр (шүүлтийн дараа 0 БОЛОХГҮЙ)', () => {
  // Хэрэв хэн нэг нь CATEGORIES.filter(...)-ийн ШИНЭ индексийг кодловол энэ
  // тест унана: орлогын жагсаалтад "Орлого" эхэнд (pos=0) байх ч ЖИНХЭНЭ
  // индекс нь 3 байх ёстой.
  const inc = listCategoriesWithIndexFor('income');
  assert.equal(inc[0].category, 'Орлого');
  assert.equal(inc[0].index, 3, 'pos биш — ЖИНХЭНЭ index кодлогдох ёстой');

  const encoded = dc.encodeButtonId(1, inc[0].index, false);
  assert.equal(encoded, 'c|1|3|0');
  assert.equal(dc.categoryByIndex(dc.parseId(encoded).catIdx), 'Орлого');
});

test('ЗАРЛАГЫН шүүлт: индекс 3-аас хойших ангиллууд шилжихгүй', () => {
  // Зарлагын жагсаалтаас "Орлого" (index 3) хасагдана → түүнээс хойших бүх
  // ангиллын POSITION 1-ээр ухарна, гэхдээ INDEX нь хэвээр байх ёстой.
  const exp = listCategoriesWithIndexFor('expense');
  const shil = exp.find((o) => o.category === 'Шилжүүлэг & гэр бүл');
  assert.equal(shil.index, 4, 'CATEGORIES дахь жинхэнэ байрлал');
  assert.equal(exp.indexOf(shil), 3, 'шүүсэн жагсаалт дахь байрлал (pos) — өөр');
  // Кодлолд index орох ёстой (pos орвол "Орлого" гарч ирнэ — яг тэр алдаа)
  assert.equal(dc.categoryByIndex(dc.parseId(dc.encodeButtonId(1, shil.index, false)).catIdx),
    'Шилжүүлэг & гэр бүл');
  assert.equal(CATEGORIES[exp.indexOf(shil)], 'Орлого'); // pos кодловол ингэж эвдэрнэ
});
