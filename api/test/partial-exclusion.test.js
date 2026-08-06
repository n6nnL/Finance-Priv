// ============================================================
//  test/partial-exclusion.test.js — ХЭСЭГЧИЛСЭН хасалт (migration 016)
//
//  ★ ЗААГ 1 (ХАМГИЙН ЧУХАЛ): excluded_amount нь ЗӨВХӨН төсөв/ангилал/шинжилгээнд
//    нөлөөлнө. /balance болон balance-history БҮТЭН amount-аар ажилласаар байна —
//    доорх тестүүд өмнөх/дараах хариуг ЯГ ТАГ (deepEqual) харьцуулж түгжинэ.
//  ★ ЗААГ 2: БҮРЭН хасагдсан мөр (excluded_amount = amount) нь 015-ын boolean
//    туг шиг ЯГ ижил үр дүн өгнө — 4 query-д бүгдэд нь (backward-compat).
//  ★ ЗААГ 3: Нэг гүйлгээнд олон бичлэг холбогдоход excluded_amount нь тэдгээрийн
//    НИЙЛБЭР; нэг нь салахад ЗӨВХӨН түүний хувь хэмжээ хасагдана.
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb } from '../db.js';
import { createApp } from '../app.js';
import { hashPasswordSync } from '../auth/passwordHash.js';
import { createJwt } from '../auth/jwt.js';

const API_KEY = 'partial-test-key';
const JWT_SECRET = 'partial-test-jwt';
let server, baseUrl, db, jwt;

before(async () => {
  db = createDb(':memory:');
  db.createUser('owner@t.st', hashPasswordSync('pw'), 'admin'); // owner = id 1
  const app = createApp({ db, apiKey: API_KEY, jwtSecret: JWT_SECRET, rateLimit: { windowSeconds: 60, max: 100000 } });
  await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });
  jwt = createJwt({ secret: JWT_SECRET, accessTtl: '1h' });
});
after(async () => { await new Promise((r) => server.close(r)); db.close(); });

const bearer = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
const call = (path, method = 'GET', body, headers) =>
  fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
const j = async (r) => r.json();

let mid = 0;
/** Шинэ хэрэглэгч + түүний токен (тест бүр тусгаарлагдсан). */
function newUser(tag) {
  const id = db.createUser(`${tag}@t.st`, hashPasswordSync('pw'), 'user').id;
  return { id, tk: jwt.signAccess(db.getUserById(id)) };
}
function seedTxn(userId, over = {}) {
  const { id } = db.insertTransaction({
    userId, messageId: `<p${++mid}>`, amount: 1000, currency: 'MNT',
    date: '2026-06-10', type: 'expense', description: 'X',
    category: 'Гадуур хооллолт', status: 'classified', balance: null, ...over,
  });
  return id;
}

// ===================== 1) МИГРАЦ 016 =====================

test('016: excluded_amount DEFAULT 0 + exclusion_share багана нэмэгдсэн', () => {
  const id = seedTxn(1);
  assert.equal(db.getById(1, id).excluded_amount, 0);
  const cols = db._raw.prepare('PRAGMA table_info(debt_ledger)').all().map((c) => c.name);
  assert.ok(cols.includes('exclusion_share'));
});

