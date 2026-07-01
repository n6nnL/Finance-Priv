// ============================================================
//  test/budget-status.test.js — Real-time tracker: циклийн зарлага
//  budgetCycle (хил) + db.getCycleSpend (нийлбэр тэнцэх, income салгах,
//  тодорхойгүй далдлахгүй) + GET /api/budget-status + READ-ONLY баталгаа.
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../db.js';
import { createApp } from '../app.js';
import { hashPasswordSync } from '../auth/passwordHash.js';
import { paydayFor, currentCycle, ymd } from '../budgetCycle.js';

const API_KEY = 'bstatus-test-key';
const JWT_SECRET = 'test-jwt-secret';
let server, baseUrl, db, OWNER;

const addDays = (ymdStr, n) => { const d = new Date(ymdStr + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); };

let mid = 0;
function insertTx(over = {}) {
  return db.insertTransaction({
    userId: OWNER, messageId: `<b${++mid}>`, amount: 1000, currency: 'MNT',
    date: '2026-06-20', type: 'expense', category: 'Тээвэр', status: 'classified', ...over,
  });
}

before(async () => {
  db = createDb(':memory:');
  OWNER = db.createUser('admin', hashPasswordSync('x'), 'admin').id;
  const app = createApp({ db, apiKey: API_KEY, jwtSecret: JWT_SECRET, rateLimit: { windowSeconds: 60, max: 100000 } });
  await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });
});
after(async () => { await new Promise((r) => server.close(r)); db.close(); });

// ---------------- Цикл хил (pure) ----------------
test('paydayFor: Бямба-payday (2026-08-15) → Баасан 14 руу ухарна', () => {
  assert.equal(ymd(paydayFor(2026, 7, 15)), '2026-08-14');
});

test('currentCycle: now >= payday → [payday, дараа сар), end exclusive', () => {
  const c = currentCycle(new Date('2026-06-20T10:00:00'), 15);
  assert.equal(c.start, '2026-06-15');
  assert.equal(c.end, '2026-07-15');
  assert.equal(c.anchorDay, 15);
});

test('currentCycle: now < payday → [өмнөх сар, энэ сарын payday)', () => {
  const c = currentCycle(new Date('2026-06-10T10:00:00'), 15);
  assert.equal(c.start, '2026-05-15');
  assert.equal(c.end, '2026-06-15');
});

// ---------------- getCycleSpend: нийлбэр + хил + income ----------------
test('getCycleSpend: ангилсан + тодорхойгүй = нийт; income салгагдсан; хил [start,end)', () => {
  const start = '2026-06-15';
  const end = '2026-07-15';
  // Циклийн ДОТОР
  insertTx({ date: start, amount: 100000, category: 'Хүнсний зүйл' });      // start inclusive
  insertTx({ date: '2026-06-20', amount: 50000, category: 'Хүнсний зүйл' });
  insertTx({ date: '2026-06-20', amount: 30000, category: 'Тээвэр' });
  insertTx({ date: '2026-06-25', amount: 70000, category: null, status: 'pending_review' }); // тодорхойгүй
  insertTx({ date: '2026-07-01', amount: 3000000, type: 'income', category: 'Орлого' });       // ОРЛОГО
  // Циклийн ГАДНА (хасагдах ёстой)
  insertTx({ date: end, amount: 999, category: 'Тээвэр' });                  // end EXCLUSIVE
  insertTx({ date: addDays(start, -1), amount: 888, category: 'Тээвэр' });   // start-ээс өмнө

  const s = db.getCycleSpend(OWNER, start, end);
  const byCat = Object.fromEntries(s.byCategory.map((r) => [r.category, r.spent]));
  assert.equal(byCat['Хүнсний зүйл'], 150000);
  assert.equal(byCat['Тээвэр'], 30000, 'end дээрх 999 ба start-1 дээрх 888 ОРОХ ёсгүй');
  assert.equal(s.unclassified, 70000, 'тодорхойгүй зарлага далдлагдсан/тарсан');
  assert.equal(s.totalSpend, 250000);
  // INVARIANT: Σ ангилсан + тодорхойгүй = нийт
  const sumCat = s.byCategory.reduce((a, r) => a + r.spent, 0);
  assert.equal(sumCat + s.unclassified, s.totalSpend);
  // income зарлагад ОРООГҮЙ, тусдаа actualIncome
  assert.equal(s.actualIncome, 3000000);
});

// ---------------- READ-ONLY баталгаа ----------------
test('getCycleSpend READ-ONLY: гүйлгээний тоо ба ангилал хэвээр', () => {
  const before = db._raw.prepare('SELECT COUNT(*) c FROM transactions WHERE user_id=?').get(OWNER).c;
  const sampleCatsBefore = db._raw.prepare("SELECT id, category, status FROM transactions WHERE user_id=? ORDER BY id").all(OWNER);
  db.getCycleSpend(OWNER, '2026-06-15', '2026-07-15');
  const after2 = db._raw.prepare('SELECT COUNT(*) c FROM transactions WHERE user_id=?').get(OWNER).c;
  const sampleCatsAfter = db._raw.prepare("SELECT id, category, status FROM transactions WHERE user_id=? ORDER BY id").all(OWNER);
  assert.equal(after2, before, 'tracker гүйлгээний тоог өөрчилсөн!');
  assert.deepEqual(sampleCatsAfter, sampleCatsBefore, 'tracker ангилал/статус өөрчилсөн!');
});

