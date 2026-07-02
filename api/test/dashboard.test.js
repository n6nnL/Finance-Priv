// ============================================================
//  test/dashboard.test.js — Dashboard + AI + AUTH + MULTI-TENANT
//  AI mock; in-memory DB; seed owner user. HTTP X-API-Key = machine→owner.
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../db.js';
import { createApp } from '../app.js';
import { hashPasswordSync } from '../auth/passwordHash.js';

const API_KEY = 'dash-test-key';
const JWT_SECRET = 'test-jwt-secret';
let server, baseUrl, db, OWNER;

const mockAi = {
  enabled: true,
  aiCategorize: async (desc) => {
    if (/THE LBOM/i.test(desc)) return { category: 'other', confidence: 'low' };
    return { category: 'Хүнсний зүйл', confidence: 'medium' };
  },
};

before(async () => {
  db = createDb(':memory:');
  OWNER = db.createUser('admin', hashPasswordSync('testpw'), 'admin').id; // owner (machine хамаарна)
  const app = createApp({ db, ai: mockAi, apiKey: API_KEY, jwtSecret: JWT_SECRET, allowRegister: true, localAuth: true, rateLimit: { windowSeconds: 60, max: 100000 } });
  await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });
});
after(async () => { await new Promise((r) => server.close(r)); db.close(); });

const H = { 'Content-Type': 'application/json', 'X-API-Key': API_KEY };
const post = (path, body) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
const patch = (path, body) => fetch(`${baseUrl}${path}`, { method: 'PATCH', headers: H, body: JSON.stringify(body) });
const get = (path, headers = { 'X-API-Key': API_KEY }) => fetch(`${baseUrl}${path}`, { headers });

let mid = 0;
// userId: OWNER — machine push-д заавал (multi-tenant contract)
const tx = (over = {}) => ({ userId: OWNER, messageId: `<m${++mid}>`, amount: 10000, currency: 'MNT', date: '2026-06-08', type: 'expense', description: 'X', ...over });

test('дүрмээр танигдах (SocialPay) → classified, Захиалга & сервис', async () => {
  const r = await post('/api/transactions', tx({ description: 'SocialPay гүйлгэ' }));
  assert.equal(r.status, 201);
  assert.equal((await r.json()).txStatus, 'classified');
  assert.equal(db.getByMessageId(OWNER, `<m${mid}>`).category, 'Захиалга & сервис');
});

test('орлого → Орлого (classified)', async () => {
  await post('/api/transactions', tx({ description: 'цалин', type: 'income' }));
  assert.equal(db.getByMessageId(OWNER, `<m${mid}>`).category, 'Орлого');
});

test('танигдаагүй → AI санал + pending_review (category NULL)', async () => {
  await post('/api/transactions', tx({ description: '0930 ZZUNKNOWNX' }));
  const row = db.getByMessageId(OWNER, `<m${mid}>`);
  assert.equal(row.category, null);
  assert.equal(row.ai_suggested_category, 'Хүнсний зүйл');
});

test('PATCH applyToAll → бүх мөр + override', async () => {
  await post('/api/transactions', tx({ description: '0930 BUJINBOM' }));
  const firstId = db.getByMessageId(OWNER, `<m${mid}>`).id;
  await post('/api/transactions', tx({ description: '0047 BUJINBOM' }));
  const r = await patch(`/api/transactions/${firstId}/category`, { category: 'Гадуур хооллолт', applyToAll: true });
  const j = await r.json();
  assert.ok(j.updated >= 2);
  await post('/api/transactions', tx({ description: '5253 BUJINBOM' }));
  assert.equal(db.getByMessageId(OWNER, `<m${mid}>`).category, 'Гадуур хооллолт');
});

test('POS баталгаажуулалт: merchantPlace → row.merchant_place', async () => {
  await post('/api/transactions', tx({ description: '0930 QQPLACEBOM' }));
  const row = db.getByMessageId(OWNER, `<m${mid}>`);
  const r = await patch(`/api/transactions/${row.id}/category`, { category: 'Гадуур хооллолт', merchantPlace: 'Шулуун дун' });
  assert.equal((await r.json()).override.friendly_name, 'Шулуун дун');
  assert.equal(db.getById(OWNER, row.id).merchant_place, 'Шулуун дун');
});

test('PATCH /:id/note → тэмдэглэл', async () => {
  await post('/api/transactions', tx({ description: 'SocialPay гүйлгэ' }));
  const row = db.getByMessageId(OWNER, `<m${mid}>`);
  await patch(`/api/transactions/${row.id}/note`, { note: 'Тест' });
  assert.equal(db.getById(OWNER, row.id).note, 'Тест');
});

