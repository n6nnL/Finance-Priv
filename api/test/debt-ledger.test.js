// ============================================================
//  test/debt-ledger.test.js — Өрийн дэвтэр + төсвөөс хасах туг
//
//  ★ ХАМГИЙН ЧУХАЛ ЗААГ: excluded_from_budget нь ТӨСӨВ/ШИНЖИЛГЭЭнд Л
//  нөлөөлнө, ҮЛДЭГДЭЛД ХЭЗЭЭ Ч нөлөөлөхгүй. Доорх тестүүд түүнийг түгжинэ.
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../db.js';
import { createApp } from '../app.js';
import { hashPasswordSync } from '../auth/passwordHash.js';
import { createJwt } from '../auth/jwt.js';

const API_KEY = 'debt-test-key';
const JWT_SECRET = 'debt-test-jwt';
let server, baseUrl, db, OWNER, USER_B, tokenA, tokenB;

before(async () => {
  db = createDb(':memory:');
  OWNER = db.createUser('owner@t.st', hashPasswordSync('pw'), 'admin').id;
  USER_B = db.createUser('b@t.st', hashPasswordSync('pw'), 'user').id;
  const app = createApp({ db, apiKey: API_KEY, jwtSecret: JWT_SECRET, rateLimit: { windowSeconds: 60, max: 100000 } });
  await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });
  const jwt = createJwt({ secret: JWT_SECRET, accessTtl: '1h' });
  tokenA = jwt.signAccess(db.getUserById(OWNER));
  tokenB = jwt.signAccess(db.getUserById(USER_B));
});
after(async () => { await new Promise((r) => server.close(r)); db.close(); });

const H = { 'Content-Type': 'application/json', 'X-API-Key': API_KEY };
const bearer = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
const call = (path, method = 'GET', body, headers = H) =>
  fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
const j = async (r) => r.json();

let mid = 0;
/** Гүйлгээ шууд DB-д оруулах (userId сонгож болохоор). */
function seedTxn(userId, over = {}) {
  const { id } = db.insertTransaction({
    userId, messageId: `<d${++mid}>`, amount: 1000, currency: 'MNT',
    date: '2026-06-10', type: 'expense', description: 'X',
    category: 'Тээвэр', status: 'classified', balance: null, ...over,
  });
  return id;
}

// ===================== МИГРАЦ =====================

test('015: excluded_from_budget багана DEFAULT 0-оор нэмэгдсэн', () => {
  const id = seedTxn(OWNER);
  assert.equal(db.getById(OWNER, id).excluded_from_budget, 0);
});

test('015: миграц идемпотент — дахин ажиллуулахад алдаагүй, өгөгдөл хэвээр', () => {
  // createDb нь дотроо migrate() дууддаг; ижил файлыг дахин нээх нь re-run-тэй тэнцүү.
  // :memory: тул энд шинэ DB дээр давхар migrate дуудагдахыг шалгана.
  const db2 = createDb(':memory:');
  const u = db2.createUser('m@t.st', hashPasswordSync('pw'), 'admin').id;
  const before = db2.listDebtEntries(u).length;
  const db3 = createDb(':memory:'); // дахин миграц — throw хийх ёсгүй
  db3.close();
  assert.equal(before, 0);
  db2.close();
});

// ===================== ГОЛ ЗААГ: шинжилгээ vs үлдэгдэл =====================

