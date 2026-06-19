// ============================================================
//  server.js — Production entry point
//  config унших → db нээх → app үүсгэх → listen
// ============================================================

import { config } from './config.js';
import { createDb } from './db.js';
import { createApp } from './app.js';
import { createAi } from './ai.js';
import { logger } from './logger.js';

const db = createDb(config.dbPath);
const ai = createAi({ apiKey: config.ai.apiKey, model: config.ai.model, enabled: config.ai.enabled });

const app = createApp({
  db,
  ai,
  apiKey: config.apiKey,
  hmacSecret: config.hmacSecret,
  bodyLimit: config.bodyLimit,
  rateLimit: config.rateLimit,
  dashboardUser: config.dashboard.user,
  dashboardPassword: config.dashboard.password,
});

const server = app.listen(config.port, () => {
  logger.info('🚀 Bank Transactions API эхэллээ', {
    port: config.port,
    hmac: config.hmacSecret ? 'enabled' : 'disabled',
    ai: ai.enabled ? config.ai.model : 'disabled',
    db: config.dbPath,
  });
});

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
});
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', { err: err?.message, stack: err?.stack });
});