test('GET /api/summary + /monthly + /categories', async () => {
  await post('/api/transactions', tx({ description: 'цалин орлоо', type: 'income', amount: 500000 }));
  const s = await (await get('/api/summary')).json();
  assert.ok(s.totalIncome >= 500000);
  const m = await (await get('/api/monthly')).json();
  assert.ok(Array.isArray(m.data) && m.data.length >= 1);
  const c = await (await get('/api/categories')).json();
  assert.equal(c.categories.length, 10);
});

test('GET /pending зөвхөн pending_review', async () => {
  const j = await (await get('/api/transactions/pending')).json();
  assert.ok(j.data.every((row) => row.status === 'pending_review'));
});

test('AI идэвхгүй / алдаа → pending, санал null (зогсохгүй)', async () => {
  const d = createDb(':memory:');
  d.createUser('o', hashPasswordSync('x'), 'admin');
  const app = createApp({ db: d, ai: { enabled: false, aiCategorize: async () => { throw new Error('x'); } }, apiKey: API_KEY, jwtSecret: JWT_SECRET, rateLimit: { windowSeconds: 60, max: 100000 } });
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const url = `http://127.0.0.1:${srv.address().port}`;
  const res = await fetch(`${url}/api/transactions`, { method: 'POST', headers: H, body: JSON.stringify({ userId: d.getOwnerUserId(), messageId: '<aioff>', amount: 5000, currency: 'MNT', date: '2026-06-08', type: 'expense', description: '0930 ZZUNKNOWNAI' }) });
  assert.equal((await res.json()).txStatus, 'pending_review');
  assert.equal(d.getByMessageId(d.getOwnerUserId(), '<aioff>').ai_suggested_category, null);
  await new Promise((r) => srv.close(r)); d.close();
});

// ---------------- AUTH (JWT) ----------------
test('login: admin/testpw → JWT, /me ажиллана', async () => {
  const lr = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin', password: 'testpw' }) });
  assert.equal(lr.status, 200);
  const { accessToken, refreshToken, user } = await lr.json();
  assert.ok(accessToken && refreshToken);
  assert.equal(user.email, 'admin');
  // /me JWT-ээр
  const me = await get('/api/auth/me', { Authorization: `Bearer ${accessToken}` });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.id, OWNER);
  // protected route JWT-ээр
  assert.equal((await get('/api/categories', { Authorization: `Bearer ${accessToken}` })).status, 200);
});

test('login буруу нууц үг → 401', async () => {
  const r = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin', password: 'wrong' }) });
  assert.equal(r.status, 401);
});

test('refresh: refreshToken → шинэ accessToken', async () => {
  const { refreshToken } = await (await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin', password: 'testpw' }) })).json();
  const rr = await fetch(`${baseUrl}/api/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
  assert.equal(rr.status, 200);
  assert.ok((await rr.json()).accessToken);
});

test('token-гүй protected route → 401', async () => {
  assert.equal((await fetch(`${baseUrl}/api/summary`)).status, 401);
});

// ---------------- MULTI-TENANT ----------------
test('multi-tenant: хэрэглэгч зөвхөн өөрийн өгөгдлийг харна', async () => {
  // owner-д гүйлгээ бий (дээрх тестүүдээс). Шинэ хэрэглэгч B бүртгүүлнэ.
  const reg = await fetch(`${baseUrl}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'b@test.mn', password: 'pass1234' }) });
  assert.equal(reg.status, 201);
  const { accessToken: bToken } = await reg.json();
  const bHdr = { Authorization: `Bearer ${bToken}` };

  // B-ийн жагсаалт ХООСОН (owner-ийн гүйлгээ харагдахгүй)
  const bList = await (await get('/api/transactions', bHdr)).json();
  assert.equal(bList.total, 0);
  // owner-д гүйлгээ бий
  const oList = await (await get('/api/transactions')).json();
  assert.ok(oList.total > 0);
  // B owner-ийн гүйлгээг id-ээр харж ЧАДАХГҮЙ (404)
  const someId = db.getByMessageId(OWNER, '<m1>')?.id;
  if (someId) {
    const patchRes = await fetch(`${baseUrl}/api/transactions/${someId}/note`, { method: 'PATCH', headers: { ...bHdr, 'Content-Type': 'application/json' }, body: JSON.stringify({ note: 'hack' }) });
    assert.equal(patchRes.status, 404);
  }
});

test('register хаалттай үед → 403', async () => {
  const d = createDb(':memory:');
  d.createUser('o', hashPasswordSync('x'), 'admin');
  const app = createApp({ db: d, ai: mockAi, apiKey: API_KEY, jwtSecret: JWT_SECRET, allowRegister: false, localAuth: true, rateLimit: { windowSeconds: 60, max: 100000 } });
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const url = `http://127.0.0.1:${srv.address().port}`;
  const r = await fetch(`${url}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'x@y.z', password: 'pass1234' }) });
  assert.equal(r.status, 403);
  await new Promise((r2) => srv.close(r2)); d.close();
});
