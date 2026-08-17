// ============================================================
//  test/debt-repayment.test.js — ХЭСЭГЧИЛСЭН БУЦААЛТ (миграц 019)
//
//  Хоёр зүйлийг түгжинэ:
//   (1) NETTING — буцаалт нь эх бичлэгийг ЗАСАХГҮЙ, тусдаа эвент болж
//       үлдэгдлийг бууруулна (50,000 − 20,000 = 30,000), түүхэнд ХОЁУЛАА үлдэнэ.
//   (2) ОРЛОГЫН АВТОМАТ ХАСАЛТ — банкаар ирсэн буцаалтын гүйлгээ төсөв/
//       шинжилгээний ОРЛОГОд тоологдохгүй.
//
//  ★ ХАМГИЙН ЧУХАЛ ЗААГ (015/016-тай ЯГ ижил): хасалт нь ЗӨВХӨН төсөв/
//  шинжилгээнд нөлөөлнө. ҮЛДЭГДЭЛ (/balance, /balance-history) нь холбоос
//  байгаа эсэхээс үл хамааран БАЙТ ТУТМАА ИЖИЛ байна — мөнгө дансанд
//  бодитоор орсон тул.
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../db.js';
import { createApp } from '../app.js';
import { hashPasswordSync } from '../auth/passwordHash.js';
import { createJwt } from '../auth/jwt.js';

const API_KEY = 'repay-test-key';
const JWT_SECRET = 'repay-test-jwt';
let server, baseUrl, db, OWNER, USER_B, tokenA, tokenB;

before(async () => {
  db = createDb(':memory:');
  OWNER = db.createUser('owner@r.st', hashPasswordSync('pw'), 'admin').id;
  USER_B = db.createUser('b@r.st', hashPasswordSync('pw'), 'user').id;
  const app = createApp({ db, apiKey: API_KEY, jwtSecret: JWT_SECRET, rateLimit: { windowSeconds: 60, max: 100000 } });
  await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });
  const jwt = createJwt({ secret: JWT_SECRET, accessTtl: '1h' });
  tokenA = jwt.signAccess(db.getUserById(OWNER));
  tokenB = jwt.signAccess(db.getUserById(USER_B));
});
after(async () => { await new Promise((r) => server.close(r)); db.close(); });

const bearer = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
const call = (path, method = 'GET', body, token = tokenA) =>
  fetch(`${baseUrl}${path}`, { method, headers: bearer(token), body: body ? JSON.stringify(body) : undefined });
const j = async (r) => r.json();

let mid = 0;
/** Гүйлгээ шууд DB-д оруулах (userId сонгож болохоор). */
function seedTxn(userId, over = {}) {
  const { id } = db.insertTransaction({
    userId, messageId: `<r${++mid}>`, amount: 1000, currency: 'MNT',
    date: '2026-06-10', type: 'expense', description: 'X',
    category: 'Тээвэр', status: 'classified', balance: null, ...over,
  });
  return id;
}

/** Шинэ бичлэг үүсгээд id-г нь буцаах (богиносгогч). */
async function newDebt(over = {}, token = tokenA) {
  const r = await j(await call('/api/debt-ledger', 'POST', {
    counterparty: 'Мөнх-од', direction: 'i_lent', amount: 50000, entryDate: '2026-06-01', ...over,
  }, token));
  return r.entry;
}

/** Нэг хүн × валютын цэвэр үлдэгдэл (олдохгүй бол 0 — бүрэн цэвэршсэн). */
async function netOf(counterparty, currency = 'MNT', token = tokenA) {
  const r = await j(await call('/api/debt-ledger/balances', 'GET', null, token));
  const row = r.data.find((b) => b.counterparty === counterparty && b.currency === currency);
  return row ? row.net : 0;
}

// ===================== МИГРАЦ 019 =====================

test('019: repays_entry_id багана нэмэгдсэн, хуучин мөр бүр NULL (backfill байхгүй)', async () => {
  const cols = db._raw.prepare('PRAGMA table_info(debt_ledger)').all().map((c) => c.name);
  assert.ok(cols.includes('repays_entry_id'), 'repays_entry_id багана байх ёстой');
  const e = await newDebt({ counterparty: 'Миграц' });
  assert.equal(e.repaysEntryId, null, 'энгийн бичлэгийн repaysEntryId нь NULL');
});

