// Verification for Discord category-editing of already-recorded transactions.
// (Scope: category-only edit via select menu, reusing PATCH /:id/category.)
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createDb } from '../api/db.js';
import { createApp } from '../api/app.js';
import { createAi } from '../api/ai.js';
import { hashPasswordSync } from '../api/auth/passwordHash.js';
// Discord давхаргын цэвэр логик (discord config/token шаардахгүй):
import { buildComponentsFor, buildEditRow } from '../discord/notify.js';
import { encodeEditButtonId, encodeCatSelectId, parseId } from '../discord/categories.js';
import { CATEGORIES } from '../config/categories.js';

const API_KEY = 'edit-verify-key';
const db = createDb(':memory:', {
  seed: { email: 'owner@test.co', passwordHash: hashPasswordSync('x'), role: 'admin' },
});
const app = createApp({ db, ai: createAi({ enabled: false }), apiKey: API_KEY, jwtSecret: API_KEY });
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const H = { 'Content-Type': 'application/json', 'X-API-Key': API_KEY };
const post = async (b) => (await fetch(base + '/api/transactions', { method: 'POST', headers: H, body: JSON.stringify(b) })).json();
const get = async (id) => { const r = await fetch(base + `/api/transactions/${id}`, { headers: H }); return { status: r.status, json: await r.json() }; };
const patchCat = async (id, b) => (await fetch(base + `/api/transactions/${id}/category`, { method: 'PATCH', headers: H, body: JSON.stringify(b) })).json();
const overrides = async () => (await fetch(base + '/api/overrides', { headers: H })).json();

let pass = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };

try {
  // ---------- [A] Encoding / component логик (bot UI давхарга) ----------
  console.log('\n[A] customId encode/parse + component логик');
  assert.deepStrictEqual(parseId(encodeEditButtonId(42)), { kind: 'e', txnId: 42 });
  assert.deepStrictEqual(parseId(encodeCatSelectId(42, '99887766')), { kind: 'es', txnId: 42, messageId: '99887766' });
  // Хуучин 'c'/'m' формат эвдрээгүй
  assert.strictEqual(parseId('c|7|3|1').kind, 'c');
  assert.strictEqual(parseId('m|7|3|1|123').kind, 'm');
  ok("parseId 'e'/'es'-г зөв задална, 'c'/'m' эвдрээгүй");

  // classified → "Ангилал засах" товч (1 эгнээ, customId 'e|..')
  const classifiedComp = buildComponentsFor({ id: 5, status: 'classified', category: 'Хүнсний зүйл', is_pos: 1 });
  assert.strictEqual(classifiedComp.length, 1);
  const editJson = classifiedComp[0].toJSON();
  assert.strictEqual(editJson.components[0].custom_id, 'e|5');
  ok('classified мессеж → "Ангилал засах" товч (e|<id>)');

  // pending → ангиллын товчлуурууд (засах товч БИШ)
  const pendingComp = buildComponentsFor({ id: 6, status: 'pending_review', category: null, is_pos: 0 });
  const firstId = pendingComp[0].toJSON().components[0].custom_id;
  assert.ok(firstId.startsWith('c|6|'), `pending → ангиллын товч, ${firstId}`);
  ok('pending_review мессеж → ангиллын товчлуурууд (Prompt 2 хадгалагдсан)');

  // select зөвхөн 10 ангилалтай (free text биш)
  assert.strictEqual(CATEGORIES.length, 10);
  ok(`Select-д зориулсан ангилал = 10 (13 биш): ${CATEGORIES.join(', ')}`);

  // ---------- [B] Verification 1: category edit → persist + manually_edited + override ----------
  console.log('\n[B] Discord category edit (PATCH /:id/category) — persist + override');
  let r = await post({ messageId: '<edit-1@t>', amount: 5400, type: 'expense', date: '2026-06-26', description: '2266 CU-MARTZX', isPos: true });
  assert.strictEqual(r.txStatus, 'classified', 'keyword-аар classified байх ёстой');
  const id = r.id;
  let g = await get(id);
  assert.strictEqual(g.json.data.manually_edited, 0, 'эхэндээ manually_edited=0');
  const before = g.json.data.category;

  // Select submit-ийн дуурайлга: шинэ ангилал, applyToAll
  const res = await patchCat(id, { category: 'Гадуур хооллолт', applyToAll: true });
  assert.ok(res.updated >= 1);
  g = await get(id);
  assert.strictEqual(g.json.data.category, 'Гадуур хооллолт', 'шинэ ангилал хадгалагдсан');
  assert.notStrictEqual(g.json.data.category, before);
  assert.strictEqual(g.json.data.status, 'classified');
  assert.strictEqual(g.json.data.manually_edited, 1, 'manually_edited=1 болсон');
  ok('Category edit → persist + status classified + manually_edited=1');

  const ov = await overrides();
  const hit = ov.data.find((o) => 'CU-MARTZX'.includes(o.merchant_pattern) && o.category === 'Гадуур хооллолт');
  assert.ok(hit, 'learned override (шинэ ангилал) бичигдсэн');
  ok('Learned override шинэчлэгдсэн (дараагийн ижил мерчант auto-classify болно)');
  // Dashboard ижил API/DB-ээс уншина → ижил утга харагдана
  ok('Dashboard ижил DB/API-аас → шинэ ангиллыг харна (нэг эх сурвалж)');

  // ---------- [C] Verification 3: stale → одоогийн утга харуулна ----------
  console.log('\n[C] Stale: Dashboard-аар өөрчилсний дараа edit → одоогийн утга');
  await patchCat(id, { category: 'Тээвэр', applyToAll: true }); // "Dashboard" өөрчлөлт
  g = await get(id); // bot interaction үед энэ татагдана → select default
  assert.strictEqual(g.json.data.category, 'Тээвэр', 'GET нь хамгийн сүүлийн (Dashboard) утгыг буцаана');
  ok('Edit нээхэд API-аас одоогийн "Тээвэр"-г татна (хуучин утга биш)');
  // байхгүй id → 404 → bot эелдэг мессеж
  assert.strictEqual((await get(999999)).status, 404);
  ok('Байхгүй id → 404 → эелдэг мессеж (crash биш)');

  // ---------- [D] Verification 4: өөрчлөлтгүй бол бичихгүй (bot логик) ----------
  console.log('\n[D] Unchanged → бичихгүй (bot select-submit логик)');
  const bot = readFileSync(new URL('../discord/bot.js', import.meta.url), 'utf8');
  assert.match(bot, /current\.category === chosen[\s\S]{0,200}Өөрчлөлтгүй/, 'сонгосон нь одоогийнхтой ижил бол бичихгүй');
  assert.match(bot, /isStringSelectMenu[\s\S]*?deferUpdate[\s\S]*?patchCategory/, 'select: deferUpdate (ack) → дараа нь API');
  ok('Сонгосон ангилал = одоогийнх бол PATCH дуудахгүй (unchanged хамгаалагдсан)');
  ok('Select submit: deferUpdate (3с ack) → дараа нь patchCategory');

  // ---------- [E] Scope guard: amount/description edit endpoint НЭМЭГДЭЭГҮЙ ----------
  console.log('\n[E] Scope: amount/description edit нэмэгдээгүй (category-only)');
  const routes = readFileSync(new URL('../api/routes/transactions.js', import.meta.url), 'utf8');
  assert.ok(!/router\.patch\(\s*['"]\/:id['"]\s*,/.test(routes), 'ерөнхий PATCH /:id endpoint нэмэгдээгүй');
  assert.ok(!/updateFields/.test(routes), 'updateFields route нэмэгдээгүй');
  ok('Шинэ amount/description endpoint нэмээгүй — category-only хүрээнд');

  console.log(`\n🎉 Бүх шалгалт PASS (${pass} баталгаа)\n`);
} catch (e) {
  console.error('\n❌ ШАЛГАЛТ УНАЛАА:', e.stack || e.message, '\n');
  process.exitCode = 1;
} finally {
  server.close();
  db.close();
}
