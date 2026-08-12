// ============================================================
//  scripts/category-id.verify.mjs — ТОГТМОЛ id-ийн END-TO-END шалгалт (019)
//
//  ЖИНХЭНЭ `createApp()` + `:memory:` DB дээр bot-ын БҮТЭН урсгалыг дуурайна:
//    pending гүйлгээ → notify.js-ийн БОДИТ товч → customId/callback_data-г
//    задлах → PATCH /api/transactions/:id/category → DB-д ЯМАР УТГА бичигдсэнийг
//    шалгах.
//
//  Гол асуулт: «товч дээр бичигдсэн шошго ба DB-д бичигдсэн ангилал ИЖИЛ үү?»
//  Хуучин индекс кодлолын үед энэ хоёр чимээгүй зөрөх боломжтой байсан.
//
//  Ажиллуулах:  node scripts/category-id.verify.mjs
// ============================================================
import assert from 'node:assert';
import { createDb } from '../api/db.js';
import { createApp } from '../api/app.js';
import { createAi } from '../api/ai.js';
import { hashPasswordSync } from '../api/auth/passwordHash.js';
// Bot-ын цэвэр логик (discord/telegram config, token ШААРДАХГҮЙ):
import { buildButtonRows } from '../discord/notify.js';
import { buildCategoryKeyboard } from '../telegram/notify.js';
import * as dc from '../discord/categories.js';
import * as tg from '../telegram/categories.js';
import { CATEGORIES } from '../config/categories.js';

const API_KEY = 'cat-id-verify-key';
const db = createDb(':memory:', {
  seed: { email: 'owner@test.co', passwordHash: hashPasswordSync('x'), role: 'admin' },
});
const app = createApp({ db, ai: createAi({ enabled: false }), apiKey: API_KEY, jwtSecret: API_KEY });
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const H = { 'Content-Type': 'application/json', 'X-API-Key': API_KEY };

const post = async (b) => (await fetch(base + '/api/transactions', { method: 'POST', headers: H, body: JSON.stringify(b) })).json();
const get = async (id) => (await fetch(base + `/api/transactions/${id}`, { headers: H })).json();
const patchCat = async (id, b) => {
  const r = await fetch(base + `/api/transactions/${id}/category`, { method: 'PATCH', headers: H, body: JSON.stringify(b) });
  return { status: r.status, json: await r.json() };
};
const overrides = async () => (await fetch(base + '/api/overrides', { headers: H })).json();

let pass = 0;
let n = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };

// Machine (X-API-Key) push-д userId ЗААВАЛ (owner fallback БАЙХГҮЙ — §5)
const OWNER_ID = db.getOwnerUserId();

/** Танигдахгүй мерчанттай pending гүйлгээ үүсгэнэ (keyword дүрэмд ОРООГҮЙ). */
async function makePending(type = 'expense') {
  n += 1;
  const r = await post({
    userId: OWNER_ID,
    messageId: `<cat-id-verify-${n}@t>`,
    amount: 1000 + n,
    type,
    date: '2026-08-10',
    description: `ZZQQ UNKNOWNMERCH${n}`,
    isPos: false,
  });
  return r;
}