test('019: миграц идемпотент — дахин ажиллуулахад алдаагүй', () => {
  const db2 = createDb(':memory:');
  db2.migrate();
  db2.migrate();
  const cols = db2._raw.prepare('PRAGMA table_info(debt_ledger)').all().map((c) => c.name);
  assert.equal(cols.filter((c) => c === 'repays_entry_id').length, 1);
  db2.close();
});

// ===================== (1) NETTING =====================

test('★ 50,000₮ зээлүүлээд 20,000₮ буцаахад үлдэгдэл 30,000₮ болно', async () => {
  const e = await newDebt({ counterparty: 'Мөнх-од' });
  assert.equal(await netOf('Мөнх-од'), 50000);

  const r = await call(`/api/debt-ledger/${e.id}/repay`, 'POST', { amount: 20000, entryDate: '2026-06-15' });
  assert.equal(r.status, 201);
  const body = await j(r);
  assert.equal(body.status, 'ok');
  assert.equal(body.outstanding, 30000, 'эх бичлэгийн үлдэгдэл өр');
  assert.equal(await netOf('Мөнх-од'), 30000, '★ цэвэр үлдэгдэл 30,000₮');

  // Эх бичлэг нь ЗАСАГДААГҮЙ (mutation биш, эвент)
  const parent = db.getDebtEntry(OWNER, e.id);
  assert.equal(parent.amount, 50000, 'эх бичлэгийн дүн ХЭВЭЭР');
  assert.equal(parent.status, 'open');

  // Буцаалт нь ЭСРЭГ чиглэлтэй, эх бичлэг рүү заасан
  assert.equal(body.entry.direction, 'i_borrowed');
  assert.equal(body.entry.repaysEntryId, e.id);
  assert.equal(body.entry.counterparty, 'Мөнх-од', 'counterparty эх бичлэгээс өвлөгдөнө');
});

test('★ Түүхэнд ХОЁУЛАА харагдана (эх бичлэг + буцаалт)', async () => {
  const e = await newDebt({ counterparty: 'Түүх', amount: 50000 });
  await call(`/api/debt-ledger/${e.id}/repay`, 'POST', { amount: 20000, entryDate: '2026-06-15' });

  const list = await j(await call('/api/debt-ledger?counterparty=Түүх'));
  assert.equal(list.data.length, 2, '★ хоёр эвент');
  const parent = list.data.find((x) => x.id === e.id);
  const repay = list.data.find((x) => x.repaysEntryId === e.id);
  assert.ok(parent && repay);
  assert.equal(parent.amount, 50000);
  assert.equal(parent.repaid, 20000, 'жагсаалтад буцаагдсан дүн харагдана');
  assert.equal(parent.outstanding, 30000, 'жагсаалтад үлдэгдэл харагдана');
  assert.equal(repay.amount, 20000);
  assert.equal(repay.outstanding, 0, 'буцаалтын эвент өөрөө үлдэгдэлгүй');
});

test('Олон удаагийн хэсэгчилсэн буцаалт хуримтлагдана (20к + 15к → 15к үлдэнэ)', async () => {
  const e = await newDebt({ counterparty: 'Олон', amount: 50000 });
  await call(`/api/debt-ledger/${e.id}/repay`, 'POST', { amount: 20000, entryDate: '2026-06-15' });
  await call(`/api/debt-ledger/${e.id}/repay`, 'POST', { amount: 15000, entryDate: '2026-06-20' });
  assert.equal(await netOf('Олон'), 15000);
  assert.equal(db.getDebtOutstanding(OWNER, e.id), 15000);
});

test('Бүтэн дүнгээр буцаахад үлдэгдэл 0 болж, balances-аас БҮРМӨСӨН гарна', async () => {
  const e = await newDebt({ counterparty: 'Бүтэн', amount: 50000 });
  await call(`/api/debt-ledger/${e.id}/repay`, 'POST', { amount: 50000, entryDate: '2026-06-15' });
  assert.equal(await netOf('Бүтэн'), 0, 'HAVING net <> 0 тул мөр огт байхгүй');
});

