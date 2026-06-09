// ============================================================
//  db.js — node:sqlite холболт + query функцууд
//
//  createDb(path) → {
//    insertTransaction, getByMessageId, getById, listTransactions,
//    getSummary, getPending, updateCategoryById, updateCategoryByPattern,
//    addOverride, getOverrides, normalizeMerchant, migrate, close, _raw
//  }
//
//  Native compile (Python/Build Tools) шаардахгүй — Node-ийн суурилуулсан
//  node:sqlite ашиглана. Бүх query parameterized (SQL injection хамгаалалт).
//
//  Postgres руу шилжих бол: ижил интерфэйстэй db обьект үүсгэж, INSERT-д
//  `ON CONFLICT (message_id) DO NOTHING RETURNING id` ашиглана (README үз).
// ============================================================

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Огноог YYYY-MM-DD болгон хэвийшүүлэх.
 */
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

/**
 * Мерчантын тайлбарыг нормчлох — таниулах хэв болгоно.
 * - Том үсэг (Cyrillic-г ч JS зөв хөрвүүлнэ)
 * - Эхний terminal/POS код ("0930 ", "2266 ") хасах
 * - Олон зайг ганц зай болгох
 * Жишээ: "0930 STOREBOM" → "STOREBOM",  "0047 THE LBOM" → "THE LBOM"
 * Ингэснээр нэг мерчант өөр өөр terminal кодтой ирэхэд ижил хэв болно.
 */
