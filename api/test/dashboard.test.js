// ============================================================
//  test/dashboard.test.js — Dashboard + AI API integration test
//  (10 ангиллын систем). AI-г mock хийнэ. In-memory DB.
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../db.js';
import { createApp } from '../app.js';

const API_KEY = 'dash-test-key';
let server, baseUrl, db;

// Mock AI: танигдаагүйг "Хүнсний зүйл"/medium; THE LBOM → other/low
const mockAi = {
  enabled: true,
  aiCategorize: async (desc) => {
    if (/THE LBOM/i.test(desc)) return { category: 'other', confidence: 'low' };
    return { category: 'Хүнсний зүйл', confidence: 'medium' };
  },
};

before(async () => {
  db = createDb(':memory:');
  const app = createApp({ db, ai: mockAi, apiKey: API_KEY, rateLimit: { windowSeconds: 60, max: 100000 } });
  await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });
});
after(async () => { await new Promise((r) => server.close(r)); db.close(); });

const H = { 'Content-Type': 'application/json', 'X-API-Key': API_KEY };
const post = (path, body) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
const patch = (path, body) => fetch(`${baseUrl}${path}`, { method: 'PATCH', headers: H, body: JSON.stringify(body) });
const get = (path) => fetch(`${baseUrl}${path}`, { headers: { 'X-API-Key': API_KEY } });

let mid = 0;
const tx = (over = {}) => ({
  messageId: `<m${++mid}>`, amount: 10000, currency: 'MNT', date: '2026-06-08',
  type: 'expense', description: 'X', ...over,
});

test('дүрмээр танигдах (SocialPay) → classified, Захиалга & сервис', async () => {
  const r = await post('/api/transactions', tx({ description: 'SocialPay гүйлгэ' }));
  assert.equal(r.status, 201);
  assert.equal((await r.json()).txStatus, 'classified');
  assert.equal(db.getByMessageId(`<m${mid}>`).category, 'Захиалга & сервис');
});

test('орлого → Орлого (classified, AI асуухгүй)', async () => {
  const r = await post('/api/transactions', tx({ description: 'хэн нэгэн мөнгө явуулав', type: 'income' }));
  assert.equal((await r.json()).txStatus, 'classified');
  assert.equal(db.getByMessageId(`<m${mid}>`).category, 'Орлого');
});

test('танигдаагүй → AI санал + pending_review (category NULL)', async () => {
  const r = await post('/api/transactions', tx({ description: '0930 ZZUNKNOWNX' }));
  assert.equal((await r.json()).txStatus, 'pending_review');
  const row = db.getByMessageId(`<m${mid}>`);
  assert.equal(row.category, null);
  assert.equal(row.ai_suggested_category, 'Хүнсний зүйл');
  assert.equal(row.ai_confidence, 'medium');
});

test('AI low confidence (THE LBOM) → pending, санал other/low', async () => {
  const r = await post('/api/transactions', tx({ description: '0930 THE LBOM' }));
  assert.equal((await r.json()).txStatus, 'pending_review');
  const row = db.getByMessageId(`<m${mid}>`);
  assert.equal(row.ai_suggested_category, 'other');
  assert.equal(row.ai_confidence, 'low');
});

test('GET /pending — pending_review буцаана', async () => {
  const r = await get('/api/transactions/pending');
  const j = await r.json();
  assert.ok(j.data.every((row) => row.status === 'pending_review'));
  assert.ok(j.total >= 2);
});

test('PATCH category (нэг мөр) → classified', async () => {
  await post('/api/transactions', tx({ description: '0930 SINGLEONE' }));
  const row = db.getByMessageId(`<m${mid}>`);
  const r = await patch(`/api/transactions/${row.id}/category`, { category: 'Тээвэр' });
  assert.equal(r.status, 200);
  const u = db.getById(row.id);
  assert.equal(u.category, 'Тээвэр');
  assert.equal(u.status, 'classified');
});