test('i_borrowed чиглэлд ч ажиллана (би 30,000₮ зээлээд 10,000₮ төлсөн → 20,000₮ өртэй)', async () => {
  const e = await newDebt({ counterparty: 'Зээлдүүлэгч', direction: 'i_borrowed', amount: 30000 });
  assert.equal(await netOf('Зээлдүүлэгч'), -30000);
  const body = await j(await call(`/api/debt-ledger/${e.id}/repay`, 'POST', { amount: 10000, entryDate: '2026-06-15' }));
  assert.equal(body.entry.direction, 'i_lent', 'эсрэг чиглэл');
  assert.equal(await netOf('Зээлдүүлэгч'), -20000);
});

test('Үлдэгдлээс их буцаалт → 400 (OVER_REPAYMENT), юу ч бичигдэхгүй', async () => {
  const e = await newDebt({ counterparty: 'Хэтрэлт', amount: 50000 });
  await call(`/api/debt-ledger/${e.id}/repay`, 'POST', { amount: 40000, entryDate: '2026-06-15' });
  const r = await call(`/api/debt-ledger/${e.id}/repay`, 'POST', { amount: 20000, entryDate: '2026-06-16' });
  assert.equal(r.status, 400);
  assert.equal((await j(r)).code, 'OVER_REPAYMENT');
  assert.equal(await netOf('Хэтрэлт'), 10000, 'үлдэгдэл хэвээр — rollback');
  assert.equal(db.listDebtEntries(OWNER, { counterparty: 'Хэтрэлт' }).length, 2, 'гуравдахь мөр үүсээгүй');
});

test('Буцаалтын эвент рүү дахин буцаалт → 400, хаагдсан өр дээр буцаалт → 400', async () => {
  const e = await newDebt({ counterparty: 'Гинж', amount: 50000 });
  const rep = await j(await call(`/api/debt-ledger/${e.id}/repay`, 'POST', { amount: 10000, entryDate: '2026-06-15' }));
  const r1 = await call(`/api/debt-ledger/${rep.entry.id}/repay`, 'POST', { amount: 5000, entryDate: '2026-06-16' });
  assert.equal(r1.status, 400);
  assert.equal((await j(r1)).code, 'NOT_AN_ENTRY');

  await call(`/api/debt-ledger/${e.id}`, 'PATCH', { status: 'settled' });
  const r2 = await call(`/api/debt-ledger/${e.id}/repay`, 'POST', { amount: 5000, entryDate: '2026-06-17' });
  assert.equal(r2.status, 400);
  assert.equal((await j(r2)).code, 'ALREADY_SETTLED');
});

// ===================== "ХААХ" ХЭВЭЭР АЖИЛЛАНА =====================

test('★ Хаах = үлдэгдлийг тэг болгох: буцаалттай бичлэгийг хаахад буцаалт нь ХАМТ хаагдана', async () => {
  const e = await newDebt({ counterparty: 'Хаалт', amount: 50000 });
  await call(`/api/debt-ledger/${e.id}/repay`, 'POST', { amount: 20000, entryDate: '2026-06-15' });
  assert.equal(await netOf('Хаалт'), 30000);

  await call(`/api/debt-ledger/${e.id}`, 'PATCH', { status: 'settled' });
  // ⚠️ Хэрэв буцаалт нээлттэй үлдвэл үлдэгдэл −20,000 болж "та өртэй" гэсэн
  //    ХУДАЛ дүн гарна. Cascade нь яг үүнээс сэргийлнэ.
  assert.equal(await netOf('Хаалт'), 0, '★ тэг — сөрөг үлдэгдэл ҮҮСЭХГҮЙ');
  const list = db.listDebtEntries(OWNER, { counterparty: 'Хаалт' });
  assert.ok(list.every((x) => x.status === 'settled'), 'хоёулаа хаагдсан');
});

