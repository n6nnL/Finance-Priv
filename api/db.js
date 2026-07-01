// ============================================================
//  db.js — node:sqlite холболт + query функцууд (multi-tenant)
//
//  Foundation: бүх хэрэглэгчийн өгөгдөл `user_id`-тэй. Одоо 1 хэрэглэгч ч
//  query бүр user_id-аар шүүгдэнэ → дараа олон хэрэглэгч нэмэхэд schema
//  өөрчлөхгүй, өгөгдөл автоматаар тусгаарлагдана.
//
//  createDb(path, { seed }) — seed = { email, passwordHash, role } байвал
//  users хоосон үед анхны admin-г үүсгэнэ. Хуучин өгөгдлийг seed admin-д
//  хамааруулна.
//
//  Native compile шаардахгүй (node:sqlite). Бүх query parameterized.
// ============================================================

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function normalizeDate(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const dotted = s.match(/^(\d{4})[./](\d{2})[./](\d{2})/);
  if (dotted) return `${dotted[1]}-${dotted[2]}-${dotted[3]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s;
}

/** Мерчантын тайлбарыг таниулах хэв болгох (terminal код хасч, том үсэг) */
export function normalizeMerchant(desc) {
  return String(desc || '').toUpperCase().replace(/^\d{3,4}\s+/, '').replace(/\s+/g, ' ').trim();
}

/**
 * Хэрэглэгчийн тохиргооны DEFAULT.
 *
 *  ⚠️ ЦАЛИН (salaryAmount)-д DEFAULT БАЙХГҮЙ (null) — хэрэглэгч ЗААВАЛ оруулна.
 *  Код дотор хуурамч цалин/төсвийн дүн ХЭЗЭЭ Ч бичигдэхгүй (public repo). Subscription
 *  seed (Netflix/Claude) болон ангиллын нэр нь зөвхөн хэрэглэгчийн засаж болох эхлэл;
 *  бодит дүн нь DB-д, хэрэглэгчийнх.
 */
export const DEFAULT_SETTINGS = {
  salaryAmount: null, // ЗААВАЛ оруулна — default үгүй
  paydayDay: 15,
  usdMnt: 3578,
  subscriptions: [
    { name: 'Netflix', day: 7, amountUsd: 3.99 },
    { name: 'Claude', day: 25, amountUsd: 20 },
  ],
  categoryAllocations: [
    { category: 'Хадгаламж', amountMnt: 0 },
    { category: 'Хүнсний зүйл', amountMnt: 0 },
    { category: 'Гадуур хооллолт', amountMnt: 0 },
    { category: 'Тээвэр', amountMnt: 0 },
  ],
};

/**
 * Real-time tracker-ийн %-хуваарилалтын DEFAULT (шинэ хэрэглэгчид seed).
 * Хувиар удирдана (хэрэглэгчийн шаардлага). Нийлбэр 100% давж БОЛНО.
 */
export const DEFAULT_ALLOC_PERCENTS = [
  { category: 'Хадгаламж', percent: 17 },
  { category: 'Хүнсний зүйл', percent: 13 },
  { category: 'Гадуур хооллолт', percent: 8 },
  { category: 'Тээвэр', percent: 5 },
];

export function createDb(dbPath, opts = {}) {
  if (dbPath && dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath || ':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');

  function hasColumn(table, col) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  }

  // --- Миграц (идемпотент) ---
  function migrate() {
    // 001-004: үндсэн transactions + dashboard/AI/note баганууд (өмнөх)
    db.exec(readFileSync(join(__dirname, 'migrations', '001_init.sqlite.sql'), 'utf8'));
    for (const [t, c, def] of [
      ['transactions', 'status', "ALTER TABLE transactions ADD COLUMN status TEXT NOT NULL DEFAULT 'classified'"],
      ['transactions', 'ai_suggested_category', 'ALTER TABLE transactions ADD COLUMN ai_suggested_category TEXT'],
      ['transactions', 'ai_confidence', 'ALTER TABLE transactions ADD COLUMN ai_confidence TEXT'],
      ['transactions', 'note', 'ALTER TABLE transactions ADD COLUMN note TEXT'],
      ['transactions', 'is_pos', 'ALTER TABLE transactions ADD COLUMN is_pos INTEGER'],
      ['transactions', 'merchant_place', 'ALTER TABLE transactions ADD COLUMN merchant_place TEXT'],
      // Хэрэглэгч гараар баталгаажуулсан мөр — pipeline (reparse/recategorize)
      // үүнийг ХЭЗЭЭ Ч дахин parse/categorize хийхгүй.
      ['transactions', 'manually_edited', 'ALTER TABLE transactions ADD COLUMN manually_edited INTEGER NOT NULL DEFAULT 0'],
    ]) {
      if (!hasColumn(t, c)) db.exec(def);
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_txn_status ON transactions (status)');
    db.exec(`CREATE TABLE IF NOT EXISTS category_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_pattern TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL, friendly_name TEXT, default_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    if (!hasColumn('category_overrides', 'friendly_name')) db.exec('ALTER TABLE category_overrides ADD COLUMN friendly_name TEXT');
    if (!hasColumn('category_overrides', 'default_note')) db.exec('ALTER TABLE category_overrides ADD COLUMN default_note TEXT');

    // 005: AUTH + MULTI-TENANT ----------------------------------------------
    // users хүснэгт (auth foundation; role = эрхийн суурь)
    db.exec(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now')))`);

    // Анхны admin-г seed хийх (users хоосон үед)
    const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    if (userCount === 0 && opts.seed && opts.seed.email && opts.seed.passwordHash) {
      db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?,?,?)')
        .run(opts.seed.email, opts.seed.passwordHash, opts.seed.role || 'admin');
    }
    // Owner = анхны (хамгийн бага id) хэрэглэгч — machine (listener/discord) түүнд хамаарна
    const owner = db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
    const seedUserId = owner ? owner.id : null;

    // transactions.user_id
    if (!hasColumn('transactions', 'user_id')) {
      db.exec('ALTER TABLE transactions ADD COLUMN user_id INTEGER');
      if (seedUserId) db.prepare('UPDATE transactions SET user_id=? WHERE user_id IS NULL').run(seedUserId);
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_txn_user ON transactions (user_id)');

    // category_overrides → user_id + UNIQUE(user_id, merchant_pattern) (multi-tenant)
    if (!hasColumn('category_overrides', 'user_id')) {
      db.exec('BEGIN');
      try {
        db.exec(`CREATE TABLE category_overrides_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
          merchant_pattern TEXT NOT NULL, category TEXT NOT NULL,
          friendly_name TEXT, default_note TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(user_id, merchant_pattern))`);
        if (seedUserId) {
          db.exec(`INSERT INTO category_overrides_new (user_id, merchant_pattern, category, friendly_name, default_note, created_at)
                   SELECT ${seedUserId}, merchant_pattern, category, friendly_name, default_note, created_at FROM category_overrides`);
        }
        db.exec('DROP TABLE category_overrides');
        db.exec('ALTER TABLE category_overrides_new RENAME TO category_overrides');
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    }

    // 006: ТӨСӨВ — хэрэглэгчийн тохиргоо + хувийн event (per-user) -----------
    // user_settings: нэг хэрэглэгчид нэг мөр, JSON (цалин/payday/ханш/subs/alloc).
    db.exec(`CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY,
      data TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    // personal_events: хуанли дээрх хувийн тэмдэглэгээ (нэр/огноо/төсөв).
    db.exec(`CREATE TABLE IF NOT EXISTS personal_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      amount_mnt INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_pevents_user ON personal_events (user_id)');

    // 007: GOOGLE нэвтрэлт + Calendar token (хүний нэвтрэлт Google руу шилжсэн) ----
    // users дээр google_sub/picture багана. password_hash NOT NULL хэвээр — Google
    // хэрэглэгчид хоосон ('') sentinel-тэй (bcrypt compare ХЭЗЭЭ Ч таарахгүй).
    if (!hasColumn('users', 'google_sub')) db.exec('ALTER TABLE users ADD COLUMN google_sub TEXT');
    if (!hasColumn('users', 'picture')) db.exec('ALTER TABLE users ADD COLUMN picture TEXT');
    // google_tokens: Calendar refresh_token (НУУЦ — API хариуд ХЭЗЭЭ Ч буцаахгүй).
    db.exec(`CREATE TABLE IF NOT EXISTS google_tokens (
      user_id INTEGER PRIMARY KEY,
      refresh_token TEXT,
      scope TEXT,
      calendar_connected INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);

    // 008: REAL-TIME TRACKER — %-хуваарилалт (per-user) -----------------------
    // Хувиар удирдана. Composite PK (user_id, category) → per-user тусгаарлалт.
    db.exec(`CREATE TABLE IF NOT EXISTS budget_allocations (
      user_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      percent REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, category))`);
  }
  migrate();

  // ===================== USERS (auth) =====================
  function createUser(email, passwordHash, role = 'user') {
    const res = db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?,?,?)')
      .run(String(email).toLowerCase().trim(), passwordHash, role);
    return getUserById(Number(res.lastInsertRowid));
  }
  function getUserByEmail(email) {
    return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase().trim()) ?? null;
  }
  function getUserById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null;
  }
  function countUsers() {
    return db.prepare('SELECT COUNT(*) c FROM users').get().c;
  }
  /** Owner (анхны admin) id — machine (API key) дуудлага түүнд хамаарна */
  function getOwnerUserId() {
    const r = db.prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1").get();
    return r ? r.id : null;
  }

  // ===================== TRANSACTIONS =====================
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (user_id, message_id, amount, currency, txn_date, description, type, category,
       account_last4, raw, status, ai_suggested_category, ai_confidence, is_pos)
    VALUES
      (@user_id, @message_id, @amount, @currency, @txn_date, @description, @type, @category,
       @account_last4, @raw, @status, @ai_suggested_category, @ai_confidence, @is_pos)`);
  const byIdStmt = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?');
  const byMsgStmt = db.prepare('SELECT * FROM transactions WHERE message_id = ? AND user_id = ?');

  /** Гүйлгээ insert (tx.userId ЗААВАЛ). Идэмпотентность: message_id UNIQUE. */
  function insertTransaction(tx) {
    const row = {
      user_id: tx.userId,
      message_id: tx.messageId,
      amount: tx.amount,
      currency: tx.currency ?? 'MNT',
      txn_date: normalizeDate(tx.date),
      description: tx.description ?? null,
      type: tx.type,
      category: tx.category ?? null,
      account_last4: tx.accountLast4 ?? null,
      raw: tx.raw ?? null,
      status: tx.status ?? 'classified',
      ai_suggested_category: tx.aiSuggestedCategory ?? null,
      ai_confidence: tx.aiConfidence ?? null,
      is_pos: tx.isPos == null ? null : tx.isPos ? 1 : 0,
    };
    const res = insertStmt.run(row);
    if (res.changes > 0) {
      const id = Number(res.lastInsertRowid);
      return { created: true, id, row: byIdStmt.get(id, tx.userId) };
    }
    const existing = byMsgStmt.get(tx.messageId, tx.userId);
    return { created: false, id: existing ? Number(existing.id) : null, row: existing ?? null };
  }

  function getByMessageId(userId, messageId) {
    return byMsgStmt.get(messageId, userId) ?? null;
  }
  function getById(userId, id) {
    return byIdStmt.get(id, userId) ?? null;
  }

  /** Шүүлтийн WHERE — ҮРГЭЛЖ user_id-аар эхэлнэ (tenant isolation) */
  function buildWhere(userId, { from, to, category, type, q, minAmount, maxAmount, status } = {}) {
    const where = ['user_id = ?'];
    const params = [userId];
    if (from) { where.push('txn_date >= ?'); params.push(from); }
    if (to) { where.push('txn_date <= ?'); params.push(to); }
    if (category) {
      const cats = Array.isArray(category) ? category : String(category).split(',').map((s) => s.trim()).filter(Boolean);
      if (cats.length === 1) { where.push('category = ?'); params.push(cats[0]); }
      else if (cats.length > 1) { where.push(`category IN (${cats.map(() => '?').join(',')})`); params.push(...cats); }
    }
    if (type) { where.push('type = ?'); params.push(type); }
    if (q) { where.push('description LIKE ?'); params.push('%' + q + '%'); }
    if (minAmount != null && minAmount !== '') { where.push('amount >= ?'); params.push(Number(minAmount)); }
    if (maxAmount != null && maxAmount !== '') { where.push('amount <= ?'); params.push(Number(maxAmount)); }
    if (status) { where.push('status = ?'); params.push(status); }
    return { whereSql: 'WHERE ' + where.join(' AND '), params };
  }

  function listTransactions(userId, filters = {}) {
    const { whereSql, params } = buildWhere(userId, filters);
    const lim = Math.min(Math.max(Number(filters.limit) || 50, 1), 500);
    const off = Math.max(Number(filters.offset) || 0, 0);
    const rows = db.prepare(`SELECT * FROM transactions ${whereSql} ORDER BY txn_date DESC, id DESC LIMIT ? OFFSET ?`).all(...params, lim, off);
    const total = db.prepare(`SELECT COUNT(*) AS c FROM transactions ${whereSql}`).get(...params).c;
    return { rows: attachOverrideInfo(userId, rows), total: Number(total), limit: lim, offset: off };
  }

  function getSummary(userId, filters = {}) {
    const { whereSql, params } = buildWhere(userId, filters);
    const totals = db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS total_expense,
        COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END),0) AS total_income,
        COUNT(*) AS count FROM transactions ${whereSql}`).get(...params);
    const byCategory = db.prepare(`SELECT category, type, COUNT(*) AS count, COALESCE(SUM(amount),0) AS total
        FROM transactions ${whereSql} GROUP BY category, type ORDER BY total DESC`).all(...params);
    const byPlace = db.prepare(`SELECT merchant_place AS place, COUNT(*) AS count, COALESCE(SUM(amount),0) AS total
        FROM transactions ${whereSql} AND merchant_place IS NOT NULL AND type='expense'
        GROUP BY merchant_place ORDER BY total DESC LIMIT 10`).all(...params);
    return {
      totalExpense: Number(totals.total_expense),
      totalIncome: Number(totals.total_income),
      count: Number(totals.count),
      byCategory: byCategory.map((r) => ({ category: r.category, type: r.type, count: Number(r.count), total: Number(r.total) })),
      byPlace: byPlace.map((r) => ({ place: r.place, count: Number(r.count), total: Number(r.total) })),
    };
  }

  /** Сараар орлого/зарлага (Шинжилгээ хэсэгт) */
  function getMonthly(userId, { months = 12 } = {}) {
    const rows = db.prepare(`
      SELECT substr(txn_date,1,7) AS ym,
             COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS expense,
             COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END),0) AS income,
             COUNT(*) AS count
      FROM transactions WHERE user_id = ? AND txn_date IS NOT NULL
      GROUP BY ym ORDER BY ym DESC LIMIT ?`).all(userId, Math.min(Math.max(Number(months) || 12, 1), 60));
    return rows.reverse().map((r) => ({ month: r.ym, expense: Number(r.expense), income: Number(r.income), count: Number(r.count) }));
  }

  /**
   * Сонгосон сарын ангиллын задаргаа (зөвхөн ЗАРЛАГА; орлогыг pie-д оруулахгүй).
   * Сар нь txn_date-аар тодорхойлогдоно (банкны имэйлийн ӨДРИЙН утга — UB
   * орон нутгийн огноо, цагийн нарийвчлалгүй тул midnight-ийн tz хямрал үүсэхгүй).
   * Ангилаагүй / pending_review → нэгтгэж 'Ангилаагүй' зүсэм болгоно (нийт тэнцэнэ).
   * @returns {{month, byCategory:{category,total,count}[], totalExpense, totalIncome}|null}
   */
  function getByCategory(userId, month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) return null;
    const m = String(month);
    const byCategory = db.prepare(`
      SELECT CASE WHEN category IS NULL OR status='pending_review'
                  THEN 'Ангилаагүй' ELSE category END AS category,
             COUNT(*) AS count, COALESCE(SUM(amount),0) AS total
      FROM transactions
      WHERE user_id=? AND type='expense' AND txn_date IS NOT NULL
            AND substr(txn_date,1,7)=?
      GROUP BY 1 ORDER BY total DESC`).all(userId, m)
      .map((r) => ({ category: r.category, total: Number(r.total), count: Number(r.count) }));
    const exp = db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM transactions
      WHERE user_id=? AND type='expense' AND txn_date IS NOT NULL AND substr(txn_date,1,7)=?`).get(userId, m).t;
    const inc = db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM transactions
      WHERE user_id=? AND type='income' AND txn_date IS NOT NULL AND substr(txn_date,1,7)=?`).get(userId, m).t;
    return { month: m, byCategory, totalExpense: Number(exp), totalIncome: Number(inc) };
  }

  /**
   * Циклийн зарлага ангиллаар (real-time tracker). READ-ONLY.
   *  Хил: [startYmd inclusive, endYmd exclusive) — txn_date нь 'YYYY-MM-DD' тул
   *  string харьцуулалт зөв (давхцал/алдалтгүй). Зөвхөн ЗАРЛАГА (type='expense').
   *  Ангилаагүй / pending_review → тусдаа `unclassified` (далдлахгүй; нийлбэр тэнцэнэ).
   *  Орлогыг (income) тусад нь `actualIncome`-оор буцаана (зарлагад холихгүй).
   * @returns {{ byCategory:{category,spent}[], unclassified:number, totalSpend:number, actualIncome:number }}
   */
  function getCycleSpend(userId, startYmd, endYmd) {
    const rows = db.prepare(`
      SELECT CASE WHEN category IS NULL OR status='pending_review' THEN NULL ELSE category END AS cat,
             COALESCE(SUM(amount),0) AS total
      FROM transactions
      WHERE user_id=? AND type='expense' AND txn_date IS NOT NULL
            AND txn_date >= ? AND txn_date < ?
      GROUP BY cat`).all(userId, startYmd, endYmd);
    let unclassified = 0;
    const byCategory = [];
    for (const r of rows) {
      if (r.cat == null) unclassified += Number(r.total);
      else byCategory.push({ category: r.cat, spent: Number(r.total) });
    }
    byCategory.sort((a, b) => b.spent - a.spent);
    const totalSpend = byCategory.reduce((s, r) => s + r.spent, 0) + unclassified;
    const actualIncome = Number(db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM transactions
      WHERE user_id=? AND type='income' AND txn_date IS NOT NULL AND txn_date >= ? AND txn_date < ?`)
      .get(userId, startYmd, endYmd).t);
    return { byCategory, unclassified, totalSpend, actualIncome };
  }

  // ===================== BUDGET ALLOCATIONS (%, per-user) =====================
  const _allocList = db.prepare('SELECT category, percent FROM budget_allocations WHERE user_id=? ORDER BY rowid');
  const _allocDelAll = db.prepare('DELETE FROM budget_allocations WHERE user_id=?');
  const _allocIns = db.prepare("INSERT INTO budget_allocations (user_id, category, percent, updated_at) VALUES (?,?,?,datetime('now'))");

  /** %-хуваарилалт. Мөр байхгүй бол DEFAULT seed буцаана (persist хийхгүй). */
  function getBudgetAllocations(userId) {
    const rows = _allocList.all(userId);
    if (rows.length === 0) return DEFAULT_ALLOC_PERCENTS.map((a) => ({ ...a }));
    return rows.map((r) => ({ category: r.category, percent: Number(r.percent) }));
  }

  /** Бүх жагсаалтыг ATOMIC upsert (replace-all). Хэсэгчилсэн бичилт үлдээхгүй. */
  function saveBudgetAllocations(userId, list) {
    db.exec('BEGIN');
    try {
      _allocDelAll.run(userId);
      const seen = new Set();
      for (const a of list || []) {
        const cat = String(a?.category ?? '').trim();
        if (!cat || seen.has(cat)) continue; // давхар категори алгасна (PK мөргөлдөөн)
        seen.add(cat);
        _allocIns.run(userId, cat, Math.max(0, Number(a.percent) || 0));
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return getBudgetAllocations(userId);
  }

  function getPending(userId, { limit = 100, offset = 0 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const off = Math.max(Number(offset) || 0, 0);
    const rows = db.prepare(`SELECT * FROM transactions WHERE user_id=? AND status='pending_review' ORDER BY txn_date DESC, id DESC LIMIT ? OFFSET ?`).all(userId, lim, off);
    const total = db.prepare(`SELECT COUNT(*) AS c FROM transactions WHERE user_id=? AND status='pending_review'`).get(userId).c;
    return { rows: attachOverrideInfo(userId, rows), total: Number(total), limit: lim, offset: off };
  }

  const _updateCatById = db.prepare(`UPDATE transactions
    SET category=@category, status='classified', note=COALESCE(@note,note),
        merchant_place=COALESCE(@place,merchant_place), ai_suggested_category=NULL, ai_confidence=NULL,
        manually_edited=1
    WHERE id=@id AND user_id=@user_id`);

  function updateCategoryById(userId, id, category, { note = null, merchantPlace = null } = {}) {
    return _updateCatById.run({ id, user_id: userId, category,
      note: note && String(note).trim() ? String(note).trim() : null,
      place: merchantPlace && String(merchantPlace).trim() ? String(merchantPlace).trim() : null }).changes;
  }

  function updateCategoryByPattern(userId, pattern, category, { note = null, merchantPlace = null } = {}) {
    const np = normalizeMerchant(pattern);
    if (!np) return 0;
    const all = db.prepare('SELECT id, description FROM transactions WHERE user_id=?').all(userId);
    const ids = all.filter((r) => normalizeMerchant(r.description).includes(np)).map((r) => r.id);
    if (!ids.length) return 0;
    const noteV = note && String(note).trim() ? String(note).trim() : null;
    const placeV = merchantPlace && String(merchantPlace).trim() ? String(merchantPlace).trim() : null;
    const upd = db.prepare(`UPDATE transactions SET category=?, status='classified',
      note=COALESCE(?,note), merchant_place=COALESCE(?,merchant_place),
      ai_suggested_category=NULL, ai_confidence=NULL, manually_edited=1 WHERE id=? AND user_id=?`);
    db.exec('BEGIN');
    try { for (const id of ids) upd.run(category, noteV, placeV, id, userId); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
    return ids.length;
  }

  const _updateNote = db.prepare('UPDATE transactions SET note=@note WHERE id=@id AND user_id=@user_id');
  function updateNote(userId, id, note) {
    return _updateNote.run({ id, user_id: userId, note: note && String(note).trim() ? String(note).trim() : null }).changes;
  }

  // ===================== OVERRIDES (per-user) =====================
  const _addOverride = db.prepare(`
    INSERT INTO category_overrides (user_id, merchant_pattern, category, friendly_name, default_note)
    VALUES (@user_id, @pattern, @category, @friendly, @note)
    ON CONFLICT(user_id, merchant_pattern) DO UPDATE SET
      category = excluded.category,
      friendly_name = COALESCE(excluded.friendly_name, category_overrides.friendly_name),
      default_note  = COALESCE(excluded.default_note, category_overrides.default_note)`);

  function addOverride(userId, pattern, category, friendlyName = null, defaultNote = null) {
    const np = normalizeMerchant(pattern);
    if (!np) return null;
    _addOverride.run({ user_id: userId, pattern: np, category,
      friendly: friendlyName && String(friendlyName).trim() ? String(friendlyName).trim() : null,
      note: defaultNote && String(defaultNote).trim() ? String(defaultNote).trim() : null });
    return db.prepare('SELECT * FROM category_overrides WHERE user_id=? AND merchant_pattern=?').get(userId, np);
  }

  function getOverrides(userId) {
    return db.prepare('SELECT * FROM category_overrides WHERE user_id=? ORDER BY created_at DESC').all(userId);
  }

  function attachOverrideInfo(userId, rows) {
    const overrides = getOverrides(userId);
    return rows.map((r) => {
      const norm = normalizeMerchant(r.description);
      const hit = norm ? overrides.find((o) => norm.includes(o.merchant_pattern)) : null;
      return { ...r, friendly_name: hit ? hit.friendly_name : null, override_note: hit ? hit.default_note : null };
    });
  }

  // ===================== SETTINGS (per-user, JSON) =====================
  const _getSettings = db.prepare('SELECT data FROM user_settings WHERE user_id = ?');
  const _saveSettings = db.prepare(`INSERT INTO user_settings (user_id, data, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`);

  /** Хэрэглэгчийн тохиргоо — хадгалаагүй бол DEFAULT (цалин = null). */
  function getSettings(userId) {
    const row = _getSettings.get(userId);
    let saved = {};
    if (row) { try { saved = JSON.parse(row.data) || {}; } catch { saved = {}; } }
    // DEFAULT дээр хадгалсныг давхарлана (дутуу талбар → default утга).
    return { ...structuredClone(DEFAULT_SETTINGS), ...saved };
  }

  /** Upsert (route дотор zod-оор баталгаажуулсан obj). */
  function saveSettings(userId, obj) {
    const merged = { ...structuredClone(DEFAULT_SETTINGS), ...(obj || {}) };
    _saveSettings.run(userId, JSON.stringify(merged));
    return getSettings(userId);
  }

  // ===================== PERSONAL EVENTS (per-user) =====================
  const _listEvents = db.prepare(
    'SELECT id, title, date, amount_mnt FROM personal_events WHERE user_id = ? ORDER BY date ASC, id ASC'
  );
  const _addEvent = db.prepare(
    'INSERT INTO personal_events (user_id, title, date, amount_mnt) VALUES (?,?,?,?)'
  );
  const _getEvent = db.prepare('SELECT id, title, date, amount_mnt FROM personal_events WHERE id = ? AND user_id = ?');
  const _deleteEvent = db.prepare('DELETE FROM personal_events WHERE id = ? AND user_id = ?');

  const _mapEvent = (r) => (r ? { id: Number(r.id), title: r.title, date: r.date,
    amountMnt: r.amount_mnt == null ? null : Number(r.amount_mnt) } : null);

  function listEvents(userId) {
    return _listEvents.all(userId).map(_mapEvent);
  }
  function addEvent(userId, e) {
    const amt = e.amountMnt == null || e.amountMnt === '' ? null : Math.round(Number(e.amountMnt));
    const res = _addEvent.run(userId, String(e.title).trim(), String(e.date), amt);
    return _mapEvent(_getEvent.get(Number(res.lastInsertRowid), userId));
  }
  function deleteEvent(userId, id) {
    return _deleteEvent.run(id, userId).changes;
  }

  // ===================== GOOGLE AUTH (per-user) =====================
  const _insertGoogleUser = db.prepare(
    "INSERT INTO users (email, password_hash, role, google_sub, picture) VALUES (?, '', 'user', ?, ?)"
  );
  const _linkGoogle = db.prepare('UPDATE users SET google_sub = ?, picture = COALESCE(?, picture) WHERE id = ?');

  function getUserByGoogleSub(sub) {
    if (!sub) return null;
    return db.prepare('SELECT * FROM users WHERE google_sub = ?').get(String(sub)) ?? null;
  }

  /**
   * Google нэвтрэлт → хэрэглэгч олох/холбох/үүсгэх.
   *  1) google_sub-аар  2) email-аар (хуучин хэрэглэгч холбоно)  3) шинээр үүсгэх.
   * password_hash = '' sentinel (local нэвтрэлт хийх боломжгүй).
   */
  function upsertGoogleUser({ email, sub, picture = null } = {}) {
    const e = String(email || '').toLowerCase().trim();
    const s = String(sub || '');
    if (!e || !s) return null;
    let user = getUserByGoogleSub(s);
    if (user) {
      if (picture && picture !== user.picture) _linkGoogle.run(s, picture, user.id);
      return getUserById(user.id);
    }
    user = getUserByEmail(e);
    if (user) {
      _linkGoogle.run(s, picture, user.id);
      return getUserById(user.id);
    }
    const res = _insertGoogleUser.run(e, s, picture);
    return getUserById(Number(res.lastInsertRowid));
  }

  const _saveGoogleTokens = db.prepare(`INSERT INTO google_tokens (user_id, refresh_token, scope, calendar_connected, updated_at)
    VALUES (@user_id, @refresh_token, @scope, @calendar_connected, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      refresh_token = COALESCE(excluded.refresh_token, google_tokens.refresh_token),
      scope = excluded.scope,
      calendar_connected = excluded.calendar_connected,
      updated_at = excluded.updated_at`);

  /** Calendar token хадгалах. refresh_token null бол хуучныг хэвээр (Google зөвхөн
   *  анхны consent дээр refresh_token буцаадаг). НУУЦ — API хариуд буцаахгүй. */
  function saveGoogleTokens(userId, { refreshToken = null, scope = '' } = {}) {
    const calendar = String(scope || '').includes('calendar') ? 1 : 0;
    _saveGoogleTokens.run({
      user_id: userId, refresh_token: refreshToken || null,
      scope: String(scope || ''), calendar_connected: calendar,
    });
    return getGoogleTokens(userId);
  }
  function getGoogleTokens(userId) {
    return db.prepare('SELECT user_id, refresh_token, scope, calendar_connected, updated_at FROM google_tokens WHERE user_id = ?').get(userId) ?? null;
  }

  function close() { try { db.close(); } catch { /* ignore */ } }

  return {
    // users / auth
    createUser, getUserByEmail, getUserById, countUsers, getOwnerUserId,
    // transactions
    insertTransaction, getByMessageId, getById, listTransactions, getSummary,
    getMonthly, getByCategory, getCycleSpend, getPending, updateCategoryById, updateCategoryByPattern, updateNote,
    // real-time tracker: %-хуваарилалт
    getBudgetAllocations, saveBudgetAllocations,
    // overrides
    addOverride, getOverrides, normalizeMerchant,
    // settings + personal events (төсөв)
    getSettings, saveSettings, listEvents, addEvent, deleteEvent,
    // google auth
    getUserByGoogleSub, upsertGoogleUser, saveGoogleTokens, getGoogleTokens,
    migrate, close, _raw: db,
  };
}

export default createDb;