test('PATCH applyToAll → тэр мерчантын бүх мөр + override', async () => {
  await post('/api/transactions', tx({ description: '0930 BUJINBOM' }));
  const firstId = db.getByMessageId(`<m${mid}>`).id;
  await post('/api/transactions', tx({ description: '0047 BUJINBOM' }));
  const r = await patch(`/api/transactions/${firstId}/category`, { category: 'Гадуур хооллолт', applyToAll: true });
  const j = await r.json();
  assert.ok(j.updated >= 2);
  assert.ok(j.override);
  const r2 = await post('/api/transactions', tx({ description: '5253 BUJINBOM' }));
  assert.equal((await r2.json()).txStatus, 'classified');
  assert.equal(db.getByMessageId(`<m${mid}>`).category, 'Гадуур хооллолт');
});

test('ингест: BOM → is_pos=1, BOM-гүй → is_pos=0', async () => {
  await post('/api/transactions', tx({ description: '0930 MYSHOPBOM' }));
  assert.equal(db.getByMessageId(`<m${mid}>`).is_pos, 1);
  await post('/api/transactions', tx({ description: 'SocialPay гүйлгэ' }));
  assert.equal(db.getByMessageId(`<m${mid}>`).is_pos, 0);
});

test('POS баталгаажуулалт: merchantPlace → override.friendly_name + row.merchant_place', async () => {
  await post('/api/transactions', tx({ description: '0930 QQPLACEBOM' }));
  const row = db.getByMessageId(`<m${mid}>`);
  const r = await patch(`/api/transactions/${row.id}/category`, { category: 'Гадуур хооллолт', merchantPlace: 'Шулуун дун' });
  const j = await r.json();
  assert.equal(j.override.friendly_name, 'Шулуун дун');
  const u = db.getById(row.id);
  assert.equal(u.merchant_place, 'Шулуун дун');
  assert.equal(u.category, 'Гадуур хооллолт');
});

test('POS биш баталгаажуулалт: note → override.default_note + row.note', async () => {
  await post('/api/transactions', tx({ description: 'HER-БАТСАЙХАН ТӨ' }));
  const row = db.getByMessageId(`<m${mid}>`);
  const r = await patch(`/api/transactions/${row.id}/category`, { category: 'Шилжүүлэг & гэр бүл', note: 'Ээжид сарын мөнгө' });
  const j = await r.json();
  assert.equal(j.override.default_note, 'Ээжид сарын мөнгө');
  const u = db.getById(row.id);
  assert.equal(u.note, 'Ээжид сарын мөнгө');
  assert.equal(u.category, 'Шилжүүлэг & гэр бүл');
});

test('override_note annotation жагсаалтад харагдана', async () => {
  await post('/api/transactions', tx({ description: 'HER-БАТСАЙХАН ТӨ 2' }));
  const list = await (await get('/api/transactions?q=' + encodeURIComponent('БАТСАЙХАН'))).json();
  assert.ok(list.data.some((x) => x.override_note === 'Ээжид сарын мөнгө'));
});

test('PATCH /:id/note → зөвхөн тэмдэглэл засна', async () => {
  await post('/api/transactions', tx({ description: 'SocialPay гүйлгэ' }));
  const row = db.getByMessageId(`<m${mid}>`);
  const r = await patch(`/api/transactions/${row.id}/note`, { note: 'Тест тэмдэглэл' });
  assert.equal(r.status, 200);
  assert.equal(db.getById(row.id).note, 'Тест тэмдэглэл');
});

test('POST /api/overrides → дараагийн ингест автоматаар ангилагдана', async () => {
  const r = await post('/api/overrides', { merchantPattern: 'STOREBOM', category: 'Хүнсний зүйл' });
  assert.equal(r.status, 201);
  const r2 = await post('/api/transactions', tx({ description: '0047 STOREBOM' }));
  assert.equal((await r2.json()).txStatus, 'classified');
  assert.equal(db.getByMessageId(`<m${mid}>`).category, 'Хүнсний зүйл');
});