test('Дахин нээхэд буцаалт нь ч хамт нээгдэж, үлдэгдэл сэргэнэ', async () => {
  const e = await newDebt({ counterparty: 'Дахин', amount: 50000 });
  await call(`/api/debt-ledger/${e.id}/repay`, 'POST', { amount: 20000, entryDate: '2026-06-15' });
  await call(`/api/debt-ledger/${e.id}`, 'PATCH', { status: 'settled' });
  await call(`/api/debt-ledger/${e.id}`, 'PATCH', { status: 'open' });
  assert.equal(await netOf('Дахин'), 30000, 'үлдэгдэл ЯГ хэвээр сэргэнэ');
});

test('Буцаалтгүй бичлэгийн хаах/нээх зан төлөв 015-тай ЯГ ижил хэвээр', async () => {
  const e = await newDebt({ counterparty: 'Хуучин', amount: 7000 });
  await call(`/api/debt-ledger/${e.id}`, 'PATCH', { status: 'settled' });
  assert.equal(await netOf('Хуучин'), 0);
  assert.ok(db.getDebtEntry(OWNER, e.id).settledAt, 'settled_at тэмдэглэгдэнэ');
  await call(`/api/debt-ledger/${e.id}`, 'PATCH', { status: 'open' });
  assert.equal(await netOf('Хуучин'), 7000);
  assert.equal(db.getDebtEntry(OWNER, e.id).settledAt, null);
});

// ===================== (2) ОРЛОГЫН АВТОМАТ ХАСАЛТ =====================

test('★ Холбосон буцаалт → орлогын гүйлгээ /summary-гээс гарна, manually_edited=1', async () => {
  const u = db.createUser('inc1@r.st', hashPasswordSync('pw'), 'user').id;
  const tk = createJwt({ secret: JWT_SECRET, accessTtl: '1h' }).signAccess(db.getUserById(u));
  // Банкаар ирсэн 20,000₮ буцаалтын ОРЛОГО
  const txn = seedTxn(u, { amount: 20000, type: 'income', date: '2026-07-05', category: 'Орлого' });
  const before = await j(await fetch(`${baseUrl}/api/summary?from=2026-07-01&to=2026-07-31`, { headers: bearer(tk) }));
  assert.equal(before.totalIncome, 20000, 'холбоосгүй үед орлогод тоологдоно');

  const e = await j(await call('/api/debt-ledger', 'POST', {
    counterparty: 'Мөнх-од', direction: 'i_lent', amount: 50000, entryDate: '2026-07-01',
  }, tk));
  const r = await call(`/api/debt-ledger/${e.entry.id}/repay`, 'POST',
    { amount: 20000, entryDate: '2026-07-05', linkedTransactionId: txn }, tk);
  assert.equal(r.status, 201);

  const after = await j(await fetch(`${baseUrl}/api/summary?from=2026-07-01&to=2026-07-31`, { headers: bearer(tk) }));
  assert.equal(after.totalIncome, 0, '★ орлого хиймлээр өсөхгүй');

  const row = db.getById(u, txn);
  assert.equal(row.excluded_from_budget, 1);
  assert.equal(row.excluded_amount, 20000);
  assert.equal(row.manually_edited, 1, '★ pipeline дахин хөндөхгүй');

  // Үлдэгдэл өр нь мөн зөв
  assert.equal(db.getDebtOutstanding(u, e.entry.id), 30000);
});

test('★ /analytics/by-category-ийн totalIncome-оос ч гарна', async () => {
  const u = db.createUser('inc2@r.st', hashPasswordSync('pw'), 'user').id;
  const tk = createJwt({ secret: JWT_SECRET, accessTtl: '1h' }).signAccess(db.getUserById(u));
  const txn = seedTxn(u, { amount: 25000, type: 'income', date: '2026-08-03', category: 'Орлого' });
  const e = await j(await call('/api/debt-ledger', 'POST', {
    counterparty: 'Батаа', direction: 'i_lent', amount: 25000, entryDate: '2026-08-01',
  }, tk));

  const before = await j(await fetch(`${baseUrl}/api/analytics/by-category?month=2026-08`, { headers: bearer(tk) }));
  assert.equal(before.totalIncome, 25000);

  await call(`/api/debt-ledger/${e.entry.id}/repay`, 'POST',
    { amount: 25000, entryDate: '2026-08-03', linkedTransactionId: txn }, tk);

  const after = await j(await fetch(`${baseUrl}/api/analytics/by-category?month=2026-08`, { headers: bearer(tk) }));
  assert.equal(after.totalIncome, 0, '★ by-category орлогод ч тоологдохгүй');
});