test('★ Хасагдсан гүйлгээ шинжилгээнээс АЛГА болох ч ҮЛДЭГДЭЛД хэвээр', async () => {
  const u = db.createUser('excl@t.st', hashPasswordSync('pw'), 'user').id;
  const jwt = createJwt({ secret: JWT_SECRET, accessTtl: '1h' });
  const tk = jwt.signAccess(db.getUserById(u));

  // Ердийн зарлага + үлдэгдлийн anchor-той том зарлага (билет)
  seedTxn(u, { amount: 5000, category: 'Тээвэр', date: '2026-06-01' });
  const ticket = seedTxn(u, { amount: 600000, category: 'Тээвэр', date: '2026-06-05', balance: 900000 });

  const before = await j(await call('/api/analytics/by-category?month=2026-06', 'GET', null, bearer(tk)));
  const beforeBal = await j(await call('/api/balance', 'GET', null, bearer(tk)));
  const beforeSum = await j(await call('/api/summary', 'GET', null, bearer(tk)));
  assert.equal(before.byCategory.find((c) => c.category === 'Тээвэр').total, 605000);
  assert.equal(beforeBal.balance, 900000);
  assert.equal(beforeSum.totalExpense, 605000);

  // Төсвөөс хас
  const r = await j(await call(`/api/transactions/${ticket}/exclusion`, 'PATCH', { excluded: true }, bearer(tk)));
  assert.equal(r.excluded, true);
  assert.equal(r.manuallyEdited, true); // invariant 2: гар засвар гэж тэмдэглэгдэнэ

  const after = await j(await call('/api/analytics/by-category?month=2026-06', 'GET', null, bearer(tk)));
  const afterBal = await j(await call('/api/balance', 'GET', null, bearer(tk)));
  const afterSum = await j(await call('/api/summary', 'GET', null, bearer(tk)));
  const afterMonthly = await j(await call('/api/monthly', 'GET', null, bearer(tk)));

  // Шинжилгээ: 600k АЛГА
  assert.equal(after.byCategory.find((c) => c.category === 'Тээвэр').total, 5000);
  assert.equal(after.totalExpense, 5000);
  assert.equal(afterSum.totalExpense, 5000);
  assert.equal(afterMonthly.data.find((m) => m.month === '2026-06').expense, 5000);
  // ★ Үлдэгдэл: ХЭВЭЭР (мөнгө бодитоор хөдөлсөн)
  assert.equal(afterBal.balance, 900000);

  // balance-history-д ч хэвээр (сэргээлт хөндөгдөөгүй)
  const hist = await j(await call('/api/balance-history?from=2026-06-01&to=2026-06-10', 'GET', null, bearer(tk)));
  assert.equal(hist.available, true);
  const day5 = hist.series.find((p) => p.date === '2026-06-05');
  assert.ok(day5.transactions.some((t) => t.id === ticket), 'хасагдсан гүйлгээ balance-history-д хэвээр байх ёстой');
});

test('★ /budget-status (getCycleSpend) ч хасалтыг хүндэтгэнэ — зарлага ба орлого', async () => {
  const u = db.createUser('cycle@t.st', hashPasswordSync('pw'), 'user').id;
  const jwt = createJwt({ secret: JWT_SECRET, accessTtl: '1h' });
  const tk = jwt.signAccess(db.getUserById(u));
  // Идэвхтэй циклд багтахаар ӨНӨӨДРИЙН огноогоор суулгана
  const today = new Date().toISOString().slice(0, 10);
  const normal = seedTxn(u, { amount: 4000, category: 'Тээвэр', date: today });
  const ticket = seedTxn(u, { amount: 600000, category: 'Тээвэр', date: today });
  const payback = seedTxn(u, { amount: 600000, type: 'income', category: 'Орлого', date: today });

  const before = await j(await call('/api/budget-status?cycle=current', 'GET', null, bearer(tk)));
  assert.equal(before.byCategory.find((c) => c.category === 'Тээвэр').spent, 604000);
  assert.equal(before.actualIncome, 600000);

  await call(`/api/transactions/${ticket}/exclusion`, 'PATCH', { excluded: true }, bearer(tk));
  await call(`/api/transactions/${payback}/exclusion`, 'PATCH', { excluded: true }, bearer(tk));

  const after = await j(await call('/api/budget-status?cycle=current', 'GET', null, bearer(tk)));
  assert.equal(after.byCategory.find((c) => c.category === 'Тээвэр').spent, 4000, 'Тээврийн төсөв 600k-аар хөөрөгдөх ЁСГҮЙ');
  assert.equal(after.totalSpend, 4000);
  assert.equal(after.actualIncome, 0, 'буцаалтын орлого ч хөөрөгдөх ЁСГҮЙ');
  assert.ok(normal); // ердийн зарлага хэвээр тоологдсоныг дээрх 4000 нотолно
});

