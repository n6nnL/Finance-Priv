// ============================================================
//  migrate.js — Миграц ажиллуулах standalone скрипт
//  Ажиллуулах:  npm run migrate
//  (db.js нь createDb() дотроо автоматаар migrate хийдэг тул энэ нь
//   гол төлөв гар аргаар DB үүсгэх/шалгахад зориулагдсан.)
// ============================================================

import { config } from './config.js';
import { createDb } from './db.js';
import { logger } from './logger.js';

try {
  const db = createDb(config.dbPath);
  db.migrate();
  logger.info('✅ Миграц амжилттай', { db: config.dbPath });
  db.close();
  process.exit(0);
} catch (err) {
  logger.error('❌ Миграц амжилтгүй', { err: err?.message });
  process.exit(1);
}
