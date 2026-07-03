// ============================================================
//  manager.js — олон хэрэглэгчийн IMAP listener-үүдийг удирдах
//
//  Reconcile загвар: тогтмол интервалд DB-ээс идэвхтэй дансуудыг уншиж,
//    - шинэ данс → listener асаана
//    - салгагдсан / reauth_needed болсон данс → listener зогсооно
//    - token/email өөрчлөгдсөн (дахин холбосон) данс → restart
//  Нэг дансны алдаа бусдад нөлөөлөхгүй: listener бүр өөрийн run() loop-тэй,
//  invalid_grant үед өөрөө зогсоод (onAuthError → reauth_needed) дараагийн
//  reconcile дээр цэвэрлэгдэнэ.
//
//  Цэвэр логик — config/env импортгүй (тест хийхэд хялбар). Бүх хамаарал
//  (данс унших, listener үүсгэх, лог) injected.
// ============================================================

/**
 * @param {{
 *   listAccounts: () => { userId:number, email:string, refreshToken:string }[],
 *   createListener: (account) => { run:()=>Promise<void>, stop:()=>Promise<void>, msSinceLastMessage:()=>number },
 *   logger: { info:Function, warn:Function, error:Function },
 * }} deps
 */
export function createManager({ listAccounts, createListener, logger }) {
  /** @type {Map<number, { listener, refreshToken, email, runPromise }>} */
  const running = new Map();

  async function stopEntry(userId, entry, reason) {
    logger.info({ userId, email: entry.email, reason }, 'Listener зогсооно');
    try {
      await entry.listener.stop();
    } catch (err) {
      logger.warn({ userId, err: err?.message }, 'Listener зогсооход алдаа (үргэлжилнэ)');
    }
    running.delete(userId);
  }

  /**
   * DB-ийн төлөвтэй нийцүүлнэ. Алдаа гарвал throw хийхгүй (нэг reconcile
   * алдаа дараагийн интервалыг зогсоохгүй).
   */
  async function reconcile() {
    let accounts;
    try {
      accounts = listAccounts();
    } catch (err) {
      logger.error({ err: err?.message }, 'Данс унших алдаа — дараагийн интервалд дахин оролдоно');
      return;
    }
    const activeIds = new Set(accounts.map((a) => a.userId));

    // 1) Идэвхгүй болсон (салгасан / reauth_needed) → зогсооно
    for (const [userId, entry] of [...running]) {
      if (!activeIds.has(userId)) await stopEntry(userId, entry, 'идэвхгүй болсон');
    }

    // 2) Шинэ данс асаах / өөрчлөгдсөн данс restart
    for (const acc of accounts) {
      const entry = running.get(acc.userId);
      if (entry && entry.refreshToken === acc.refreshToken && entry.email === acc.email
          && entry.oauthClient === acc.oauthClient) continue;
      if (entry) await stopEntry(acc.userId, entry, 'token/email өөрчлөгдсөн — restart');

      const listener = createListener(acc);
      logger.info({ userId: acc.userId, email: acc.email }, 'Listener асаана');
      // run() нь stop болтол буцахгүй — background-д ажиллана. Алдааг нь
      // энд барьж процессыг унагаахгүй (listener дотроо reconnect хийдэг).
      const runPromise = listener.run().catch((err) => {
        logger.error({ userId: acc.userId, email: acc.email, err: err?.message }, 'Listener run() алдаа — зогслоо');
      });
      running.set(acc.userId, {
        listener, refreshToken: acc.refreshToken, email: acc.email, oauthClient: acc.oauthClient, runPromise,
      });
    }
  }

  async function stopAll() {
    for (const [userId, entry] of [...running]) {
      await stopEntry(userId, entry, 'shutdown');
    }
  }

  /** Heartbeat-д: данс бүрийн сүүлийн имэйлээс хойшх ms */
  function statuses() {
    return [...running.entries()].map(([userId, e]) => ({
      userId, email: e.email, msSinceLastMessage: e.listener.msSinceLastMessage(),
    }));
  }

  return { reconcile, stopAll, statuses, running };
}

export default createManager;
