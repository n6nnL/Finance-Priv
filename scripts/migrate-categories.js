// ============================================================
//  scripts/migrate-categories.js — хуучин англи category → канон монгол
//
//  Нэг удаагийн, ИДЕМПОТЕНТ миграц. Зөвхөн `config/categories.js`-ийн
//  OLD_TO_NEW-д тодорхойлсон хуучин key-үүдийг канон нэр рүү буулгана.
//
//  Ажиллуулах:
//    node scripts/migrate-categories.js            → DRY-RUN (юу ч бичихгүй)
//    node scripts/migrate-categories.js --apply    → бодитоор бичнэ
//    DB_PATH=/зам/тransactions.sqlite node scripts/migrate-categories.js
//
//  ХАМГААЛАЛТ:
//    • DRY-RUN анхдагч — `--apply` тугтай үед л UPDATE.
//    • Хэрэглэгч ГАРААР баталгаажуулсан мөр (manually_edited=1 ЭСВЭЛ note-той)
//      — ХӨНДӨХГҮЙ.
//    • Транзакцаар (BEGIN/COMMIT) — хэсэгчилсэн бичилт үлдээхгүй.
// ============================================================

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { CATEGORIES, OLD_TO_NEW } from '../config/categories.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const dbPath = process.env.DB_PATH
  ? resolve(process.env.DB_PATH)
  : join(__dirname, '..', 'api', 'data', 'transactions.sqlite');

console.log('== Category миграц (хуучин англи → канон монгол) ==');
console.log('DB   :', dbPath);
console.log('Горим:', APPLY ? 'APPLY (бодитоор бичнэ)' : 'DRY-RUN (зөвхөн харуулна)');
if (APPLY) {
  console.log('\n⚠️  Үргэлжлүүлэхээс ӨМНӨ DB backup хий:');
  console.log(`    cp "${dbPath}" "${dbPath}.bak-$(date +%Y%m%d-%H%M%S)"\n`);
}

const db = new DatabaseSync(dbPath);

function hasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
}
// Гараар баталгаажуулсан мөрийг хамгаалах WHERE (багана байхгүй бол алгасна).
const protectClauses = [];
if (hasColumn('transactions', 'manually_edited')) protectClauses.push('(manually_edited IS NULL OR manually_edited = 0)');
if (hasColumn('transactions', 'note')) protectClauses.push("(note IS NULL OR note = '')");
const SAFE = protectClauses.length ? protectClauses.join(' AND ') : '1=1';

const canon = new Set(CATEGORIES);
const oldKeys = Object.keys(OLD_TO_NEW);

// 1) Буулгах төлөвлөгөө (OLD_TO_NEW key бүрээр)
const plan = [];
let toChange = 0;
let prot = 0;
for (const oldCat of oldKeys) {
  const changeable = db.prepare(`SELECT COUNT(*) n FROM transactions WHERE category = ? AND ${SAFE}`).get(oldCat).n;
  const protectedN = db.prepare(`SELECT COUNT(*) n FROM transactions WHERE category = ? AND NOT (${SAFE})`).get(oldCat).n;
  if (changeable || protectedN) plan.push({ oldCat, newCat: OLD_TO_NEW[oldCat], changeable, protectedN });
  toChange += changeable;
  prot += protectedN;
}

// 2) Танигдаагүй утга (канон ч биш, OLD_TO_NEW-д ч алга) — pending_review-д санал
const unknown = db.prepare(
  `SELECT COALESCE(category,'(NULL)') c, COUNT(*) n FROM transactions
   WHERE category IS NOT NULL AND category NOT IN (${CATEGORIES.map(() => '?').join(',')})
     AND category NOT IN (${oldKeys.map(() => '?').join(',')})
   GROUP BY category ORDER BY n DESC`
).all(...CATEGORIES, ...oldKeys);

// ---- Тайлан ----
if (plan.length === 0) {
  console.log('✅ Буулгах хуучин англи category АЛГА — өгөгдөл аль хэдийн канон. Хийх зүйлгүй.');
} else {
  console.log('Буулгах төлөвлөгөө:');
  for (const p of plan) {
    console.log(`  ${p.oldCat.padEnd(12)} → ${p.newCat.padEnd(24)} : ${p.changeable} буулгах, ${p.protectedN} хамгаалагдсан (хөндөхгүй)`);
  }
  console.log(`\nНийт: ${toChange} буулгах, ${prot} хамгаалагдсан.`);
}
if (unknown.length) {
  console.log('\n⚠️  Танигдаагүй category утга (канон ч биш, mapping-д ч алга) — гараар шийдэх / pending_review:');
  for (const u of unknown) console.log(`  ${String(u.n).padStart(5)} | ${u.c}`);
} else {
  console.log('Танигдаагүй (canon-бус) category утга: алга.');
}

// ---- APPLY ----
if (APPLY && toChange > 0) {
  db.exec('BEGIN');
  try {
    const upd = db.prepare(`UPDATE transactions SET category = ? WHERE category = ? AND ${SAFE}`);
    let done = 0;
    for (const p of plan) done += upd.run(p.newCat, p.oldCat).changes;
    db.exec('COMMIT');
    console.log(`\n✅ APPLY дууслаа — ${done} мөр буулгав.`);
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('❌ ROLLBACK (юу ч бичээгүй):', e.message);
    db.close();
    process.exit(1);
  }
} else if (!APPLY && toChange > 0) {
  console.log('\n(DRY-RUN — юу ч бичээгүй. Бодитоор: node scripts/migrate-categories.js --apply)');
}

db.close();
