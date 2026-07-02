// ============================================================
//  telegram/db.js — API-ийн DB-тэй харьцах цорын ганц цэг (bot процесс)
//
//  Bot ЗӨВХӨН ӨӨРИЙН bookkeeping 3 хүснэгтэд (telegram_links,
//  telegram_link_codes, telegram_notifications) шууд унших/бичих эрхтэй —
//  санхүүгийн өгөгдөлд (transactions/category_overrides) ХЭЗЭЭ Ч шууд
//  бичихгүй, зөвхөн уншина (мэдэгдэл илрүүлэхэд, Discord bot-той ижил
//  polling загвар) — жинхэнэ бичилт apiClient.js-ээр (JWT-тэй REST дуудлага).
//
//  ЭНД МИГРАЦ АЖИЛЛУУЛАХГҮЙ — schema-г зөвхөн api/db.js удирдана. Хүснэгт
//  байхгүй бол (API хараахан шинэчлэгдээгүй) graceful-аар хоосон/false буцаана.
// ============================================================

import { DatabaseSync } from 'node:sqlite';

export function createTelegramStore({ dbPath }) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA journal_mode = WAL');

  function hasTable(name) {
    try {
      return !!db.prepare('SELECT 1 FROM sqlite_master WHERE type=? AND name=?').get('table', name);
    } catch {
      return false;
    }
  }
  const ready = () => hasTable('telegram_links') && hasTable('telegram_link_codes') && hasTable('telegram_notifications');

  /** chat_id → user_id (холбогдоогүй бол null). */
  function resolveUserByChatId(chatId) {
    if (!ready()) return null;
    const row = db.prepare('SELECT user_id FROM telegram_links WHERE chat_id=?').get(String(chatId));
    return row ? Number(row.user_id) : null;
  }

  /** JWT mint хийхэд хэрэгтэй хэрэглэгчийн үндсэн мэдээлэл (token/нууц утга орохгүй). */
  function getUserBasic(userId) {
    const row = db.prepare('SELECT id, email, role FROM users WHERE id=?').get(userId);
    return row ? { id: Number(row.id), email: row.email, role: row.role } : null;
  }

  /** userId → { chatId } (холбогдоогүй бол null). */
  function getLinkByUserId(userId) {
    if (!ready()) return null;
    const row = db.prepare('SELECT chat_id FROM telegram_links WHERE user_id=?').get(userId);
    return row ? { chatId: row.chat_id } : null;
  }

  /**
   * Linking код зарцуулах: хүчинтэй (ашиглаагүй, хугацаа дуусаагүй) бол
   * chat_id-г тухайн userId-д холбоно. Атомик (BEGIN/COMMIT).
   * @returns {{ ok:true, userId:number } | { ok:false, reason:'invalid'|'expired'|'used'|'chat_taken' }}
   */
  function consumeLinkCode(code, chatId) {
    if (!ready()) return { ok: false, reason: 'invalid' };
    const row = db.prepare('SELECT user_id, expires_at, used FROM telegram_link_codes WHERE code=?').get(String(code).trim());
    if (!row) return { ok: false, reason: 'invalid' };
    if (row.used) return { ok: false, reason: 'used' };
    const expired = db.prepare(`SELECT datetime('now') > ? AS e`).get(row.expires_at).e;
    if (expired) return { ok: false, reason: 'expired' };

    db.exec('BEGIN');
    try {
      db.prepare('UPDATE telegram_link_codes SET used=1 WHERE code=?').run(String(code).trim());
      db.prepare(
        `INSERT INTO telegram_links (user_id, chat_id, linked_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET chat_id=excluded.chat_id, linked_at=excluded.linked_at`
      ).run(row.user_id, String(chatId));
      db.exec('COMMIT');
      return { ok: true, userId: Number(row.user_id) };
    } catch (e) {
      db.exec('ROLLBACK');
      // UNIQUE(chat_id) зөрчил — энэ chat өөр хэрэглэгчид аль хэдийн холбогдсон
      if (/UNIQUE/i.test(e?.message || '')) return { ok: false, reason: 'chat_taken' };
      throw e;
    }
  }

  /** Bot-ийн /unlink команд — chat_id-аар олж устгана. */
  function unlinkByChatId(chatId) {
    if (!ready()) return false;
    const res = db.prepare('DELETE FROM telegram_links WHERE chat_id=?').run(String(chatId));
    return res.changes > 0;
  }

  /** Одоогийн хамгийн их transaction id (анх асахад backlog алгасахад). */
  function getMaxTransactionId() {
    const row = db.prepare('SELECT COALESCE(MAX(id),0) AS m FROM transactions').get();
    return Number(row.m);
  }

  /**
   * id > sinceId бөгөөд ХОЛБОГДСОН хэрэглэгчийн шинэ гүйлгээ (олон хэрэглэгч
   * зэрэг) — Discord-ийн owner-only polling-той ижил загвар, зөвхөн олон
   * хэрэглэгчид JOIN нэмэгдсэн.
   */
  function listNewLinkedTransactions(sinceId) {
    if (!ready()) return [];
    return db.prepare(`
      SELECT t.*, l.chat_id AS chat_id
      FROM transactions t
      JOIN telegram_links l ON l.user_id = t.user_id
      WHERE t.id > ?
      ORDER BY t.id ASC LIMIT 50
    `).all(sinceId);
  }

  /**
   * Мэдэгдэл давхар илгээхгүй байх идэмпотентность. INSERT OR IGNORE —
   * changes>0 бол ЭНЭ дуудлага анхных (илгээх ёстой).
   */
  function markNotified(transactionId, chatId, messageId = null) {
    const res = db.prepare(
      `INSERT OR IGNORE INTO telegram_notifications (transaction_id, chat_id, message_id) VALUES (?, ?, ?)`
    ).run(transactionId, String(chatId), messageId != null ? String(messageId) : null);
    return res.changes > 0;
  }

  /** Гүйлгээний одоогийн төлөв (stale эсэх шалгах, Discord bot-той ижил зорилго). */
  function getTransaction(id) {
    return db.prepare('SELECT * FROM transactions WHERE id=?').get(id) ?? null;
  }

  /** /status команд: тухайн хэрэглэгчийн Gmail холболтын төлөв (token БИШ). */
  function getGmailStatus(userId) {
    try {
      const row = db.prepare('SELECT gmail_connected, gmail_status FROM google_tokens WHERE user_id=?').get(userId);
      return { connected: Boolean(row && row.gmail_connected), status: row ? String(row.gmail_status || '') : '' };
    } catch {
      return { connected: false, status: '' };
    }
  }

  function close() {
    try { db.close(); } catch { /* ignore */ }
  }

  return {
    resolveUserByChatId, getUserBasic, getLinkByUserId, consumeLinkCode, unlinkByChatId,
    getMaxTransactionId, listNewLinkedTransactions, markNotified, getTransaction, getGmailStatus,
    close, _raw: db,
  };
}

export default createTelegramStore;