test('Бэлнээр буцаах (холбоосгүй) нь БҮРЭН хүчинтэй — ямар ч гүйлгээ хөндөгдөхгүй', async () => {
  const u = db.createUser('cash@r.st', hashPasswordSync('pw'), 'user').id;
  const tk = createJwt({ secret: JWT_SECRET, accessTtl: '1h' }).signAccess(db.getUserById(u));
  const txn = seedTxn(u, { amount: 20000, type: 'income', date: '2026-07-05', category: 'Орлого' });
  const e = await j(await call('/api/debt-ledger', 'POST', {
    counterparty: 'Бэлэн', direction: 'i_lent', amount: 50000, entryDate: '2026-07-01',
  }, tk));

  const r = await call(`/api/debt-ledger/${e.entry.id}/repay`, 'POST', { amount: 20000, entryDate: '2026-07-05' }, tk);
  assert.equal(r.status, 201);
  assert.equal((await j(r)).entry.linkedTransactionId, null);
  assert.equal(db.getById(u, txn).excluded_from_budget, 0, 'ямар ч гүйлгээ хасагдаагүй');
  assert.equal(db.getDebtOutstanding(u, e.entry.id), 30000);
});

test('Валют зөрөх гүйлгээ рүү холбохыг татгалзана (400) — backend хөрвүүлэхгүй', async () => {
  const u = db.createUser('cur@r.st', hashPasswordSync('pw'), 'user').id;
  const tk = createJwt({ secret: JWT_SECRET, accessTtl: '1h' }).signAccess(db.getUserById(u));
  const eurTxn = seedTxn(u, { amount: 20, currency: 'EUR', type: 'income', date: '2026-07-05' });
  const e = await j(await call('/api/debt-ledger', 'POST', {
    counterparty: 'Валют', direction: 'i_lent', amount: 50000, currency: 'MNT', entryDate: '2026-07-01',
  }, tk));
  const r = await call(`/api/debt-ledger/${e.entry.id}/repay`, 'POST',
    { amount: 20000, entryDate: '2026-07-05', linkedTransactionId: eurTxn }, tk);
  assert.equal(r.status, 400);
  assert.equal((await j(r)).code, 'CURRENCY_MISMATCH');
  assert.equal(db.getById(u, eurTxn).excluded_from_budget, 0);
  assert.equal(db.getDebtOutstanding(u, e.entry.id), 50000, 'буцаалт бүртгэгдээгүй — rollback');
});

test('EUR өр нь EUR буцаалтаар л цэвэрших — валют хооронд ХЭЗЭЭ Ч холилдохгүй', async () => {
  const e = await newDebt({ counterparty: 'Евро', amount: 100, currency: 'EUR' });
  const body = await j(await call(`/api/debt-ledger/${e.id}/repay`, 'POST', { amount: 40, entryDate: '2026-06-15' }));
  assert.equal(body.entry.currency, 'EUR', 'валют эх бичлэгээс өвлөгдөнө');
  assert.equal(await netOf('Евро', 'EUR'), 60);
  assert.equal(await netOf('Евро', 'MNT'), 0, 'MNT-д огт нөлөөлөхгүй');
});

// ===================== ЭРГЭЛТИЙН СИММЕТР (reversal) =====================

