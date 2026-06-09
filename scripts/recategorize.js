// ============================================================
//  scripts/recategorize.js — НЭГ УДААГИЙН: шинэ 10-ангиллаар дахин ангилах
//
//  1) Хэрэглэгчийн learned override-ийн ангиллыг хуучин (англи key) →
//     шинэ нэр рүү буулгана (OLD_TO_NEW). Энэ нь хэрэглэгчийн ШИЙДВЭРИЙГ
//     хадгална, зөвхөн нэрийг шинэ 10-ангиллын схемд тааруулна.
//  2) Override-той (хэрэглэгч баталгаажуулсан) гүйлгээ → override-ийн
//     ангиллыг хэрэглэнэ (ХӨНДӨХГҮЙ, зөвхөн шинэ нэрээр).
//  3) Бусад (автомат/pending) гүйлгээ → шинэ дүрмээр дахин ангилна:
//     Орлого(type) → keyword → null(pending_review).
//
//  Ажиллуулах:  node scripts/recategorize.js   (API серверийг түр зогсоо)
// ============================================================

import { createDb } from '../api/db.js';
import { categorizeByRules, INCOME_CATEGORY } from '../api/categorize.js';
import { OLD_TO_NEW } from '../config/categories.js';

const API_DB_PATH = process.env.API_DB_PATH || './api/data/transactions.sqlite';
const db = createDb(API_DB_PATH);

// 1) Override-ийн ангиллыг шинэ нэр рүү буулгах
const overrides0 = db.getOverrides();
let ovMigrated = 0;
db._raw.exec('BEGIN');
try {
  const updOv = db._raw.prepare('UPDATE category_overrides SET category=? WHERE id=?');
  for (const ov of overrides0) {
    if (OLD_TO_NEW[ov.category]) { updOv.run(OLD_TO_NEW[ov.category], ov.id); ovMigrated++; }
  }
  db._raw.exec('COMMIT');
} catch (e) { db._raw.exec('ROLLBACK'); throw e; }

const overrides = db.getOverrides(); // шинэчилсэн

// 2-3) Гүйлгээнүүдийг дахин ангилах
const rows = db._raw.prepare('SELECT * FROM transactions').all();
const setClassified = db._raw.prepare(
  "UPDATE transactions SET category=?, status='classified', ai_suggested_category=NULL, ai_confidence=NULL WHERE id=?"
);
const setPending = db._raw.prepare(
  "UPDATE transactions SET category=NULL, status='pending_review', ai_suggested_category=NULL, ai_confidence=NULL WHERE id=?"
);

const counts = {};
let viaOverride = 0, viaIncome = 0, viaKeyword = 0, toPending = 0;
const bump = (c) => { counts[c] = (counts[c] || 0) + 1; };

db._raw.exec('BEGIN');
try {
  for (const r of rows) {
    const norm = db.normalizeMerchant(r.description);
    const ov = norm ? overrides.find((o) => o.merchant_pattern && norm.includes(o.merchant_pattern)) : null;

    if (ov) {
      // Хэрэглэгчийн баталгаажуулсан мерчант → override-ийн ангилал (шинэ нэр)
      if (r.category !== ov.category || r.status !== 'classified') setClassified.run(ov.category, r.id);
      bump(ov.category); viaOverride++;
      continue;
    }

    // Автомат/pending → шинэ дүрмээр
    let newCat = r.type === 'income' ? INCOME_CATEGORY : categorizeByRules(r.description);
    if (newCat) {
      if (r.category !== newCat || r.status !== 'classified') setClassified.run(newCat, r.id);
      bump(newCat);
      if (r.type === 'income') viaIncome++; else viaKeyword++;
    } else {
      if (r.category !== null || r.status !== 'pending_review') setPending.run(r.id);
      toPending++;
    }
  }
  db._raw.exec('COMMIT');
} catch (e) { db._raw.exec('ROLLBACK'); throw e; }

console.log('\n============================================================');
console.log('📊 RECATEGORIZE ТАЙЛАН (10 ангиллын систем)');
console.log('============================================================');
console.log('Override ангилал шинэ нэр рүү буулгасан:', ovMigrated);
console.log('Override-оор:', viaOverride, '| Орлого:', viaIncome, '| Keyword:', viaKeyword, '| pending:', toPending);
console.log('\nАнгилал тус бүрээр:');
for (const [c, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log('  ' + String(n).padStart(4), c);
}
console.log('  ' + String(toPending).padStart(4), '(Ангилаагүй / pending)');
console.log('============================================================');
db.close();
