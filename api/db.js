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
import { isoDate } from '../config/txfields.js';
import { DEFAULT_CATEGORY, subcategoryValid } from '../config/categories.js';
import { encryptToken, decryptToken, isEncrypted } from '../config/tokenCrypto.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function normalizeDate(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  // ISO/dotted мөрийн эхэнд (config/txfields.js — дундын); үгүй бол Date fallback.
  const iso = isoDate(s, { anchored: true });
  if (iso) return iso;
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
  budgetFloor: null, // хамгаалах доод үлдэгдэл — салинтай адил default null (хуурамч тоо ХЭЗЭЭ Ч биш)
  paydayDay: 15,
  usdMnt: 3578,
  eurMnt: 4120,
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

/**
 * Float дүнгийн харьцуулалтын хүлцэл. 30000+25000+35000 гэх мэт нийлбэр нь
 * IEEE-754-д яг таг тэнцэхгүй байж болох тул "бүрэн хасагдсан" болон
 * "хэтэрсэн"-ийг ЭНЭ хүлцэлтэйгээр шийднэ (₮/€-ийн хувьд 1e-6 нь утгагүй жижиг).
 */
export const EXCLUSION_EPS = 1e-6;

/**
 * Хасалтын дүрэм зөрчигдсөн (дуудагч тал 400 болгож хөрвүүлнэ).
 *  code = 'OVER_EXCLUSION'   — хасах дүн гүйлгээний дүнгээс их
 *  code = 'CURRENCY_MISMATCH'— өрийн бичлэг ба гүйлгээний валют таарахгүй
 *  code = 'INVALID_AMOUNT'   — тоо биш / сөрөг
 */
export class ExclusionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExclusionError';
    this.code = code;
  }
}

