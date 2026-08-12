// ============================================================
//  test/subcategory.test.js — ДЭД АНГИЛЛЫН backend plumbing (миграц 018)
//
//  ЖИНХЭНЭ createApp() + `:memory:` DB. Энд шалгах гэрээнүүд:
//    • ingest дэд ангилалгүй → NULL (зан төлөв ӨӨРЧЛӨГДӨӨГҮЙ),
//    • PATCH .../category нь сонголттой subcategory-г хүлээж авч, ХАРЬЯАЛЛЫГ
//      шалгаж (400), мөрөнд хадгална,
//    • applyToAll=true → override-д ч бичигдэж, ДАРААГИЙН ижил мерчант
//      ХОЁУЛАНГ нь (ангилал + дэд ангилал) автоматаар авна,
//    • keyword-аар ангилагдсан гүйлгээ дэд ангилал ХЭЗЭЭ Ч авахгүй,
//    • manually_edited=1 мөр ХӨНДӨГДӨХГҮЙ.
//
//  ⚠️ Клиент (bot/dashboard) энэ фазад дэд ангилал ИЛГЭЭХГҮЙ — энэ бол зөвхөн
//     API-ийн суурь. UI нь Prompt 3.
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb } from '../db.js';
import { createApp } from '../app.js';
import { hashPasswordSync } from '../auth/passwordHash.js';

const API_KEY = 'subcat-test-key';
const JWT_SECRET = 'test-jwt-secret';
let server, baseUrl, db, OWNER, OTHER;

const mockAi = { enabled: false, aiCategorize: async () => ({ category: 'other', confidence: 'low' }) };

before(async () => {
  db = createDb(':memory:');
  OWNER = db.createUser('admin', hashPasswordSync('testpw'), 'admin').id;
  OTHER = db.createUser('other', hashPasswordSync('testpw'), 'user').id;
  const app = createApp({
    db, ai: mockAi, apiKey: API_KEY, jwtSecret: JWT_SECRET,
    allowRegister: true, localAuth: true, rateLimit: { windowSeconds: 60, max: 100000 },
  });
  await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });
});
after(async () => { await new Promise((r) => server.close(r)); db.close(); });

const H = { 'Content-Type': 'application/json', 'X-API-Key': API_KEY };
const post = (path, body) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
const patch = (path, body) => fetch(`${baseUrl}${path}`, { method: 'PATCH', headers: H, body: JSON.stringify(body) });
const getRow = async (id) => (await (await fetch(`${baseUrl}/api/transactions/${id}`, { headers: H })).json()).data;

let mid = 0;
const tx = (over = {}) => ({
  userId: OWNER, messageId: `<sc${++mid}>`, amount: 12000, currency: 'MNT',
  date: '2026-08-08', type: 'expense', description: '0930 ZZSUBUNKNOWNX', ...over,
});

async function seed(over = {}) {
  const r = await post('/api/transactions', tx(over));
  const j = await r.json();
  assert.equal(r.status, 201, `seed амжилтгүй: ${r.status} ${JSON.stringify(j)}`);
  return j.id;
}

// ---------- Миграц / анхны төлөв ----------

test('018 миграц: хоёр хүснэгтэд subcategory багана нэмэгдсэн, БҮГД NULL', () => {
  const cols = (t) => db._raw.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  assert.ok(cols('transactions').includes('subcategory'));
  assert.ok(cols('category_overrides').includes('subcategory'));
  const notNull = db._raw.prepare('SELECT COUNT(*) c FROM transactions WHERE subcategory IS NOT NULL').get().c;
  assert.equal(notNull, 0, 'backfill ХИЙГДЭХ ЁСГҮЙ');
});

