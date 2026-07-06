// ============================================================
//  test/balance.test.js — account_balance миграц + getCurrentBalance + /api/balance
//  in-memory DB; JWT-ээр 2 хэрэглэгч → per-user isolation шалгана.
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../db.js';
import { createApp } from '../app.js';

const JWT_SECRET = 'balance-test-secret';
let server, baseUrl, db;

before(async () => {
  db = createDb(':memory:');
  const app = createApp({
    db,
    apiKey: 'unused-balance-key',
    jwtSecret: JWT_SECRET,
    allowRegister: true,
    localAuth: true,
    rateLimit: { windowSeconds: 60, max: 100000 },
  });
  await new Promise((r) => {
    server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); });
  });
});
after(async () => { await new Promise((r) => server.close(r)); db.close(); });

async function registerUser(email) {
  const r = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pass1234' }),
  });
  assert.equal(r.status, 201, `register ${email}`);
  const { accessToken, user } = await r.json();
  return { auth: { Authorization: `Bearer ${accessToken}` }, userId: user.id };
}

function getBalance(auth) {
  return fetch(`${baseUrl}/api/balance`, { headers: auth });
}

// ---- Миграц: additive, idempotent, хуучин мөр NULL хэвээр ----
test('миграц: account_balance багана нэмэгдсэн, DEFAULT NULL, 2 дахин ажиллуулахад idempotent', () => {
  const cols = db._raw.prepare('PRAGMA table_info(transactions)').all();
  assert.ok(cols.some((c) => c.name === 'account_balance'), 'account_balance багана байх ёстой');

  const owner = db.createUser('mig-owner@example.com', 'x', 'admin');
  db.insertTransaction({
    userId: owner.id, messageId: '<mig-pre1>', amount: 500, currency: 'MNT',
    date: '2026-01-01', type: 'expense', description: 'миграцийн өмнөх мөр',
  }); // balance өгөгдөөгүй
  const before1 = db.getByMessageId(owner.id, '<mig-pre1>');
  assert.equal(before1.account_balance, null);

  assert.doesNotThrow(() => db.migrate()); // 2 дахь удаа ажиллуулах — алдаагүй, no-op

  const colsAfter = db._raw.prepare('PRAGMA table_info(transactions)').all()
    .filter((c) => c.name === 'account_balance');
  assert.equal(colsAfter.length, 1, 'багана давхардаагүй байх ёстой');
  const after1 = db.getByMessageId(owner.id, '<mig-pre1>');
  assert.equal(after1.account_balance, null, 'миграцийн өмнөх мөр NULL хэвээр байх ёстой');
});

// ---- getCurrentBalance / GET /api/balance: latest transaction_date (insertion order БИШ) ----
test('GET /api/balance: хамгийн сүүлийн transaction_date-тэй мөрийн balance-г буцаана (insert дараалал үл хамаарна)', async () => {
  const { auth, userId } = await registerUser('bal-order@example.com');

  // Санаатай эрэмбэ бус (listener downtime-ийн дараа гүйцэх нөхцөлийг дуурайна):
  // хамгийн эртний огноог эхлээд, хамгийн сүүлийн огноог дунд, дунд огноог сүүлд insert.
  db.insertTransaction({ userId, messageId: '<bo-1>', amount: 1000, currency: 'MNT', date: '2026-06-01', type: 'expense', balance: 5000 });
  db.insertTransaction({ userId, messageId: '<bo-2>', amount: 1000, currency: 'MNT', date: '2026-06-10', type: 'expense', balance: 9000 });
  db.insertTransaction({ userId, messageId: '<bo-3>', amount: 1000, currency: 'MNT', date: '2026-06-05', type: 'expense', balance: 7000 });

  const r = await getBalance(auth);
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.equal(json.status, 'ok');
  assert.equal(json.balance, 9000, 'txn_date 2026-06-10 (хамгийн сүүлийн) мөрийн balance байх ёстой — MAX(id) БИШ');
});

test('GET /api/balance: account_balance NULL мөрүүдийг алгасна', async () => {
  const { auth, userId } = await registerUser('bal-null@example.com');
  db.insertTransaction({ userId, messageId: '<bn-1>', amount: 1000, currency: 'MNT', date: '2026-06-01', type: 'expense', balance: 4000 });
  // Хамгийн сүүлийн огноотой ч balance parse амжилтгүй байсан (NULL) мөр
  db.insertTransaction({ userId, messageId: '<bn-2>', amount: 1000, currency: 'MNT', date: '2026-06-20', type: 'expense' });

  const r = await getBalance(auth);
  const json = await r.json();
  assert.equal(json.balance, 4000, 'NULL balance-тай хамгийн сүүлийн мөрийг алгасаж, дараагийн non-null-г буцаана');
});

test('GET /api/balance: гүйлгээгүй/бүгд NULL хэрэглэгчид balance: null', async () => {
  const { auth } = await registerUser('bal-empty@example.com');
  const r = await getBalance(auth);
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.equal(json.balance, null);
});

// ---- Isolation: хэрэглэгч A-ийн хариу хэзээ ч B-ийн өгөгдлийг агуулахгүй ----
test('per-user isolation: GET /api/balance нь зөвхөн өөрийн хэрэглэгчийн үлдэгдлийг буцаана', async () => {
  const a = await registerUser('bal-iso-a@example.com');
  const b = await registerUser('bal-iso-b@example.com');

  db.insertTransaction({ userId: a.userId, messageId: '<iso-a1>', amount: 1000, currency: 'MNT', date: '2026-06-15', type: 'expense', balance: 111000 });
  db.insertTransaction({ userId: b.userId, messageId: '<iso-b1>', amount: 1000, currency: 'MNT', date: '2026-06-16', type: 'expense', balance: 222000 });

  const rA = await getBalance(a.auth);
  const rB = await getBalance(b.auth);
  const jsonA = await rA.json();
  const jsonB = await rB.json();

  assert.equal(jsonA.balance, 111000);
  assert.equal(jsonB.balance, 222000);
  assert.notEqual(jsonA.balance, jsonB.balance);
});

test('JWT-гүй → 401 (auth шаардлагатай)', async () => {
  const r = await fetch(`${baseUrl}/api/balance`);
  assert.equal(r.status, 401);
});