export function createDb(dbPath, opts = {}) {
  if (dbPath && dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });

  // Token encryption at rest — TOKEN_ENC_KEY (32 byte hex). Байхгүй бол plaintext
  // (зөвхөн хуучин тест/dev нийцтэй байдалд); prod-д server.js required() болгодог.
  const tokenEncKey = opts.tokenEncKey || '';
  const encTok = (v) => (tokenEncKey ? encryptToken(v, tokenEncKey) : v);
  const decTok = (v) => (tokenEncKey ? decryptToken(v, tokenEncKey) : v);

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

    // 009: MULTI-TENANT GMAIL — per-user Gmail холболт + token шифрлэлт -------
    // google_tokens дээр Gmail-ийн тусдаа баганууд (calendar-тай зэрэгцэнэ).
    // gmail_status: 'active' | 'reauth_needed' | '' (listener нэг хэрэглэгчийн
    // invalid_grant-д reauth_needed тавьж, бусад хэрэглэгчийг үргэлжлүүлнэ).
    for (const [c, def] of [
      ['gmail_refresh_token', 'ALTER TABLE google_tokens ADD COLUMN gmail_refresh_token TEXT'],
      ['gmail_scope', 'ALTER TABLE google_tokens ADD COLUMN gmail_scope TEXT'],
      // Холбогдсон inbox-ийн бодит Gmail хаяг (login email-ээс өөр байж болно) —
      // listener IMAP XOAUTH2-д auth.user болж хэрэглэгдэнэ.
      ['gmail_email', 'ALTER TABLE google_tokens ADD COLUMN gmail_email TEXT'],
      ['gmail_connected', 'ALTER TABLE google_tokens ADD COLUMN gmail_connected INTEGER NOT NULL DEFAULT 0'],
      ['gmail_status', "ALTER TABLE google_tokens ADD COLUMN gmail_status TEXT NOT NULL DEFAULT ''"],
    ]) {
      if (!hasColumn('google_tokens', c)) db.exec(def);
    }
    // Backfill: хуучин plaintext token-уудыг шифрлэнэ (нэг удаа, идемпотент —
    // enc:v1: префикстэйг дахин шифрлэхгүй). Зөвхөн key тохируулагдсан үед.
    if (tokenEncKey) {
      const rows = db.prepare(
        `SELECT user_id, refresh_token, gmail_refresh_token FROM google_tokens
         WHERE refresh_token IS NOT NULL OR gmail_refresh_token IS NOT NULL`
      ).all();
      const upd = db.prepare('UPDATE google_tokens SET refresh_token=?, gmail_refresh_token=? WHERE user_id=?');
      for (const r of rows) {
        const needCal = r.refresh_token && !isEncrypted(r.refresh_token);
        const needGm = r.gmail_refresh_token && !isEncrypted(r.gmail_refresh_token);
        if (needCal || needGm) {
          upd.run(
            r.refresh_token ? encryptToken(r.refresh_token, tokenEncKey) : r.refresh_token,
            r.gmail_refresh_token ? encryptToken(r.gmail_refresh_token, tokenEncKey) : r.gmail_refresh_token,
            r.user_id
          );
        }
      }
    }

    // 010: TELEGRAM ХОЛБОЛТ (multi-tenant bot) -------------------------------
    // telegram_links: 1 хэрэглэгч ↔ 1 chat (хоёулаа UNIQUE). Bot процесс ЭНЭ
    // хүснэгтэд шууд унших/бичих эрхтэй (санхүүгийн өгөгдөл БИШ, зөвхөн mapping).
    db.exec(`CREATE TABLE IF NOT EXISTS telegram_links (
      user_id INTEGER PRIMARY KEY,
      chat_id TEXT NOT NULL UNIQUE,
      linked_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    // Нэг удаагийн linking код (dashboard-аас generate, bot-д consume).
    db.exec(`CREATE TABLE IF NOT EXISTS telegram_link_codes (
      code TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    // Идэмпотентность: нэг гүйлгээг нэг chat-д давхар мэдэгдэхгүй.
    db.exec(`CREATE TABLE IF NOT EXISTS telegram_notifications (
      transaction_id INTEGER NOT NULL,
      chat_id TEXT NOT NULL,
      message_id TEXT,
      sent_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (transaction_id, chat_id))`);

    // 011: GMAIL OAUTH CLIENT MARKER -----------------------------------------
    // Listener refresh хийхдээ token-ыг олгосон ЯГ ТЭР OAuth client-г ашиглах
    // ёстой (Google refresh_token-ыг өөр client-ээр сэргээхийг зөвшөөрдөггүй —
    // 'unauthorized_client'). 'desktop' = legacy seed (root .env GOOGLE_CLIENT_ID,
    // scripts/get-token.js). 'web' = dashboard Settings→Gmail холбох
    // (GMAIL_GOOGLE_CLIENT_ID, saveGmailTokens-ээр үргэлж тавигдана).
    if (!hasColumn('google_tokens', 'gmail_oauth_client')) {
      db.exec(`ALTER TABLE google_tokens ADD COLUMN gmail_oauth_client TEXT NOT NULL DEFAULT 'desktop'`);
    }

    // 012: ГҮЙЛГЭЭНИЙ ДАРААХ ҮЛДЭГДЭЛ (Үлдэгдэл) --------------------------------
    // Nullable, DEFAULT NULL л — хуучин ~1057 гүйлгээг backfill ХИЙХГҮЙ (тусдаа
    // ажил). Зөвхөн шинэ гүйлгээнд (listener balance parse хийсэн бол) бөглөгдөнө.
    if (!hasColumn('transactions', 'account_balance')) {
      db.exec('ALTER TABLE transactions ADD COLUMN account_balance REAL');
    }

    // 013: ГАР АРГААР УДИРДСАН ХӨРӨНГӨ (бэлэн мөнгө/EUR, listener харахгүй) --------
    // ЭНЭ хүснэгт нь хэрэглэгчийн ШУУД бичдэг цорын ганц санхүүгийн хүснэгт —
    // "transactions/category_overrides-д шууд бичихгүй" дүрэм ЭНД ХАМААРАХГҮЙ.
    // amount ЗААВАЛ эерэг, чиглэл нь type ('deposit'|'withdrawal')-д (transactions-тэй
    // ижил конвенц). amount_eur/exchange_rate — сонголттой, зөвхөн лавлагаа (balance-д
    // нөлөөгүй, дахин тооцоолохгүй).
    db.exec(`CREATE TABLE IF NOT EXISTS manual_ledger_entries (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL,
      entry_date    TEXT NOT NULL,
      type          TEXT NOT NULL CHECK (type IN ('deposit','withdrawal')),
      amount        REAL NOT NULL,
      amount_eur    REAL,
      exchange_rate REAL,
      note          TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')))`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_manual_ledger_user ON manual_ledger_entries (user_id)');

    // 014: ГАР АРГААР УДИРДСАН ХӨРӨНГӨ — currency багана (EUR-г байгальд нь хадгална) --
    // Хуучин зан төлөв: EUR × ханшийг frontend оруулах агшинд MNT болгож
    // "царцаадаг" байсан нь ханш хожим өөрчлөгдөхөд буруу болдог асуудлыг засна.
    // EUR мөрд amount ЗААВАЛ EUR дүн, currency='EUR' — MNT рүү зөвхөн display үед
    // (амьд ханшаар) хөрвүүлнэ. Хуучин мөрүүд бүгд currency='MNT' болно (DEFAULT).
    if (!hasColumn('manual_ledger_entries', 'currency')) {
      db.exec("ALTER TABLE manual_ledger_entries ADD COLUMN currency TEXT NOT NULL DEFAULT 'MNT'");
    }

    // 015: ӨР ТӨЛБӨРИЙН ДЭВТЭР + ТӨСВӨӨС ХАСАХ ТУГ -------------------------------
    // (a) debt_ledger — хүн хоорондын өр (Болд надад өртэй / би ээждээ өртэй).
    //     manual_ledger_entries-ийн ЯГ ТЭР философи: дүнг ЭХ ВАЛЮТААР нь хадгална,
    //     backend ХЭЗЭЭ Ч хөрвүүлэхгүй — MNT/EUR тус тусдаа цэвэршүүлж (net),
    //     зөвхөн frontend display үед амьд ханшаар харуулна.
    //     linked_transaction_id  = өр үүсгэсэн ЭХ гүйлгээ (ж: найзын билет авсан зарлага)
    //     settled_transaction_id = өрийг ХААСАН гүйлгээ (ж: буцааж өгсөн орлого) — сонголттой.
    //     FK-д ON DELETE SET NULL — гүйлгээ уствал өрийн бичлэг үлдэнэ (холбоос л тасарна).
    db.exec(`CREATE TABLE IF NOT EXISTS debt_ledger (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id                INTEGER NOT NULL REFERENCES users(id),
      counterparty           TEXT NOT NULL,
      direction              TEXT NOT NULL CHECK (direction IN ('i_lent','i_borrowed')),
      amount                 REAL NOT NULL CHECK (amount > 0),
      currency               TEXT NOT NULL DEFAULT 'MNT' CHECK (currency IN ('MNT','EUR')),
      entry_date             TEXT NOT NULL,
      note                   TEXT,
      status                 TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled')),
      linked_transaction_id  INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
      settled_transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
      created_at             TEXT NOT NULL DEFAULT (datetime('now')),
      settled_at             TEXT)`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_debt_ledger_user ON debt_ledger (user_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_debt_ledger_linked ON debt_ledger (linked_transaction_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_debt_ledger_settled ON debt_ledger (settled_transaction_id)');

    // (b) transactions.excluded_from_budget — ⚠️ ЗӨВХӨН төсөв/ангилал/шинжилгээнд
    //     нөлөөлнө, ҮЛДЭГДЭЛД ХЭЗЭЭ Ч НӨЛӨӨЛӨХГҮЙ. Найзын билетийг картаараа
    //     авахад мөнгө БОДИТООР дансаас гарсан тул balance-д тоологдох ЁСТОЙ;
    //     харин "Тээвэр" ангиллын төсвийг 600% хэтрүүлэх нь БУРУУ. Тиймээс
    //     getSummary/getMonthly/getByCategory/getCycleSpend дээр л шүүгдэнэ;
    //     getCurrentBalance/getBalanceAnchor/getDailyTxnStats/balanceHistory.js
    //     БОЛОН listTransactions (хэрэглэгч буцааж асаах ёстой) ХӨНДӨГДӨХГҮЙ.
    //     Хуучин бүх мөр DEFAULT 0 (оролцоно) — backfill шаардлагагүй.
    if (!hasColumn('transactions', 'excluded_from_budget')) {
      db.exec('ALTER TABLE transactions ADD COLUMN excluded_from_budget INTEGER NOT NULL DEFAULT 0');
    }

    // 016: ХЭСЭГЧИЛСЭН ХАСАЛТ — хуваасан зардал (split) ---------------------------
    //  015-ын хасалт "бүгд эсвэл юу ч биш" байсан: 90,000₮-ийн зоогийн газрын
    //  дансыг холбоход БҮХЭЛД нь төсвөөс гардаг. Хуваасан зардалд энэ БУРУУ —
    //  Болдын 30к, Ганагийн 25к нь гарах ёстой ч ӨӨРИЙН 35к "Гадуур хооллолт"-д
    //  ҮЛДЭХ ёстой. Тиймээс тугийг ДҮН болгож нарийвчлав.
    //
    //  (a) transactions.excluded_amount — төсвөөс хасагдах ДҮН (0 = хасалтгүй).
    //      Төсөв/ангилал/шинжилгээ нь `amount - excluded_amount`-ыг нийлбэрлэнэ.
    //      ⚠️ ҮЛДЭГДЭЛД ХЭЗЭЭ Ч НӨЛӨӨЛӨХГҮЙ (015-ын заагтай ЯГ ижил) —
    //      getCurrentBalance/getBalanceAnchor/getDailyTxnStats/balanceHistory.js
    //      бүхэлд нь БҮТЭН amount-ыг хэвээр хэрэглэнэ.
    //      Backfill: хуучин бүрэн хасагдсан мөр (excluded_from_budget=1) →
    //      excluded_amount = amount ⇒ зан төлөв ЯГ хэвээр үлдэнэ.
    //  (b) excluded_from_budget нь УСТГАГДААГҮЙ — "БҮРЭН хасагдсан" гэсэн
    //      уламжлагдсан туг болж (excluded_amount >= amount) бичилт бүр дээр
    //      хамт шинэчлэгдэнэ. Хуучин уншигч код бүр зөв хэвээр ажиллана.
    //  (c) debt_ledger.exclusion_share — тухайн бичлэг холбогдсон гүйлгээнээс
    //      ХЭДИЙГ эзлэхийг заана. NULL → бичлэгийн өөрийн amount (түгээмэл тохиолдол).
    //      Нэг гүйлгээнд ОЛОН бичлэг холбогдож болно: excluded_amount = тэдгээрийн
    //      хувь хэмжээний НИЙЛБЭР (тоолуур нэмэгдүүлэхгүй, ҮРГЭЛЖ дахин тооцоолно).
    if (!hasColumn('transactions', 'excluded_amount')) {
      db.exec('ALTER TABLE transactions ADD COLUMN excluded_amount REAL NOT NULL DEFAULT 0 CHECK (excluded_amount >= 0)');
      db.exec('UPDATE transactions SET excluded_amount = amount WHERE excluded_from_budget = 1');
    }
    if (!hasColumn('debt_ledger', 'exclusion_share')) {
      db.exec('ALTER TABLE debt_ledger ADD COLUMN exclusion_share REAL CHECK (exclusion_share IS NULL OR exclusion_share >= 0)');
    }
    // Багана хоорондын хязгаар (excluded_amount <= amount) — SQLite-д энгийн CHECK
    // болгож бичих боломжгүй тул trigger. Float дүнгийн бөөрөнхийлөлтөд EPS зөвшөөрнө
    // (55000.000000001 гэх мэт нийлбэр нь хууль ёсны "бүрэн" хасалт байж болно).
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_txn_excluded_amount_ins
      BEFORE INSERT ON transactions
      WHEN NEW.excluded_amount > NEW.amount + ${EXCLUSION_EPS}
      BEGIN SELECT RAISE(ABORT, 'excluded_amount нь amount-аас их байж болохгүй'); END`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_txn_excluded_amount_upd
      BEFORE UPDATE ON transactions
      WHEN NEW.excluded_amount > NEW.amount + ${EXCLUSION_EPS}
      BEGIN SELECT RAISE(ABORT, 'excluded_amount нь amount-аас их байж болохгүй'); END`);

    // 017: МЭДЭГДЭЛ ИРСЭН ЦАГ (email Date: header) --------------------------------
    // Голомтын имэйлийн BODY-д ЗӨВХӨН огноо (цаггүй) байдаг тул гүйлгээний цагийг
    // Gmail имэйлийн `Date:` header-ээс авна. ISO 8601 **UTC** string-ээр хадгална
    // (ж: '2026-08-05T06:32:00.000Z'); дэлгэц/bot дээр л УБ (UTC+8) болгож харуулна.
    //  ⚠️ txn_date-д ХЭЗЭЭ Ч хүрэхгүй — тэр огноо (YYYY-MM-DD) хэвээрээ үлдэнэ
    //     (budgetCycle.js / balanceHistory.js / /balance-history бүгд түүнд тулгуурладаг).
    //  Nullable, DEFAULT NULL, backfill ХИЙХГҮЙ — 012-ын account_balance-тай ЯГ ижил
    //  философи: хуучин ~1057 мөр цаггүй үлдэнэ, parse амжилтгүй бол insert блоклогдохгүй.
    if (!hasColumn('transactions', 'email_received_at')) {
      db.exec('ALTER TABLE transactions ADD COLUMN email_received_at TEXT');
    }

    // 018: ДЭД АНГИЛАЛ (subcategory) ------------------------------------------
    // ⚠️ ДУГААРЛАЛТЫН ТӨӨРӨГДӨЛ: §15-д "018" (applicability) ба "019" (тогтмол id)
    //    гэж бичигдсэн нь ФИЧЕРИЙН БАГЦЫН шошго — тэдгээр нь миграц НЭМЭЭГҮЙ.
    //    Миграцын жинхэнэ гинж 017-д зогссон тул ЭНЭ нь 018 дугаартай.
    //
    // Ангилал доторх нарийвчлал: 'Эрүүл мэнд' → 'Шүд' г.м. Хоёр хүснэгтэд нэмнэ:
    //   • transactions.subcategory      — тухайн гүйлгээний дэд ангилал
    //   • category_overrides.subcategory — сурсан дэд ангилал (ingest дээр хэрэглэнэ)
    //
    // ⚠️ Хадгалагдах утга нь МОНГОЛ LABEL (ангиллынхтай ЯГ ИЖИЛ гэрээ) — id БИШ.
    // ⚠️ Nullable, DEFAULT NULL, **BACKFILL ХИЙХГҮЙ** — 012/017-тэй ижил философи:
    //    одоо байгаа БҮХ мөр NULL хэвээр үлдэнэ (хуурамч утга гаргахгүй). Дэд
    //    ангилал нь зөвхөн learned override эсвэл хэрэглэгчийн засвараар л орно;
    //    keyword-оор ХЭЗЭЭ Ч таамаглахгүй.
    // ⚠️ Аналитикийн query бүр NULL-ыг ТЭВЧИХ ёстой (GROUP BY-д NULL нь бүлэг болно).
    if (!hasColumn('transactions', 'subcategory')) {
      db.exec('ALTER TABLE transactions ADD COLUMN subcategory TEXT');
    }
    if (!hasColumn('category_overrides', 'subcategory')) {
      db.exec('ALTER TABLE category_overrides ADD COLUMN subcategory TEXT');
    }
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
       account_last4, raw, status, ai_suggested_category, ai_confidence, is_pos, account_balance,
       email_received_at, subcategory)
    VALUES
      (@user_id, @message_id, @amount, @currency, @txn_date, @description, @type, @category,
       @account_last4, @raw, @status, @ai_suggested_category, @ai_confidence, @is_pos, @account_balance,
       @email_received_at, @subcategory)`);
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
      account_balance: tx.balance ?? null,
      // Мэдэгдэл ирсэн цаг (017) — listener илгээгээгүй бол NULL (цаггүй мөр).
      email_received_at: tx.emailReceivedAt ?? null,
      // Дэд ангилал (018) — listener ХЭЗЭЭ Ч илгээхгүй. Утга орох ганц зам нь
      // classify.js-ийн таарсан override; өөр тохиолдолд ҮРГЭЛЖ NULL.
      subcategory: tx.subcategory ?? null,
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

  // Хамгийн сүүлийн txn_date-той (INSERT/id дараалал БИШ) account_balance
  // NOT NULL мөрийг сонгоно. txn_date тэнцүү бол id DESC (тухайн өдрийн
  // сүүлд орсон нь илүү найдвартай) — давхардал/downtime-ийн дараах
  // out-of-order insert-д зөв ажиллана.
  const _balanceAnchor = db.prepare(`
    SELECT txn_date, account_balance FROM transactions
    WHERE user_id = ? AND account_balance IS NOT NULL
    ORDER BY txn_date DESC, id DESC
    LIMIT 1`);

  /** Сүүлийн бодит (мэдэгдэж буй) үлдэгдлийн мөр — { date, balance } эсвэл null. */
  function getBalanceAnchor(userId) {
    const row = _balanceAnchor.get(userId);
    return row ? { date: row.txn_date, balance: Number(row.account_balance) } : null;
  }

  /** Хэрэглэгчийн одоогийн үлдэгдэл (сүүлийн txn_date-тэй мөрөөс). Байхгүй бол null. */
  function getCurrentBalance(userId) {
    const anchor = getBalanceAnchor(userId);
    return anchor ? anchor.balance : null;
  }

  const _dailyTxnStats = db.prepare(`
    SELECT txn_date AS date,
           COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0) AS net,
           COUNT(*) AS cnt
    FROM transactions
    WHERE user_id = ? AND txn_date IS NOT NULL AND txn_date >= ? AND txn_date <= ?
    GROUP BY txn_date`);

  /**
   * Өдөр тутмын цэвэр өөрчлөлт (орлого - зарлага; amount баганад ЗААВАЛ эерэг
   * утга хадгалагддаг тул чиглэлийг type-аар шийднэ) + гүйлгээний тоо (READ-ONLY,
   * balance-history сэргээлт болон gap илрүүлэлтэд ашиглагдана).
   * @returns {{date:string, net:number, count:number}[]}
   */
  function getDailyTxnStats(userId, fromYmd, toYmd) {
    return _dailyTxnStats.all(userId, fromYmd, toYmd)
      .map((r) => ({ date: r.date, net: Number(r.net), count: Number(r.cnt) }));
  }

  const _dailyTransactionRows = db.prepare(`
    SELECT id, txn_date, description, merchant_place, category, amount, type, created_at
    FROM transactions
    WHERE user_id = ? AND txn_date IS NOT NULL AND txn_date >= ? AND txn_date <= ?
    ORDER BY txn_date ASC, id ASC`);

  /**
   * [from,to] мужийн ГҮЙЛГЭЭ бүр (орлого+зарлага аль аль нь) — balance-history-ийн
   * өдөр дээр даран задаргаанд (drill-down) зориулав. Ангилаагүй (category NULL)
   * мөрийг ХАСАХГҮЙ — тухайн өдрийн жагсаалтад хэвээр орно (frontend catLabel(null)
   * → 'Ангилаагүй' гэж харуулна). merchant_place snake_case — format.js-ийн
   * displayDesc(row)-той шууд нийцүүлэв (дахин мэдэгдэл бичихгүй). READ-ONLY.
   * @returns {{id:number, date:string, description:string|null, merchant_place:string|null, category:string|null, amount:number, type:string, createdAt:string}[]}
   */
  function getDailyTransactionRows(userId, fromYmd, toYmd) {
    return _dailyTransactionRows.all(userId, fromYmd, toYmd).map((r) => ({
      id: Number(r.id),
      date: r.txn_date,
      description: r.description,
      merchant_place: r.merchant_place,
      category: r.category,
      amount: Number(r.amount),
      type: r.type,
      createdAt: r.created_at,
    }));
  }

  /**
   * Төсөв/шинжилгээнд тоологдох ЦЭВЭР дүнгийн SQL хэсэг (migration 016).
   * Дөрвөн дуудагч (getSummary/getMonthly/getByCategory/getCycleSpend) БҮГД
   * үүнийг хэрэглэнэ — өөр хаана Ч БИШ. `amount` дангаараа = үлдэгдлийн ертөнц.
   * ⚠️ excluded_amount ∈ [0, amount] тул NET хэзээ ч сөрөг болохгүй.
   */
  const NET_AMOUNT = '(amount - COALESCE(excluded_amount, 0))';

  /**
   * Шүүлтийн WHERE — ҮРГЭЛЖ user_id-аар эхэлнэ (tenant isolation).
   * @param {{budgetOnly?: boolean}} filters  budgetOnly=true үед БҮРЭН хасагдсан
   *   мөрийг (excluded_from_budget=1 ⇔ excluded_amount >= amount) хасна — ЗӨВХӨН
   *   шинжилгээ/төсвийн дуудагчид.
   *   ⚠️ 016-аас хойш энэ шүүлт нь ЗӨВХӨН тоо/бүлэг үүсгэхэд нөлөөлнө: бүрэн
   *   хасагдсан мөрийн ЦЭВЭР дүн аль хэдийн 0 тул нийлбэрт нөлөөгүй. Ийнхүү
   *   хуучин (015) зан төлөв — count, хоосон бүлэг байхгүй — ЯГ ХЭВЭЭР үлдэнэ.
   *   ХЭСЭГЧИЛСЭН хасалттай мөр (0 < excluded_amount < amount) шүүгдэхгүй, зөвхөн
   *   дүн нь NET_AMOUNT-аар багасна.
   *   listTransactions нь үүнийг ДАМЖУУЛАХГҮЙ: хэрэглэгч хасагдсан мөрөө жагсаалтдаа
   *   БҮТЭН дүнгээр хараад удирдах боломжтой байх ёстой (net хийхгүй).
   */
  function buildWhere(userId, { from, to, category, type, q, minAmount, maxAmount, status, budgetOnly } = {}) {
    const where = ['user_id = ?'];
    const params = [userId];
    if (budgetOnly) where.push('excluded_from_budget = 0');
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

  // ⚠️ ШИНЖИЛГЭЭ — БҮРЭН хасагдсан мөр ОРОХГҮЙ (budgetOnly), хэсэгчилсэн хасалттай
  // мөр ЦЭВЭР дүнгээрээ (NET_AMOUNT) орно. Үлдэгдлийн тооцоололд
  // (getCurrentBalance/getDailyTxnStats/balanceHistory) эдгээрийн АЛЬ Ч БАЙХГҮЙ.
  function getSummary(userId, filters = {}) {
    const { whereSql, params } = buildWhere(userId, { ...filters, budgetOnly: true });
    const totals = db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN type='expense' THEN ${NET_AMOUNT} ELSE 0 END),0) AS total_expense,
        COALESCE(SUM(CASE WHEN type='income'  THEN ${NET_AMOUNT} ELSE 0 END),0) AS total_income,
        COUNT(*) AS count FROM transactions ${whereSql}`).get(...params);
    const byCategory = db.prepare(`SELECT category, type, COUNT(*) AS count, COALESCE(SUM(${NET_AMOUNT}),0) AS total
        FROM transactions ${whereSql} GROUP BY category, type ORDER BY total DESC`).all(...params);
    const byPlace = db.prepare(`SELECT merchant_place AS place, COUNT(*) AS count, COALESCE(SUM(${NET_AMOUNT}),0) AS total
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
             COALESCE(SUM(CASE WHEN type='expense' THEN ${NET_AMOUNT} ELSE 0 END),0) AS expense,
             COALESCE(SUM(CASE WHEN type='income'  THEN ${NET_AMOUNT} ELSE 0 END),0) AS income,
             COUNT(*) AS count
      FROM transactions WHERE user_id = ? AND txn_date IS NOT NULL AND excluded_from_budget = 0
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
             COUNT(*) AS count, COALESCE(SUM(${NET_AMOUNT}),0) AS total
      FROM transactions
      WHERE user_id=? AND type='expense' AND txn_date IS NOT NULL
            AND substr(txn_date,1,7)=? AND excluded_from_budget = 0
      GROUP BY 1 ORDER BY total DESC`).all(userId, m)
      .map((r) => ({ category: r.category, total: Number(r.total), count: Number(r.count) }));
    const exp = db.prepare(`SELECT COALESCE(SUM(${NET_AMOUNT}),0) AS t FROM transactions
      WHERE user_id=? AND type='expense' AND txn_date IS NOT NULL AND substr(txn_date,1,7)=? AND excluded_from_budget = 0`).get(userId, m).t;
    const inc = db.prepare(`SELECT COALESCE(SUM(${NET_AMOUNT}),0) AS t FROM transactions
      WHERE user_id=? AND type='income' AND txn_date IS NOT NULL AND substr(txn_date,1,7)=? AND excluded_from_budget = 0`).get(userId, m).t;
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
             COALESCE(SUM(${NET_AMOUNT}),0) AS total
      FROM transactions
      WHERE user_id=? AND type='expense' AND txn_date IS NOT NULL
            AND txn_date >= ? AND txn_date < ? AND excluded_from_budget = 0
      GROUP BY cat`).all(userId, startYmd, endYmd);
    let unclassified = 0;
    const byCategory = [];
    for (const r of rows) {
      if (r.cat == null) unclassified += Number(r.total);
      else byCategory.push({ category: r.cat, spent: Number(r.total) });
    }
    byCategory.sort((a, b) => b.spent - a.spent);
    const totalSpend = byCategory.reduce((s, r) => s + r.spent, 0) + unclassified;
    const actualIncome = Number(db.prepare(`SELECT COALESCE(SUM(${NET_AMOUNT}),0) t FROM transactions
      WHERE user_id=? AND type='income' AND txn_date IS NOT NULL AND txn_date >= ? AND txn_date < ?
            AND excluded_from_budget = 0`)
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

  /**
   * ★ ГЭРЭЭ (018): мөрийн `subcategory` нь ҮРГЭЛЖ түүний `category`-д харьяалагдана.
   * Ангилал өөрчлөгдөхөд хуучин дэд ангилал өнчирч болзошгүй тул:
   *   • хэрэглэгч тодорхой дэд ангилал өгсөн бол → ТЭР нь ялна,
   *   • өгөөгүй бол → хуучин утга ШИНЭ ангилалд ч хүчинтэй бол ХАДГАЛНА,
   *     хүчингүй болсон бол NULL болгож ЦЭВЭРЛЭНЭ.
   * Ингэснээр "Тээвэр + Шүд" гэх ГАЖ хос ХЭЗЭЭ Ч үүсэхгүй.
   */
  function _resolveSub(newCategory, existingSub, providedSub) {
    if (providedSub != null && String(providedSub).trim()) return String(providedSub).trim();
    if (existingSub && subcategoryValid(newCategory, existingSub)) return existingSub;
    return null;
  }

  const _updateCatById = db.prepare(`UPDATE transactions
    SET category=@category, subcategory=@subcategory, status='classified', note=COALESCE(@note,note),
        merchant_place=COALESCE(@place,merchant_place), ai_suggested_category=NULL, ai_confidence=NULL,
        manually_edited=1
    WHERE id=@id AND user_id=@user_id`);

  function updateCategoryById(userId, id, category, { note = null, merchantPlace = null, subcategory = null } = {}) {
    const cur = byIdStmt.get(id, userId);
    if (!cur) return 0;
    return _updateCatById.run({ id, user_id: userId, category,
      subcategory: _resolveSub(category, cur.subcategory, subcategory),
      note: note && String(note).trim() ? String(note).trim() : null,
      place: merchantPlace && String(merchantPlace).trim() ? String(merchantPlace).trim() : null }).changes;
  }

  function updateCategoryByPattern(userId, pattern, category, { note = null, merchantPlace = null, subcategory = null } = {}) {
    const np = normalizeMerchant(pattern);
    if (!np) return 0;
    // subcategory-г мөр тус бүрд шийдэх тул одоогийн утгыг нь хамт татна
    const all = db.prepare('SELECT id, description, subcategory FROM transactions WHERE user_id=?').all(userId);
    const hits = all.filter((r) => normalizeMerchant(r.description).includes(np));
    if (!hits.length) return 0;
    const noteV = note && String(note).trim() ? String(note).trim() : null;
    const placeV = merchantPlace && String(merchantPlace).trim() ? String(merchantPlace).trim() : null;
    const upd = db.prepare(`UPDATE transactions SET category=?, subcategory=?, status='classified',
      note=COALESCE(?,note), merchant_place=COALESCE(?,merchant_place),
      ai_suggested_category=NULL, ai_confidence=NULL, manually_edited=1 WHERE id=? AND user_id=?`);
    db.exec('BEGIN');
    try {
      for (const r of hits) {
        upd.run(category, _resolveSub(category, r.subcategory, subcategory), noteV, placeV, r.id, userId);
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return hits.length;
  }

  // Тэмдэглэл/газрын нэрийг ангилал ХӨНДӨЛГҮЙ засах. undefined талбарт ГАР
  // ХҮРЭХГҮЙ; өгсөн талбарын хоосон string → NULL (утга УСТГАХ боломж).
  // ⚠️ override/manually_edited-д нөлөөлөхгүй — энэ бол дан талбарын засвар.
  function updateTransactionFields(userId, id, { note, merchantPlace } = {}) {
    const sets = [];
    const params = { id, user_id: userId };
    if (note !== undefined) { sets.push('note=@note'); params.note = String(note).trim() || null; }
    if (merchantPlace !== undefined) { sets.push('merchant_place=@place'); params.place = String(merchantPlace).trim() || null; }
    if (!sets.length) return 0;
    return db.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id=@id AND user_id=@user_id`).run(params).changes;
  }

  // Хуучирсан pending_review → автоматаар DEFAULT_CATEGORY ('Бусад'). Хэрэглэгчийн
  // бодлого: гүйлгээ N хоногоос дээш хугацаанд ангилагдаагүй хэвээр байвал (санахаа
  // больсон) авто "Бусад" болгоно. Гараар зассан мөрийг (manually_edited) ХӨНДӨХГҮЙ.
  // Систем-даяар (owner-ийн бүх гүйлгээ). Буцаах: өөрчлөгдсөн мөрийн тоо.
  const _autoClassifyStale = db.prepare(`UPDATE transactions
    SET category = @category, status = 'classified'
    WHERE status = 'pending_review'
      AND (manually_edited IS NULL OR manually_edited = 0)
      AND txn_date IS NOT NULL
      AND txn_date <= date('now', @cutoff)`);

  function autoClassifyStalePending({ days = 3, category = DEFAULT_CATEGORY } = {}) {
    const d = Math.trunc(Number(days));
    if (!Number.isFinite(d) || d <= 0) return 0; // 0/сөрөг → унтраалттай
    return _autoClassifyStale.run({ category, cutoff: `-${d} days` }).changes;
  }

  // ===================== OVERRIDES (per-user) =====================
  // ⚠️ subcategory (018) нь `category`-тай ХАМТ дарж бичигдэнэ (COALESCE БИШ) —
  // ангилал өөрчлөгдөхөд хуучин дэд ангилал өнчрөх ёсгүй. Дэд ангилалгүйгээр
  // override шинэчлэгдвэл subcategory NULL болно (энэ нь ЗӨВ: шинэ ангилалд
  // харьяалагдахгүй хуучин утга үлдэхээс NULL нь дээр).
  const _addOverride = db.prepare(`
    INSERT INTO category_overrides (user_id, merchant_pattern, category, friendly_name, default_note, subcategory)
    VALUES (@user_id, @pattern, @category, @friendly, @note, @subcategory)
    ON CONFLICT(user_id, merchant_pattern) DO UPDATE SET
      category = excluded.category,
      subcategory = excluded.subcategory,
      friendly_name = COALESCE(excluded.friendly_name, category_overrides.friendly_name),
      default_note  = COALESCE(excluded.default_note, category_overrides.default_note)`);

  function addOverride(userId, pattern, category, friendlyName = null, defaultNote = null, subcategory = null) {
    const np = normalizeMerchant(pattern);
    if (!np) return null;
    const sub = subcategory && String(subcategory).trim() ? String(subcategory).trim() : null;
    _addOverride.run({ user_id: userId, pattern: np, category,
      friendly: friendlyName && String(friendlyName).trim() ? String(friendlyName).trim() : null,
      note: defaultNote && String(defaultNote).trim() ? String(defaultNote).trim() : null,
      // Гэрээ хамгаалалт: харьяалагдахгүй утга override-д ОРОХГҮЙ (route аль хэдийн
      // 400 өгдөг ч энэ нь DB давхаргын сүүлчийн хамгаалалт).
      subcategory: sub && subcategoryValid(category, sub) ? sub : null });
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
   *  анхны consent дээр refresh_token буцаадаг). НУУЦ — шифрлэгдэж хадгалагдана,
   *  API хариуд буцаахгүй. */
  function saveGoogleTokens(userId, { refreshToken = null, scope = '' } = {}) {
    const calendar = String(scope || '').includes('calendar') ? 1 : 0;
    _saveGoogleTokens.run({
      user_id: userId, refresh_token: refreshToken ? encTok(refreshToken) : null,
      scope: String(scope || ''), calendar_connected: calendar,
    });
    return getGoogleTokens(userId);
  }
  /** refresh_token-уудыг тайлсан (decrypt) байдлаар буцаана — зөвхөн дотоод хэрэглээ. */
  function getGoogleTokens(userId) {
    const row = db.prepare('SELECT * FROM google_tokens WHERE user_id = ?').get(userId) ?? null;
    if (!row) return null;
    return {
      ...row,
      refresh_token: row.refresh_token ? decTok(row.refresh_token) : row.refresh_token,
      gmail_refresh_token: row.gmail_refresh_token ? decTok(row.gmail_refresh_token) : row.gmail_refresh_token,
    };
  }

  const _disconnectGoogleTokens = db.prepare(
    `UPDATE google_tokens SET refresh_token=NULL, scope='', calendar_connected=0, updated_at=datetime('now') WHERE user_id=?`
  );
  /** Хэрэглэгч Settings-ээс "Салгах" дарахад — token устгаж flag-ыг 0 болгоно. */
  function disconnectGoogleCalendar(userId) {
    _disconnectGoogleTokens.run(userId);
  }

  // ===================== GMAIL ХОЛБОЛТ (per-user, multi-tenant listener) =====================
  // ЭНЭ функц зөвхөн Settings-ийн web Gmail-connect callback-аас дуудагддаг
  // (routes/auth.js /gmail/callback) тул gmail_oauth_client үргэлж 'web'
  // (listener token refresh хийхдээ зөв client сонгохын тулд, migration 011).
  const _saveGmailTokens = db.prepare(`INSERT INTO google_tokens
      (user_id, gmail_refresh_token, gmail_scope, gmail_email, gmail_connected, gmail_status, gmail_oauth_client, updated_at)
    VALUES (@user_id, @gmail_refresh_token, @gmail_scope, @gmail_email, 1, 'active', 'web', datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      gmail_refresh_token = COALESCE(excluded.gmail_refresh_token, google_tokens.gmail_refresh_token),
      gmail_scope = excluded.gmail_scope,
      gmail_email = COALESCE(excluded.gmail_email, google_tokens.gmail_email),
      gmail_connected = 1,
      gmail_status = 'active',
      gmail_oauth_client = 'web',
      updated_at = excluded.updated_at`);

  /** Gmail refresh token хадгалах (шифрлэгдэнэ). email = холбогдсон inbox-ийн бодит
   *  Gmail хаяг (IMAP auth.user). Дахин холбоход status='active' болно. */
  function saveGmailTokens(userId, { refreshToken = null, scope = '', email = null } = {}) {
    _saveGmailTokens.run({
      user_id: userId,
      gmail_refresh_token: refreshToken ? encTok(refreshToken) : null,
      gmail_scope: String(scope || ''),
      gmail_email: email ? String(email).toLowerCase().trim() : null,
    });
    return getGmailInfo(userId);
  }

  const _disconnectGmail = db.prepare(
    `UPDATE google_tokens SET gmail_refresh_token=NULL, gmail_scope='', gmail_email=NULL, gmail_connected=0, gmail_status='', updated_at=datetime('now') WHERE user_id=?`
  );
  function disconnectGmail(userId) {
    _disconnectGmail.run(userId);
  }

  const _setGmailStatus = db.prepare(
    `UPDATE google_tokens SET gmail_status=?, updated_at=datetime('now') WHERE user_id=?`
  );
  /** Listener/API-аас Gmail холболтын төлөв солих ('active' | 'reauth_needed'). */
  function setGmailStatus(userId, status) {
    _setGmailStatus.run(String(status || ''), userId);
  }

  /** Gmail холболтын төлөв — token утга ОРОХГҮЙ (API /me-д аюулгүй). */
  function getGmailInfo(userId) {
    const row = db.prepare('SELECT gmail_connected, gmail_status, gmail_email FROM google_tokens WHERE user_id = ?').get(userId);
    return {
      connected: Boolean(row && row.gmail_connected),
      status: row ? String(row.gmail_status || '') : '',
      email: row ? (row.gmail_email || null) : null,
    };
  }

  // ===================== TELEGRAM ХОЛБОЛТ (per-user, multi-tenant bot) =====================
  const CODE_TTL_MIN = 10;
  function _genCode() {
    // 6 оронтой тоон код (000000-999999-ийг '0'-ээр pad хийж 6 оронтой байлгана)
    return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  }
  const _deleteUnusedCodes = db.prepare('DELETE FROM telegram_link_codes WHERE user_id=? AND used=0');
  const _insertCode = db.prepare(
    `INSERT INTO telegram_link_codes (code, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`
  );

  /** Хэрэглэгчийн linking код үүсгэх (10 мин TTL). Хуучин ашиглаагүй кодыг цэвэрлэнэ. */
  function createTelegramLinkCode(userId) {
    _deleteUnusedCodes.run(userId);
    let code;
    // Практикт мөргөлдөх магадлал бага ч PK давхцлаас найдвартай ангижрах (5 оролдлого).
    for (let i = 0; i < 5; i++) {
      code = _genCode();
      try {
        _insertCode.run(code, userId, `+${CODE_TTL_MIN} minutes`);
        break;
      } catch (e) {
        if (i === 4) throw e;
        code = null;
      }
    }
    const row = db.prepare('SELECT code, expires_at FROM telegram_link_codes WHERE code=?').get(code);
    return { code: row.code, expiresAt: row.expires_at };
  }

  function getTelegramLink(userId) {
    const row = db.prepare('SELECT chat_id, linked_at FROM telegram_links WHERE user_id=?').get(userId);
    return row ? { chatId: row.chat_id, linkedAt: row.linked_at } : null;
  }

  function disconnectTelegram(userId) {
    db.prepare('DELETE FROM telegram_links WHERE user_id=?').run(userId);
  }

  // ===================== ГАР АРГААР УДИРДСАН ХӨРӨНГӨ (manual ledger, per-user) =====================
  const _insertLedger = db.prepare(`
    INSERT INTO manual_ledger_entries (user_id, entry_date, type, amount, currency, amount_eur, exchange_rate, note, created_at, updated_at)
    VALUES (@user_id, @entry_date, @type, @amount, @currency, @amount_eur, @exchange_rate, @note, datetime('now'), datetime('now'))`);
  const _getLedgerEntry = db.prepare('SELECT * FROM manual_ledger_entries WHERE id=? AND user_id=?');
  const _listLedger = db.prepare('SELECT * FROM manual_ledger_entries WHERE user_id=? ORDER BY entry_date DESC, id DESC');
  const _updateLedger = db.prepare(`
    UPDATE manual_ledger_entries
    SET entry_date=@entry_date, type=@type, amount=@amount, currency=@currency, amount_eur=@amount_eur,
        exchange_rate=@exchange_rate, note=@note, updated_at=datetime('now')
    WHERE id=@id AND user_id=@user_id`);
  const _deleteLedger = db.prepare('DELETE FROM manual_ledger_entries WHERE id=? AND user_id=?');
  // Валют тус бүрийг тусад нь нийлбэрлэнэ — MNT ба EUR-ийг хэзээ ч нэг тоонд
  // хольж нэмэхгүй (хөрвүүлэлт зөвхөн display үед, frontend талд амьд ханшаар).
  const _ledgerBalance = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN currency='MNT' THEN (CASE WHEN type='deposit' THEN amount ELSE -amount END) ELSE 0 END), 0) AS mnt,
      COALESCE(SUM(CASE WHEN currency='EUR' THEN (CASE WHEN type='deposit' THEN amount ELSE -amount END) ELSE 0 END), 0) AS eur
    FROM manual_ledger_entries WHERE user_id=?`);

  const _mapLedger = (r) => (r ? {
    id: Number(r.id),
    date: r.entry_date,
    type: r.type,
    amount: Number(r.amount),
    currency: r.currency || 'MNT',
    amountEur: r.amount_eur == null ? null : Number(r.amount_eur),
    exchangeRate: r.exchange_rate == null ? null : Number(r.exchange_rate),
    note: r.note ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  } : null);

  /** Balance = signed sum, валют тус бүрээр тусад ({mnt, eur}). */
  function getManualLedgerBalance(userId) {
    const row = _ledgerBalance.get(userId);
    return { mnt: Number(row.mnt), eur: Number(row.eur) };
  }

  /** Жагсаалт (entry_date DESC) + balance нэг дор. */
  function listManualLedger(userId) {
    return { rows: _listLedger.all(userId).map(_mapLedger), balance: getManualLedgerBalance(userId) };
  }

  function addManualLedgerEntry(userId, e) {
    const res = _insertLedger.run({
      user_id: userId,
      entry_date: e.date,
      type: e.type,
      amount: e.amount,
      currency: e.currency || 'MNT',
      amount_eur: e.amountEur ?? null,
      exchange_rate: e.exchangeRate ?? null,
      note: e.note ?? null,
    });
    return _mapLedger(_getLedgerEntry.get(Number(res.lastInsertRowid), userId));
  }

  /** Hard update — soft-delete/audit шаардлагагүй (хувийн, low-stakes хэрэгсэл). */
  function updateManualLedgerEntry(userId, id, e) {
    const res = _updateLedger.run({
      id, user_id: userId,
      entry_date: e.date, type: e.type, amount: e.amount, currency: e.currency || 'MNT',
      amount_eur: e.amountEur ?? null, exchange_rate: e.exchangeRate ?? null, note: e.note ?? null,
    });
    if (res.changes === 0) return null;
    return _mapLedger(_getLedgerEntry.get(id, userId));
  }

  function deleteManualLedgerEntry(userId, id) {
    return _deleteLedger.run(id, userId).changes;
  }

  // ===================== ӨР ТӨЛБӨРИЙН ДЭВТЭР (debt_ledger, per-user) =====================
  //  Философи нь manual_ledger_entries-тэй ИЖИЛ: дүн ЭХ ВАЛЮТААР, backend хөрвүүлэхгүй.
  //  Гүйлгээтэй холбогдох үед transactions.excluded_from_budget-г ХАМТ шинэчилдэг тул
  //  бүх ийм үйлдэл НЭГ SQLite транзакцид ороосон (тал дутуу төлөв үүсэхээс сэргийлнэ).

  const _debtCols = `id, user_id, counterparty, direction, amount, currency, entry_date, note,
                     status, linked_transaction_id, settled_transaction_id, exclusion_share,
                     created_at, settled_at`;

  const _mapDebt = (r) => (r ? {
    id: Number(r.id),
    counterparty: r.counterparty,
    direction: r.direction,
    amount: Number(r.amount),
    currency: r.currency || 'MNT',
    entryDate: r.entry_date,
    note: r.note ?? null,
    status: r.status,
    linkedTransactionId: r.linked_transaction_id == null ? null : Number(r.linked_transaction_id),
    settledTransactionId: r.settled_transaction_id == null ? null : Number(r.settled_transaction_id),
    // NULL = "бичлэгийн бүтэн amount-ыг эзэлнэ" (түгээмэл тохиолдол). Хэрэглэгч
    // тодорхой хувь хэмжээ (ж: цайллагын үлдэгдэл жигд бус хуваагдсан) өгвөл тоо.
    exclusionShare: r.exclusion_share == null ? null : Number(r.exclusion_share),
    createdAt: r.created_at,
    settledAt: r.settled_at ?? null,
  } : null);

  const _getDebt = db.prepare(`SELECT ${_debtCols} FROM debt_ledger WHERE id=? AND user_id=?`);

  /** Нэг өрийн бичлэг (per-user scoped) — олдохгүй бол null. */
  function getDebtEntry(userId, id) {
    return _mapDebt(_getDebt.get(id, userId));
  }

  /** Жагсаалт — шинэ нь эхэнд. counterparty/status шүүлт сонголттой. */
  function listDebtEntries(userId, { counterparty, status } = {}) {
    const where = ['user_id = ?'];
    const params = [userId];
    if (counterparty) { where.push('counterparty = ?'); params.push(String(counterparty).trim()); }
    if (status) { where.push('status = ?'); params.push(status); }
    return db.prepare(`SELECT ${_debtCols} FROM debt_ledger WHERE ${where.join(' AND ')}
      ORDER BY entry_date DESC, id DESC`).all(...params).map(_mapDebt);
  }

  /**
   * Хүн бүрээр, ВАЛЮТ ТУС БҮРЭЭР цэвэр үлдэгдэл (зөвхөн status='open').
   * net > 0 → тэр хүн ХЭРЭГЛЭГЧИД өртэй (i_lent давамгайлсан);
   * net < 0 → хэрэглэгч тэр хүнд өртэй. MNT ба EUR-ийг ХЭЗЭЭ Ч нийлүүлэхгүй.
   * Тэг болж цэвэршсэн хосыг буцаахгүй (өр үлдээгүй тул).
   */
  function getDebtBalances(userId) {
    return db.prepare(`
      SELECT counterparty, currency,
             COALESCE(SUM(CASE WHEN direction='i_lent' THEN amount ELSE -amount END), 0) AS net
      FROM debt_ledger
      WHERE user_id=? AND status='open'
      GROUP BY counterparty, currency
      HAVING net <> 0
      ORDER BY counterparty ASC, currency ASC`).all(userId)
      .map((r) => ({
        counterparty: r.counterparty,
        currency: r.currency,
        net: Number(r.net),
        direction: Number(r.net) > 0 ? 'i_lent' : 'i_borrowed',
      }));
  }

  // --- Гүйлгээний хасалтын туслахууд (016: туг БИШ, ДҮН) ---

  //  excluded_from_budget нь ЭНД, бичилт бүр дээр, "БҮРЭН хасагдсан"-аар дахин
  //  тооцоологдоно (excluded_amount >= amount). Тугийг уншиж байгаа ХУУЧИН бүх
  //  зам (buildWhere budgetOnly, getMonthly/getByCategory/getCycleSpend-ийн WHERE,
  //  route-ийн хариу) ийнхүү зөв хэвээр үлдэнэ.
  //  manually_edited: хасалт БАЙГАА үед 1 (pipeline дахин хөндөхгүй) — 0 болгож
  //  буцаахад БУЦААХГҮЙ (хэрэглэгч гар хүрсэн баримт хэвээр).
  const _setExcludedAmount = db.prepare(`UPDATE transactions
    SET excluded_amount = @amount,
        excluded_from_budget = CASE WHEN @amount > 0 AND @amount + ${EXCLUSION_EPS} >= amount THEN 1 ELSE 0 END,
        manually_edited = CASE WHEN @amount > 0 THEN 1 ELSE manually_edited END
    WHERE id=@id AND user_id=@user_id`);

  /**
   * Гүйлгээнээс төсвөөс хасах ДҮНГ тавих (0 = хасалтгүй). Хязгаар [0, amount] —
   * давбал ExclusionError('OVER_EXCLUSION'). Ангиллын нийлбэр ХЭЗЭЭ Ч сөрөг
   * болохгүйн баталгаа нь энэ.
   * @returns {number} өөрчлөгдсөн мөрийн тоо
   */
  function setTransactionExcludedAmount(userId, id, amount) {
    const row = byIdStmt.get(id, userId);
    if (!row) return 0;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) {
      throw new ExclusionError('INVALID_AMOUNT', 'Хасах дүн 0-ээс багагүй тоо байх ёстой');
    }
    const full = Number(row.amount);
    if (amt > full + EXCLUSION_EPS) {
      throw new ExclusionError('OVER_EXCLUSION',
        `Хасах дүн (${amt}) гүйлгээний дүнгээс (${full}) их байж болохгүй`);
    }
    // Float бөөрөнхийлөлт trigger-т мөргөхөөс сэргийлж таслана (амьд DB-д
    // excluded_amount ЯГ amount байх нь "бүрэн хасагдсан"-ы каноник хэлбэр).
    return _setExcludedAmount.run({ id, user_id: userId, amount: Math.min(amt, full) }).changes;
  }

  /**
   * Уламжлагдсан boolean API (015). Одоо ДҮН дээр буусан: true → бүтэн amount,
   * false → 0. Хуучин дуудагчид (route, тест) ЯГ адилхан ажиллана.
   * @returns {number} өөрчлөгдсөн мөрийн тоо
   */
  function setTransactionExclusion(userId, id, excluded) {
    const row = byIdStmt.get(id, userId);
    if (!row) return 0;
    return setTransactionExcludedAmount(userId, id, excluded ? Number(row.amount) : 0);
  }

  /**
   * Тухайн гүйлгээг ӨӨР өрийн бичлэг (excludeDebtId-аас бусад) хараахан
   * лавлаж байгаа эсэх. Гар аргаар хасалт өөрчлөхөөс ӨМНӨ ЗААВАЛ шалгана —
   * эс бөгөөс дэвтрийн тооцоо ба туг зөрнө.
   */
  function isTransactionReferencedByOtherDebt(userId, txnId, excludeDebtId = null) {
    if (txnId == null) return false;
    const row = db.prepare(`SELECT COUNT(*) c FROM debt_ledger
      WHERE user_id=? AND id IS NOT ?
        AND (linked_transaction_id=? OR settled_transaction_id=?)`)
      .get(userId, excludeDebtId, txnId, txnId);
    return Number(row.c) > 0;
  }

  // Тухайн гүйлгээг лавлаж буй БҮХ өрийн бичлэгийн хувь хэмжээний нийлбэр.
  // ⚠️ Нэг бичлэг гүйлгээг linked/settled аль алинд нь лавласан ч НЭГ Л удаа
  //    тоологдоно (бичлэг = нэг хувь хэмжээ).
  // ⚠️ Валют таарахгүй бичлэг НИЙЛБЭРТ ОРОХГҮЙ — 30 EUR-ыг MNT гүйлгээнээс
  //    хасах боломжгүй (route нь ийм холбоосыг 400-аар татгалздаг; энэ нь
  //    хоёр дахь хамгаалалт).
  const _debtShareSum = db.prepare(`
    SELECT COALESCE(SUM(COALESCE(d.exclusion_share, d.amount)), 0) AS s
    FROM debt_ledger d
    JOIN transactions t ON t.id = @txn AND t.user_id = @user
    WHERE d.user_id = @user
      AND (d.linked_transaction_id = @txn OR d.settled_transaction_id = @txn)
      AND d.currency = COALESCE(t.currency, 'MNT')`);

  /**
   * Гүйлгээний excluded_amount-ыг ХОЛБОГДСОН БИЧЛЭГҮҮДЭЭС дахин тооцоолно.
   * ⚠️ Тоолуур нэмэгдүүлэх/хасах БИШ — үргэлж бүх лавлагааны нийлбэрээс
   * шинээр гаргана (retry/давхар дуудалтад ч зөв). Тиймээс нэг бичлэг
   * салахад НӨГӨӨ бичлэгүүдийн хувь хэмжээ ХЭВЭЭР үлдэнэ (0 болж унахгүй).
   * ЗААВАЛ өрийн бичлэгийн бичилтийн ДАРАА дуудна.
   */
  function recomputeTransactionExclusion(userId, txnId) {
    if (txnId == null) return;
    const row = byIdStmt.get(txnId, userId);
    if (!row) return;
    const sum = Number(_debtShareSum.get({ txn: txnId, user: userId }).s);
    setTransactionExcludedAmount(userId, txnId, sum); // хэтэрвэл ExclusionError → rollback
  }

  /**
   * Өрийн бичлэгийн валют холбогдох гүйлгээнийхтэй таарч байгаа эсэх.
   * ⚠️ Backend ХЭЗЭЭ Ч хөрвүүлэхгүй (manual ledger/debt ledger-ийн үндсэн дүрэм) —
   * тиймээс валют зөрөх холбоос нь утгагүй, шууд татгалзана.
   */
  function assertLinkCurrency(userId, txnId, currency) {
    if (txnId == null) return;
    const row = byIdStmt.get(txnId, userId);
    if (!row) return; // байхгүй гүйлгээг дуудагч тал тусад нь 400 болгоно
    const txCur = row.currency || 'MNT';
    const debtCur = currency || 'MNT';
    if (txCur !== debtCur) {
      throw new ExclusionError('CURRENCY_MISMATCH',
        `Гүйлгээний валют (${txCur}) өрийн бичлэгийнхтэй (${debtCur}) таарахгүй тул холбох боломжгүй`);
    }
  }

  /** Гүйлгээ тухайн хэрэглэгчийнх мөн эсэх (холбохын өмнөх эрхийн шалгалт). */
  function transactionBelongsToUser(userId, txnId) {
    if (txnId == null) return true;
    return !!db.prepare('SELECT 1 FROM transactions WHERE id=? AND user_id=?').get(txnId, userId);
  }

  /** ⚠️ Хоёр хүснэгтэд бичих үйлдлийг НЭГ транзакцид ороож дуудна. */
  function inTransaction(fn) {
    db.exec('BEGIN');
    try { const out = fn(); db.exec('COMMIT'); return out; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  const _insertDebt = db.prepare(`
    INSERT INTO debt_ledger (user_id, counterparty, direction, amount, currency, entry_date, note,
                             status, linked_transaction_id, exclusion_share, created_at)
    VALUES (@user_id, @counterparty, @direction, @amount, @currency, @entry_date, @note,
            'open', @linked, @share, datetime('now'))`);

  /**
   * Шинэ өрийн бичлэг. linked_transaction_id өгвөл тэр гүйлгээнээс ЭНЭ бичлэгийн
   * хувь хэмжээг (exclusionShare ?? amount) төсвөөс хасна — нэг транзакцид, тал
   * дутуу төлөв үүсэхгүй. Хэтрэх/валют зөрөх бол throw → бүхэлдээ rollback.
   */
  function addDebtEntry(userId, e) {
    return inTransaction(() => {
      const currency = e.currency || 'MNT';
      if (e.linkedTransactionId != null) assertLinkCurrency(userId, e.linkedTransactionId, currency);
      const res = _insertDebt.run({
        user_id: userId,
        counterparty: String(e.counterparty).trim(),
        direction: e.direction,
        amount: e.amount,
        currency,
        entry_date: e.entryDate,
        note: e.note ?? null,
        linked: e.linkedTransactionId ?? null,
        share: e.exclusionShare ?? null,
      });
      if (e.linkedTransactionId != null) recomputeTransactionExclusion(userId, e.linkedTransactionId);
      return _mapDebt(_getDebt.get(Number(res.lastInsertRowid), userId));
    });
  }

  /**
   * Өрийн бичлэг засах / хаах (settle) / дахин нээх (re-open).
   * Хасалтын дүрэм (016 — ДҮНГЭЭР):
   *  - Холбоос ЭСВЭЛ amount/exclusion_share/currency өөрчлөгдвөл ХӨНДӨГДСӨН БҮХ
   *    гүйлгээний excluded_amount-ыг лавлагаануудаас нь ДАХИН ТООЦООЛНО. Хуучин
   *    холбоос дээр нөгөө бичлэгүүдийн хувь хэмжээ хэвээр үлдэнэ (0 болж унахгүй).
   *  - status 'settled' → settled_at тэмдэглэнэ; 'open' руу буцаавал
   *    settled_transaction_id-г цэвэрлэж, түүний хувь хэмжээг чөлөөлнө.
   * @returns {object|null} шинэчилсэн бичлэг, олдохгүй бол null
   */
  function updateDebtEntry(userId, id, patch) {
    return inTransaction(() => {
      const cur = _getDebt.get(id, userId);
      if (!cur) return null;

      const next = {
        counterparty: patch.counterparty !== undefined ? String(patch.counterparty).trim() : cur.counterparty,
        direction: patch.direction !== undefined ? patch.direction : cur.direction,
        amount: patch.amount !== undefined ? patch.amount : Number(cur.amount),
        currency: patch.currency !== undefined ? patch.currency : cur.currency,
        entry_date: patch.entryDate !== undefined ? patch.entryDate : cur.entry_date,
        note: patch.note !== undefined ? patch.note : cur.note,
        status: patch.status !== undefined ? patch.status : cur.status,
        linked: patch.linkedTransactionId !== undefined ? patch.linkedTransactionId : cur.linked_transaction_id,
        settledTxn: patch.settledTransactionId !== undefined ? patch.settledTransactionId : cur.settled_transaction_id,
        share: patch.exclusionShare !== undefined ? patch.exclusionShare : cur.exclusion_share,
      };
      // 'open' руу буцаахад хаалтын гүйлгээний холбоос утгагүй болно
      if (next.status === 'open') next.settledTxn = null;

      const oldLinked = cur.linked_transaction_id;
      const oldSettled = cur.settled_transaction_id;

      if (next.linked != null) assertLinkCurrency(userId, next.linked, next.currency);
      if (next.settledTxn != null) assertLinkCurrency(userId, next.settledTxn, next.currency);

      db.prepare(`UPDATE debt_ledger SET counterparty=@counterparty, direction=@direction, amount=@amount,
          currency=@currency, entry_date=@entry_date, note=@note, status=@status,
          linked_transaction_id=@linked, settled_transaction_id=@settledTxn, exclusion_share=@share,
          settled_at=CASE WHEN @status='settled' THEN COALESCE(settled_at, datetime('now')) ELSE NULL END
        WHERE id=@id AND user_id=@user_id`)
        .run({ ...next, id, user_id: userId });

      // Хөндөгдсөн БҮХ гүйлгээг (хуучин + шинэ) дахин тооцоолно. amount/share
      // өөрчлөгдсөн ч холбоос хэвээр бол хасалт зөв дагаж өөрчлөгдөнө.
      for (const txnId of new Set([oldLinked, oldSettled, next.linked, next.settledTxn].filter((v) => v != null))) {
        recomputeTransactionExclusion(userId, txnId);
      }

      return _mapDebt(_getDebt.get(id, userId));
    });
  }

  /**
   * Устгах + хөндөгдсөн гүйлгээнүүдийг дахин тооцоолох. ЗӨВХӨН энэ бичлэгийн
   * хувь хэмжээ хасагдана — нөгөө бичлэгүүдийнх хэвээр (устгасны ДАРАА
   * дахин тооцоолдог тул автоматаар).
   */
  function deleteDebtEntry(userId, id) {
    return inTransaction(() => {
      const cur = _getDebt.get(id, userId);
      if (!cur) return 0;
      const changes = db.prepare('DELETE FROM debt_ledger WHERE id=? AND user_id=?').run(id, userId).changes;
      if (changes) {
        for (const txnId of new Set([cur.linked_transaction_id, cur.settled_transaction_id].filter((v) => v != null))) {
          recomputeTransactionExclusion(userId, txnId);
        }
      }
      return changes;
    });
  }

  function close() { try { db.close(); } catch { /* ignore */ } }

  return {
    // users / auth
    createUser, getUserByEmail, getUserById, countUsers, getOwnerUserId,
    // transactions
    insertTransaction, getByMessageId, getById, getCurrentBalance, getBalanceAnchor, getDailyTxnStats,
    getDailyTransactionRows,
    listTransactions, getSummary,
    getMonthly, getByCategory, getCycleSpend, getPending, updateCategoryById, updateCategoryByPattern, updateTransactionFields,
    autoClassifyStalePending, setTransactionExclusion, setTransactionExcludedAmount, transactionBelongsToUser,
    // өр төлбөрийн дэвтэр (debt_ledger)
    listDebtEntries, getDebtEntry, getDebtBalances, addDebtEntry, updateDebtEntry, deleteDebtEntry,
    isTransactionReferencedByOtherDebt,
    // real-time tracker: %-хуваарилалт
    getBudgetAllocations, saveBudgetAllocations,
    // overrides
    addOverride, getOverrides, normalizeMerchant,
    // settings + personal events (төсөв)
    getSettings, saveSettings, listEvents, addEvent, deleteEvent,
    // google auth
    getUserByGoogleSub, upsertGoogleUser, saveGoogleTokens, getGoogleTokens, disconnectGoogleCalendar,
    // gmail холболт (multi-tenant listener)
    saveGmailTokens, disconnectGmail, setGmailStatus, getGmailInfo,
    // telegram холболт (multi-tenant bot)
    createTelegramLinkCode, getTelegramLink, disconnectTelegram,
    // гар аргаар удирдсан хөрөнгө (manual ledger)
    listManualLedger, addManualLedgerEntry, updateManualLedgerEntry, deleteManualLedgerEntry, getManualLedgerBalance,
    migrate, close, _raw: db,
  };
}

export default createDb;