test('Хасагдсан гүйлгээ transactions ЖАГСААЛТААС алга болохгүй (буцааж асаах боломж)', async () => {
  const u = db.createUser('list@t.st', hashPasswordSync('pw'), 'user').id;
  const jwt = createJwt({ secret: JWT_SECRET, accessTtl: '1h' });
  const tk = jwt.signAccess(db.getUserById(u));
  const id = seedTxn(u, { amount: 700 });
  await call(`/api/transactions/${id}/exclusion`, 'PATCH', { excluded: true }, bearer(tk));
  const list = await j(await call('/api/transactions', 'GET', null, bearer(tk)));
  assert.ok(list.data.some((t) => t.id === id), 'жагсаалтад харагдах ёстой');
});

test('exclusion: excluded буцаах → шинжилгээнд эргэж орно', async () => {
  const u = db.createUser('toggle@t.st', hashPasswordSync('pw'), 'user').id;
  const jwt = createJwt({ secret: JWT_SECRET, accessTtl: '1h' });
  const tk = jwt.signAccess(db.getUserById(u));
  const id = seedTxn(u, { amount: 3000, date: '2026-07-02' });
  await call(`/api/transactions/${id}/exclusion`, 'PATCH', { excluded: true }, bearer(tk));
  assert.equal((await j(await call('/api/analytics/by-category?month=2026-07', 'GET', null, bearer(tk)))).totalExpense, 0);
  await call(`/api/transactions/${id}/exclusion`, 'PATCH', { excluded: false }, bearer(tk));
  assert.equal((await j(await call('/api/analytics/by-category?month=2026-07', 'GET', null, bearer(tk)))).totalExpense, 3000);
});

test('exclusion: boolean биш → 400; байхгүй гүйлгээ → 404', async () => {
  const id = seedTxn(OWNER);
  assert.equal((await call(`/api/transactions/${id}/exclusion`, 'PATCH', { excluded: 'yes' })).status, 400);
  assert.equal((await call('/api/transactions/999999/exclusion', 'PATCH', { excluded: true })).status, 404);
});

// ===================== ӨРИЙН ДЭВТЭР — CRUD =====================

test('POST /debt-ledger → 201, GET → жагсаалт, balances цэвэршинэ', async () => {
  const r = await call('/api/debt-ledger', 'POST', {
    counterparty: 'Болд', direction: 'i_lent', amount: 20000, currency: 'MNT', entryDate: '2026-06-01', note: 'билет',
  });
  assert.equal(r.status, 201);
  const body = await j(r);
  assert.equal(body.entry.status, 'open');
  assert.equal(body.entry.counterparty, 'Болд');

  await call('/api/debt-ledger', 'POST', {
    counterparty: 'Болд', direction: 'i_borrowed', amount: 5000, currency: 'MNT', entryDate: '2026-06-02',
  });
  const bal = await j(await call('/api/debt-ledger/balances'));
  const bold = bal.data.find((b) => b.counterparty === 'Болд' && b.currency === 'MNT');
  assert.equal(bold.net, 15000);
  assert.equal(bold.direction, 'i_lent');
});

test('balances: ⚠️ MNT ба EUR тусдаа (хооронд нь цэвэрших ЁСГҮЙ)', async () => {
  await call('/api/debt-ledger', 'POST', {
    counterparty: 'Ана', direction: 'i_lent', amount: 50000, currency: 'MNT', entryDate: '2026-06-01',
  });
  await call('/api/debt-ledger', 'POST', {
    counterparty: 'Ана', direction: 'i_borrowed', amount: 20, currency: 'EUR', entryDate: '2026-06-01',
  });
  const bal = await j(await call('/api/debt-ledger/balances'));
  const rows = bal.data.filter((b) => b.counterparty === 'Ана');
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.currency === 'MNT').net, 50000);
  assert.equal(rows.find((r) => r.currency === 'EUR').net, -20);
});

test('POST валидаци: amount ≤ 0, буруу direction/currency/огноо → 400', async () => {
  const bad = [
    { counterparty: 'X', direction: 'i_lent', amount: 0, entryDate: '2026-06-01' },
    { counterparty: 'X', direction: 'i_lent', amount: -5, entryDate: '2026-06-01' },
    { counterparty: 'X', direction: 'huuramch', amount: 5, entryDate: '2026-06-01' },
    { counterparty: 'X', direction: 'i_lent', amount: 5, currency: 'USD', entryDate: '2026-06-01' },
    { counterparty: 'X', direction: 'i_lent', amount: 5, entryDate: '06/01/2026' },
    { counterparty: '', direction: 'i_lent', amount: 5, entryDate: '2026-06-01' },
  ];
  for (const b of bad) assert.equal((await call('/api/debt-ledger', 'POST', b)).status, 400, JSON.stringify(b));
});