export function normalizeMerchant(desc) {
  return String(desc || '')
    .toUpperCase()
    .replace(/^\d{3,4}\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createDb(dbPath) {
  if (dbPath && dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath || ':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');

  /** Тухайн хүснэгтэд багана байгаа эсэх (идемпотент миграцид) */
  function hasColumn(table, col) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some((c) => c.name === col);
  }

  // --- Миграц (идемпотент) ---
  function migrate() {
    // 001: үндсэн transactions хүснэгт
    db.exec(readFileSync(join(__dirname, 'migrations', '001_init.sqlite.sql'), 'utf8'));

    // 002: dashboard + AI багана/хүснэгт (ADD COLUMN идемпотентоор)
    if (!hasColumn('transactions', 'status')) {
      db.exec("ALTER TABLE transactions ADD COLUMN status TEXT NOT NULL DEFAULT 'classified'");
    }
    if (!hasColumn('transactions', 'ai_suggested_category')) {
      db.exec('ALTER TABLE transactions ADD COLUMN ai_suggested_category TEXT');
    }
    if (!hasColumn('transactions', 'ai_confidence')) {
      db.exec('ALTER TABLE transactions ADD COLUMN ai_confidence TEXT');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_txn_status ON transactions (status)');
    db.exec(`
      CREATE TABLE IF NOT EXISTS category_overrides (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        merchant_pattern TEXT NOT NULL UNIQUE,
        category         TEXT NOT NULL,
        friendly_name    TEXT,
        default_note     TEXT,
        created_at       TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    // 003: friendly_name (газрын танигдсан нэр) — хуучин category_overrides-д идемпотент нэмэх
    if (!hasColumn('category_overrides', 'friendly_name')) {
      db.exec('ALTER TABLE category_overrides ADD COLUMN friendly_name TEXT');
    }
    // 004: note / is_pos / merchant_place (transactions) + default_note (overrides)
    if (!hasColumn('transactions', 'note')) {
      db.exec('ALTER TABLE transactions ADD COLUMN note TEXT');
    }
    if (!hasColumn('transactions', 'is_pos')) {
      db.exec('ALTER TABLE transactions ADD COLUMN is_pos INTEGER'); // 1=POS, 0=биш, NULL=мэдэгдээгүй
    }
    if (!hasColumn('transactions', 'merchant_place')) {
      db.exec('ALTER TABLE transactions ADD COLUMN merchant_place TEXT');
    }
    if (!hasColumn('category_overrides', 'default_note')) {
      db.exec('ALTER TABLE category_overrides ADD COLUMN default_note TEXT');
    }
  }
  migrate();

  // --- Statements ---
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (message_id, amount, currency, txn_date, description, type, category,
       account_last4, raw, status, ai_suggested_category, ai_confidence, is_pos)
    VALUES
      (@message_id, @amount, @currency, @txn_date, @description, @type, @category,
       @account_last4, @raw, @status, @ai_suggested_category, @ai_confidence, @is_pos)
  `);
  const byMessageIdStmt = db.prepare('SELECT * FROM transactions WHERE message_id = ?');
  const byIdStmt = db.prepare('SELECT * FROM transactions WHERE id = ?');

  /**
   * Гүйлгээ insert (идэмпотентность: message_id UNIQUE).
   * @returns {{ created: boolean, id: number, row: object }}
   */
  function insertTransaction(tx) {
    const row = {
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
      return { created: true, id: Number(res.lastInsertRowid), row: byIdStmt.get(Number(res.lastInsertRowid)) };
    }
    const existing = byMessageIdStmt.get(tx.messageId);
    return { created: false, id: existing ? Number(existing.id) : null, row: existing ?? null };
  }

  function getByMessageId(messageId) {
    return byMessageIdStmt.get(messageId) ?? null;
  }
  function getById(id) {
    return byIdStmt.get(id) ?? null;
  }

  /**
   * Шүүлтийн WHERE + params бүтээх (list ба summary хоёрт хуваалцана).
   * Дэмжих: from, to, category(массив/мөр), type, q(текст хайлт),
   *         minAmount, maxAmount, status
   */
  function buildWhere({ from, to, category, type, q, minAmount, maxAmount, status } = {}) {
    const where = [];
    const params = [];
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
    return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
  }

  /** Жагсаалт + шүүлт + pagination */
  function listTransactions(filters = {}) {
    const { whereSql, params } = buildWhere(filters);
    const lim = Math.min(Math.max(Number(filters.limit) || 50, 1), 500);
    const off = Math.max(Number(filters.offset) || 0, 0);
    const rows = db
      .prepare(`SELECT * FROM transactions ${whereSql} ORDER BY txn_date DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...params, lim, off);
    const total = db.prepare(`SELECT COUNT(*) AS c FROM transactions ${whereSql}`).get(...params).c;
    return { rows: attachOverrideInfo(rows), total: Number(total), limit: lim, offset: off };
  }

  /** Хураангуй: нийт зарлага/орлого, тоо, ангиллаар задаргаа (шүүлттэй) */
  function getSummary(filters = {}) {
    const { whereSql, params } = buildWhere(filters);
    const totals = db
      .prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS total_expense,
          COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END),0) AS total_income,
          COUNT(*) AS count
        FROM transactions ${whereSql}
      `)
      .get(...params);
    // category-г null хэвээр (COALESCE-гүй) — "ангилаагүй/pending"-г бодит "other"-оос
    // ялгаж харуулна. Frontend null-г "Ангилаагүй" гэж үзүүлнэ.
    const byCategory = db
      .prepare(`
        SELECT category, type,
               COUNT(*) AS count, COALESCE(SUM(amount),0) AS total
        FROM transactions ${whereSql}
        GROUP BY category, type
        ORDER BY total DESC
      `)
      .all(...params);
    // Газраар (merchant_place) зарлагын задаргаа — "Шулуун дунд нийт хэдэн ₮"
    const placeWhere = whereSql
      ? `${whereSql} AND merchant_place IS NOT NULL AND type='expense'`
      : `WHERE merchant_place IS NOT NULL AND type='expense'`;
    const byPlace = db
      .prepare(`
        SELECT merchant_place AS place, COUNT(*) AS count, COALESCE(SUM(amount),0) AS total
        FROM transactions ${placeWhere}
        GROUP BY merchant_place ORDER BY total DESC LIMIT 10
      `)
      .all(...params);

    return {
      totalExpense: Number(totals.total_expense),
      totalIncome: Number(totals.total_income),
      count: Number(totals.count),
      byCategory: byCategory.map((r) => ({
        category: r.category,
        type: r.type,
        count: Number(r.count),
        total: Number(r.total),
      })),
      byPlace: byPlace.map((r) => ({ place: r.place, count: Number(r.count), total: Number(r.total) })),
    };
  }

  /** Баталгаажуулах хүлээж буй (pending_review) */
  function getPending({ limit = 100, offset = 0 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const off = Math.max(Number(offset) || 0, 0);
    const rows = db
      .prepare(`SELECT * FROM transactions WHERE status='pending_review' ORDER BY txn_date DESC, id DESC LIMIT ? OFFSET ?`)
      .all(lim, off);
    const total = db.prepare(`SELECT COUNT(*) AS c FROM transactions WHERE status='pending_review'`).get().c;
    return { rows: attachOverrideInfo(rows), total: Number(total), limit: lim, offset: off };
  }

  const _updateCatById = db.prepare(`
    UPDATE transactions
    SET category = @category, status = 'classified',
        note = COALESCE(@note, note),
        merchant_place = COALESCE(@place, merchant_place),
        ai_suggested_category = NULL, ai_confidence = NULL
    WHERE id = @id
  `);

  /**
   * Нэг гүйлгээний ангилал засах (+сонголтоор note, merchant_place).
   * note/place нь null бол хуучныг хадгална (дарж бичихгүй).
   */
  function updateCategoryById(id, category, { note = null, merchantPlace = null } = {}) {
    const res = _updateCatById.run({
      id, category,
      note: note && String(note).trim() ? String(note).trim() : null,
      place: merchantPlace && String(merchantPlace).trim() ? String(merchantPlace).trim() : null,
    });
    return res.changes;
  }

  /**
   * Мерчант хэвэнд тохирох БҮХ гүйлгээний ангилал засах (applyToAll).
   * Cyrillic-г зөв зохицуулахын тулд JS талд normalize→includes хийнэ.
   * @returns {number} шинэчилсэн мөрийн тоо
   */
  function updateCategoryByPattern(pattern, category, { note = null, merchantPlace = null } = {}) {
    const np = normalizeMerchant(pattern);
    if (!np) return 0;
    const all = db.prepare('SELECT id, description FROM transactions').all();
    const ids = all
      .filter((r) => normalizeMerchant(r.description).includes(np))
      .map((r) => r.id);
    if (ids.length === 0) return 0;
    const noteV = note && String(note).trim() ? String(note).trim() : null;
    const placeV = merchantPlace && String(merchantPlace).trim() ? String(merchantPlace).trim() : null;
    const upd = db.prepare(
      `UPDATE transactions SET category=?, status='classified',
       note=COALESCE(?, note), merchant_place=COALESCE(?, merchant_place),
       ai_suggested_category=NULL, ai_confidence=NULL WHERE id=?`
    );
    db.exec('BEGIN');
    try {
      for (const id of ids) upd.run(category, noteV, placeV, id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return ids.length;
  }

  const _updateNote = db.prepare('UPDATE transactions SET note=@note WHERE id=@id');
  /** Зөвхөн note засах (dashboard inline edit). Хоосон → null. */
  function updateNote(id, note) {
    const v = note && String(note).trim() ? String(note).trim() : null;
    const res = _updateNote.run({ id, note: v });
    return res.changes;
  }

  const _addOverride = db.prepare(`
    INSERT INTO category_overrides (merchant_pattern, category, friendly_name, default_note)
    VALUES (@pattern, @category, @friendly, @note)
    ON CONFLICT(merchant_pattern) DO UPDATE SET
      category = excluded.category,
      -- friendly_name/default_note өгөгдсөн л бол шинэчилнэ (хоосон бол хуучныг хадгална)
      friendly_name = COALESCE(excluded.friendly_name, category_overrides.friendly_name),
      default_note  = COALESCE(excluded.default_note, category_overrides.default_note)
  `);

  /**
   * Learned override нэмэх/шинэчлэх (merchant_pattern нь нормчлогдсон).
   * @param {string} pattern
   * @param {string} category
   * @param {string|null} [friendlyName]  газрын танигдсан нэр (POS, жишээ: "Шулуун дун")
   * @param {string|null} [defaultNote]   нийтлэг шалтгаан (POS биш, жишээ: "Ээжид мөнгө")
   */
  function addOverride(pattern, category, friendlyName = null, defaultNote = null) {
    const np = normalizeMerchant(pattern);
    if (!np) return null;
    const friendly = friendlyName && String(friendlyName).trim() ? String(friendlyName).trim() : null;
    const note = defaultNote && String(defaultNote).trim() ? String(defaultNote).trim() : null;
    _addOverride.run({ pattern: np, category, friendly, note });
    return db.prepare('SELECT * FROM category_overrides WHERE merchant_pattern = ?').get(np);
  }

  function getOverrides() {
    return db.prepare('SELECT * FROM category_overrides ORDER BY created_at DESC').all();
  }

  /**
   * Мөрүүдэд override-ийн friendly_name + default_note-г хавсаргана (унших үед
   * тооцоолно тул хожим нэр/тэмдэглэл өгсөн ч буцаан тусна).
   */
  function attachOverrideInfo(rows) {
    const overrides = getOverrides();
    return rows.map((r) => {
      const norm = normalizeMerchant(r.description);
      const hit = norm ? overrides.find((o) => norm.includes(o.merchant_pattern)) : null;
      return {
        ...r,
        friendly_name: hit ? hit.friendly_name : null,
        override_note: hit ? hit.default_note : null,
      };
    });
  }

  function close() {
    try { db.close(); } catch { /* ignore */ }
  }

  return {
    insertTransaction,
    getByMessageId,
    getById,
    listTransactions,
    getSummary,
    getPending,
    updateCategoryById,
    updateCategoryByPattern,
    updateNote,
    addOverride,
    getOverrides,
    normalizeMerchant,
    migrate,
    close,
    _raw: db,
  };
}

export default createDb;
