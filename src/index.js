// ============================================================
//  index.js — Entry point. Бүх модулийг холбож ажиллуулна.
//
//  Multi-tenant урсгал:
//    API DB-ээс холбогдсон дансууд (reconcile poll) → данс бүрт IMAP IDLE
//    → имэйл ирэх → банкны хаягаар шүүх → идэмпотентность шалгах
//    → parseGolomt → categorize → DB-д insert (user_id-тай)
//    → API руу push (payload.userId = тухайн дансны хэрэглэгч) → статус шинэчлэх
// ============================================================

import { config } from './config.js';
import { logger, notifyError } from './logger.js';
import { ImapListener } from './imap-client.js';
import { createAccountsStore } from './accounts.js';
import { createManager } from './manager.js';
import { parseGolomt } from './parsers/golomt.js';
import { categorize } from './categorize.js';
import { pushTransaction } from './push.js';
import {
  isProcessed,
  insertTransaction,
  updateTransactionStatus,
  migrateLegacyStateToUser,
  closeDb,
} from './db.js';

/**
 * Илгээгчийн хаягийг envelope/parsed-аас гаргаж авч шүүх.
 */
function senderMatches(parsed) {
  const from = parsed?.from?.value?.[0]?.address?.toLowerCase() ?? '';
  return from === config.bankSender;
}

/**
 * Нэг имэйлийг боловсруулах гол функц (imap-client-ээс дуудагдана).
 * account = аль хэрэглэгчийн inbox-оос уншсан — гүйлгээ ТҮҮНД ноогдоно.
 * Алдаа гарвал throw хийхгүй — listener-ийг унтраахгүй.
 */
async function processEmail(account, parsed, uid) {
  const messageId = parsed.messageId ?? null;
  const subject = parsed.subject ?? '';

  // 1) Банкны хаягаар шүүх
  if (!senderMatches(parsed)) {
    logger.debug({ uid, from: parsed?.from?.text }, 'Банкны хаяг биш — алгасав');
    return;
  }

  // 2) Message-ID байхгүй бол сэжигтэй — UID-ээр түлхүүр үүсгэнэ
  const idKey = messageId || `uid-${uid}-${subject}`;

  // 3) Идэмпотентность: аль хэдийн боловсруулсан уу?
  if (isProcessed(idKey)) {
    logger.debug({ idKey }, 'Аль хэдийн боловсруулсан — алгасав');
    return;
  }

  logger.info({ uid, subject, messageId: idKey, userId: account.userId }, '📩 Банкны имэйл ирлээ');

  // 4) Parse — parseGolomt нь simpleParser-ийн үр дүнг ШУУД авна.
  let tx = null;
  try {
    tx = parseGolomt(parsed);
  } catch (err) {
    logger.error({ uid, err: err?.message }, 'Parse exception');
  }

  // 5) Parse алдсан → DB-д parse_failed гэж тэмдэглэж, Message-ID бүртгэнэ.
  //    parseGolomt үргэлж object буцаадаг тул шаардлагатай талбар (amount)
  //    байгаа эсэхээр амжилтыг шална.
  if (!tx || tx.amount == null) {
    logger.warn({ uid, subject }, '⚠️ Parse амжилтгүй (дүн олдсонгүй) — parse_failed');
    insertTransaction({
      messageId: idKey,
      userId: account.userId,
      uid,
      status: 'parse_failed',
      subject,
      error: 'Шаардлагатай талбар (amount) олдсонгүй',
    });
    await notifyError('parse-failed', new Error(`Parse failed: ${subject}`));
    return;
  }

  // 6) Ангилах (parser category-г null үлдээдэг тул энд онооно)
  const category = categorize(tx);

  // 7) API payload бэлдэх — вэбсайтын API-ийн каноник гэрээтэй ИЖИЛ:
  //    messageId, amount, currency, date, description, type, category,
  //    accountLast4, raw + userId (multi-tenant: API талд ЗААВАЛ, owner fallback үгүй).
  const payload = {
    messageId: idKey,
    userId: account.userId,
    amount: tx.amount,
    currency: tx.currency,
    date: tx.date,
    description: tx.description,
    type: tx.type, // parser шууд 'expense'|'income' буцаана
    category,
    accountLast4: tx.accountLast4,
    isPos: tx.isPos, // BOM дүрэм (POS гүйлгээ эсэх)
    raw: (tx.raw || subject || '').slice(0, 4000),
  };

  // 8) DB-д урьдчилж insert (status: pushing-ийн оронд эхэлж push_failed-аар
  //    тэмдэглэж, амжилттай бол шинэчилнэ — ингэснээр push дунд унтарсан ч
  //    гүйлгээ DB-д үлдэж re-push боломжтой).
  //    DB-ийн дотоод багана direction/accountTail-д type/accountLast4-г буулгана.
  const inserted = insertTransaction({
    messageId: idKey,
    userId: account.userId,
    uid,
    status: 'push_failed', // түр төлөв; push амжилттай бол pushed болгоно
    amount: tx.amount,
    currency: tx.currency,
    direction: tx.type === 'income' ? 'credit' : 'debit',
    description: tx.description,
    category,
    accountTail: tx.accountLast4,
    date: tx.date,
    subject,
    payload,
    attempts: 0,
  });

  if (!inserted) {
    // Хоорондын race — өөр газар insert хийчихсэн
    logger.debug({ idKey }, 'Insert race — аль хэдийн орсон, алгасав');
    return;
  }

  // 9) Push (retry-той)
  const result = await pushTransaction(payload, idKey);

  if (result.ok) {
    updateTransactionStatus(idKey, { status: 'pushed', attempts: result.attempts });
    logger.info({ idKey, amount: tx.amount, category, direction: tx.direction }, '✅ Гүйлгээ бүртгэгдлээ');
  } else {
    updateTransactionStatus(idKey, {
      status: 'push_failed',
      error: result.error,
      attempts: result.attempts,
    });
    logger.error({ idKey, err: result.error }, '❌ Push амжилтгүй — push_failed (дараа re-push)');
    await notifyError('push-failed', new Error(result.error || 'push failed'));
  }
}