test('★ Буцаалтыг устгахад орлогын хасалт БУЦНА (excluded_from_budget = 0)', async () => {
  const u = db.createUser('rev1@r.st', hashPasswordSync('pw'), 'user').id;
  const tk = createJwt({ secret: JWT_SECRET, accessTtl: '1h' }).signAccess(db.getUserById(u));
  const txn = seedTxn(u, { amount: 20000, type: 'income', date: '2026-07-05', category: 'Орлого' });
  const e = await j(await call('/api/debt-ledger', 'POST', {
    counterparty: 'Буцаалт', direction: 'i_lent', amount: 50000, entryDate: '2026-07-01',
  }, tk));
  const rep = await j(await call(`/api/debt-ledger/${e.entry.id}/repay`, 'POST',
    { amount: 20000, entryDate: '2026-07-05', linkedTransactionId: txn }, tk));
  assert.equal(db.getById(u, txn).excluded_from_budget, 1);

  const d = await call(`/api/debt-ledger/${rep.entry.id}`, 'DELETE', null, tk);
  assert.equal(d.status, 200);
  const row = db.getById(u, txn);
  assert.equal(row.excluded_from_budget, 0, '★ хасалт буцсан');
  assert.equal(row.excluded_amount, 0);
  assert.equal(db.getDebtOutstanding(u, e.entry.id), 50000, 'үлдэгдэл өр сэргэсэн');

  const sum = await j(await fetch(`${baseUrl}/api/summary?from=2026-07-01&to=2026-07-31`, { headers: bearer(tk) }));
  assert.equal(sum.totalIncome, 20000, 'орлого буцаж тоологдоно');
});

test('★ ӨӨР бичлэг мөн тэр гүйлгээг лавлаж байвал хасалт ҮЛДЭНЭ (reference count)', async () => {
  const u = db.createUser('rev2@r.st', hashPasswordSync('pw'), 'user').id;
  const tk = createJwt({ secret: JWT_SECRET, accessTtl: '1h' }).signAccess(db.getUserById(u));
  // Нэг 30,000₮ орлогоор ХОЁР хүн зэрэг буцаасан (20к + 10к)
  const txn = seedTxn(u, { amount: 30000, type: 'income', date: '2026-07-05', category: 'Орлого' });
  const e1 = await j(await call('/api/debt-ledger', 'POST', {
    counterparty: 'А', direction: 'i_lent', amount: 20000, entryDate: '2026-07-01',
  }, tk));
  const e2 = await j(await call('/api/debt-ledger', 'POST', {
    counterparty: 'Б', direction: 'i_lent', amount: 10000, entryDate: '2026-07-01',
  }, tk));
  const rep1 = await j(await call(`/api/debt-ledger/${e1.entry.id}/repay`, 'POST',
    { amount: 20000, entryDate: '2026-07-05', linkedTransactionId: txn }, tk));
  await call(`/api/debt-ledger/${e2.entry.id}/repay`, 'POST',
    { amount: 10000, entryDate: '2026-07-05', linkedTransactionId: txn }, tk);

  assert.equal(db.getById(u, txn).excluded_amount, 30000, 'хоёулангийнх нийлбэрээр бүрэн хасагдсан');
  assert.equal(db.getById(u, txn).excluded_from_budget, 1);

  // Нэгийг нь устгахад НӨГӨӨГИЙНХ нь хэвээр
  await call(`/api/debt-ledger/${rep1.entry.id}`, 'DELETE', null, tk);
  const row = db.getById(u, txn);
  assert.equal(row.excluded_amount, 10000, '★ зөвхөн устсаных хасагдав');
  assert.equal(row.excluded_from_budget, 0, 'бүрэн БИШ болсон тул туг унана');

  const sum = await j(await fetch(`${baseUrl}/api/summary?from=2026-07-01&to=2026-07-31`, { headers: bearer(tk) }));
  assert.equal(sum.totalIncome, 20000, '30,000 − үлдсэн 10,000 хасалт');
});