test('GET шүүлт: ?counterparty= ба ?status=', async () => {
  const all = await j(await call('/api/debt-ledger?counterparty=Ана'));
  assert.ok(all.data.length >= 2);
  assert.ok(all.data.every((e) => e.counterparty === 'Ана'));
  assert.equal((await call('/api/debt-ledger?status=huuramch')).status, 400);
});

// ===================== ХОЛБОЛТ / SETTLE / БУЦААЛТ =====================

test('★ Холбох → зарлага хасагдана; settle+орлого холбох → орлого ч хасагдана', async () => {
  const u = db.createUser('reimb@t.st', hashPasswordSync('pw'), 'user').id;
  const jwt = createJwt({ secret: JWT_SECRET, accessTtl: '1h' });
  const tk = jwt.signAccess(db.getUserById(u));

  const expense = seedTxn(u, { amount: 600000, category: 'Тээвэр', date: '2026-05-05' });
  const income = seedTxn(u, { amount: 600000, type: 'income', category: 'Орлого', date: '2026-05-20' });

  // Зээлүүлсэн бичлэг + эх гүйлгээ холбох
  const created = await j(await call('/api/debt-ledger', 'POST', {
    counterparty: 'Найз', direction: 'i_lent', amount: 600000, currency: 'MNT',
    entryDate: '2026-05-05', linkedTransactionId: expense,
  }, bearer(tk)));
  assert.equal(created.entry.linkedTransactionId, expense);
  assert.equal(db.getById(u, expense).excluded_from_budget, 1);
  assert.equal(db.getById(u, expense).manually_edited, 1);

  // Зарлага шинжилгээнээс гарсан
  let cat = await j(await call('/api/analytics/by-category?month=2026-05', 'GET', null, bearer(tk)));
  assert.equal(cat.totalExpense, 0);
  assert.equal(cat.totalIncome, 600000); // орлого хараахан хасагдаагүй

  // Хаах + буцаасан орлогыг холбох
  const settled = await j(await call(`/api/debt-ledger/${created.entry.id}`, 'PATCH', {
    status: 'settled', settledTransactionId: income,
  }, bearer(tk)));
  assert.equal(settled.entry.status, 'settled');
  assert.ok(settled.entry.settledAt);
  assert.equal(db.getById(u, income).excluded_from_budget, 1);

  // Орлого ч шинжилгээнээс гарсан → сарын орлого хөөрөгдөхгүй
  cat = await j(await call('/api/analytics/by-category?month=2026-05', 'GET', null, bearer(tk)));
  assert.equal(cat.totalIncome, 0);
  // Хаагдсан тул үлдэгдэлд өр үлдэхгүй
  assert.equal((await j(await call('/api/debt-ledger/balances', 'GET', null, bearer(tk)))).data.length, 0);
});

test('Дахин нээх (re-open) → хаалтын гүйлгээний хасалт буцна', async () => {
  const u = db.createUser('reopen@t.st', hashPasswordSync('pw'), 'user').id;
  const jwt = createJwt({ secret: JWT_SECRET, accessTtl: '1h' });
  const tk = jwt.signAccess(db.getUserById(u));
  const income = seedTxn(u, { amount: 900, type: 'income', date: '2026-04-10' });
  const e = await j(await call('/api/debt-ledger', 'POST', {
    counterparty: 'Дорж', direction: 'i_lent', amount: 900, entryDate: '2026-04-01',
  }, bearer(tk)));
  await call(`/api/debt-ledger/${e.entry.id}`, 'PATCH', { status: 'settled', settledTransactionId: income }, bearer(tk));
  assert.equal(db.getById(u, income).excluded_from_budget, 1);

  const re = await j(await call(`/api/debt-ledger/${e.entry.id}`, 'PATCH', { status: 'open' }, bearer(tk)));
  assert.equal(re.entry.status, 'open');
  assert.equal(re.entry.settledTransactionId, null);
  assert.equal(db.getById(u, income).excluded_from_budget, 0, 're-open үед хасалт буцах ёстой');
});