// ------------------------------------------------------------
// Heartbeat: данс бүрийн "alive" log + удаан имэйлгүй бол warning
// ------------------------------------------------------------
function startHeartbeat(manager) {
  const intervalMs = config.heartbeatSeconds * 1000;
  const warnMs = config.idleWarnMinutes * 60 * 1000;
  const timer = setInterval(() => {
    const statuses = manager.statuses();
    if (statuses.length === 0) {
      logger.info('💓 Heartbeat — холбогдсон данс алга (Gmail холбохыг хүлээж байна)');
      return;
    }
    for (const s of statuses) {
      const mins = Math.round(s.msSinceLastMessage / 60000);
      if (s.msSinceLastMessage > warnMs) {
        logger.warn({ email: s.email, minutesSinceLastEmail: mins }, '💓 Heartbeat — удаан имэйл ирээгүй (warning)');
      } else {
        logger.info({ email: s.email, minutesSinceLastEmail: mins }, '💓 Heartbeat — alive');
      }
    }
  }, intervalMs);
  if (timer.unref) timer.unref();
  return timer;
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------
async function main() {
  logger.info(
    { mailbox: config.gmail.mailbox, sender: config.bankSender, api: config.website.apiUrl },
    '🚀 Bank email listener эхэлж байна (multi-tenant)'
  );

  const accounts = createAccountsStore({
    apiDbPath: config.apiDbPath,
    tokenEncKey: config.tokenEncKey,
  });

  // Нэг удаагийн шилжилт: хуучин .env-ийн GMAIL_REFRESH_TOKEN → owner-ийн
  // Gmail холболт (шифрлэгдэж DB-д). Мөн хуучин global lastSeenUid → owner scoped.
  if (config.oauth.refreshToken) {
    const seeded = accounts.seedOwnerFromEnv({
      refreshToken: config.oauth.refreshToken,
      email: config.gmail.user,
    });
    if (seeded) logger.info('Owner-ийн Gmail холболтыг .env-ээс seed хийлээ (шифрлэгдсэн)');
  }
  const firstAccount = accounts.listActiveAccounts()[0];
  if (firstAccount) migrateLegacyStateToUser(firstAccount.userId);

  const manager = createManager({
    listAccounts: () => accounts.listActiveAccounts(),
    createListener: (acc) => new ImapListener({
      userId: acc.userId,
      email: acc.email,
      refreshToken: acc.refreshToken,
      // token-ыг олгосон яг тэр client-ээр л сэргээх ёстой (Google
      // 'unauthorized_client' өгдөг эс тэгвэл) — migration 011, accounts.js.
      clientId: acc.oauthClient === 'web' ? config.oauth.webClientId : config.oauth.clientId,
      clientSecret: acc.oauthClient === 'web' ? config.oauth.webClientSecret : config.oauth.clientSecret,
      onMessage: (parsed, uid) => processEmail(acc, parsed, uid),
      onAuthError: () => {
        // invalid_grant → энэ хэрэглэгч дахин холбох шаардлагатай; бусад үргэлжилнэ
        logger.warn({ userId: acc.userId, email: acc.email }, 'invalid_grant — gmail_status=reauth_needed');
        try { accounts.markReauthNeeded(acc.userId); } catch (err) {
          logger.error({ err: err?.message }, 'reauth_needed тэмдэглэхэд алдаа');
        }
        // Owner admin observability: тухайн хэрэглэгч дахин холбогдох хэрэгтэйг owner-т мэдэгдэнэ.
        notifyError('gmail-reauth-needed', new Error(`Gmail дахин холбох шаардлагатай: ${acc.email}`));
      },
    }),
    logger,
  });

  const heartbeat = startHeartbeat(manager);

  // Reconcile: эхэлмэгц нэг удаа, дараа нь тогтмол интервалд (данс нэмэгдэх/
  // хасагдахыг процесс restart-гүйгээр барина). unref ХИЙХГҮЙ — данс 0 үед ч
  // энэ interval процессыг амьд барьж, Gmail холбогдохыг хүлээнэ.
  await manager.reconcile();
  const reconcileTimer = setInterval(() => {
    manager.reconcile().catch((err) => logger.error({ err: err?.message }, 'reconcile алдаа'));
  }, config.accountsPollSeconds * 1000);

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info({ signal }, 'Зогсоох дохио — graceful shutdown');
    clearInterval(heartbeat);
    clearInterval(reconcileTimer);
    try {
      await manager.stopAll();
    } catch (err) {
      logger.error({ err: err?.message }, 'Listener зогсооход алдаа');
    }
    accounts.close();
    closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Бүх async-ийн сүүлчийн хамгаалалт — процесс унтраахгүй
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: reason?.message ?? String(reason) }, 'unhandledRejection');
    notifyError('unhandledRejection', reason);
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err: err?.message, stack: err?.stack }, 'uncaughtException');
    notifyError('uncaughtException', err);
  });

  // main() эндээс буцна — reconcile interval (ref-тэй) процессыг амьд барина;
  // listener-үүд manager дотор background ажиллана.
}

main().catch(async (err) => {
  logger.fatal({ err: err?.message, stack: err?.stack }, 'main() амжилтгүй — гаралаа');
  await notifyError('main-fatal', err);
  process.exit(1);
});