test('Холбоосыг PATCH-аар салгахад ч хасалт буцна (un-link)', async () => {
  const u = db.createUser('rev3@r.st', hashPasswordSync('pw'), 'user').id;
  const tk = createJwt({ secret: JWT_SECRET, accessTtl: '1h' }).signAccess(db.getUserById(u));
  const txn = seedTxn(u, { amount: 20000, type: 'income', date: '2026-07-05', category: 'Орлого' });
  const e = await j(await call('/api/debt-ledger', 'POST', {
    counterparty: 'Салгах', direction: 'i_lent', amount: 50000, entryDate: '2026-07-01',
  }, tk));
  const rep = await j(await call(`/api/debt-ledger/${e.entry.id}/repay`, 'POST',
    { amount: 20000, entryDate: '2026-07-05', linkedTransactionId: txn }, tk));
  assert.equal(db.getById(u, txn).excluded_from_budget, 1);

  await call(`/api/debt-ledger/${rep.entry.id}`, 'PATCH', { linkedTransactionId: null }, tk);
  assert.equal(db.getById(u, txn).excluded_from_budget, 0);
  assert.equal(db.getById(u, txn).excluded_amount, 0);
  assert.equal(await netOf('Салгах', 'MNT', tk), 30000, 'холбоос салгасан ч netting ХЭВЭЭР');
});

test('★ Эх бичлэг устахад буцаалтууд нь ХАМТ устаж, хасалт нь ч буцна', async () => {
  const u = db.createUser('rev4@r.st', hashPasswordSync('pw'), 'user').id;
  const tk = createJwt({ secret: JWT_SECRET, accessTtl: '1h' }).signAccess(db.getUserById(u));
  const txn = seedTxn(u, { amount: 20000, type: 'income', date: '2026-07-05', category: 'Орлого' });
  const e = await j(await call('/api/debt-ledger', 'POST', {
    counterparty: 'Өнчин', direction: 'i_lent', amount: 50000, entryDate: '2026-07-01',
  }, tk));
  await call(`/api/debt-ledger/${e.entry.id}/repay`, 'POST',
    { amount: 20000, entryDate: '2026-07-05', linkedTransactionId: txn }, tk);

  await call(`/api/debt-ledger/${e.entry.id}`, 'DELETE', null, tk);
  assert.equal(db.listDebtEntries(u, { counterparty: 'Өнчин' }).length, 0, '★ өнчин буцаалт үлдэхгүй');
  assert.equal(db.getById(u, txn).excluded_from_budget, 0, 'хасалт нь ч буцав');
  const bal = await j(await call('/api/debt-ledger/balances', 'GET', null, tk));
  assert.ok(!bal.data.some((b) => b.counterparty === 'Өнчин'), 'сөрөг үлдэгдэл ҮҮСЭХГҮЙ');
});

// ===================== ★ ҮЛДЭГДЭЛ ХӨНДӨГДӨХГҮЙ =====================

test('★★ Холбосон буцаалт /balance-history-г БАЙТ ТУТМАА өөрчлөхгүй', async () => {
  const u = db.createUser('bal@r.st', hashPasswordSync('pw'), 'user').id;
  const tk = createJwt({ secret: JWT_SECRET, accessTtl: '1h' }).signAccess(db.getUserById(u));
  seedTxn(u, { amount: 5000, type: 'expense', date: '2026-07-02', balance: 95000 });
  const txn = seedTxn(u, { amount: 20000, type: 'income', date: '2026-07-05', category: 'Орлого', balance: 115000 });
  seedTxn(u, { amount: 3000, type: 'expense', date: '2026-07-08', balance: 112000 });

  const url = `${baseUrl}/api/balance-history?from=2026-07-01&to=2026-07-10`;
  const raw = (r) => r.text(); // ★ ЗАДЛААГҮЙ текстээр — байт тутмаа харьцуулна
  const beforeTxt = await raw(await fetch(url, { headers: bearer(tk) }));
  const beforeBal = await j(await fetch(`${baseUrl}/api/balance`, { headers: bearer(tk) }));

  const e = await j(await call('/api/debt-ledger', 'POST', {
    counterparty: 'Үлдэгдэл', direction: 'i_lent', amount: 50000, entryDate: '2026-07-01',
  }, tk));
  const r = await call(`/api/debt-ledger/${e.entry.id}/repay`, 'POST',
    { amount: 20000, entryDate: '2026-07-05', linkedTransactionId: txn }, tk);
  assert.equal(r.status, 201);
  assert.equal(db.getById(u, txn).excluded_from_budget, 1, 'хасалт БОДИТООР хийгдсэн');

  const afterTxt = await raw(await fetch(url, { headers: bearer(tk) }));
  const afterBal = await j(await fetch(`${baseUrl}/api/balance`, { headers: bearer(tk) }));

  assert.equal(afterTxt, beforeTxt, '★★ /balance-history БАЙТ ТУТМАА ИЖИЛ');
  assert.deepEqual(afterBal, beforeBal, '★★ /balance ИЖИЛ');
});

