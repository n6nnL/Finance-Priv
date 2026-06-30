// End-to-end verification for Discord-driven pending_review resolution.
// Жинхэнэ API factory-г :memory: DB дээр ачаалж, bot-ийн түшиглэдэг
// дата-давхаргын урсгалыг бүхэлд нь шалгана. Discord gateway шаардахгүй.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createDb } from '../api/db.js';
import { createApp } from '../api/app.js';
import { createAi } from '../api/ai.js';
import { hashPasswordSync } from '../api/auth/passwordHash.js';

const API_KEY = 'verify-key-123';
const db = createDb(':memory:', {
  seed: { email: 'owner@test.co', passwordHash: hashPasswordSync('x'), role: 'admin' },
});
const ai = createAi({ enabled: false });
const app = createApp({ db, ai, apiKey: API_KEY, jwtSecret: API_KEY });
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const H = { 'Content-Type': 'application/json', 'X-API-Key': API_KEY };

const post = async (b) => {
  const r = await fetch(base + '/api/transactions', { method: 'POST', headers: H, body: JSON.stringify(b) });
  return { status: r.status, json: await r.json() };
};
const get = async (id) => {
  const r = await fetch(base + `/api/transactions/${id}`, { headers: H });
  return { status: r.status, json: await r.json() };
};
const patch = async (id, b) => {
  const r = await fetch(base + `/api/transactions/${id}/category`, { method: 'PATCH', headers: H, body: JSON.stringify(b) });
  return { status: r.status, json: await r.json() };
};

let pass = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
let msgId = 1; const mid = () => `<verify-${msgId++}@test>`;

try {
  // ---------- [1] POS pending → "Ямар газар?" урсгал ----------
  console.log('\n[1] POS pending_review → category + manually_edited + override + clear');
  const posMsg = mid();
  let r = await post({ messageId: posMsg, amount: 5400, type: 'expense', date: '2026-06-26', description: '2266 ZXQSTOREBOM', isPos: true });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.txStatus, 'pending_review', `POS unknown нь pending байх ёстой, ${r.json.txStatus}`);
  const posId = r.json.id;
  ok('Үл мэдэгдэх POS гүйлгээ → pending_review');

  r = await get(posId);
  assert.strictEqual(r.json.data.status, 'pending_review');
  assert.strictEqual(r.json.data.is_pos, 1, 'is_pos=1 (bot "Ямар газар?" асууна)');
  assert.strictEqual(r.json.data.manually_edited, 0, 'эхэндээ manually_edited=0');
  ok('GET /:id → pending, is_pos=1, manually_edited=0');

  // Bot модал submit-ийн дуурайлга: POS → merchantPlace, applyToAll
  r = await patch(posId, { category: 'Хүнсний зүйл', applyToAll: true, merchantPlace: 'Шулуун дун' });
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.updated >= 1);
  assert.ok(r.json.override && r.json.override.friendly_name === 'Шулуун дун', 'override.friendly_name бичигдсэн');
  ok('PATCH (merchantPlace) → override бичигдсэн (friendly_name)');

  r = await get(posId);
  assert.strictEqual(r.json.data.category, 'Хүнсний зүйл');
  assert.strictEqual(r.json.data.status, 'classified', 'pending цэвэрлэгдсэн');
  assert.strictEqual(r.json.data.manually_edited, 1, 'manually_edited=1 болсон');
  assert.strictEqual(r.json.data.merchant_place, 'Шулуун дун');
  ok('GET /:id → category set, status=classified, manually_edited=1, merchant_place set');

  // ---------- [2] Transfer pending → "Юунд?" ----------
  console.log('\n[2] Transfer (POS биш) pending_review');
  r = await post({ messageId: mid(), amount: 50000, type: 'expense', date: '2026-06-26', description: 'ZXQPERSONTRANSFER', isPos: false });
  assert.strictEqual(r.json.txStatus, 'pending_review');
  const trId = r.json.id;
  r = await get(trId);
  assert.strictEqual(r.json.data.is_pos, 0, 'is_pos=0 → bot "Юунд?" асууна');
  ok('Шилжүүлэг → pending, is_pos=0 (bot "Юунд?")');

  // ---------- [3] Override → дараагийн ижил мерчант auto-classify ----------
  console.log('\n[3] Ижил мерчантын 2 дахь гүйлгээ → override-оор auto-classify');
  r = await post({ messageId: mid(), amount: 9000, type: 'expense', date: '2026-06-27', description: '2266 ZXQSTOREBOM', isPos: true });
  assert.strictEqual(r.json.txStatus, 'classified', `override-оор classified байх ёстой, ${r.json.txStatus}`);
  const auto = await get(r.json.id);
  assert.strictEqual(auto.json.data.category, 'Хүнсний зүйл', 'override ангилал тавигдсан');
  assert.strictEqual(auto.json.data.manually_edited, 0, 'авто-classified нь manually_edited биш (override хамгаална)');
  ok('2 дахь ZXQSTOREBOM → автоматаар "Хүнсний зүйл" (override ажиллав)');

  // ---------- [4] Stale: шийдэгдсэн/устсаныг эелдэг харьцах (bot-ийн шалгалт) ----------
  console.log('\n[4] Stale товч: API-аас дахин татах → эелдэг (crash биш)');
  // 4a) аль хэдийн classified (Dashboard-аар шийдэгдсэн төлөөлөл)
  r = await get(posId);
  assert.strictEqual(r.json.data.status, 'classified');
  ok('Шийдэгдсэн мөрийг дахин татахад status!=pending_review → bot эелдэг мессеж харуулна');
  // 4b) байхгүй id → 404 (bot getTransaction нь null болж эелдэг мессеж өгнө)
  r = await get(999999);
  assert.strictEqual(r.status, 404, `байхгүй id → 404, ${r.status}`);
  ok('Байхгүй id → 404 (getTransaction → null → эелдэг мессеж)');

  // ---------- [5] Pipeline guard + bot wording (эх кодын баталгаа) ----------
  console.log('\n[5] manually_edited pipeline guard + асуултын үг');
  const recat = readFileSync(new URL('./recategorize.js', import.meta.url), 'utf8');
  const reparse = readFileSync(new URL('./reparse.js', import.meta.url), 'utf8');
  assert.match(recat, /manually_edited === 1/, 'recategorize.js manually_edited-г skip хийнэ');
  assert.match(reparse, /manually_edited !== 1/, 'reparse.js manually_edited-г skip хийнэ');
  ok('reparse/recategorize нь manually_edited мөрийг дахин ангилахгүй');
  const bot = readFileSync(new URL('../discord/bot.js', import.meta.url), 'utf8');
  assert.match(bot, /p\.isPos \? 'Ямар газар\?' : 'Юунд\?'/, 'bot POS→"Ямар газар?", transfer→"Юунд?"');
  assert.match(bot, /deferReply[\s\S]{0,400}getTransaction/, 'submit: deferReply (ack) → дараа нь API');
  ok('bot: POS/transfer асуултын логик + submit дээр ack-before-write хадгалагдсан');

  console.log(`\n🎉 Бүх шалгалт PASS (${pass} баталгаа)\n`);
} catch (e) {
  console.error('\n❌ ШАЛГАЛТ УНАЛАА:', e.message, '\n');
  process.exitCode = 1;
} finally {
  server.close();
  db.close();
}
