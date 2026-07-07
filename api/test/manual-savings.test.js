// ============================================================
//  test/manual-savings.test.js — Гар аргаар удирдсан хөрөнгө (manual ledger)
//  CRUD + balance aggregate (signed sum) + per-user isolation + zod validation.
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../db.js';
import { createApp } from '../app.js';

const JWT_SECRET = 'mansav-test-secret';
let server, baseUrl, db;

before(async () => {
  db = createDb(':memory:');
  const app = createApp({
    db, apiKey: 'unused-mansav-key', jwtSecret: JWT_SECRET, allowRegister: true, localAuth: true,
    rateLimit: { windowSeconds: 60, max: 100000 },
  });
  await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });
});
after(async () => { await new Promise((r) => server.close(r)); db.close(); });

async function registerUser(email) {
  const r = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pass1234' }),
  });
  assert.equal(r.status, 201, `register ${email}`);
  const { accessToken, user } = await r.json();
  return { auth: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, userId: user.id };
}

const list = (auth) => fetch(`${baseUrl}/api/manual-savings`, { headers: auth });
const create = (auth, body) => fetch(`${baseUrl}/api/manual-savings`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
const update = (auth, id, body) => fetch(`${baseUrl}/api/manual-savings/${id}`, { method: 'PUT', headers: auth, body: JSON.stringify(body) });
const del = (auth, id) => fetch(`${baseUrl}/api/manual-savings/${id}`, { method: 'DELETE', headers: auth });

test('JWT-гүй → 401', async () => {
  const r = await fetch(`${baseUrl}/api/manual-savings`);
  assert.equal(r.status, 401);
});

test('шинэ хэрэглэгч: хоосон жагсаалт, balance 0', async () => {
  const { auth } = await registerUser('mansav-empty@example.com');
  const r = await list(auth);
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.equal(json.status, 'ok');
  assert.deepEqual(json.data, []);
  assert.equal(json.balance, 0);
});

test('зөвхөн MNT дүнтэй мөр (EUR/ханшгүй) хадгалагдаж, жагсаалтад зөв гарна', async () => {
  const { auth } = await registerUser('mansav-mnt-only@example.com');
  const r = await create(auth, { date: '2026-06-01', type: 'deposit', amount: 500000 });
  assert.equal(r.status, 201);
  const json = await r.json();
  assert.equal(json.status, 'ok');
  assert.equal(json.entry.amount, 500000);
  assert.equal(json.entry.amountEur, null);
  assert.equal(json.entry.exchangeRate, null);
  assert.equal(json.balance, 500000);

  const l = await (await list(auth)).json();
  assert.equal(l.data.length, 1);
  assert.equal(l.data[0].amount, 500000);
});

test('EUR + ханштай мөр бүрэн хадгалагдана (frontend тооцоолсон дүнг дахин шалгахгүй)', async () => {
  const { auth } = await registerUser('mansav-full@example.com');
  const r = await create(auth, {
    date: '2026-06-02', type: 'deposit', amount: 391000, amountEur: 100, exchangeRate: 3910, note: 'цалингийн үлдэгдэл',
  });
  assert.equal(r.status, 201);
  const { entry } = await r.json();
  assert.equal(entry.amount, 391000);
  assert.equal(entry.amountEur, 100);
  assert.equal(entry.exchangeRate, 3910);
  assert.equal(entry.note, 'цалингийн үлдэгдэл');
});

test('balance aggregate: deposit нэмнэ, withdrawal хасна (тэмдэгтэй нийлбэр)', async () => {
  const { auth } = await registerUser('mansav-agg@example.com');
  await create(auth, { date: '2026-06-01', type: 'deposit', amount: 1000000 });
  await create(auth, { date: '2026-06-05', type: 'withdrawal', amount: 300000 });
  const r2 = await create(auth, { date: '2026-06-10', type: 'deposit', amount: 200000 });
  const json = await r2.json();
  assert.equal(json.balance, 900000); // 1,000,000 - 300,000 + 200,000
  const l = await (await list(auth)).json();
  assert.equal(l.balance, 900000);
  // entry_date DESC эрэмбэ
  assert.deepEqual(l.data.map((r) => r.date), ['2026-06-10', '2026-06-05', '2026-06-01']);
});

test('update: мөр засахад balance шинэчлэгдэнэ', async () => {
  const { auth } = await registerUser('mansav-upd@example.com');
  const r = await create(auth, { date: '2026-06-01', type: 'deposit', amount: 100000 });
  const { entry } = await r.json();
  const r2 = await update(auth, entry.id, { date: '2026-06-01', type: 'deposit', amount: 250000, note: 'засварласан' });
  assert.equal(r2.status, 200);
  const json = await r2.json();
  assert.equal(json.entry.amount, 250000);
  assert.equal(json.entry.note, 'засварласан');
  assert.equal(json.balance, 250000);
});

test('update: төрөл (type) солиход balance тэмдэг зөв өөрчлөгдөнө', async () => {
  const { auth } = await registerUser('mansav-upd-type@example.com');
  const r = await create(auth, { date: '2026-06-01', type: 'deposit', amount: 100000 });
  const { entry } = await r.json();
  const r2 = await update(auth, entry.id, { date: '2026-06-01', type: 'withdrawal', amount: 100000 });
  const json = await r2.json();
  assert.equal(json.balance, -100000);
});

test('update: байхгүй id → 404', async () => {
  const { auth } = await registerUser('mansav-upd-404@example.com');
  const r = await update(auth, 999999, { date: '2026-06-01', type: 'deposit', amount: 1000 });
  assert.equal(r.status, 404);
});

test('delete: мөр устгагдаж balance-аас хасагдана', async () => {
  const { auth } = await registerUser('mansav-del@example.com');
  const r1 = await create(auth, { date: '2026-06-01', type: 'deposit', amount: 100000 });
  const { entry: e1 } = await r1.json();
  await create(auth, { date: '2026-06-02', type: 'deposit', amount: 50000 });

  const rDel = await del(auth, e1.id);
  assert.equal(rDel.status, 200);
  const delJson = await rDel.json();
  assert.equal(delJson.deleted, e1.id);
  assert.equal(delJson.balance, 50000);

  const l = await (await list(auth)).json();
  assert.equal(l.data.length, 1);
  assert.equal(l.data[0].amount, 50000);
});

test('delete: байхгүй id → 404', async () => {
  const { auth } = await registerUser('mansav-del-404@example.com');
  const r = await del(auth, 999999);
  assert.equal(r.status, 404);
});

test('zod validation: сөрөг/0 amount, буруу type, буруу date → 400', async () => {
  const { auth } = await registerUser('mansav-invalid@example.com');
  const badAmount = await create(auth, { date: '2026-06-01', type: 'deposit', amount: -500 });
  assert.equal(badAmount.status, 400);
  const zeroAmount = await create(auth, { date: '2026-06-01', type: 'deposit', amount: 0 });
  assert.equal(zeroAmount.status, 400);
  const badType = await create(auth, { date: '2026-06-01', type: 'transfer', amount: 1000 });
  assert.equal(badType.status, 400);
  const badDate = await create(auth, { date: '2026/06/01', type: 'deposit', amount: 1000 });
  assert.equal(badDate.status, 400);
  const badEur = await create(auth, { date: '2026-06-01', type: 'deposit', amount: 1000, amountEur: -5 });
  assert.equal(badEur.status, 400);
  const badRate = await create(auth, { date: '2026-06-01', type: 'deposit', amount: 1000, exchangeRate: 0 });
  assert.equal(badRate.status, 400);
});

test('per-user isolation: A, B хоёрын жагсаалт/balance бие биенээ огт харахгүй', async () => {
  const a = await registerUser('mansav-iso-a@example.com');
  const b = await registerUser('mansav-iso-b@example.com');
  await create(a.auth, { date: '2026-06-01', type: 'deposit', amount: 111000 });
  await create(b.auth, { date: '2026-06-01', type: 'deposit', amount: 222000 });

  const la = await (await list(a.auth)).json();
  const lb = await (await list(b.auth)).json();
  assert.equal(la.balance, 111000);
  assert.equal(lb.balance, 222000);
  assert.equal(la.data.length, 1);
  assert.equal(lb.data.length, 1);

  // B нь A-ийн мөрийг update/delete хийж чадахгүй (own userId scope-оор олдохгүй)
  const aEntryId = la.data[0].id;
  const rUpd = await update(b.auth, aEntryId, { date: '2026-06-01', type: 'deposit', amount: 999 });
  assert.equal(rUpd.status, 404);
  const rDel = await del(b.auth, aEntryId);
  assert.equal(rDel.status, 404);
});
