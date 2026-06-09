// ============================================================
//  scripts/repush.js — push_failed гүйлгээнүүдийг дахин илгээх
//
//  Ажиллуулах:  node scripts/repush.js  (эсвэл npm run repush)
//  Cron-д тавьж тогтмол ажиллуулж болно.
// ============================================================

import { logger } from '../src/logger.js';
import { getFailedPushes, updateTransactionStatus, closeDb } from '../src/db.js';
import { pushTransaction } from '../src/push.js';

async function main() {
  const rows = getFailedPushes();
  logger.info({ count: rows.length }, 'Re-push: push_failed гүйлгээ олдлоо');

  let ok = 0;
  let fail = 0;

  for (const row of rows) {
    let payload;
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      logger.warn({ messageId: row.message_id }, 'payload_json задлах боломжгүй — алгасав');
      fail++;
      continue;
    }

    const result = await pushTransaction(payload, row.message_id);
    if (result.ok) {
      updateTransactionStatus(row.message_id, {
        status: 'pushed',
        attempts: (row.attempts || 0) + result.attempts,
      });
      ok++;
    } else {
      updateTransactionStatus(row.message_id, {
        status: 'push_failed',
        error: result.error,
        attempts: (row.attempts || 0) + result.attempts,
      });
      fail++;
    }
  }

  logger.info({ ok, fail }, 'Re-push дууслаа');
  closeDb();
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err: err?.message }, 'Re-push алдаа');
  closeDb();
  process.exit(1);
});
