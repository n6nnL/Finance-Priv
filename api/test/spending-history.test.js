// ============================================================
//  test/spending-history.test.js — Өдөр тутмын зарлагын түүх (GET /api/spending-history)
//  Зөвхөн ЗАРЛАГА нийлбэрлэгдэнэ, per-user isolation, UB өдрийн хил, ангилаагүй
//  мөр хасагдахгүй, хоосон муж цэвэр (алдаагүй, 0-үүдээр дүүрсэн) байх.
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../db.js';
import { createApp } from '../app.js';
import { ubYmd, addDaysYmd } from '../balanceHistory.js';

const JWT_SECRET = 'spendhist-test-secret';
let server, baseUrl, db;

before(async () => {
  db = createDb(':memory:');
  const app = createApp({
    db, apiKey: 'unused-spendhist-key', jwtSecret: JWT_SECRET, allowRegister: true, localAuth: true,
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
  return { auth: { Authorization: `Bearer ${accessToken}` }, userId: user.id };
}
function getHistory(auth, from) {
  const qs = from ? `?from=${from}` : '';
  return fetch(`${baseUrl}/api/spending-history${qs}`, { headers: auth });
}

test('JWT-гүй → 401', async () => {
  const r = await fetch(`${baseUrl}/api/spending-history`);
  assert.equal(r.status, 401);
});

test('буруу from параметр → 400', async () => {
  const { auth } = await registerUser('sh-badq@example.com');
  const r = await getHistory(auth, '2026-4-1');
  assert.equal(r.status, 400);
});

test('өдөр тутмын нийлбэр зөв (олон гүйлгээтэй өдөр нийлбэрлэгдэнэ)', async () => {
  const { auth, userId } = await registerUser('sh-totals@example.com');
  let mid = 0;
  const tx = (over) => db.insertTransaction({
    userId, messageId: `<sh${++mid}>`, amount: 1000, currency: 'MNT', type: 'expense', status: 'classified', ...over,
  });
  tx({ date: '2026-06-01', amount: 5000, description: 'Кофе', category: 'Хүнсний зүйл' });
  tx({ date: '2026-06-01', amount: 3000, description: 'Талх', category: 'Хүнсний зүйл' });
  tx({ date: '2026-06-02', amount: 20000, description: 'Такси', category: 'Тээвэр' });

  const r = await getHistory(auth, '2026-06-01');
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.equal(json.status, 'ok');
  const d1 = json.series.find((s) => s.date === '2026-06-01');
  const d2 = json.series.find((s) => s.date === '2026-06-02');
  assert.equal(d1.total, 8000, '5000+3000 нийлбэрлэгдэх ёстой');
  assert.equal(d1.transactions.length, 2);
  assert.equal(d2.total, 20000);
  assert.equal(d2.transactions.length, 1);
});

test('орлого (income) нийлбэрт орохгүй — зөвхөн зарлага', async () => {
  const { auth, userId } = await registerUser('sh-income-excl@example.com');
  let mid = 0;
  db.insertTransaction({ userId, messageId: `<shi${++mid}>`, amount: 500000, currency: 'MNT', date: '2026-06-05', type: 'income', description: 'Цалин', category: 'Орлого', status: 'classified' });
  db.insertTransaction({ userId, messageId: `<shi${++mid}>`, amount: 12000, currency: 'MNT', date: '2026-06-05', type: 'expense', description: 'Хоол', category: 'Хүнсний зүйл', status: 'classified' });

  const r = await getHistory(auth, '2026-06-05');
  const json = await r.json();
  const d = json.series.find((s) => s.date === '2026-06-05');
  assert.equal(d.total, 12000, 'орлогын 500,000 нийлбэрт орохгүй байх ёстой');
  assert.equal(d.transactions.length, 1);
  assert.equal(d.transactions[0].description, 'Хоол');
});

test('ангилаагүй (category NULL) гүйлгээ өдрийн жагсаалтаас ХАСАГДАХГҮЙ', async () => {
  const { auth, userId } = await registerUser('sh-uncat@example.com');
  let mid = 0;
  db.insertTransaction({ userId, messageId: `<shu${++mid}>`, amount: 7000, currency: 'MNT', date: '2026-06-07', type: 'expense', description: '0930 UNKNOWNBOM', category: null, status: 'pending_review' });

  const r = await getHistory(auth, '2026-06-07');
  const json = await r.json();
  const d = json.series.find((s) => s.date === '2026-06-07');
  assert.equal(d.total, 7000);
  assert.equal(d.transactions.length, 1, 'ангилаагүй мөр алдагдах ёсгүй');
  assert.equal(d.transactions[0].category, null);
});

test('UB өдрийн хил: ubYmd-ээр тооцсон "to" өдрийг зөв багтаана', async () => {
  const { auth, userId } = await registerUser('sh-ubday@example.com');
  const today = ubYmd(); // өнөөдрийн УБ огноо (сервер/тестийн OS TZ-ээс үл хамааран)
  let mid = 0;
  db.insertTransaction({ userId, messageId: `<shub${++mid}>`, amount: 4500, currency: 'MNT', date: today, type: 'expense', description: 'Өнөөдрийн зарлага', category: 'Бусад', status: 'classified' });

  const r = await getHistory(auth, addDaysYmd(today, -1));
  const json = await r.json();
  assert.equal(json.to, today, '"to" яг өнөөдрийн УБ огноо байх ёстой');
  const d = json.series.find((s) => s.date === today);
  assert.ok(d, 'өнөөдрийн өдөр цувралд байх ёстой');
  assert.equal(d.total, 4500);
});

test('from өгөгдөөгүй → идэвхтэй циклийн эхлэлээс (currentCycle) авна', async () => {
  const { auth } = await registerUser('sh-defaultfrom@example.com');
  const r = await getHistory(auth); // from-гүй
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(json.from), 'from автоматаар тооцогдсон YYYY-MM-DD байх ёстой');
  assert.ok(json.from <= json.to);
});

test('хоосон муж (гүйлгээгүй хэрэглэгч) → цэвэр 0-үүдээр дүүрсэн цуврал, алдаагүй', async () => {
  const { auth } = await registerUser('sh-empty@example.com');
  const r = await getHistory(auth, '2026-06-01');
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.ok(json.series.length > 0, 'өдрүүд өөрсдөө үргэлж enumerate хийгдэнэ');
  for (const d of json.series) {
    assert.equal(d.total, 0);
    assert.deepEqual(d.transactions, []);
  }
});

test('per-user isolation: A, B хоёрын spending-history бие биенээ огт харахгүй', async () => {
  const a = await registerUser('sh-iso-a@example.com');
  const b = await registerUser('sh-iso-b@example.com');
  let mid = 0;
  db.insertTransaction({ userId: a.userId, messageId: `<shiso${++mid}>`, amount: 11000, currency: 'MNT', date: '2026-06-10', type: 'expense', description: 'A-гийн зарлага', category: 'Бусад', status: 'classified' });
  db.insertTransaction({ userId: b.userId, messageId: `<shiso${++mid}>`, amount: 22000, currency: 'MNT', date: '2026-06-10', type: 'expense', description: 'B-гийн зарлага', category: 'Бусад', status: 'classified' });

  const rA = await (await getHistory(a.auth, '2026-06-10')).json();
  const rB = await (await getHistory(b.auth, '2026-06-10')).json();
  const dA = rA.series.find((s) => s.date === '2026-06-10');
  const dB = rB.series.find((s) => s.date === '2026-06-10');
  assert.equal(dA.total, 11000);
  assert.equal(dB.total, 22000);
  assert.equal(dA.transactions[0].description, 'A-гийн зарлага');
  assert.equal(dB.transactions[0].description, 'B-гийн зарлага');
});

test('READ-ONLY: spending-history дуудсаны дараа ч transactions мөрийн тоо/утга өөрчлөгдөхгүй', async () => {
  const { auth, userId } = await registerUser('sh-readonly@example.com');
  db.insertTransaction({ userId, messageId: '<shro1>', amount: 3000, currency: 'MNT', date: '2026-06-01', type: 'expense', description: 'X', category: 'Бусад', status: 'classified' });
  const before1 = db.listTransactions(userId, {}).total;
  await getHistory(auth, '2026-04-01');
  await getHistory(auth, '2026-04-01');
  const after1 = db.listTransactions(userId, {}).total;
  assert.equal(after1, before1);
});