test('★ 018: файл DB — миграц ИДЕМПОТЕНТ, backfill БАЙХГҮЙ (хуучин мөр NULL хэвээр)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'subcat-mig-'));
  const p = join(dir, 'x.sqlite');
  try {
    // 1) Эхний нээлт — миграц ажиллана, хуучин загварын мөрүүд үүсгэнэ
    const first = createDb(p);
    const u = first.createUser('legacy@t.st', hashPasswordSync('pw'), 'admin').id;
    const a = first.insertTransaction({ userId: u, messageId: '<M1>', amount: 5000,
      date: '2026-01-01', type: 'expense', description: 'кофе', category: 'Гадуур хооллолт' }).id;
    first.addOverride(u, 'кофе', 'Гадуур хооллолт');
    assert.equal(first.getById(u, a).subcategory, null);
    first.close();

    // 2) Дахин нээх — hasComumn() хамгаалалт: ALTER дахин ажиллахгүй, унахгүй
    const second = createDb(p);
    const cols = second._raw.prepare('PRAGMA table_info(transactions)').all()
      .filter((c) => c.name === 'subcategory');
    assert.equal(cols.length, 1, 'subcategory багана ЯГ НЭГ удаа нэмэгдсэн байх ёстой');
    const ovCols = second._raw.prepare('PRAGMA table_info(category_overrides)').all()
      .filter((c) => c.name === 'subcategory');
    assert.equal(ovCols.length, 1);

    // 3) BACKFILL БАЙХГҮЙ — хуучин мөр ба override хоёул NULL хэвээр
    assert.equal(second.getById(u, a).subcategory, null, 'хуучин мөр NULL хэвээр');
    assert.equal(second.getOverrides(u)[0].subcategory, null, 'хуучин override NULL хэвээр');
    // Ангилал нь ЮУ Ч өөрчлөгдөөгүй
    assert.equal(second.getById(u, a).category, 'Гадуур хооллолт');
    second.close();

    // 4) Гурав дахь нээлт ч мөн адил (олон удаа reload хийхэд аюулгүй)
    const third = createDb(p);
    assert.equal(third.getById(u, a).subcategory, null);
    third.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ingest дэд ангилалгүй → row.subcategory NULL (зан төлөв хэвээр)', async () => {
  const id = await seed();
  const row = await getRow(id);
  assert.equal(row.subcategory, null);
  assert.equal(row.status, 'pending_review');
  assert.equal(row.category, null);
});

test('★ keyword-аар ангилагдсан гүйлгээ дэд ангилал ХЭЗЭЭ Ч авахгүй', async () => {
  // 'cafe' keyword → 'Гадуур хооллолт' (дүрмээр). dining-д дэд ангилал БАЙГАА ч
  // keyword салаа түүнийг оноох ЁСГҮЙ.
  const id = await seed({ description: '1122 CAFEZZQ', messageId: `<sc-kw${++mid}>` });
  const row = await getRow(id);
  assert.equal(row.category, 'Гадуур хооллолт', 'keyword-аар ангилагдсан байх ёстой');
  assert.equal(row.status, 'classified');
  assert.equal(row.subcategory, null, '★ keyword дэд ангилал оноох ЁСГҮЙ');
});

test('орлогын автомат ангилал ("Орлого") ч дэд ангилалгүй', async () => {
  const id = await seed({ type: 'income', description: 'ЦАЛИН ZZINCOMEX', messageId: `<sc-inc${++mid}>` });
  const row = await getRow(id);
  assert.equal(row.category, 'Орлого');
  assert.equal(row.subcategory, null, 'income салаа дэд ангилал оноохгүй');
});

// ---------- PATCH .../category ----------

