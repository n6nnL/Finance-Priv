// ============================================================
//  test/category-applicability.test.js — SERVER-SIDE BACKSTOP
//
//  Гурван клиент picker-ээ шүүдэг ч түүнд НАЙДАХГҮЙ: шууд HTTP дуудлагаар
//  зарлаган мөрөнд "Орлого" оноох оролдлогыг API 400-аар хаах ёстой
//  (UI-д л байгаа хамгаалалт нь хамгаалалт БИШ).
//
//  in-memory DB, AI mock — dashboard.test.js-ийн загвартай ижил.
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../db.js';
import { createApp } from '../app.js';
import { hashPasswordSync } from '../auth/passwordHash.js';

const API_KEY = 'applic-test-key';
const JWT_SECRET = 'test-jwt-secret';
let server, baseUrl, db, OWNER;

const mockAi = { enabled: false, aiCategorize: async () => ({ category: 'other', confidence: 'low' }) };

before(async () => {
  db = createDb(':memory:');
  OWNER = db.createUser('admin', hashPasswordSync('testpw'), 'admin').id;
  const app = createApp({
    db, ai: mockAi, apiKey: API_KEY, jwtSecret: JWT_SECRET,
    allowRegister: true, localAuth: true, rateLimit: { windowSeconds: 60, max: 100000 },
  });
  await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });
});
after(async () => { await new Promise((r) => server.close(r)); db.close(); });

const H = { 'Content-Type': 'application/json', 'X-API-Key': API_KEY };
const post = (path, body) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
const patch = (path, body) => fetch(`${baseUrl}${path}`, { method: 'PATCH', headers: H, body: JSON.stringify(body) });

let mid = 0;
const tx = (over = {}) => ({
  userId: OWNER, messageId: `<ap${++mid}>`, amount: 10000, currency: 'MNT',
  date: '2026-06-08', type: 'expense', description: '0930 ZZUNKNOWNAPX', ...over,
});

/** Гүйлгээ үүсгээд id-г нь буцаана */
async function seed(over = {}) {
  const r = await post('/api/transactions', tx(over));
  assert.ok(r.status === 201, `seed амжилтгүй: ${r.status}`);
  return (await r.json()).id;
}

// ---- PATCH /api/transactions/:id/category ----

test('ЗАРЛАГА + "Орлого" → 400 (энэ фазын гол алдаа хаагдсан)', async () => {
  const id = await seed({ type: 'expense' });
  const r = await patch(`/api/transactions/${id}/category`, { category: 'Орлого' });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.match(j.error, /Орлого/);
  assert.match(j.error, /зарлагын/);
  // Мөр ХӨНДӨГДӨӨГҮЙ байх ёстой
  assert.equal(db.getById(OWNER, id).category, null);
});

test('ЗАРЛАГА + зөвшөөрөгдсөн ангилал → 200', async () => {
  const id = await seed({ type: 'expense' });
  const r = await patch(`/api/transactions/${id}/category`, { category: 'Тээвэр' });
  assert.equal(r.status, 200);
  assert.equal(db.getById(OWNER, id).category, 'Тээвэр');
});

test('ОРЛОГО + зөвхөн зарлагын ангилал ("Тээвэр") → 400 (эсрэг чиглэл ч хаалттай)', async () => {
  const id = await seed({ type: 'income', description: 'цалин орлоо APX' });
  const r = await patch(`/api/transactions/${id}/category`, { category: 'Тээвэр' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /орлогын/);
});

test('ОРЛОГО + "Орлого" → 200', async () => {
  const id = await seed({ type: 'income', description: 'цалин орлоо APY' });
  const r = await patch(`/api/transactions/${id}/category`, { category: 'Орлого' });
  assert.equal(r.status, 200);
  assert.equal(db.getById(OWNER, id).category, 'Орлого');
});

test('ХОЁУЛАНД зөвшөөрөгдсөн ангилал — орлого ба зарлага хоёуланд 200', async () => {
  for (const [type, cat] of [['income', 'Шилжүүлэг & гэр бүл'], ['expense', 'Бусад']]) {
    const id = await seed({ type, description: `both ${type} APZ` });
    const r = await patch(`/api/transactions/${id}/category`, { category: cat });
    assert.equal(r.status, 200, `${type}/${cat}`);
    assert.equal(db.getById(OWNER, id).category, cat);
  }
});

test('Танихгүй ангилал → 400 (гишүүнчлэлийн шалгалт хэвээр)', async () => {
  const id = await seed({ type: 'expense' });
  const r = await patch(`/api/transactions/${id}/category`, { category: 'Байхгүй ангилал' });
  assert.equal(r.status, 400);
});

test('Backstop нь applyToAll-тай ч ажиллана (override үүсэхгүй)', async () => {
  const id = await seed({ type: 'expense', description: 'APPLYALL BACKSTOP' });
  const before = db.getOverrides(OWNER).length;
  const r = await patch(`/api/transactions/${id}/category`, { category: 'Орлого', applyToAll: true });
  assert.equal(r.status, 400);
  assert.equal(db.getOverrides(OWNER).length, before, 'татгалзсан хүсэлт override үүсгэх ЁСГҮЙ');
});

// ---- POST /api/overrides (хэсэгчилсэн шалгалт) ----

test('POST /overrides + "Орлого" → 400 (зөвхөн орлогын ангилал override-д утгагүй)', async () => {
  const r = await post('/api/overrides', { merchantPattern: 'zzoverridex', category: 'Орлого' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /орлогын ангилал/);
});

test('POST /overrides + зарлагын ангилал → 201 (хэвийн хэрэглээ хөндөгдөөгүй)', async () => {
  const r = await post('/api/overrides', { merchantPattern: 'zzoverridey', category: 'Тээвэр' });
  assert.equal(r.status, 201);
});

test('POST /overrides + хоёуланд тохирох ангилал → 201', async () => {
  const r = await post('/api/overrides', { merchantPattern: 'zzoverridez', category: 'Шилжүүлэг & гэр бүл' });
  assert.equal(r.status, 201);
});

// ---- Регресс: жагсаалтын endpoint ШҮҮГДЭХГҮЙ ----

test('GET /api/categories — БҮХ 10-г буцаасан хэвээр (шүүлт нь picker-ийн ажил)', async () => {
  const r = await fetch(`${baseUrl}/api/categories`, { headers: { 'X-API-Key': API_KEY } });
  const j = await r.json();
  assert.equal(j.categories.length, 10);
  assert.ok(j.categories.includes('Орлого'));
});