test('★ ХАМГААЛАЛТ: өөр бичлэг лавлаж байвал хасалт БУЦААХГҮЙ', async () => {
  const u = db.createUser('guard@t.st', hashPasswordSync('pw'), 'user').id;
  const jwt = createJwt({ secret: JWT_SECRET, accessTtl: '1h' });
  const tk = jwt.signAccess(db.getUserById(u));
  const shared = seedTxn(u, { amount: 100000, category: 'Гадуур хооллолт', date: '2026-03-03' });

  // Нэг зарлагыг ХОЁР хүнд хуваасан (хоёр бичлэг ижил гүйлгээг лавлана)
  const e1 = await j(await call('/api/debt-ledger', 'POST', {
    counterparty: 'А', direction: 'i_lent', amount: 50000, entryDate: '2026-03-03', linkedTransactionId: shared,
  }, bearer(tk)));
  const e2 = await j(await call('/api/debt-ledger', 'POST', {
    counterparty: 'Б', direction: 'i_lent', amount: 50000, entryDate: '2026-03-03', linkedTransactionId: shared,
  }, bearer(tk)));
  // 50k + 50k = 100k = бүтэн дүн → БҮРЭН хасагдсан (015-ын тугтай ижил үр дүн)
  assert.equal(db.getById(u, shared).excluded_amount, 100000);
  assert.equal(db.getById(u, shared).excluded_from_budget, 1);

  // 016: нэгийг устгахад ЗӨВХӨН түүний 50k чөлөөлөгдөнө — нөгөөгийнх ҮЛДЭНЭ
  // (015-д бүтэн 100k хасагдсан хэвээр үлддэг байсан нь ХУВААСАН зардалд буруу)
  await call(`/api/debt-ledger/${e1.entry.id}`, 'DELETE', null, bearer(tk));
  const afterOne = db.getById(u, shared);
  assert.equal(afterOne.excluded_amount, 50000, 'нөгөө бичлэгийн хувь хэмжээ үлдэх ёстой (0 ч биш, 100k ч биш)');
  assert.equal(afterOne.excluded_from_budget, 0, 'бүрэн хасагдаагүй болсон');

  // Сүүлчийнхийг устгахад Л хасалт бүрэн буцна
  await call(`/api/debt-ledger/${e2.entry.id}`, 'DELETE', null, bearer(tk));
  assert.equal(db.getById(u, shared).excluded_amount, 0, 'сүүлийн лавлагаа арилахад хасалт буцах ёстой');
  assert.equal(db.getById(u, shared).excluded_from_budget, 0);
});

test('Холбоос солих: хуучин гүйлгээ сулрч, шинэ нь хасагдана', async () => {
  const u = db.createUser('swap@t.st', hashPasswordSync('pw'), 'user').id;
  const jwt = createJwt({ secret: JWT_SECRET, accessTtl: '1h' });
  const tk = jwt.signAccess(db.getUserById(u));
  const t1 = seedTxn(u, { amount: 100, date: '2026-02-01' });
  const t2 = seedTxn(u, { amount: 200, date: '2026-02-02' });
  const e = await j(await call('/api/debt-ledger', 'POST', {
    counterparty: 'В', direction: 'i_lent', amount: 100, entryDate: '2026-02-01', linkedTransactionId: t1,
  }, bearer(tk)));
  assert.equal(db.getById(u, t1).excluded_amount, 100);
  assert.equal(db.getById(u, t1).excluded_from_budget, 1); // 100 = t1-ийн бүтэн дүн

  await call(`/api/debt-ledger/${e.entry.id}`, 'PATCH', { linkedTransactionId: t2 }, bearer(tk));
  assert.equal(db.getById(u, t1).excluded_amount, 0, 'хуучин холбоос сулрах ёстой');
  assert.equal(db.getById(u, t1).excluded_from_budget, 0);
  // 016: 100₮-ийн бичлэг 200₮-ийн гүйлгээнээс ЗӨВХӨН 100₮-г хасна (бүхлээр нь БИШ)
  assert.equal(db.getById(u, t2).excluded_amount, 100, 'шинэ холбоосоос бичлэгийн хувь хэмжээ хасагдана');
  assert.equal(db.getById(u, t2).excluded_from_budget, 0, 'хэсэгчилсэн тул БҮРЭН хасагдсан гэж тэмдэглэгдэхгүй');

  // Холбоосыг бүрэн салгах
  await call(`/api/debt-ledger/${e.entry.id}`, 'PATCH', { linkedTransactionId: null }, bearer(tk));
  assert.equal(db.getById(u, t2).excluded_amount, 0);
  assert.equal(db.getById(u, t2).excluded_from_budget, 0);
});