test('★ Хасагдсан орлого гүйлгээний ЖАГСААЛТАД бүтэн дүнгээрээ хэвээр', async () => {
  const u = db.createUser('list@r.st', hashPasswordSync('pw'), 'user').id;
  const tk = createJwt({ secret: JWT_SECRET, accessTtl: '1h' }).signAccess(db.getUserById(u));
  const txn = seedTxn(u, { amount: 20000, type: 'income', date: '2026-07-05', category: 'Орлого' });
  const e = await j(await call('/api/debt-ledger', 'POST', {
    counterparty: 'Жагсаалт', direction: 'i_lent', amount: 50000, entryDate: '2026-07-01',
  }, tk));
  await call(`/api/debt-ledger/${e.entry.id}/repay`, 'POST',
    { amount: 20000, entryDate: '2026-07-05', linkedTransactionId: txn }, tk);

  const list = await j(await fetch(`${baseUrl}/api/transactions?limit=100`, { headers: bearer(tk) }));
  const row = list.data.find((t) => t.id === txn);
  assert.ok(row, '★ жагсаалтаас алга БОЛОХГҮЙ (хэрэглэгч буцааж асаах ёстой)');
  assert.equal(row.amount, 20000, 'бүтэн дүнгээрээ');
  assert.equal(row.excluded_from_budget, 1);
});

// ===================== PER-USER ISOLATION =====================

test('★ Isolation: B хэрэглэгч A-гийн бичлэг рүү буцаалт бүртгэж чадахгүй (404)', async () => {
  const e = await newDebt({ counterparty: 'ХамгаалалтA', amount: 50000 }, tokenA);
  const r = await call(`/api/debt-ledger/${e.id}/repay`, 'POST', { amount: 10000, entryDate: '2026-06-15' }, tokenB);
  assert.equal(r.status, 404);
  assert.equal(await netOf('ХамгаалалтA', 'MNT', tokenA), 50000, 'A-гийн үлдэгдэл хэвээр');
});

test('★ Isolation: өөр хэрэглэгчийн гүйлгээ рүү буцаалт холбохыг татгалзана (400)', async () => {
  const txnA = seedTxn(OWNER, { amount: 9999, type: 'income', date: '2026-06-20' });
  const eB = await newDebt({ counterparty: 'ХакерБ', amount: 9999 }, tokenB);
  const r = await call(`/api/debt-ledger/${eB.id}/repay`, 'POST',
    { amount: 9999, entryDate: '2026-06-20', linkedTransactionId: txnA }, tokenB);
  assert.equal(r.status, 400);
  assert.equal(db.getById(OWNER, txnA).excluded_from_budget, 0, 'бусдын гүйлгээ хөндөгдөх ЁСГҮЙ');
});

test('Буруу оролт: сөрөг/тэг дүн, огноогүй, байхгүй id → 400/404', async () => {
  const e = await newDebt({ counterparty: 'Оролт', amount: 5000 });
  assert.equal((await call(`/api/debt-ledger/${e.id}/repay`, 'POST', { amount: -5, entryDate: '2026-06-15' })).status, 400);
  assert.equal((await call(`/api/debt-ledger/${e.id}/repay`, 'POST', { amount: 0, entryDate: '2026-06-15' })).status, 400);
  assert.equal((await call(`/api/debt-ledger/${e.id}/repay`, 'POST', { amount: 100 })).status, 400);
  assert.equal((await call('/api/debt-ledger/999999/repay', 'POST', { amount: 100, entryDate: '2026-06-15' })).status, 404);
  assert.equal((await call('/api/debt-ledger/abc/repay', 'POST', { amount: 100, entryDate: '2026-06-15' })).status, 400);
});
