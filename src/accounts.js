// ============================================================
//  accounts.js — API-ийн DB-ээс холбогдсон Gmail дансуудыг унших
//
//  Multi-tenant: хэрэглэгч бүр dashboard-оос Gmail-аа холбоход refresh
//  token нь API DB-ийн google_tokens-д ШИФРЛЭГДЭЖ хадгалагдана. Listener
//  (энэ процесс) тэр DB файлыг шууд нээж уншина — token API хариугаар
//  ХЭЗЭЭ Ч дамждаггүй (invariant). SQLite WAL олон процессын уншилт +
//  хааяын бичилт (gmail_status)-ийг дэмжинэ.
//
//  ЭНД МИГРАЦ АЖИЛЛУУЛАХГҮЙ — schema-г зөвхөн API (createDb) удирдана.
//  gmail_* баганууд байхгүй бол (API хараахан шинэчлэгдээгүй) хоосон
//  жагсаалт буцаана.
// ============================================================

import { DatabaseSync } from 'node:sqlite';
import { decryptToken, encryptToken } from '../config/tokenCrypto.js';

/**
 * @param {{ apiDbPath: string, tokenEncKey: string }} opts
 */
export function createAccountsStore({ apiDbPath, tokenEncKey }) {
  const db = new DatabaseSync(apiDbPath);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA journal_mode = WAL');

  function hasGmailColumns() {
    try {
      return db.prepare('PRAGMA table_info(google_tokens)').all().some((c) => c.name === 'gmail_refresh_token');
    } catch {
      return false;
    }
  }

  /**
   * Идэвхтэй (холбогдсон, reauth шаардаагүй) дансууд.
   * @returns {{ userId: number, email: string, refreshToken: string }[]}
   */
  function listActiveAccounts() {
    if (!hasGmailColumns()) return [];
    const rows = db.prepare(`
      SELECT g.user_id, g.gmail_refresh_token, g.gmail_email, u.email AS user_email
      FROM google_tokens g JOIN users u ON u.id = g.user_id
      WHERE g.gmail_connected = 1 AND g.gmail_status = 'active'
            AND g.gmail_refresh_token IS NOT NULL`).all();
    const out = [];
    for (const r of rows) {
      try {
        out.push({
          userId: Number(r.user_id),
          email: r.gmail_email || r.user_email,
          refreshToken: decryptToken(r.gmail_refresh_token, tokenEncKey),
        });
      } catch {
        // Тайлагдахгүй token (key зөрсөн г.м) — тухайн дансыг алгасна,
        // бусад данс үргэлжилнэ. Token утгыг log-д хэвлэхгүй.
      }
    }
    return out;
  }

  /** invalid_grant → тухайн хэрэглэгчийг reauth_needed болгоно (бусдад нөлөөгүй). */
  function markReauthNeeded(userId) {
    if (!hasGmailColumns()) return;
    db.prepare(`UPDATE google_tokens SET gmail_status = 'reauth_needed', updated_at = datetime('now') WHERE user_id = ?`)
      .run(userId);
  }

  /**
   * Нэг удаагийн owner seed: хуучин .env-ийн GMAIL_REFRESH_TOKEN-ийг owner
   * (хамгийн бага id) хэрэглэгчийн Gmail холболт болгож шифрлэн оруулна.
   * Идемпотент — owner аль хэдийн gmail token-той бол юу ч хийхгүй.
   * @param {{ refreshToken: string, email: string }} legacy
   * @returns {boolean} seed хийсэн эсэх
   */
  function seedOwnerFromEnv(legacy) {
    if (!legacy?.refreshToken || !hasGmailColumns()) return false;
    const owner = db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
    if (!owner) return false;
    const existing = db.prepare('SELECT gmail_refresh_token FROM google_tokens WHERE user_id = ?').get(owner.id);
    if (existing && existing.gmail_refresh_token) return false; // аль хэдийн холбогдсон

    db.prepare(`INSERT INTO google_tokens
        (user_id, gmail_refresh_token, gmail_scope, gmail_email, gmail_connected, gmail_status, updated_at)
      VALUES (?, ?, 'https://mail.google.com/', ?, 1, 'active', datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        gmail_refresh_token = excluded.gmail_refresh_token,
        gmail_scope = excluded.gmail_scope,
        gmail_email = excluded.gmail_email,
        gmail_connected = 1,
        gmail_status = 'active',
        updated_at = excluded.updated_at`)
      .run(owner.id, encryptToken(legacy.refreshToken, tokenEncKey), String(legacy.email || '').toLowerCase().trim() || null);
    return true;
  }

  function close() {
    try { db.close(); } catch { /* ignore */ }
  }

  return { listActiveAccounts, markReauthNeeded, seedOwnerFromEnv, close, _raw: db };
}

export default createAccountsStore;