test('016: файл DB — миграц идемпотент, backfill зөв (хуучин туг → бүтэн дүн)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'partial-excl-'));
  const p = join(dir, 'x.sqlite');
  try {
    // 1) 015-ын төлөв дуурайх: багана хасч, зөвхөн boolean тугтай мөрүүд
    const old = createDb(p);
    const u = old.createUser('legacy@t.st', hashPasswordSync('pw'), 'admin').id;
    const excluded = old.insertTransaction({ userId: u, messageId: '<L1>', amount: 600000,
      date: '2026-01-01', type: 'expense', description: 'билет', category: 'Тээвэр' }).id;
    const normal = old.insertTransaction({ userId: u, messageId: '<L2>', amount: 5000,
      date: '2026-01-02', type: 'expense', description: 'кофе', category: 'Гадуур хооллолт' }).id;
    // 016-г "болоогүй" болгож буцаана: багана устгаад зөвхөн тугийг үлдээнэ
    old._raw.exec('DROP TRIGGER IF EXISTS trg_txn_excluded_amount_ins');
    old._raw.exec('DROP TRIGGER IF EXISTS trg_txn_excluded_amount_upd');
    old._raw.exec('ALTER TABLE transactions DROP COLUMN excluded_amount');
    old._raw.exec('ALTER TABLE debt_ledger DROP COLUMN exclusion_share');
    old._raw.prepare('UPDATE transactions SET excluded_from_budget=1 WHERE id=?').run(excluded);
    old.close();

    // 2) Шинэ deploy — 016 ажиллана
    const neu = createDb(p);
    assert.equal(neu.getById(u, excluded).excluded_amount, 600000, 'бүрэн хасагдсан мөр → excluded_amount = amount');
    assert.equal(neu.getById(u, excluded).excluded_from_budget, 1);
    assert.equal(neu.getById(u, normal).excluded_amount, 0, 'бусад мөр → 0');
    neu.close();

    // 3) Дахин нээх = миграц дахин ажиллах — алдаагүй, өгөгдөл ХЭВЭЭР
    const again = createDb(p);
    assert.equal(again.getById(u, excluded).excluded_amount, 600000);
    assert.equal(again.getById(u, normal).excluded_amount, 0);
    assert.equal(again.listTransactions(u).total, 2);
    again.close();
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ===================== 2) BACKWARD-COMPAT: бүрэн хасалт =====================

test('★ Backward-compat: excluded_amount = amount нь 4 query-д БҮГДЭД нь тэгээр тоологдоно', () => {
  const { id: u } = newUser('bc');
  seedTxn(u, { amount: 5000, category: 'Тээвэр', date: '2026-06-01' });
  const full = seedTxn(u, { amount: 600000, category: 'Тээвэр', date: '2026-06-05' });
  const income = seedTxn(u, { amount: 600000, type: 'income', category: 'Орлого', date: '2026-06-06' });

  // Бүрэн хасах (015-ын boolean замаар — доторх дүнгийн замд буусан)
  db.setTransactionExclusion(u, full, true);
  db.setTransactionExclusion(u, income, true);
  assert.equal(db.getById(u, full).excluded_amount, 600000);
  assert.equal(db.getById(u, full).excluded_from_budget, 1, 'туг ХЭВЭЭР maintain хийгдэнэ');

  // (1) getSummary — нийт + byCategory + byPlace
  const s = db.getSummary(u, {});
  assert.equal(s.totalExpense, 5000);
  assert.equal(s.totalIncome, 0);
  assert.equal(s.count, 1, 'бүрэн хасагдсан мөр 015-ын адил тоологдохгүй');
  assert.equal(s.byCategory.length, 1);
  assert.equal(s.byCategory[0].total, 5000);
  // (2) getMonthly
  assert.equal(db.getMonthly(u, { months: 12 }).find((m) => m.month === '2026-06').expense, 5000);
  // (3) getByCategory
  const bc = db.getByCategory(u, '2026-06');
  assert.equal(bc.totalExpense, 5000);
  assert.equal(bc.totalIncome, 0);
  assert.equal(bc.byCategory.find((c) => c.category === 'Тээвэр').total, 5000);
  assert.equal(bc.byCategory.find((c) => c.category === 'Тээвэр').count, 1);
  // (4) getCycleSpend
  const cs = db.getCycleSpend(u, '2026-06-01', '2026-07-01');
  assert.equal(cs.totalSpend, 5000);
  assert.equal(cs.actualIncome, 0);
  assert.equal(cs.byCategory.find((c) => c.category === 'Тээвэр').spent, 5000);
});

// ===================== 3) ХЭСЭГЧИЛСЭН ХАСАЛТ =====================

test('★ Хэсэгчилсэн: 90k-аас 55k хасахад ангилал 55k-аар буурч, ҮЛДЭГДЭЛ ХЭВЭЭР', async () => {
  const { id: u, tk } = newUser('partial');
  seedTxn(u, { amount: 10000, category: 'Гадуур хооллолт', date: '2026-08-01' });
  const meal = seedTxn(u, { amount: 90000, category: 'Гадуур хооллолт', date: '2026-08-02', balance: 1500000 });

  const balBefore = await j(await call('/api/balance', 'GET', null, bearer(tk)));
  const histBefore = await j(await call('/api/balance-history?from=2026-08-01&to=2026-08-02', 'GET', null, bearer(tk)));
  const catBefore = await j(await call('/api/analytics/by-category?month=2026-08', 'GET', null, bearer(tk)));
  assert.equal(catBefore.byCategory.find((c) => c.category === 'Гадуур хооллолт').total, 100000);

  const r = await j(await call(`/api/transactions/${meal}/exclusion`, 'PATCH', { excludedAmount: 55000 }, bearer(tk)));
  assert.equal(r.excludedAmount, 55000);
  assert.equal(r.netAmount, 35000);
  assert.equal(r.excluded, false, 'хэсэгчилсэн тул БҮРЭН хасагдсан гэж тэмдэглэгдэхгүй');
  assert.equal(r.manuallyEdited, true, 'invariant: хасалттай мөр гар засвартай гэж тэмдэглэгдэнэ');

  // Төсөв/ангилал: 55k-аар буурсан (ӨӨРИЙН 35k ХЭВЭЭР)
  const catAfter = await j(await call('/api/analytics/by-category?month=2026-08', 'GET', null, bearer(tk)));
  assert.equal(catAfter.byCategory.find((c) => c.category === 'Гадуур хооллолт').total, 45000);
  assert.equal(catAfter.byCategory.find((c) => c.category === 'Гадуур хооллолт').count, 2, 'мөр ХЭВЭЭР тоологдоно');
  assert.equal(catAfter.totalExpense, 45000);
  assert.equal((await j(await call('/api/summary', 'GET', null, bearer(tk)))).totalExpense, 45000);
  assert.equal((await j(await call('/api/monthly', 'GET', null, bearer(tk)))).data.find((m) => m.month === '2026-08').expense, 45000);

  // ★ ҮЛДЭГДЭЛ ба balance-history — ЯГ ТАГ хэвээр
  const balAfter = await j(await call('/api/balance', 'GET', null, bearer(tk)));
  const histAfter = await j(await call('/api/balance-history?from=2026-08-01&to=2026-08-02', 'GET', null, bearer(tk)));
  assert.deepEqual(balAfter, balBefore, '/balance ХЭЗЭЭ Ч хөндөгдөхгүй');
  assert.deepEqual(histAfter, histBefore, 'balance-history ХЭЗЭЭ Ч хөндөгдөхгүй');

  // Жагсаалтад БҮТЭН дүнгээрээ харагдана (net хийхгүй)
  const list = await j(await call('/api/transactions', 'GET', null, bearer(tk)));
  const row = list.data.find((t) => t.id === meal);
  assert.equal(row.amount, 90000, 'жагсаалтад бүтэн дүн');
  assert.equal(row.excluded_amount, 55000, 'UI тэмдэглэгээнд хасагдсан хэсэг дамжина');
});

test('Хэсэгчилсэн хасалт getCycleSpend-д ч цэвэр дүнгээр орно', () => {
  const { id: u } = newUser('cycle-partial');
  const meal = seedTxn(u, { amount: 90000, category: 'Гадуур хооллолт', date: '2026-09-10' });
  assert.equal(db.getCycleSpend(u, '2026-09-01', '2026-10-01').totalSpend, 90000);
  db.setTransactionExcludedAmount(u, meal, 55000);
  const cs = db.getCycleSpend(u, '2026-09-01', '2026-10-01');
  assert.equal(cs.byCategory.find((c) => c.category === 'Гадуур хооллолт').spent, 35000);
  assert.equal(cs.totalSpend, 35000);
});

// ===================== 4) ОЛОН БИЧЛЭГ — нийлбэр ба салгалт =====================

test('★ Олон бичлэг: 30k + 25k = 55k; 25k-г салгахад 30k ҮЛДЭНЭ (0 ч биш, 55k ч биш)', async () => {
  const { id: u, tk } = newUser('multi');
  const meal = seedTxn(u, { amount: 90000, category: 'Гадуур хооллолт', date: '2026-10-02' });

  const bold = await j(await call('/api/debt-ledger', 'POST', {
    counterparty: 'Болд', direction: 'i_lent', amount: 30000, currency: 'MNT',
    entryDate: '2026-10-02', linkedTransactionId: meal,
  }, bearer(tk)));
  assert.equal(db.getById(u, meal).excluded_amount, 30000);

  const gana = await j(await call('/api/debt-ledger', 'POST', {
    counterparty: 'Гана', direction: 'i_lent', amount: 25000, currency: 'MNT',
    entryDate: '2026-10-02', linkedTransactionId: meal,
  }, bearer(tk)));
  assert.equal(db.getById(u, meal).excluded_amount, 55000, 'хоёр бичлэгийн НИЙЛБЭР');
  assert.equal(db.getById(u, meal).excluded_from_budget, 0, '90k-аас 55k — бүрэн БИШ');

  // Гана-гийн холбоосыг салгах → зөвхөн 25k чөлөөлөгдөнө
  await call(`/api/debt-ledger/${gana.entry.id}`, 'PATCH', { linkedTransactionId: null }, bearer(tk));
  assert.equal(db.getById(u, meal).excluded_amount, 30000, 'Болдын хувь хэмжээ ҮЛДЭХ ЁСТОЙ');

  // Болдыг устгах → 0
  await call(`/api/debt-ledger/${bold.entry.id}`, 'DELETE', null, bearer(tk));
  assert.equal(db.getById(u, meal).excluded_amount, 0);
});

test('exclusionShare: бичлэгийн amount-аас ӨӨР хувь хэмжээ (жигд бус хуваалт)', async () => {
  const { id: u, tk } = newUser('share');
  const meal = seedTxn(u, { amount: 90000, category: 'Гадуур хооллолт', date: '2026-10-05' });
  // Өр нь 30k ч гэсэн тухайн гүйлгээнээс 40k-г эзэлнэ (үйлчилгээний хөлс тэгш бус)
  const e = await j(await call('/api/debt-ledger', 'POST', {
    counterparty: 'Сараа', direction: 'i_lent', amount: 30000, entryDate: '2026-10-05',
    linkedTransactionId: meal, exclusionShare: 40000,
  }, bearer(tk)));
  assert.equal(e.entry.exclusionShare, 40000);
  assert.equal(db.getById(u, meal).excluded_amount, 40000);
  assert.equal(db.getDebtBalances(u).find((b) => b.counterparty === 'Сараа').net, 30000, 'өрийн үлдэгдэл нь 30k хэвээр');

  // PATCH-аар хувь хэмжээ засах → хасалт дагаж өөрчлөгдөнө
  await call(`/api/debt-ledger/${e.entry.id}`, 'PATCH', { exclusionShare: 20000 }, bearer(tk));
  assert.equal(db.getById(u, meal).excluded_amount, 20000);
  // 0 → холбоос үлдэнэ ч хасалт байхгүй
  await call(`/api/debt-ledger/${e.entry.id}`, 'PATCH', { exclusionShare: 0 }, bearer(tk));
  assert.equal(db.getById(u, meal).excluded_amount, 0);
  assert.equal(db.getDebtEntry(u, e.entry.id).linkedTransactionId, meal, 'холбоос ХЭВЭЭР');
});

// ===================== 5) ХЭТРҮҮЛЭХ — 400, сөрөг дүн ХЭЗЭЭ Ч гарахгүй =====================

test('★ Хэтрүүлэх: excludedAmount > amount → 400; ангиллын дүн сөрөг болохгүй', async () => {
  const { id: u, tk } = newUser('over');
  const meal = seedTxn(u, { amount: 90000, category: 'Гадуур хооллолт', date: '2026-11-02' });

  const r = await call(`/api/transactions/${meal}/exclusion`, 'PATCH', { excludedAmount: 90001 }, bearer(tk));
  assert.equal(r.status, 400);
  assert.equal(db.getById(u, meal).excluded_amount, 0, 'татгалзсан бичилт хадгалагдахгүй');
  assert.equal((await call(`/api/transactions/${meal}/exclusion`, 'PATCH', { excludedAmount: -1 }, bearer(tk))).status, 400);

  // Өрийн бичлэгээр хэтрүүлэх (30k + 70k > 90k) → 400, эхнийх нь ХЭВЭЭР
  await call('/api/debt-ledger', 'POST', {
    counterparty: 'А', direction: 'i_lent', amount: 30000, entryDate: '2026-11-02', linkedTransactionId: meal,
  }, bearer(tk));
  const bad = await call('/api/debt-ledger', 'POST', {
    counterparty: 'Б', direction: 'i_lent', amount: 70000, entryDate: '2026-11-02', linkedTransactionId: meal,
  }, bearer(tk));
  assert.equal(bad.status, 400);
  assert.equal((await j(bad)).code, 'OVER_EXCLUSION');
  assert.equal(db.getById(u, meal).excluded_amount, 30000, 'rollback — эхний бичлэгийн хувь хэмжээ хэвээр');
  assert.equal(db.listDebtEntries(u).length, 1, 'татгалзсан бичлэг үүсээгүй (нэг транзакц)');

  // Ангиллын дүн хэзээ ч сөрөг биш
  const bc = db.getByCategory(u, '2026-11');
  assert.equal(bc.byCategory.find((c) => c.category === 'Гадуур хооллолт').total, 60000);
  assert.ok(bc.byCategory.every((c) => c.total >= 0));
  assert.ok(bc.totalExpense >= 0);
});

test('★ Хамгаалалт: excluded_amount > amount-ыг DB trigger ч зөвшөөрөхгүй', () => {
  const { id: u } = newUser('trigger');
  const t = seedTxn(u, { amount: 1000 });
  assert.throws(
    () => db._raw.prepare('UPDATE transactions SET excluded_amount=? WHERE id=?').run(2000, t),
    /excluded_amount/,
  );
  assert.throws(
    () => db._raw.prepare('UPDATE transactions SET excluded_amount=? WHERE id=?').run(-5, t),
    /CHECK/,
  );
  assert.equal(db.getById(u, t).excluded_amount, 0);
});

// ===================== 6) ВАЛЮТ =====================

test('★ Валют зөрөх холбоосыг татгалзана (EUR бичлэг ↔ MNT гүйлгээ) → 400', async () => {
  const { id: u, tk } = newUser('fx');
  const mnt = seedTxn(u, { amount: 90000, currency: 'MNT', date: '2026-12-01' });
  const r = await call('/api/debt-ledger', 'POST', {
    counterparty: 'Ана', direction: 'i_lent', amount: 20, currency: 'EUR',
    entryDate: '2026-12-01', linkedTransactionId: mnt,
  }, bearer(tk));
  assert.equal(r.status, 400);
  assert.equal((await j(r)).code, 'CURRENCY_MISMATCH');
  assert.equal(db.getById(u, mnt).excluded_amount, 0, 'гүйлгээ хөндөгдөөгүй');
  assert.equal(db.listDebtEntries(u).length, 0, 'бичлэг ч үүсээгүй (rollback)');

  // Валют таарвал ажиллана
  const eurTxn = seedTxn(u, { amount: 50, currency: 'EUR', date: '2026-12-02' });
  const ok = await call('/api/debt-ledger', 'POST', {
    counterparty: 'Ана', direction: 'i_lent', amount: 20, currency: 'EUR',
    entryDate: '2026-12-02', linkedTransactionId: eurTxn,
  }, bearer(tk));
  assert.equal(ok.status, 201);
  assert.equal(db.getById(u, eurTxn).excluded_amount, 20);

  // PATCH-аар валют салгахыг ч татгалзана
  const id = (await j(ok)).entry.id;
  const patch = await call(`/api/debt-ledger/${id}`, 'PATCH', { currency: 'MNT' }, bearer(tk));
  assert.equal(patch.status, 400);
  assert.equal(db.getDebtEntry(u, id).currency, 'EUR', 'rollback');
  assert.equal(db.getById(u, eurTxn).excluded_amount, 20);
});

// ===================== 7) ТУСГААРЛАЛТ =====================

test('★ Isolation: бусдын гүйлгээний excluded_amount хөндөгдөхгүй', async () => {
  const a = newUser('iso-a');
  const b = newUser('iso-b');
  const txnA = seedTxn(a.id, { amount: 90000, date: '2026-06-15' });

  // B нь A-гийн гүйлгээ рүү холбож чадахгүй
  assert.equal((await call('/api/debt-ledger', 'POST', {
    counterparty: 'Хакер', direction: 'i_lent', amount: 10000, entryDate: '2026-06-15', linkedTransactionId: txnA,
  }, bearer(b.tk))).status, 400);
  // B нь A-гийн гүйлгээний хасалтыг өөрчилж ч чадахгүй
  assert.equal((await call(`/api/transactions/${txnA}/exclusion`, 'PATCH', { excludedAmount: 5000 }, bearer(b.tk))).status, 404);
  assert.equal(db.getById(a.id, txnA).excluded_amount, 0);

  // A өөрийнхөө дээр хасалт хийхэд B-гийн шинжилгээ хөндөгдөхгүй
  const txnB = seedTxn(b.id, { amount: 90000, date: '2026-06-15' });
  await call(`/api/transactions/${txnA}/exclusion`, 'PATCH', { excludedAmount: 55000 }, bearer(a.tk));
  assert.equal(db.getById(b.id, txnB).excluded_amount, 0);
  assert.equal(db.getByCategory(b.id, '2026-06').totalExpense, 90000);
  assert.equal(db.getByCategory(a.id, '2026-06').totalExpense, 35000);
});

// ===================== 8) БОДИТ ХУВААСАН ХООЛНЫ ХУВИЛБАР =====================

test('★★ Хуваасан хоол: 90k → Болд 30k + Гана 25k → цэвэр 35k; Гана салахад 60k', async () => {
  const { id: u, tk } = newUser('meal');
  const meal = seedTxn(u, { amount: 90000, category: 'Гадуур хооллолт', date: '2027-01-15', balance: 2000000 });

  const balBefore = await j(await call('/api/balance', 'GET', null, bearer(tk)));
  const catOf = async () => {
    const r = await j(await call('/api/analytics/by-category?month=2027-01', 'GET', null, bearer(tk)));
    return r.byCategory.find((c) => c.category === 'Гадуур хооллолт')?.total ?? 0;
  };
  assert.equal(await catOf(), 90000);

  await call('/api/debt-ledger', 'POST', {
    counterparty: 'Болд', direction: 'i_lent', amount: 30000, entryDate: '2027-01-15', linkedTransactionId: meal,
  }, bearer(tk));
  const gana = await j(await call('/api/debt-ledger', 'POST', {
    counterparty: 'Гана', direction: 'i_lent', amount: 25000, entryDate: '2027-01-15', linkedTransactionId: meal,
  }, bearer(tk)));

  assert.equal(await catOf(), 35000, 'ӨӨРИЙН бодит зарлага 35k ХЭВЭЭР үлдэнэ');
  assert.deepEqual(await j(await call('/api/balance', 'GET', null, bearer(tk))), balBefore, 'үлдэгдэл хөндөгдөхгүй');

  // Гана бэлнээр өгсөн — өрийг устгав
  await call(`/api/debt-ledger/${gana.entry.id}`, 'DELETE', null, bearer(tk));
  assert.equal(await catOf(), 60000, 'Ганагийн 25k буцаж төсөвт орно (Болдынх хэвээр хасагдсан)');
  assert.deepEqual(await j(await call('/api/balance', 'GET', null, bearer(tk))), balBefore, 'үлдэгдэл дахин хөндөгдөхгүй');
});
