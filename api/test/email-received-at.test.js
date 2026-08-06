// ============================================================
//  test/email-received-at.test.js — 017: мэдэгдэл ирсэн цаг (email `Date:` header)
//
//  Шалгах invariant-ууд:
//   • Миграц additive + идемпотент; хуучин мөр NULL ХЭВЭЭР (backfill байхгүй)
//   • txn_date нь ОГНОО (YYYY-MM-DD) хэвээрээ — email_received_at түүнд хүрэхгүй
//   • listener push (emailReceivedAt) → GET /transactions болон /:id-д буцна
//   • emailReceivedAt-гүй push (хуучин listener) татгалзагдахгүй → NULL
//   • Two-user isolation
//  in-memory DB; JWT (хэрэглэгч) + X-API-Key (machine listener) хоёуланг ашиглана.
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../db.js';
import { createApp } from '../app.js';

const API_KEY = 'era-test-key';
const JWT_SECRET = 'era-test-secret';
let server, baseUrl, db;

before(async () => {
  db = createDb(':memory:');
  const app = createApp({
    db, apiKey: API_KEY, jwtSecret: JWT_SECRET, allowRegister: true, localAuth: true,
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

/** Machine (listener) push — X-API-Key + userId ЗААВАЛ. */
function push(body) {
  return fetch(`${baseUrl}/api/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify(body),
  });
}

// ---- Миграц ----------------------------------------------------------------
test('миграц 017: email_received_at багана нэмэгдсэн, DEFAULT NULL, идемпотент', () => {
  const cols = db._raw.prepare('PRAGMA table_info(transactions)').all();
  assert.ok(cols.some((c) => c.name === 'email_received_at'), 'email_received_at багана байх ёстой');

  const owner = db.createUser('era-mig@example.com', 'x', 'admin');
  // Миграцийн ӨМНӨХ маягийн мөр — цагийн талбар огт өгөөгүй
  db.insertTransaction({
    userId: owner.id, messageId: '<era-pre1>', amount: 500, currency: 'MNT',
    date: '2026-01-01', type: 'expense', description: 'цаггүй хуучин мөр',
  });
  assert.equal(db.getByMessageId(owner.id, '<era-pre1>').email_received_at, null);

  assert.doesNotThrow(() => db.migrate()); // 2 дахь удаа — no-op

  const after = db._raw.prepare('PRAGMA table_info(transactions)').all()
    .filter((c) => c.name === 'email_received_at');
  assert.equal(after.length, 1, 'багана давхардаагүй байх ёстой');
  assert.equal(
    db.getByMessageId(owner.id, '<era-pre1>').email_received_at, null,
    'миграцийн өмнөх мөр NULL хэвээр (backfill ХИЙХГҮЙ)'
  );
});

// ---- Insert + GET ----------------------------------------------------------
test('insertTransaction: emailReceivedAt хадгалагдана; txn_date ОГНОО хэвээр', () => {
  const u = db.createUser('era-ins@example.com', 'x');
  db.insertTransaction({
    userId: u.id, messageId: '<era-ins1>', amount: 37000, currency: 'MNT',
    date: '2026-08-05', type: 'expense', emailReceivedAt: '2026-08-05T06:32:00.000Z',
  });
  const row = db.getByMessageId(u.id, '<era-ins1>');
  assert.equal(row.email_received_at, '2026-08-05T06:32:00.000Z');
  assert.equal(row.txn_date, '2026-08-05', 'txn_date нь огноо хэвээр (цаг наалдахгүй)');
});

test('POST (listener push) → GET /transactions болон /:id-д email_received_at буцна', async () => {
  const { auth, userId } = await registerUser('era-push@example.com');
  const res = await push({
    userId,
    messageId: '<era-push1@golomt>',
    amount: 12500,
    currency: 'MNT',
    date: '2026-08-05',
    description: '0930 STOREBOM',
    type: 'expense',
    emailReceivedAt: '2026-08-05T06:32:00.000Z',
  });
  assert.equal(res.status, 201);
  const { id } = await res.json();

  const list = await (await fetch(`${baseUrl}/api/transactions`, { headers: auth })).json();
  const row = list.data.find((t) => t.id === id);
  assert.ok(row, 'жагсаалтад байх ёстой');
  assert.equal(row.email_received_at, '2026-08-05T06:32:00.000Z');
  assert.equal(row.txn_date, '2026-08-05');

  const one = await (await fetch(`${baseUrl}/api/transactions/${id}`, { headers: auth })).json();
  assert.equal(one.data.email_received_at, '2026-08-05T06:32:00.000Z');
});

test('emailReceivedAt-гүй push (хуучин listener) → 201, утга NULL', async () => {
  const { auth, userId } = await registerUser('era-old@example.com');
  const res = await push({
    userId, messageId: '<era-old1@golomt>', amount: 900, currency: 'MNT',
    date: '2026-08-04', type: 'expense', description: 'цаггүй',
  });
  assert.equal(res.status, 201, 'хуучин listener payload ТАТГАЛЗАГДАХГҮЙ');
  const { id } = await res.json();
  const one = await (await fetch(`${baseUrl}/api/transactions/${id}`, { headers: auth })).json();
  assert.equal(one.data.email_received_at, null);
});

test('emailReceivedAt: null шууд илгээх → 201, NULL; ISO биш string → 400', async () => {
  const { userId } = await registerUser('era-null@example.com');
  const ok = await push({
    userId, messageId: '<era-null1@golomt>', amount: 100, currency: 'MNT',
    date: '2026-08-04', type: 'expense', emailReceivedAt: null,
  });
  assert.equal(ok.status, 201);

  const bad = await push({
    userId, messageId: '<era-bad1@golomt>', amount: 100, currency: 'MNT',
    date: '2026-08-04', type: 'expense', emailReceivedAt: '2026-08-05 14:32',
  });
  assert.equal(bad.status, 400, 'ISO 8601 биш утга validation-д унана');
});

// ---- Per-user isolation ----------------------------------------------------
test('two-user isolation: нөгөө хэрэглэгчийн цагтай мөр харагдахгүй', async () => {
  const a = await registerUser('era-iso-a@example.com');
  const b = await registerUser('era-iso-b@example.com');

  const res = await push({
    userId: a.userId, messageId: '<era-iso-a1@golomt>', amount: 4000, currency: 'MNT',
    date: '2026-08-05', type: 'expense', emailReceivedAt: '2026-08-05T01:00:00.000Z',
  });
  assert.equal(res.status, 201);
  const { id } = await res.json();

  const bList = await (await fetch(`${baseUrl}/api/transactions`, { headers: b.auth })).json();
  assert.equal(bList.data.some((t) => t.id === id), false, 'B хэрэглэгчид харагдах ёсгүй');

  const bOne = await fetch(`${baseUrl}/api/transactions/${id}`, { headers: b.auth });
  assert.equal(bOne.status, 404);

  const aOne = await (await fetch(`${baseUrl}/api/transactions/${id}`, { headers: a.auth })).json();
  assert.equal(aOne.data.email_received_at, '2026-08-05T01:00:00.000Z');
});
