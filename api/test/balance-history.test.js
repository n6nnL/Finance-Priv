// ============================================================
//  test/balance-history.test.js — Үлдэгдлийн түүхийн сэргээлт
//  Цэвэр функц (balanceHistory.js) + GET /api/balance-history (READ-ONLY,
//  per-user isolation, UB өдрийн хил, >2 хоногийн цоорхой илрүүлэлт).
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../db.js';
import { createApp } from '../app.js';
import { hashPasswordSync } from '../auth/passwordHash.js';
import { ubYmd, enumerateDays, addDaysYmd, reconstructBalanceSeries, detectGaps } from '../balanceHistory.js';

// ---------------- Цэвэр функц (pure) ----------------

test('ubYmd: 23:50 УБ цагаар (=15:50 UTC) зөв өдөр буцаана (UTC-ийн БИШ)', () => {
  // 2026-07-05T15:50:00Z = 2026-07-05T23:50:00+08:00 (UB) — өдөр хоёулаа 07-05
  assert.equal(ubYmd(new Date('2026-07-05T15:50:00Z')), '2026-07-05');
});

test('ubYmd: УБ шөнө дунд давсны дараа (UTC огноо ХАРАХГҮЙ ахин орой) → дараагийн өдөр', () => {
  // 2026-07-05T16:10:00Z = 2026-07-06T00:10:00+08:00 (UB) — UTC өдөр хараахан 07-05
  // байгаа ч УБ-аар аль хэдийн 07-06 болсон.
  assert.equal(ubYmd(new Date('2026-07-05T16:10:00Z')), '2026-07-06');
});

test('enumerateDays / addDaysYmd: [from,to] хоёуланг оролцуулна, сарын хил давна', () => {
  assert.deepEqual(enumerateDays('2026-04-29', '2026-05-02'),
    ['2026-04-29', '2026-04-30', '2026-05-01', '2026-05-02']);
  assert.equal(addDaysYmd('2026-04-30', 1), '2026-05-01');
  assert.equal(addDaysYmd('2026-05-01', -1), '2026-04-30');
});

test('reconstructBalanceSeries: мэдэгдэж буй синтетик гүйлгээгээр ухраад зөв тооцно', () => {
  // Anchor: 06-05 дээр 100,000. Өдөр бүрийн цэвэр өөрчлөлт:
  // 06-03: -10,000 (зарлага)   06-04: +50,000 (орлого)   06-05: -5,000 (зарлага, anchor өдөр)
  const dailyNetMap = new Map([
    ['2026-06-03', -10000],
    ['2026-06-04', 50000],
    ['2026-06-05', -5000],
  ]);
  const series = reconstructBalanceSeries({
    anchorDate: '2026-06-05', anchorBalance: 100000, dailyNetMap,
    from: '2026-06-02', to: '2026-06-05',
  });
  // 06-05 (anchor): 100,000 (шууд)
  // 06-04: 100,000 - (-5,000) = 105,000  [06-05-ийн өөрчлөлтийг ухраана]
  // 06-03: 105,000 - 50,000 = 55,000     [06-04-ийн өөрчлөлтийг ухраана]
  // 06-02: 55,000 - (-10,000) = 65,000   [06-03-ийн өөрчлөлтийг ухраана]
  assert.deepEqual(series, [
    { date: '2026-06-02', balance: 65000 },
    { date: '2026-06-03', balance: 55000 },
    { date: '2026-06-04', balance: 105000 },
    { date: '2026-06-05', balance: 100000 },
  ]);
});

test('detectGaps: 3+ дараалсан гүйлгээгүй өдрийг тэмдэглэнэ, 2 хоног хүртэлхийг үл тоомсорлоно', () => {
  const from = '2026-05-01', to = '2026-05-10';
  // Гүйлгээтэй өдрүүд: 05-01,02, (05-03,04,05 цоорхой=3 хоног), 05-06,07,
  // (05-08,09 цоорхой=2 хоног, тоологдохгүй), 05-10
  const daysWithTxn = new Set(['2026-05-01', '2026-05-02', '2026-05-06', '2026-05-07', '2026-05-10']);
  const gaps = detectGaps({ from, to, daysWithTxn });
  assert.deepEqual(gaps, [{ start: '2026-05-03', end: '2026-05-05' }]);
});

// ---------------- HTTP integration ----------------

const API_KEY = 'bhist-test-key';
const JWT_SECRET = 'bhist-test-secret';
let server, baseUrl, db;