test('POST /api/ai-categorize (mock) → санал буцаана', async () => {
  const r = await post('/api/ai-categorize', { description: '0930 ANYTHING' });
  const j = await r.json();
  assert.equal(j.category, 'Хүнсний зүйл');
  assert.equal(j.confidence, 'medium');
});

test('GET /api/summary — нийт зарлага/орлого + ангиллаар', async () => {
  await post('/api/transactions', tx({ description: 'цалин орлоо', type: 'income', amount: 500000 }));
  const r = await get('/api/summary');
  const j = await r.json();
  assert.ok(j.totalIncome >= 500000);
  assert.ok(j.totalExpense > 0);
  assert.ok(Array.isArray(j.byCategory));
  assert.ok(Array.isArray(j.byPlace));
});

test('GET /api/categories — 10 ангилал', async () => {
  const j = await (await get('/api/categories')).json();
  assert.ok(j.categories.includes('Гадуур хооллолт'));
  assert.ok(j.categories.includes('Бусад'));
  assert.equal(j.categories.length, 10);
});

test('шүүлт: q (текст хайлт)', async () => {
  const j = await (await get('/api/transactions?q=SocialPay')).json();
  assert.ok(j.data.length >= 1);
  assert.ok(j.data.every((row) => /SocialPay/i.test(row.description)));
});

test('шүүлт: minAmount', async () => {
  const j = await (await get('/api/transactions?minAmount=400000')).json();
  assert.ok(j.data.every((row) => row.amount >= 400000));
});

test('шүүлт: category (нэр, encode хийсэн)', async () => {
  const cat = 'Захиалга & сервис';
  const j = await (await get('/api/transactions?category=' + encodeURIComponent(cat))).json();
  assert.ok(j.data.every((row) => row.category === cat));
});

test('буруу category PATCH → 400', async () => {
  const r = await patch('/api/transactions/1/category', { category: 'invalid-cat' });
  assert.equal(r.status, 400);
});

test('auth байхгүй → 401', async () => {
  assert.equal((await fetch(`${baseUrl}/api/summary`)).status, 401);
});

// ---- AI СОНГОЛТТОЙ (optional) — тусдаа app instance ----
async function spinApp(ai) {
  const d = createDb(':memory:');
  const app = createApp({ db: d, ai, apiKey: API_KEY, rateLimit: { windowSeconds: 60, max: 100000 } });
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  return { d, srv, url: `http://127.0.0.1:${srv.address().port}` };
}
const ingest = (url, mid2, desc) => fetch(`${url}/api/transactions`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ messageId: mid2, amount: 5000, currency: 'MNT', date: '2026-06-08', type: 'expense', description: desc }),
});

test('AI ИДЭВХГҮЙ: танигдаагүй → pending, санал null, систем зогсохгүй', async () => {
  const { d, srv, url } = await spinApp({ enabled: false, aiCategorize: async () => { throw new Error('дуудагдах ёсгүй'); } });
  const res = await ingest(url, '<ai-off>', '0930 ZZUNKNOWNAI');
  assert.equal(res.status, 201);
  assert.equal((await res.json()).txStatus, 'pending_review');
  const row = d.getByMessageId('<ai-off>');
  assert.equal(row.category, null);
  assert.equal(row.ai_suggested_category, null);
  await new Promise((r) => srv.close(r)); d.close();
});

test('AI АЛДАА (credit алга): throw → гүйлгээ pending, санал null (зогсохгүй)', async () => {
  const { d, srv, url } = await spinApp({ enabled: true, aiCategorize: async () => { throw new Error('credit алга'); } });
  const res = await ingest(url, '<ai-fail>', '0930 ZZUNKNOWNFAIL');
  assert.equal(res.status, 201);
  assert.equal((await res.json()).txStatus, 'pending_review');
  const row = d.getByMessageId('<ai-fail>');
  assert.equal(row.category, null);
  assert.equal(row.ai_suggested_category, null);
  await new Promise((r) => srv.close(r)); d.close();
});