try {
  // ---------- [A] Discord: pending → товч → PATCH → DB ----------
  console.log('\n[A] Discord: БОДИТ товч → customId задаргаа → PATCH → DB');
  {
    const created = await makePending('expense');
    assert.strictEqual(created.txStatus, 'pending_review', 'танигдаагүй мерчант pending байх ёстой');
    const id = created.id;
    const row = (await get(id)).data;
    assert.strictEqual(row.category, null, 'pending мөрөнд ангилал байхгүй');

    // notify.js-ийн ЖИНХЭНЭ builder (мөрийн type-аар шүүгдсэн)
    const rows = buildButtonRows(id, row.is_pos === 1, row.type);
    const buttons = rows.flatMap((r) => r.components.map((c) => c.toJSON()));
    assert.strictEqual(buttons.length, 9, 'зарлагад 9 товч (Орлого-гүй)');

    // "Тээвэр" товчийг дарсан гэж үзье — ЗӨВХӨН customId-аар дамжуулна
    const btn = buttons.find((b) => b.label === 'Тээвэр');
    assert.ok(btn, '"Тээвэр" товч байх ёстой');
    assert.strictEqual(btn.custom_id, `c|${id}|transport|0`);

    // bot.js-ийн задаргаа: parseId → categoryById (массив руу индекслэхгүй)
    const p = dc.parseId(btn.custom_id);
    const cat = dc.categoryById(p.catId);
    assert.strictEqual(cat, btn.label, 'товчны ШОШГО = задарсан ангилал');

    // applyToAll = Үгүй (default OFF) → зөвхөн энэ мөр
    const res = await patchCat(p.txnId, { category: cat, applyToAll: false });
    assert.strictEqual(res.status, 200);
    const after = (await get(id)).data;
    assert.strictEqual(after.category, 'Тээвэр', 'DB-д ТОВЧНЫ ШОШГО бичигдсэн байх ёстой');
    assert.strictEqual(after.status, 'classified');
    assert.strictEqual(after.manually_edited, 1);
    ok(`Discord pending→confirm: "${btn.label}" товч → DB "${after.category}" (id=transport)`);

    const ov = await overrides();
    assert.strictEqual(ov.data.length, 0, 'applyToAll=false үед override ҮҮСЭХГҮЙ');
    ok('applyToAll=false → learned override үүсээгүй (default OFF хадгалагдсан)');
  }

  // ---------- [B] Discord: modal round-trip (id нь modal-аар дамжина) ----------
  console.log('\n[B] Discord: товч → modal customId → PATCH (талбартай)');
  {
    const created = await makePending('expense');
    const id = created.id;
    const row = (await get(id)).data;
    const buttons = buildButtonRows(id, row.is_pos === 1, row.type).flatMap((r) => r.components.map((c) => c.toJSON()));
    const btn = buttons.find((b) => b.label === 'Гадуур хооллолт');

    // bot.js: товчны parse → modal customId бүтээх → modal submit дээр дахин parse
    const fromButton = dc.parseId(btn.custom_id);
    const modalId = dc.encodeModalId(fromButton.txnId, fromButton.catId, fromButton.isPos, '1234567890123456789');
    assert.ok(modalId.length <= 100, `Discord customId 100 тэмдэгтэд багтах ёстой (${modalId.length})`);
    const fromModal = dc.parseId(modalId);
    const cat = dc.categoryById(fromModal.catId);
    assert.strictEqual(cat, 'Гадуур хооллолт', 'modal дамжсаны дараа ч ижил ангилал');

    // applyToAll = Тийм → override + бүх ижил мерчант
    const res = await patchCat(fromModal.txnId, { category: cat, applyToAll: true, note: 'үдийн хоол' });
    assert.strictEqual(res.status, 200);
    const after = (await get(id)).data;
    assert.strictEqual(after.category, 'Гадуур хооллолт');
    assert.strictEqual(after.note, 'үдийн хоол');
    const ov = await overrides();
    assert.ok(ov.data.some((o) => o.category === 'Гадуур хооллолт'), 'learned override бичигдсэн');
    ok(`Discord modal урсгал: "${btn.label}" → DB "${after.category}" + override (applyToAll=Тийм)`);
  }

  // ---------- [C] Telegram: pending → callback_data → PATCH → DB ----------
  console.log('\n[C] Telegram: БОДИТ inline keyboard → callback_data → PATCH → DB');
  {
    const created = await makePending('expense');
    const id = created.id;
    const row = (await get(id)).data;
    const kb = buildCategoryKeyboard(id, row.is_pos === 1, 'c', row.type);
    const btns = kb.reply_markup.inline_keyboard.flat();
    assert.strictEqual(btns.length, 9);

    const btn = btns.find((b) => b.text === 'Хувцас / гоо сайхан');
    assert.ok(Buffer.byteLength(btn.callback_data, 'utf8') <= 64,
      `callback_data 64 БАЙТ-д багтах ёстой (${Buffer.byteLength(btn.callback_data, 'utf8')})`);
    const p = tg.parseId(btn.callback_data);
    const cat = tg.categoryById(p.catId);
    assert.strictEqual(cat, btn.text, 'товчны ШОШГО = задарсан ангилал');

    const res = await patchCat(p.txnId, { category: cat, applyToAll: false });
    assert.strictEqual(res.status, 200);
    const after = (await get(id)).data;
    assert.strictEqual(after.category, 'Хувцас / гоо сайхан', 'DB-д ТОВЧНЫ ШОШГО бичигдсэн');
    ok(`Telegram pending→confirm: "${btn.text}" товч → DB "${after.category}" (id=apparel)`);
  }

  // ---------- [D] ОРЛОГЫН мөр: шүүлт + id тус тусдаа зөв ----------
  console.log('\n[D] Орлогын мөр — 3 товч, "Орлого" id=income');
  {
    const created = await makePending('income');
    const id = created.id;
    // income нь classify.js-ээр автоматаар 'Орлого' болно — засварын урсгалыг ('ec') дуурайна
    const row = (await get(id)).data;
    assert.strictEqual(row.category, 'Орлого', 'income → автоматаар Орлого');

    const kb = buildCategoryKeyboard(id, row.is_pos === 1, 'ec', row.type);
    const btns = kb.reply_markup.inline_keyboard.flat();
    assert.deepStrictEqual(btns.map((b) => b.text), ['Орлого', 'Шилжүүлэг & гэр бүл', 'Бусад']);
    // ★ "Орлого" нь шүүсэн жагсаалтын ЭХЭНД (pos=0) байгаа ч id нь 'income'
    assert.strictEqual(btns[0].callback_data, `ec|${id}|income|0`);

    const p = tg.parseId(btns[1].callback_data); // "Шилжүүлэг & гэр бүл"
    const cat = tg.categoryById(p.catId);
    const res = await patchCat(p.txnId, { category: cat, applyToAll: false });
    assert.strictEqual(res.status, 200);
    const after = (await get(id)).data;
    assert.strictEqual(after.category, 'Шилжүүлэг & гэр бүл');
    ok('Орлогын мөр: шүүсэн жагсаалтын байрлал ≠ id — DB-д ЗӨВ ангилал бичигдэв');
  }

  // ---------- [E] ★ НИСЛЭГ ДУНДЫН ХУУЧИН PAYLOAD (fail-safe) ----------
  console.log('\n[E] ★ Хуучин (индекс) payload → БИЧИЛТ ХИЙГДЭХГҮЙ');
  {
    const created = await makePending('expense');
    const id = created.id;
    const before = (await get(id)).data;
    assert.strictEqual(before.category, null);

    // Deploy-ийн ӨМНӨ илгээгдсэн мэдэгдлийн товч (индекс 2 = 'Тээвэр')
    const legacy = `c|${id}|2|0`;
    const p = dc.parseId(legacy);
    const cat = dc.categoryById(p.catId);
    assert.strictEqual(cat, null, 'ХУУЧИН payload ангилал болж ХУВИРАХ ЁСГҮЙ');
    assert.strictEqual(CATEGORIES[2], 'Тээвэр', '(хуучин кодлолоор бол "Тээвэр" болох байсан)');
    // bot.js нь энд PATCH дуудахгүй — мөр ХӨНДӨГДӨХГҮЙ
    const after = (await get(id)).data;
    assert.strictEqual(after.category, null, 'мөр хөндөгдөөгүй байх ёстой');
    assert.strictEqual(after.status, 'pending_review');
    assert.strictEqual(after.manually_edited, 0);
    ok('Хуучин индекс-payload → null → PATCH дуудагдахгүй, мөр pending хэвээр');

    // Telegram талд ч мөн адил
    assert.strictEqual(tg.categoryById(tg.parseId(`c|${id}|2|0`).catId), null);
    assert.strictEqual(tg.categoryById(tg.parseId(`ec|${id}|9|0`).catId), null);
    ok('Telegram-д ч хуучин payload → null (c ба ec хоёуланд)');

    const ovBefore = (await overrides()).data.length;
    assert.ok(ovBefore >= 1);
    ok(`Хуучин payload override үүсгээгүй (override тоо ${ovBefore} хэвээр)`);
  }

  // ---------- [F] БҮХ ангилал: товчны шошго ↔ DB бичилт 1:1 ----------
  console.log('\n[F] 10 ангилал бүрд: товчны шошго = DB-д бичигдсэн ангилал');
  {
    let checked = 0;
    for (const category of CATEGORIES) {
      if (category === 'Орлого') continue; // зарлагын мөрд боломжгүй (018)
      const created = await makePending('expense');
      const id = created.id;
      const row = (await get(id)).data;
      const buttons = buildButtonRows(id, row.is_pos === 1, row.type).flatMap((r) => r.components.map((c) => c.toJSON()));
      const btn = buttons.find((b) => b.label === category);
      assert.ok(btn, `"${category}" товч байх ёстой`);
      const p = dc.parseId(btn.custom_id);
      const decoded = dc.categoryById(p.catId);
      assert.strictEqual(decoded, category);
      const res = await patchCat(id, { category: decoded, applyToAll: false });
      assert.strictEqual(res.status, 200, `${category} → 200 байх ёстой`);
      const after = (await get(id)).data;
      assert.strictEqual(after.category, category, `DB-д "${category}" бичигдэх ёстой`);
      checked++;
    }
    ok(`${checked}/9 зарлагын ангилал бүрд: товч → DB бичилт ЯГ таарлаа`);
  }

  console.log(`\n🎉 Бүх шалгалт PASS (${pass} баталгаа)\n`);
} catch (e) {
  console.error('\n❌ ШАЛГАЛТ УНАЛАА:', e.stack || e.message, '\n');
  process.exitCode = 1;
} finally {
  server.close();
  db.close();
}
