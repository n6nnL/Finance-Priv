// ============================================================
//  db.js — SQLite (node:sqlite, Node 22.5+/24 — native build хэрэггүй)
//  Хадгалах зүйлс:
//    - lastSeenUid + UIDVALIDITY (state хүснэгт)
//    - боловсруулсан Message-ID (идэмпотентность)
//    - гүйлгээ + статус (parse_failed / push_failed / pushed)
// ============================================================

// Node.js-д суурилуулсан SQLite (node:sqlite). Native compile (Python/
// Build Tools) шаардахгүй. Node 22.5+/24-д бэлэн ирдэг.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';
import { logger } from './logger.js';

// DB хавтас байхгүй бол үүсгэнэ
mkdirSync(dirname(config.dbPath), { recursive: true });

const db = new DatabaseSync(config.dbPath);
// WAL — олон уншилт/нэг бичилтэд найдвартай, гүйцэтгэл сайн
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');

// ------------------------------------------------------------
// Схем
// ------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS state (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS transactions (
    message_id   TEXT PRIMARY KEY,        -- идэмпотентность түлхүүр
    uid          INTEGER,                 -- IMAP UID (мэдээллийн зорилгоор)
    status       TEXT NOT NULL,           -- pushed | push_failed | parse_failed | skipped
    amount       REAL,
    currency     TEXT,
    direction    TEXT,                    -- debit (зарлага) | credit (орлого)
    description  TEXT,
    category     TEXT,
    account_tail TEXT,                    -- дансны сүүлийн оронтой дугаар
    tx_date      TEXT,                    -- гүйлгээний огноо (ISO эсвэл raw)
    raw_subject  TEXT,
    payload_json TEXT,                    -- API руу явуулсан/явуулах JSON
    error        TEXT,                    -- parse/push алдааны мессеж
    attempts     INTEGER DEFAULT 0,       -- push оролдлогын тоо
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);
`);

// Multi-tenant: гүйлгээ аль хэрэглэгчийн inbox-оос ирснийг тэмдэглэнэ (идемпотент ALTER)
{
  const cols = db.prepare('PRAGMA table_info(transactions)').all();
  if (!cols.some((c) => c.name === 'user_id')) {
    db.exec('ALTER TABLE transactions ADD COLUMN user_id INTEGER');
  }
}

const now = () => new Date().toISOString();

// ------------------------------------------------------------
// State (lastSeenUid, uidvalidity) — key/value
// ------------------------------------------------------------
const _getState = db.prepare('SELECT value FROM state WHERE key = ?');
const _setState = db.prepare(`
  INSERT INTO state(key, value) VALUES(?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

export function getState(key) {
  const row = _getState.get(key);
  return row ? row.value : null;
}

export function setState(key, value) {
  _setState.run(key, String(value));
}

// Multi-tenant: state key-ууд хэрэглэгч бүрээр scoped (`lastSeenUid:<userId>`).
// Хуучин global key-г owner руу нэг удаа шилжүүлэх нь migrateLegacyStateToUser()-д.

export function getLastSeenUid(userId) {
  const v = getState(`lastSeenUid:${userId}`);
  return v ? Number(v) : 0;
}

export function setLastSeenUid(userId, uid) {
  setState(`lastSeenUid:${userId}`, uid);
}

export function getUidValidity(userId) {
  const v = getState(`uidValidity:${userId}`);
  return v ? Number(v) : null;
}

export function setUidValidity(userId, v) {
  setState(`uidValidity:${userId}`, v);
}

// UIDVALIDITY өөрчлөгдвөл хуучин UID-ууд хүчингүй болно.
// Энэ тохиолдолд lastSeenUid-г 0 болгож reset хийнэ
// (Message-ID идэмпотентность давхар хамгаална тул давхардахгүй).
export function handleUidValidityChange(userId, newValidity) {
  const old = getUidValidity(userId);
  if (old !== null && old !== Number(newValidity)) {
    logger.warn(
      { userId, old, new: newValidity },
      'UIDVALIDITY өөрчлөгдсөн — lastSeenUid reset хийнэ (Message-ID идэмпотентность хамгаална)'
    );
    setLastSeenUid(userId, 0);
  }
  setUidValidity(userId, newValidity);
}

/**
 * Нэг удаагийн миграц: хуучин global `lastSeenUid`/`uidValidity` утгыг owner-ийн
 * scoped key рүү шилжүүлнэ (идемпотент — global key устгагдсаны дараа дахин орохгүй).
 */
export function migrateLegacyStateToUser(userId) {
  const legacyUid = getState('lastSeenUid');
  if (legacyUid != null && getState(`lastSeenUid:${userId}`) == null) {
    setState(`lastSeenUid:${userId}`, legacyUid);
    logger.info({ userId, lastSeenUid: legacyUid }, 'Хуучин lastSeenUid-г owner руу шилжүүлэв');
  }
  const legacyValidity = getState('uidValidity');
  if (legacyValidity != null && getState(`uidValidity:${userId}`) == null) {
    setState(`uidValidity:${userId}`, legacyValidity);
  }
  db.prepare("DELETE FROM state WHERE key IN ('lastSeenUid','uidValidity')").run();
}

// ------------------------------------------------------------
// Идэмпотентность — Message-ID шалгах
// ------------------------------------------------------------
const _hasMessage = db.prepare('SELECT 1 FROM transactions WHERE message_id = ?');

export function isProcessed(messageId) {
  if (!messageId) return false;
  return !!_hasMessage.get(messageId);
}

// ------------------------------------------------------------
// Гүйлгээ хадгалах / шинэчлэх
// ------------------------------------------------------------
const _insertTx = db.prepare(`
  INSERT INTO transactions (
    message_id, user_id, uid, status, amount, currency, direction, description,
    category, account_tail, tx_date, raw_subject, payload_json, error,
    attempts, created_at, updated_at
  ) VALUES (
    @message_id, @user_id, @uid, @status, @amount, @currency, @direction, @description,
    @category, @account_tail, @tx_date, @raw_subject, @payload_json, @error,
    @attempts, @created_at, @updated_at
  )
  ON CONFLICT(message_id) DO NOTHING
`);

export function insertTransaction(tx) {
  const ts = now();
  const row = {
    message_id: tx.messageId,
    user_id: tx.userId ?? null,
    uid: tx.uid ?? null,
    status: tx.status,
    amount: tx.amount ?? null,
    currency: tx.currency ?? null,
    direction: tx.direction ?? null,
    description: tx.description ?? null,
    category: tx.category ?? null,
    account_tail: tx.accountTail ?? null,
    tx_date: tx.date ?? null,
    raw_subject: tx.subject ?? null,
    payload_json: tx.payload ? JSON.stringify(tx.payload) : null,
    error: tx.error ?? null,
    attempts: tx.attempts ?? 0,
    created_at: ts,
    updated_at: ts,
  };
  const res = _insertTx.run(row);
  return res.changes > 0; // true = шинээр орсон, false = аль хэдийн байсан
}

const _updateStatus = db.prepare(`
  UPDATE transactions
  SET status = @status, error = @error, attempts = @attempts, updated_at = @updated_at
  WHERE message_id = @message_id
`);

export function updateTransactionStatus(messageId, { status, error = null, attempts }) {
  _updateStatus.run({
    message_id: messageId,
    status,
    error,
    attempts: attempts ?? 0,
    updated_at: now(),
  });
}

// ------------------------------------------------------------
// Re-push: push_failed гүйлгээнүүдийг авах
// ------------------------------------------------------------
const _failedPushes = db.prepare(`
  SELECT * FROM transactions WHERE status = 'push_failed' ORDER BY created_at ASC
`);

export function getFailedPushes() {
  return _failedPushes.all();
}

export function closeDb() {
  try {
    db.close();
  } catch {
    /* ignore */
  }
}

export default db;