test('Өртэй гүйлгээний хасалтыг exclusion endpoint-оор шууд буцаах → 409', async () => {
  const u = db.createUser('conflict@t.st', hashPasswordSync('pw'), 'user').id;
  const jwt = createJwt({ secret: JWT_SECRET, accessTtl: '1h' });
  const tk = jwt.signAccess(db.getUserById(u));
  const t = seedTxn(u, { amount: 400, date: '2026-01-05' });
  await call('/api/debt-ledger', 'POST', {
    counterparty: 'Г', direction: 'i_lent', amount: 400, entryDate: '2026-01-05', linkedTransactionId: t,
  }, bearer(tk));
  const r = await call(`/api/transactions/${t}/exclusion`, 'PATCH', { excluded: false }, bearer(tk));
  assert.equal(r.status, 409);
  assert.equal(db.getById(u, t).excluded_from_budget, 1); // хэвээр
});

// ===================== PER-USER ISOLATION =====================

test('★ Isolation: B хэрэглэгч A-гийн өрийн бичлэгийг ХАРАХ/ЗАСАХ боломжгүй', async () => {
  const created = await j(await call('/api/debt-ledger', 'POST', {
    counterparty: 'Нууц', direction: 'i_lent', amount: 12345, entryDate: '2026-06-01',
  }, bearer(tokenA)));
  const idA = created.entry.id;

  // B-гийн жагсаалтад A-гийн бичлэг БАЙХГҮЙ
  const listB = await j(await call('/api/debt-ledger', 'GET', null, bearer(tokenB)));
  assert.ok(!listB.data.some((e) => e.id === idA));
  assert.ok(!listB.data.some((e) => e.counterparty === 'Нууц'));

  // B-гийн balances-д ч алга
  const balB = await j(await call('/api/debt-ledger/balances', 'GET', null, bearer(tokenB)));
  assert.ok(!balB.data.some((b) => b.counterparty === 'Нууц'));

  // B засах/устгах гэвэл 404
  assert.equal((await call(`/api/debt-ledger/${idA}`, 'PATCH', { amount: 1 }, bearer(tokenB))).status, 404);
  assert.equal((await call(`/api/debt-ledger/${idA}`, 'DELETE', null, bearer(tokenB))).status, 404);

  // A-гийнх хэвээр
  const stillA = await j(await call(`/api/debt-ledger?counterparty=Нууц`, 'GET', null, bearer(tokenA)));
  assert.equal(stillA.data[0].amount, 12345);
});

test('Isolation: өөр хэрэглэгчийн гүйлгээ рүү холбохыг татгалзана (400)', async () => {
  const txnA = seedTxn(OWNER, { amount: 999 });
  const r = await call('/api/debt-ledger', 'POST', {
    counterparty: 'Хакер', direction: 'i_lent', amount: 999, entryDate: '2026-06-01', linkedTransactionId: txnA,
  }, bearer(tokenB));
  assert.equal(r.status, 400);
  assert.equal(db.getById(OWNER, txnA).excluded_from_budget, 0, 'бусдын гүйлгээ хөндөгдөх ЁСГҮЙ');
});

test('DELETE/PATCH байхгүй id → 404, буруу id → 400', async () => {
  assert.equal((await call('/api/debt-ledger/999999', 'DELETE')).status, 404);
  assert.equal((await call('/api/debt-ledger/abc', 'PATCH', { amount: 5 })).status, 400);
  assert.equal((await call('/api/debt-ledger/1', 'PATCH', {})).status, 400); // хоосон patch
});
