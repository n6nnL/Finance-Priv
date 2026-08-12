// ============================================================
//  test/categoryButtonId.test.js — bot-ын payload кодлол/задлалыг түгжих тест
//  (өмнөх categoryButtonIndex.test.js-ийг ОРЛОНО — индекс кодлол устсан)
//
//  Discord/Telegram нь сонгосон ангиллыг customId/callback_data дотор ТОГТМОЛ
//  id-ЭЭР дамжуулж, categoryById()-ээр задалдаг. Энд:
//    1) шүүсэн олонлогоос кодолсон утга буцаагаад ЗӨВ нэр өгөхийг,
//    2) payload нь платформын хязгаарт багтахыг,
//    3) ХУУЧИН (индекс) payload нь ЧИМЭЭГҮЙ буруу ангилал БОЛОХГҮЙ, харин
//       null болж унахыг шалгана.
//  discord.js / telegraf ШААРДАХГҮЙ — цэвэр кодлол/задлалын логик.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listCategoriesWithIdFor } from '../config/categories.js';
import * as dc from '../discord/categories.js';
import * as tg from '../telegram/categories.js';

test('Discord: шүүсэн олонлогоос кодолсон товч → ЗӨВ ангилал болж задарна', () => {
  for (const type of ['expense', 'income', null]) {
    for (const { category, id } of listCategoriesWithIdFor(type)) {
      const encoded = dc.encodeButtonId(777, id, false);
      const p = dc.parseId(encoded);
      assert.ok(p, `parse амжилтгүй: ${encoded}`);
      assert.equal(p.kind, 'c');
      assert.equal(p.txnId, 777);
      assert.equal(dc.categoryById(p.catId), category,
        `${type}: "${category}" → ${encoded} → буруу задаргаа`);
    }
  }
});

test('Discord: modal customId (messageId-тэй) round-trip', () => {
  for (const { category, id } of listCategoriesWithIdFor('expense')) {
    const encoded = dc.encodeModalId(999999, id, true, '1234567890123456789');
    const p = dc.parseId(encoded);
    assert.equal(p.kind, 'm');
    assert.equal(p.isPos, true);
    assert.equal(p.messageId, '1234567890123456789');
    assert.equal(dc.categoryById(p.catId), category);
    // Discord-ийн ХАТУУ хязгаар: 100 тэмдэгт
    assert.ok(encoded.length <= 100, `customId хэт урт (${encoded.length}): ${encoded}`);
  }
});

test('Telegram: c/ec хоёулаа round-trip, 64 БАЙТ-д багтана', () => {
  for (const type of ['expense', 'income', null]) {
    for (const kind of ['c', 'ec']) {
      for (const { category, id } of listCategoriesWithIdFor(type)) {
        const encoded = tg.encodeButtonId(999999, id, false, kind);
        const p = tg.parseId(encoded);
        assert.ok(p, `parse амжилтгүй: ${encoded}`);
        assert.equal(p.kind, kind);
        assert.equal(tg.categoryById(p.catId), category,
          `${type}/${kind}: "${category}" → ${encoded} → буруу задаргаа`);
        // Telegram-ийн ХАТУУ хязгаар: 64 БАЙТ (тэмдэгт биш)
        assert.ok(Buffer.byteLength(encoded, 'utf8') <= 64,
          `callback_data хэт урт (${Buffer.byteLength(encoded, 'utf8')} байт): ${encoded}`);
      }
    }
  }
});

// ---- ★ IN-FLIGHT / LEGACY PAYLOAD — FAIL-SAFE ----
// Deploy-ийн ӨМНӨ илгээгдсэн мэдэгдлийн товчнууд ингэж кодлогдсон байдаг:
//   'c|123|4|1'  →  4 = CATEGORIES[4] = 'Шилжүүлэг & гэр бүл'
// Хэрэглэгч deploy-ийн ДАРАА тэр товчийг дарж болно. Шинэ парсер массив руу
// индекслэх ЁСГҮЙ — эс бөгөөс applyToAll-аар БУРУУ ангилал мерчантын БҮХ
// түүхэнд тарна.

test('★ ХУУЧИН индекс-payload → null (массив руу индекслэхгүй)', () => {
  for (let i = 0; i < 10; i++) {
    const legacyDiscord = `c|123|${i}|1`;
    const p = dc.parseId(legacyDiscord);
    assert.ok(p, 'формат нь задардаг (kind/txnId уншигдана)');
    assert.equal(dc.categoryById(p.catId), null,
      `хуучин индекс ${i} ангилал болж хувирлаа — ЧИМЭЭГҮЙ БУРУУ БИЧИЛТ`);

    for (const kind of ['c', 'ec']) {
      const legacyTg = `${kind}|123|${i}|0`;
      const q = tg.parseId(legacyTg);
      assert.ok(q);
      assert.equal(tg.categoryById(q.catId), null,
        `хуучин индекс ${i} (${kind}) ангилал болж хувирлаа`);
    }
  }
  // Хуучин modal payload ч мөн адил
  const m = dc.parseId('m|77|3|0|1234567890123456789');
  assert.equal(m.kind, 'm');
  assert.equal(dc.categoryById(m.catId), null);
});

test('танихгүй/гэмтсэн payload → null (crash БИШ)', () => {
  assert.equal(dc.parseId('garbage'), null);
  assert.equal(dc.parseId(''), null);
  assert.equal(dc.parseId(null), null);
  assert.equal(tg.parseId('c|123'), null, 'дутуу талбартай → null');
  assert.equal(tg.parseId('zz|1|dining|0'), null, 'танихгүй kind → null');
  // Формат зөв ч ангилал нь танихгүй
  assert.equal(dc.categoryById(dc.parseId('c|1|nosuchcat|0').catId), null);
  assert.equal(tg.categoryById(tg.parseId('c|1|nosuchcat|0').catId), null);
});

test('хоёр bot ИЖИЛ id-ийн орон зайг ашиглана (нэг эх сурвалж)', () => {
  for (const { category, id } of listCategoriesWithIdFor(null)) {
    assert.equal(dc.categoryById(id), category);
    assert.equal(tg.categoryById(id), category);
    assert.equal(dc.idOfCategory(category), id);
    assert.equal(tg.idOfCategory(category), id);
  }
});
