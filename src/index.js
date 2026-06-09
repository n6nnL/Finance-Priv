// ============================================================
//  index.js — Entry point. Бүх модулийг холбож ажиллуулна.
//
//  Урсгал:
//    Имэйл ирэх → банкны хаягаар шүүх → идэмпотентность шалгах
//    → parseGolomt → categorize → DB-д insert → API руу push
//    → статус шинэчлэх
// ============================================================

import { config } from './config.js';
import { logger, notifyError } from './logger.js';
import { ImapListener } from './imap-client.js';
import { parseGolomt } from './parsers/golomt.js';
import { categorize } from './categorize.js';
import { pushTransaction } from './push.js';
import {
  isProcessed,
  insertTransaction,
  updateTransactionStatus,
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
 * Алдаа гарвал throw хийхгүй — listener-ийг унтраахгүй.
 */
async function processEmail(parsed, uid) {
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

  logger.info({ uid, subject, messageId: idKey }, '📩 Банкны имэйл ирлээ');

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
  //    accountLast4, raw  (bank-api-endpoint гэрээ).
  const payload = {
    messageId: idKey,
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
// Heartbeat: тогтмол "alive" log + удаан имэйлгүй бол warning
// ------------------------------------------------------------
function startHeartbeat(listener) {
  const intervalMs = config.heartbeatSeconds * 1000;
  const warnMs = config.idleWarnMinutes * 60 * 1000;
  const timer = setInterval(() => {
    const since = listener.msSinceLastMessage();
    const mins = Math.round(since / 60000);
    if (since > warnMs) {
      logger.warn({ minutesSinceLastEmail: mins }, '💓 Heartbeat — удаан имэйл ирээгүй (warning)');
    } else {
      logger.info({ minutesSinceLastEmail: mins }, '💓 Heartbeat — alive');
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
    '🚀 Bank email listener эхэлж байна'
  );

  const listener = new ImapListener(processEmail);
  const heartbeat = startHeartbeat(listener);

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info({ signal }, 'Зогсоох дохио — graceful shutdown');
    clearInterval(heartbeat);
    try {
      await listener.stop();
    } catch (err) {
      logger.error({ err: err?.message }, 'Listener зогсооход алдаа');
    }
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

  // Listener-ийг ажиллуулах (stopped болтол буцахгүй, дотроо reconnect хийнэ)
  await listener.run();
}

main().catch(async (err) => {
  logger.fatal({ err: err?.message, stack: err?.stack }, 'main() амжилтгүй — гаралаа');
  await notifyError('main-fatal', err);
  process.exit(1);
});