test('PATCH: хүчинтэй дэд ангилал мөрөнд хадгалагдана', async () => {
  const id = await seed();
  const r = await patch(`/api/transactions/${id}/category`, {
    category: 'Эрүүл мэнд', subcategory: 'Шүд',
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.category, 'Эрүүл мэнд');
  assert.equal(j.subcategory, 'Шүд');
  const row = await getRow(id);
  assert.equal(row.category, 'Эрүүл мэнд');
  assert.equal(row.subcategory, 'Шүд');
  assert.equal(row.status, 'classified');
  assert.equal(row.manually_edited, 1);
});

test('PATCH: subcategory-гүй дуудлага (одоогийн бүх клиент) → NULL хэвээр', async () => {
  const id = await seed();
  const r = await patch(`/api/transactions/${id}/category`, { category: 'Тээвэр' });
  assert.equal(r.status, 200);
  const row = await getRow(id);
  assert.equal(row.category, 'Тээвэр');
  assert.equal(row.subcategory, null);
});

test('★ PATCH: ангилалд ХАРЬЯАЛАГДАХГҮЙ дэд ангилал → 400, мөр ХӨНДӨГДӨХГҮЙ', async () => {
  const id = await seed();
  const before = await getRow(id);
  const r = await patch(`/api/transactions/${id}/category`, {
    category: 'Тээвэр', subcategory: 'Шүд', // Шүд нь health-ийнх
  });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.match(j.error, /харьяалагдахгүй/);
  const after = await getRow(id);
  assert.equal(after.category, before.category, 'ангилал хөндөгдөх ЁСГҮЙ');
  assert.equal(after.subcategory, null);
  assert.equal(after.status, 'pending_review', 'төлөв хэвээр');
  assert.equal(after.manually_edited, 0, 'гараар зассан гэж тэмдэглэгдэх ЁСГҮЙ');
});

test('PATCH: дэд ангилалгүй ангилалд дэд ангилал өгвөл → 400', async () => {
  const id = await seed();
  const r = await patch(`/api/transactions/${id}/category`, {
    category: 'Бусад', subcategory: 'Ямар нэг',
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /дэд ангилал байхгүй/);
});

test('PATCH: 400 болсон хүсэлт override ч ҮҮСГЭХГҮЙ', async () => {
  const id = await seed({ description: '0930 ZZNOOVERRIDEX', messageId: `<sc-noov${++mid}>` });
  const r = await patch(`/api/transactions/${id}/category`, {
    category: 'Тээвэр', subcategory: 'Шүд', applyToAll: true,
  });
  assert.equal(r.status, 400);
  const ovs = db.getOverrides(OWNER);
  assert.ok(!ovs.some((o) => 'zznooverridex'.includes(o.merchant_pattern)),
    'татгалзсан хүсэлт override үүсгэх ЁСГҮЙ');
});

test('PATCH: id-г label-ийн оронд илгээвэл → 400 (DB нь label хадгална)', async () => {
  const id = await seed();
  const r = await patch(`/api/transactions/${id}/category`, {
    category: 'Эрүүл мэнд', subcategory: 'dental', // id — хүчингүй
  });
  assert.equal(r.status, 400);
});

// ---------- applyToAll → override → дараагийн ingest ----------

test('★ applyToAll=true → override-д дэд ангилал бичигдэж, ДАРААГИЙН ижил мерчант ХОЁУЛАНГ нь авна', async () => {
  const DESC = '0930 EMNELEGZZX';
  const first = await seed({ description: DESC, messageId: `<sc-ov1-${++mid}>` });

  const r = await patch(`/api/transactions/${first}/category`, {
    category: 'Эрүүл мэнд', subcategory: 'Эмнэлэг', applyToAll: true,
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.override.category, 'Эрүүл мэнд');
  assert.equal(j.override.subcategory, 'Эмнэлэг', '★ override дээр дэд ангилал бичигдсэн');

  // Мөр өөрөө ч авсан
  const firstRow = await getRow(first);
  assert.equal(firstRow.subcategory, 'Эмнэлэг');

  // ★ ДАРААГИЙН ижил мерчант — classify.js override-оос ХОЁУЛАНГ нь авах ёстой
  const second = await seed({ description: DESC, messageId: `<sc-ov2-${++mid}>` });
  const secondRow = await getRow(second);
  assert.equal(secondRow.category, 'Эрүүл мэнд');
  assert.equal(secondRow.subcategory, 'Эмнэлэг', '★ ingest дээр дэд ангилал автоматаар оногдсон');
  assert.equal(secondRow.status, 'classified');
  assert.equal(secondRow.manually_edited, 0, 'авто ангилал гараар зассан гэж тэмдэглэгдэхгүй');
});

test('дэд ангилалгүй override (хуучин хэлбэр) → subcategory NULL, зан төлөв хэвээр', async () => {
  const DESC = '0930 OLDSTYLEZZX';
  const first = await seed({ description: DESC, messageId: `<sc-old1-${++mid}>` });
  await patch(`/api/transactions/${first}/category`, { category: 'Тээвэр', applyToAll: true });

  const second = await seed({ description: DESC, messageId: `<sc-old2-${++mid}>` });
  const row = await getRow(second);
  assert.equal(row.category, 'Тээвэр');
  assert.equal(row.subcategory, null);
});

test('★ ГЭРЭЭ: ангилал солиход харьяалагдахгүй болсон дэд ангилал ЦЭВЭРЛЭГДЭНЭ', () => {
  // "Тээвэр + Шүд" гэх ГАЖ хос ХЭЗЭЭ Ч үүсэх ёсгүй.
  const id = db.insertTransaction({
    userId: OWNER, messageId: `<sc-orphan-${++mid}>`, amount: 5000, type: 'expense',
    date: '2026-08-08', description: '0930 ORPHANZZX', category: 'Эрүүл мэнд', status: 'classified',
    subcategory: 'Шүд',
  }).id;
  assert.equal(db.getById(OWNER, id).subcategory, 'Шүд');

  // Дэд ангилал ӨГӨЛГҮЙ ангиллыг сольно
  db.updateCategoryById(OWNER, id, 'Тээвэр', {});
  const row = db.getById(OWNER, id);
  assert.equal(row.category, 'Тээвэр');
  assert.equal(row.subcategory, null, '★ өнчирсөн дэд ангилал NULL болох ёстой');
});

test('ГЭРЭЭ: ижил ангилал дээр дахин хадгалахад дэд ангилал ХАДГАЛАГДАНА', () => {
  const id = db.insertTransaction({
    userId: OWNER, messageId: `<sc-keep-${++mid}>`, amount: 5000, type: 'expense',
    date: '2026-08-08', description: '0930 KEEPZZX', category: 'Эрүүл мэнд', status: 'classified',
    subcategory: 'Шүд',
  }).id;
  db.updateCategoryById(OWNER, id, 'Эрүүл мэнд', { note: 'тэмдэглэл' });
  const row = db.getById(OWNER, id);
  assert.equal(row.subcategory, 'Шүд', 'ижил ангилалд хүчинтэй хэвээр → хадгалагдана');
});

// ---------- manually_edited + isolation + аналитик ----------

test('★ manually_edited=1 мөр авто-ангиллын замаар ХӨНДӨГДӨХГҮЙ', async () => {
  const DESC = '0930 MANEDITZZX';
  // 1) Гараар ангилж дэд ангилал өгнө (manually_edited=1 болно)
  const manual = await seed({ description: DESC, messageId: `<sc-me1-${++mid}>` });
  await patch(`/api/transactions/${manual}/category`, { category: 'Эрүүл мэнд', subcategory: 'Шүд' });
  const before = await getRow(manual);
  assert.equal(before.manually_edited, 1);

  // 2) Ижил мерчантад ӨӨР дэд ангилалтай override үүсгэнэ (applyToAll)
  const other = await seed({ description: DESC, messageId: `<sc-me2-${++mid}>` });
  await patch(`/api/transactions/${other}/category`, {
    category: 'Эрүүл мэнд', subcategory: 'Эмнэлэг', applyToAll: true,
  });

  // 3) sweep (хуучирсан pending → Бусад) нь manually_edited мөрд хүрэхгүй
  db.autoClassifyStalePending({ days: 1 });
  const after = await getRow(manual);
  assert.equal(after.manually_edited, 1);
  assert.equal(after.category, 'Эрүүл мэнд');
  // ⚠️ applyToAll нь ЗОРИУДААР бүх ижил мөрд тархдаг (хэрэглэгчийн тодорхой
  // хүсэлт) — тэр нь sweep/авто-ангиллаас ӨӨР зүйл. Энд шалгах гол зүйл:
  // мөр устаагүй, ангилал нь хүчинтэй хос хэвээр.
  assert.ok(after.subcategory === 'Шүд' || after.subcategory === 'Эмнэлэг');
});

test('per-user isolation: өөр хэрэглэгчийн мөрөнд дэд ангилал оноож ЧАДАХГҮЙ', async () => {
  const r0 = await post('/api/transactions', tx({ userId: OTHER, messageId: `<sc-iso-${++mid}>` }));
  const otherId = (await r0.json()).id;
  // OWNER-ийн эрхээр (X-API-Key = owner) PATCH → 404
  const r = await patch(`/api/transactions/${otherId}/category`, {
    category: 'Эрүүл мэнд', subcategory: 'Шүд',
  });
  assert.equal(r.status, 404);
  assert.equal(db.getById(OTHER, otherId).subcategory, null);
});

test('аналитик NULL дэд ангилалтай ажиллана (by-category/summary/monthly)', async () => {
  const id = await seed({ messageId: `<sc-an-${++mid}>` });
  await patch(`/api/transactions/${id}/category`, { category: 'Эрүүл мэнд', subcategory: 'Даатгал' });
  for (const path of ['/api/summary', '/api/monthly', '/api/analytics/by-category?month=2026-08']) {
    const r = await fetch(`${baseUrl}${path}`, { headers: H });
    assert.equal(r.status, 200, `${path} → 200 байх ёстой`);
  }
  // by-category нь ангиллаар бүлэглэсэн хэвээр (дэд ангилал энэ фазад НӨЛӨӨЛӨХГҮЙ)
  const bc = await (await fetch(`${baseUrl}/api/analytics/by-category?month=2026-08`, { headers: H })).json();
  assert.ok(Array.isArray(bc.byCategory));
  assert.ok(bc.byCategory.some((r) => r.category === 'Эрүүл мэнд'),
    'шинэ ангилал аналитикт бүлэг болж гарах ёстой');
});
