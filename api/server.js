// ============================================================
//  server.js — Production entry point
//  config унших → db нээх → app үүсгэх → listen
// ============================================================

import { config } from './config.js';
import { createDb } from './db.js';
import { createApp } from './app.js';
import { createAi } from './ai.js';
import { hashPasswordSync } from './auth/passwordHash.js';
import { logger } from './logger.js';
import { notifyOps } from './ops-notify.js';

// Анхны admin-г seed хийх (users хоосон үед). Нууц үг hash хийгдэнэ.
const seed = config.auth.seedPassword
  ? { email: config.auth.seedEmail, passwordHash: hashPasswordSync(config.auth.seedPassword), role: 'admin' }
  : undefined;

const db = createDb(config.dbPath, { seed, tokenEncKey: config.tokenEncKey });
const ai = createAi({ apiKey: config.ai.apiKey, model: config.ai.model, enabled: config.ai.enabled });

const app = createApp({
  db,
  ai,
  apiKey: config.apiKey,
  hmacSecret: config.hmacSecret,
  bodyLimit: config.bodyLimit,
  rateLimit: config.rateLimit,
  jwtSecret: config.jwt.secret,
  jwtAccessTtl: config.jwt.accessTtl,
  jwtRefreshTtl: config.jwt.refreshTtl,
  allowRegister: config.auth.allowRegister,
  localAuth: config.auth.localAuth,
  google: {
    login: config.google.login,
    calendarRedirectUri: config.google.calendarRedirectUri,
    gmail: config.google.gmail,
    gmailRedirectUri: config.google.gmailRedirectUri,
    openSignup: config.auth.openSignup,
    allowedEmails: config.google.allowedEmails,
    dashboardBaseUrl: config.google.dashboardBaseUrl,
  },
});

const server = app.listen(config.port, () => {
  logger.info('🚀 Bank Transactions API эхэллээ', {
    port: config.port,
    hmac: config.hmacSecret ? 'enabled' : 'disabled',
    ai: ai.enabled ? config.ai.model : 'disabled',
    users: db.countUsers(),
    db: config.dbPath,
  });
});

// --- Хуучирсан pending_review → авто 'Бусад' (хэрэглэгчийн бодлого) ---
// N хоногоос дээш ангилагдаагүй байвал (санахаа больсон) авто ангилна. Эхлэхэд
// нэг удаа + 12 цаг тутам. 0/сөрөг days → унтраалттай. Гараар зассныг хөндөхгүй.
function sweepStalePending() {
  try {
    const n = db.autoClassifyStalePending({ days: config.pendingAutoClassifyDays });
    if (n > 0) logger.info('Хуучирсан pending → Бусад (авто)', { count: n, days: config.pendingAutoClassifyDays });
  } catch (err) {
    logger.warn('sweepStalePending алдаа', { err: err?.message });
  }
}
if (config.pendingAutoClassifyDays > 0) {
  sweepStalePending();
  const timer = setInterval(sweepStalePending, 12 * 60 * 60 * 1000);
  if (timer.unref) timer.unref();
}

// Graceful shutdown
function shutdown(signal) {
  logger.info('Зогсоох дохио — graceful shutdown', { signal });
  server.close(() => {
    db.close();
    process.exit(0);
  });
  // Хэт удвал хүчээр гарна
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', { reason: reason?.message ?? String(reason) });
  notifyOps('unhandledRejection', reason).catch(() => {});
});
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', { err: err?.message, stack: err?.stack });
  notifyOps('uncaughtException', err).catch(() => {});
});
