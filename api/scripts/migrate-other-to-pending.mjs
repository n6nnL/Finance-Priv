// ============================================================
//  scripts/migrate-other-to-pending.mjs — НЭГ УДААГИЙН миграц
//
//  Засвар 1-ийн дагуу: систем өмнө нь танигдаагүй гүйлгээг автоматаар
//  'other' ("Бусад") болгож байсан. Эдгээрийг pending_review руу буцааж,
//  category-г NULL болгоно (хэрэглэгч дахин хянана).
//
//  ⚠️ Learned override-той тааруулагдах мерчантыг ХӨНДӨХГҮЙ (хэрэглэгч
//  өөрөө баталгаажуулсан гэж үзнэ).
//
//  Ажиллуулах:  node scripts/migrate-other-to-pending.mjs
//  (API серверийг түр зогсоосон байх нь зүйтэй.)
// ============================================================

import { createDb } from '../db.js';
import { config } from '../config.js';

const db = createDb(config.dbPath);

const overrides = db.getOverrides();
const patterns = overrides.map((o) => o.merchant_pattern).filter(Boolean);

// category='other' бүх мөр
const rows = db._raw.prepare("SELECT id, description FROM transactions WHERE category='other'").all();

let moved = 0;
let keptByOverride = 0;

const updStmt = db._raw.prepare(
  "UPDATE transactions SET category=NULL, status='pending_review', ai_suggested_category=NULL, ai_confidence=NULL WHERE id=?"
);

db._raw.exec('BEGIN');
try {
  for (const r of rows) {
    const norm = db.normalizeMerchant(r.description);
    const hasOverride = norm && patterns.some((p) => norm.includes(p));
    if (hasOverride) {
      keptByOverride++; // override-той → хэрэглэгч баталгаажуулсан, хөндөхгүй
      continue;
    }
    updStmt.run(r.id);
    moved++;
  }
  db._raw.exec('COMMIT');
} catch (e) {
  db._raw.exec('ROLLBACK');
  console.error('❌ Алдаа, буцаалаа:', e.message);
  process.exit(1);
}

console.log('============================================================');
console.log("'other' → pending_review миграц дууслаа");
console.log('  pending болгосон:        ', moved);
console.log('  override-той тул үлдээсэн:', keptByOverride);
console.log('  одоо pending нийт:       ', db.getPending({ limit: 1 }).total);
console.log('============================================================');
db.close();
