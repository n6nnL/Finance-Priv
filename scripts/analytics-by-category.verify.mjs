// Verification for GET /api/analytics/by-category?month=YYYY-MM
import assert from 'node:assert';
import { createDb } from '../api/db.js';
import { createApp } from '../api/app.js';
import { createAi } from '../api/ai.js';
import { hashPasswordSync } from '../api/auth/passwordHash.js';

const API_KEY = 'analytics-key';
const db = createDb(':memory:', {
  seed: { email: 'owner@test.co', passwordHash: hashPasswordSync('x'), role: 'admin' },
});
const app = createApp({ db, ai: createAi({ enabled: false }), apiKey: API_KEY, jwtSecret: API_KEY });
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const H = { 'Content-Type': 'application/json', 'X-API-Key': API_KEY };
let mid = 0;
const post = (b) => fetch(base + '/api/transactions', { method: 'POST', headers: H, body: JSON.stringify({ messageId: `<a-${mid++}@t>`, currency: 'MNT', ...b }) }).then(r => r.json());
const byCat = async (month) => { const r = await fetch(base + `/api/analytics/by-category?month=${month}`, { headers: H }); return { status: r.status, json: await r.json() }; };

let pass = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };

try {
  // --- Seed: June expenses (incl boundary + unclassified) + income, May (incl boundary) ---
  await post({ amount: 5400, type: 'expense', date: '2026-06-10', description: '2266 CU-A', isPos: true });   // Хүнсний
  await post({ amount: 9000, type: 'expense', date: '2026-06-15', description: '2266 CU-B', isPos: true });   // Хүнсний
  await post({ amount: 3000, type: 'expense', date: '2026-06-12', description: 'TAXI ZX' });                  // Тээвэр
  await post({ amount: 2000, type: 'expense', date: '2026-06-01', description: 'TAXI BOUNDARY' });            // Тээвэр (June эхэн)
  await post({ amount: 2500, type: 'expense', date: '2026-06-20', description: 'ZXQMYSTERYBOM', isPos: true });// Ангилаагүй (pending)
  await post({ amount: 12400, type: 'income', date: '2026-06-05', description: 'SALARY' });                   // Орлого (pie-д орохгүй)
  await post({ amount: 1000, type: 'expense', date: '2026-05-31', description: 'TAXI MAYEND' });              // May (хил)
  await post({ amount: 800,  type: 'expense', date: '2026-05-20', description: '2266 CU-MAY', isPos: true }); // May

  // ---------- [1] Correctness + income excluded + manual SQL cross-check ----------
  console.log('\n[1] Per-category totals/counts + income excluded');
  let r = await byCat('2026-06');
  assert.strictEqual(r.status, 200);
  const cats = r.json.byCategory;
  const find = (name) => cats.find(c => c.category === name);
  assert.deepStrictEqual(
    { total: find('Хүнсний зүйл').total, count: find('Хүнсний зүйл').count }, { total: 14400, count: 2 });
  assert.deepStrictEqual(
    { total: find('Тээвэр').total, count: find('Тээвэр').count }, { total: 5000, count: 2 });
  ok('Хүнсний зүйл=14400/2, Тээвэр=5000/2 (06-01 хил June-д орсон)');
  assert.ok(!cats.some(c => c.category === 'Орлого'), 'Орлого pie-д БАЙХ ЁСГҮЙ');
  assert.strictEqual(r.json.totalIncome, 12400, 'totalIncome тусдаа');
  assert.strictEqual(r.json.totalExpense, 21900, 'totalExpense нь орлогогүй');
  ok('Орлого pie-аас хасагдсан; totalIncome=12400 тусдаа; totalExpense=21900');
  // Гар SQL баталгаа
  const sqlHunsni = db._raw.prepare(
    "SELECT COALESCE(SUM(amount),0) t FROM transactions WHERE type='expense' AND category='Хүнсний зүйл' AND substr(txn_date,1,7)='2026-06'").get().t;
  assert.strictEqual(Number(sqlHunsni), 14400);
  ok(`Гар SQL sum (Хүнсний зүйл, 2026-06) = ${sqlHunsni} — endpoint-той таарав`);

  // ---------- [2] Total reconciles (slices == totalExpense) ----------
  console.log('\n[2] Зүсэмүүдийн нийлбэр = totalExpense (тэнцэл)');
  const sumSlices = cats.reduce((s, c) => s + c.total, 0);
  assert.strictEqual(sumSlices, r.json.totalExpense, 'нийлбэр тэнцэхгүй');
  ok(`Зүсэм нийлбэр (${sumSlices}) == totalExpense (${r.json.totalExpense})`);

  // ---------- [3] Unclassified → 'Ангилаагүй' зүсэм ----------
  console.log('\n[3] pending/unclassified → "Ангилаагүй" зүсэм');
  assert.deepStrictEqual(
    { total: find('Ангилаагүй').total, count: find('Ангилаагүй').count }, { total: 2500, count: 1 });
  ok('Ангилаагүй=2500/1 (чимээгүй алгасаагүй — нийт тэнцэнэ)');

  // ---------- [4] Month boundary (txn_date-аар) ----------
  console.log('\n[4] Сарын хил (txn_date)');
  const may = await byCat('2026-05');
  assert.strictEqual(may.json.totalExpense, 1800, 'May = 1000(05-31)+800');
  assert.ok(may.json.byCategory.find(c => c.category === 'Тээвэр').total === 1000, '05-31 нь May-д');
  ok('05-31 → May, 06-01 → June (txn_date-аар зөв ангилагдсан)');

  // ---------- [5] Empty month + validation ----------
  console.log('\n[5] Хоосон сар + валидаци');
  const empty = await byCat('2026-01');
  assert.deepStrictEqual({ b: empty.json.byCategory, e: empty.json.totalExpense, i: empty.json.totalIncome }, { b: [], e: 0, i: 0 });
  ok('Хоосон сар → byCategory:[], totalExpense:0 (UI найрсаг мессеж харуулна)');
  assert.strictEqual((await byCat('2026-13')).status, 400);
  assert.strictEqual((await byCat('badmonth')).status, 400);
  assert.strictEqual((await fetch(base + '/api/analytics/by-category', { headers: H })).status, 400);
  ok('Буруу/дутуу month → 400');

  console.log(`\n🎉 Бүх шалгалт PASS (${pass} баталгаа)\n`);
} catch (e) {
  console.error('\n❌ ШАЛГАЛТ УНАЛАА:', e.stack || e.message, '\n');
  process.exitCode = 1;
} finally {
  server.close();
  db.close();
}