// ---------------- GET /api/budget-status (HTTP shape) ----------------
test('GET /api/budget-status: ok shape, нийлбэр тэнцэнэ, income тусдаа', async () => {
  // settings.salaryAmount → income; paydayDay default 15
  db.saveSettings(OWNER, { ...db.getSettings(OWNER), salaryAmount: 3200000, paydayDay: 15 });
  // Идэвхтэй циклд (одоо) нэг зарлага тавьж, route бодит цикл татаж байгааг батал.
  const cyc = currentCycle(new Date(), 15);
  insertTx({ date: cyc.start, amount: 12345, category: 'Гадуур хооллолт' });

  const r = await fetch(`${baseUrl}/api/budget-status?cycle=current`, { headers: { 'X-API-Key': API_KEY } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.status, 'ok');
  assert.equal(j.cycle.start, cyc.start);
  assert.equal(j.cycle.end, cyc.end);
  assert.equal(j.income, 3200000, 'income нь settings.salaryAmount-аас');
  // INVARIANT HTTP талд ч мөн адил
  const sumCat = j.byCategory.reduce((a, c) => a + c.spent, 0);
  assert.equal(sumCat + j.unclassified, j.totalSpend);
  assert.ok(j.byCategory.some((c) => c.category === 'Гадуур хооллолт' && c.spent === 12345));
});

// ---------------- budget-allocations (%) ----------------
test('GET /budget-allocations: хоосон бол DEFAULT seed (Хадгаламж 17%)', async () => {
  const fresh = db.createUser('alloc1@test.mn', hashPasswordSync('x'), 'user').id;
  const got = db.getBudgetAllocations(fresh);
  assert.equal(got.find((a) => a.category === 'Хадгаламж')?.percent, 17);
  assert.equal(got.find((a) => a.category === 'Хүнсний зүйл')?.percent, 13);
});

test('saveBudgetAllocations: round-trip + ATOMIC replace-all (хуучин категори арилна)', () => {
  const u = db.createUser('alloc2@test.mn', hashPasswordSync('x'), 'user').id;
  db.saveBudgetAllocations(u, [{ category: 'Хадгаламж', percent: 20 }, { category: 'Тээвэр', percent: 6 }]);
  let got = db.getBudgetAllocations(u);
  assert.deepEqual(got, [{ category: 'Хадгаламж', percent: 20 }, { category: 'Тээвэр', percent: 6 }]);
  // replace-all: шинэ жагсаалт → хуучин 'Тээвэр' арилна
  db.saveBudgetAllocations(u, [{ category: 'Хадгаламж', percent: 25 }]);
  got = db.getBudgetAllocations(u);
  assert.deepEqual(got, [{ category: 'Хадгаламж', percent: 25 }], 'replace-all хуучин мөрийг үлдээсэн');
});

test('budget-allocations: нийлбэр 100% давж БОЛНО (#5)', () => {
  const u = db.createUser('alloc3@test.mn', hashPasswordSync('x'), 'user').id;
  const saved = db.saveBudgetAllocations(u, [{ category: 'A', percent: 70 }, { category: 'B', percent: 60 }]);
  assert.equal(saved.reduce((s, a) => s + a.percent, 0), 130);
});

test('budget-allocations per-user isolation', () => {
  const a = db.createUser('alloc4a@test.mn', hashPasswordSync('x'), 'user').id;
  const b = db.createUser('alloc4b@test.mn', hashPasswordSync('x'), 'user').id;
  db.saveBudgetAllocations(a, [{ category: 'Хадгаламж', percent: 99 }]);
  // B хараахан хадгалаагүй → DEFAULT (A-гийнхаар дарагдаагүй)
  assert.equal(db.getBudgetAllocations(b).find((x) => x.category === 'Хадгаламж')?.percent, 17);
  assert.equal(db.getBudgetAllocations(a)[0].percent, 99);
});

test('PUT/GET /api/budget-allocations (HTTP, owner) round-trip', async () => {
  const put = await fetch(`${baseUrl}/api/budget-allocations`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify({ allocations: [{ category: 'Хадгаламж', percent: 15.5 }, { category: 'Хүнсний зүйл', percent: 12 }] }),
  });
  assert.equal(put.status, 200);
  const get = await fetch(`${baseUrl}/api/budget-allocations`, { headers: { 'X-API-Key': API_KEY } });
  const j = await get.json();
  assert.equal(j.status, 'ok');
  assert.deepEqual(j.allocations, [{ category: 'Хадгаламж', percent: 15.5 }, { category: 'Хүнсний зүйл', percent: 12 }]);
});

test('PUT /api/budget-allocations: буруу (percent сөрөг) → 400', async () => {
  const r = await fetch(`${baseUrl}/api/budget-allocations`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify({ allocations: [{ category: 'X', percent: -3 }] }),
  });
  assert.equal(r.status, 400);
});