before(async () => {
  db = createDb(':memory:');
  const app = createApp({
    db, apiKey: API_KEY, jwtSecret: JWT_SECRET, allowRegister: true, localAuth: true,
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
  return fetch(`${baseUrl}/api/balance-history?from=${from}`, { headers: auth });
}

test('anchor байхгүй хэрэглэгч → хоосон цуврал + available:false (тоо зохиохгүй)', async () => {
  const { auth } = await registerUser('bh-none@example.com');
  const r = await getHistory(auth, '2026-04-01');
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.equal(json.status, 'ok');
  assert.equal(json.available, false);
  assert.deepEqual(json.series, []);
  assert.equal(json.anchor, null);
});

test('from параметр буруу/байхгүй → 400', async () => {
  const { auth } = await registerUser('bh-badq@example.com');
  const r1 = await getHistory(auth, '2026-4-1');
  assert.equal(r1.status, 400);
  const r2 = await fetch(`${baseUrl}/api/balance-history`, { headers: auth });
  assert.equal(r2.status, 400);
});

test('anchor + гүйлгээнүүдтэй хэрэглэгч → series-ийн сүүлийн өдрийн утга anchor-той тохирно', async () => {
  const { auth, userId } = await registerUser('bh-ok@example.com');
  let mid = 0;
  const tx = (over) => db.insertTransaction({
    userId, messageId: `<bh${++mid}>`, amount: 1000, currency: 'MNT', type: 'expense', ...over,
  });
  tx({ date: '2026-06-01', amount: 20000, type: 'income' });
  tx({ date: '2026-06-02', amount: 5000, type: 'expense' });
  tx({ date: '2026-06-03', amount: 3000, type: 'expense', balance: 12000 }); // anchor

  const r = await getHistory(auth, '2026-06-01');
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.equal(json.available, true);
  assert.equal(json.anchor.date, '2026-06-03');
  assert.equal(json.anchor.balance, 12000);
  const last = json.series[json.series.length - 1];
  assert.equal(last.date, json.to);
  assert.equal(last.balance, 12000, 'anchor өдрийн (эсвэл хойших) сүүлийн цэгийн утга anchor-тай тохирох ёстой');
  // 06-03 (anchor) цэг өөрөө яг 12000 байх ёстой
  const anchorPoint = json.series.find((p) => p.date === '2026-06-03');
  assert.equal(anchorPoint.balance, 12000);
});

test('per-user isolation: A, B хоёрын balance-history бие биенээ огт харахгүй', async () => {
  const a = await registerUser('bh-iso-a@example.com');
  const b = await registerUser('bh-iso-b@example.com');
  let mid = 0;
  db.insertTransaction({ userId: a.userId, messageId: `<bhiso${++mid}>`, amount: 1000, currency: 'MNT', date: '2026-06-15', type: 'expense', balance: 111000 });
  db.insertTransaction({ userId: b.userId, messageId: `<bhiso${++mid}>`, amount: 1000, currency: 'MNT', date: '2026-06-15', type: 'expense', balance: 222000 });

  const rA = await (await getHistory(a.auth, '2026-06-01')).json();
  const rB = await (await getHistory(b.auth, '2026-06-01')).json();
  assert.equal(rA.anchor.balance, 111000);
  assert.equal(rB.anchor.balance, 222000);
});

test('gap илрүүлэлт: 3+ хоног гүйлгээгүй мөчийг цуврал дотор тэмдэглэнэ (synthetic downtime)', async () => {
  const { auth, userId } = await registerUser('bh-gap@example.com');
  let mid = 0;
  const tx = (over) => db.insertTransaction({
    userId, messageId: `<bhg${++mid}>`, amount: 1000, currency: 'MNT', type: 'expense', ...over,
  });
  // Anchor-г "өнөөдөр" болгож to==anchorDate тул anchor-ийн ДАРАА цоорхой
  // үүсэхгүй (тест ажиллаж буй өдрөөс үл хамааран тогтвортой байх зорилготой).
  const today = ubYmd();
  const d = (n) => addDaysYmd(today, n);
  tx({ date: d(-10) });
  tx({ date: d(-9) });
  // d(-8)..d(-4) (5 хоног) — synthetic Gmail downtime, огт гүйлгээгүй
  tx({ date: d(-3) });
  tx({ date: today, balance: 9000 }); // anchor = өнөөдөр

  const r = await getHistory(auth, d(-10));
  const json = await r.json();
  assert.equal(json.gaps.length, 1);
  assert.deepEqual(json.gaps[0], { start: d(-8), end: d(-4) });
});

test('READ-ONLY: balance-history дуудсаны дараа ч transactions мөрийн тоо/утга өөрчлөгдөхгүй', async () => {
  const { auth, userId } = await registerUser('bh-readonly@example.com');
  db.insertTransaction({ userId, messageId: '<bhro1>', amount: 1000, currency: 'MNT', date: '2026-06-01', type: 'expense', balance: 5000 });
  const before1 = db.listTransactions(userId, {}).total;
  await getHistory(auth, '2026-04-01');
  await getHistory(auth, '2026-04-01');
  const after1 = db.listTransactions(userId, {}).total;
  assert.equal(after1, before1);
});
