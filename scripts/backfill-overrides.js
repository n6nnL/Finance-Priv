#!/usr/bin/env node
// ============================================================
//  scripts/backfill-overrides.js — Сурсан override-ийг ХУУЧИН гүйлгээнд буцаан
//  хэрэглэх (ops, дахин ажиллуулж болох, DEFAULT нь dry-run)
//
//  ЯАГААД: `api/classify.js` ingest дээр override-оос ЗӨВХӨН `category`-г авдаг —
//  `friendly_name` (газрын нэр) ба `default_note` (шалтгаан) мөрөнд ХЭЗЭЭ Ч
//  бичигддэггүй (унших үед `attachOverrideInfo`-оор л virtual хавсрагддаг).
//  Тиймээс override үүсэхээс ӨМНӨ ч, ХОЙНО ч ирсэн автомат мөрүүд газрын нэр/
//  шалтгаангүй хоцордог. Энэ скрипт тэдгээрийг эвлэрүүлнэ.
//
//  ТААРАЛ нь ingest-тэй ЯГ ИЖИЛ байх ЁСТОЙ (classify.js:28-34):
//    normalizeMerchant(description).includes(ov.merchant_pattern)
//    — `db.getOverrides(userId)`-ийн дараалалд (created_at DESC), ЭХНИЙ таарал ялна.
//  Зөрвөл backfill-ийн тавьсан утгыг дараагийн ingest эргүүлж дарах эрсдэлтэй.
//  ⚠️ Тиймээс таарлыг SQL LIKE-аар ДАХИН БИЧИХГҮЙ — JS дотор, дундын
//  `normalizeMerchant`-аар хийнэ.
//
//  ИНВАРИАНТ:
//    • `manually_edited = 1` мөрөнд ХЭЗЭЭ Ч ХҮРЭХГҮЙ (хэрэглэгчийн шийдвэр).
//    • `manually_edited`-ийг 1 БОЛГОХГҮЙ — эдгээр нь автомат утга, автомат хэвээр.
//    • Мөр ↔ override нь ЗААВАЛ ижил `user_id`-тай (per-user тусгаарлалт).
//    • Хоосон override талбарт тухайн баганад ГАР ХҮРЭХГҮЙ (хуурамч утга үүсгэхгүй).
//    • Идемпотент — утга нь аль хэдийн тэнцүү мөрийг алгасна (дахин ажиллуулахад 0).
//
//  Ашиглалт:
//    node scripts/backfill-overrides.js --db ./copy.sqlite            # DRY-RUN (default)
//    node scripts/backfill-overrides.js --db ./copy.sqlite --user 1   # нэг хэрэглэгч
//    node scripts/backfill-overrides.js --db ./prod.sqlite --apply    # БОДИТ бичилт
//
//  ⚠️ --apply-ээс ӨМНӨ DB backup ЗААВАЛ (scripts/backup.sh эсвэл cp).
// ============================================================

import { DatabaseSync } from 'node:sqlite';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { normalizeMerchant } from '../api/db.js';
import { isPosTxn, detailFieldFor } from '../config/transactionActions.js';
import { loadEnv } from '../config/loadEnv.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = join(ROOT, 'api');

// ---------------------------- CLI ----------------------------
function parseArgs(argv) {
  const out = { db: null, apply: false, user: null, setStatus: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--set-status') out.setStatus = true;
    else if (a === '--db') out.db = argv[++i];
    else if (a.startsWith('--db=')) out.db = a.slice(5);
    else if (a === '--user') out.user = argv[++i];
    else if (a.startsWith('--user=')) out.user = a.slice(7);
    else if (a === '--help' || a === '-h') out.help = true;
    else { console.error(`Танихгүй аргумент: ${a}`); process.exit(2); }
  }
  return out;
}

function usage() {
  console.log(`
scripts/backfill-overrides.js — override → хуучин гүйлгээ (dry-run default)

  --db <зам>     SQLite файлын зам. Өгөөгүй бол: API_DB_PATH env → api/.env-ийн
                 DB_PATH (api/ хавтсанд харьцангуй) → api/data/transactions.sqlite
  --user <id>    Зөвхөн тухайн хэрэглэгч (default: бүх хэрэглэгч)
  --apply        БОДИТООР бичих (BEGIN…COMMIT, алдаа гарвал ROLLBACK).
                 Үгүй бол юу ч бичихгүй, зөвхөн тайлан хэвлэнэ.
  --set-status   category бичих үед status='pending_review' → 'classified' болгох
                 (СОНГОЛТТОЙ, default OFF — доорх тайлбарыг үз)
  -h, --help     Энэ тусламж
`);
}

/** DB зам: --db → API_DB_PATH → api/.env-ийн DB_PATH → default. */
function resolveDbPath(cliDb) {
  if (cliDb) return isAbsolute(cliDb) ? cliDb : resolve(process.cwd(), cliDb);
  if (process.env.API_DB_PATH) return resolve(process.cwd(), process.env.API_DB_PATH);
  // api/config.js-ийг импортлохгүй — тэр нь LISTENER_API_KEY/TOKEN_ENC_KEY
  // шаарддаг тул ops машин дээр (нууцгүй) шидэх болно. .env-ийг шууд уншина.
  loadEnv(join(API_DIR, '.env'));
  const p = process.env.DB_PATH;
  // DB_PATH нь api процессын cwd (api/)-д харьцангуй байдаг.
  return p ? resolve(API_DIR, p) : join(API_DIR, 'data', 'transactions.sqlite');
}

/**
 * DB нээх. Dry-run → readOnly (файлд огт хүрэхгүй). WAL сэргээх шаардлагатай
 * үед readOnly бүтэлгүйтдэг — тэр үед бичих эрхээр нээж, ГЭХДЭЭ UPDATE огт
 * явуулахгүй (WAL checkpoint-оос өөр бичилт болохгүй) гэдгийг мэдэгдэнэ.
 */
function openDb(path, apply) {
  if (apply) return new DatabaseSync(path);
  try {
    return new DatabaseSync(path, { readOnly: true });
  } catch (err) {
    console.warn(`⚠️  readOnly горимоор нээж чадсангүй (${err?.message}) — бичих`
      + ' эрхээр нээв. Dry-run тул UPDATE явуулахгүй (зөвхөн SQLite-ийн WAL сэргээлт).');
    return new DatabaseSync(path);
  }
}

const trimOrNull = (v) => {
  const s = v == null ? '' : String(v).trim();
  return s ? s : null;
};

// ---------------------------- Гол ажил ----------------------------
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  const dbPath = resolveDbPath(args.db);
  if (!existsSync(dbPath)) {
    console.error(`❌ DB олдсонгүй: ${dbPath}\n   --db <зам>-аар зааж өгнө үү.`);
    process.exit(1);
  }

  const db = openDb(dbPath, args.apply);

  // classify.js-ийн `db.getOverrides(userId)`-тэй ЯГ ИЖИЛ query (дараалал ч
  // хамаатай: created_at DESC → эхний таарал ялна).
  const qOverrides = db.prepare(
    'SELECT * FROM category_overrides WHERE user_id=? ORDER BY created_at DESC'
  );
  const qTxns = db.prepare(
    `SELECT id, user_id, description, is_pos, merchant_place, note, category, status, manually_edited
       FROM transactions WHERE user_id=? ORDER BY id`
  );
  const qUsers = db.prepare(
    'SELECT DISTINCT user_id FROM transactions WHERE user_id IS NOT NULL ORDER BY user_id'
  );

  let userIds;
  if (args.user != null) {
    const uid = Number(args.user);
    if (!Number.isInteger(uid)) { console.error('❌ --user нь бүхэл тоо байх ёстой'); process.exit(2); }
    userIds = [uid];
  } else {
    userIds = qUsers.all().map((r) => r.user_id);
  }

  // Төлөвлөгөө: мөр бүрд ямар багана ямар утгатай болох (SQL-ийг дараа нь).
  /** @type {Array<{id:number,user_id:number,sets:Record<string,string>}>} */
  const plan = [];
  const stats = {
    users: userIds.length,
    overrides: 0,
    overridesUsed: 0,
    scanned: 0,
    matched: 0,
    skippedManual: 0,
    changed: 0,
    place: 0,
    note: 0,
    category: 0,
    statusFix: 0,
    unmatched: 0,
    overwrite: 0, // хоосон БИШ утгыг дарж бичих тохиолдол (анхаарал татах ёстой)
  };
  /** @type {Array<string>} хоосон биш утгыг дарж бичих мөрүүд — тайланд ил гаргана */
  const overwrites = [];
  /** @type {Map<string, {ov:object, rows:number, place:number, note:number, cat:number, skipped:number}>} */
  const perOverride = new Map();

  // Хоосон (NULL/'') БИШ утгыг дарж бичих гэж байвал бүртгэнэ. Энэ нь backfill-ийн
  // ХҮЛЭЭГДЭЭГҮЙ тохиолдол — хэрэглэгчийн (эсвэл өмнөх applyToAll-ийн) утга дээр
  // бичих гэж байна гэсэн үг. Тайланд ил гарч, хүн шийднэ.
  const noteOverwrite = (row, col, oldV, newV) => {
    if (oldV == null || String(oldV).trim() === '') return; // NULL→утга = хэвийн
    stats.overwrite++;
    overwrites.push(`  #${row.id} [u${row.user_id}] "${row.description}" ${col}: `
      + `${JSON.stringify(oldV)} → ${JSON.stringify(newV)}`);
  };

  for (const uid of userIds) {
    const overrides = qOverrides.all(uid);
    stats.overrides += overrides.length;
    for (const ov of overrides) {
      perOverride.set(`${uid}:${ov.id}`, { ov, rows: 0, place: 0, note: 0, cat: 0, skipped: 0 });
    }
    if (!overrides.length) continue;

    for (const row of qTxns.all(uid)) {
      stats.scanned++;
      const norm = normalizeMerchant(row.description);
      if (!norm) { stats.unmatched++; continue; }

      // === classify.js:29-33-тай ЯГ ИЖИЛ таарал (эхний нь ялна) ===
      const ov = overrides.find((o) => o.merchant_pattern && norm.includes(o.merchant_pattern));
      if (!ov) { stats.unmatched++; continue; }
      stats.matched++;
      const acc = perOverride.get(`${uid}:${ov.id}`);

      // ⚠️ Хэрэглэгч гараар зассан мөр — ХЭЗЭЭ Ч хөндөхгүй.
      if (row.manually_edited === 1) { stats.skippedManual++; acc.skipped++; continue; }

      const sets = {};

      // POS (is_pos=1) → merchant_place ← friendly_name
      // POS БИШ (0 эсвэл NULL) → note ← default_note
      // Аль талбар вэ гэдгийг дундын модуль шийднэ (гурван клиенттэй ижил дүрэм).
      const field = detailFieldFor(row).rowField; // 'merchant_place' | 'note'
      const wanted = trimOrNull(isPosTxn(row) ? ov.friendly_name : ov.default_note);
      if (wanted !== null && row[field] !== wanted) {
        sets[field] = wanted;
        if (field === 'merchant_place') { stats.place++; acc.place++; } else { stats.note++; acc.note++; }
        noteOverwrite(row, field, row[field], wanted);
      }

      // category — схемд NOT NULL ч хоосон стрингээс хамгаална.
      const wantedCat = trimOrNull(ov.category);
      if (wantedCat !== null && row.category !== wantedCat) {
        sets.category = wantedCat;
        stats.category++; acc.cat++;
        noteOverwrite(row, 'category', row.category, wantedCat);
      }

      // Ангилал бичих үед status зөрчил үүсч болно (category-тэй боловч
      // 'pending_review' хэвээр). ЗӨВХӨН --set-status тугтай үед засна —
      // ingest (classify.js) override таарвал status='classified' буцаадаг тул
      // ийм мөр логикийн хувьд classified байх ёстой. Default OFF: скриптийн
      // цар хүрээ нь place/note/category, status биш.
      if (sets.category && row.status === 'pending_review') {
        stats.statusFix++;
        if (args.setStatus) sets.status = 'classified';
      }

      if (Object.keys(sets).length) {
        plan.push({ id: row.id, user_id: row.user_id, sets });
        stats.changed++;
        acc.rows++;
      }
    }
  }

  stats.overridesUsed = [...perOverride.values()].filter((a) => a.rows > 0).length;

  // ---------------------------- Тайлан ----------------------------
  const mode = args.apply ? 'APPLY (БОДИТ БИЧИЛТ)' : 'DRY-RUN (юу ч бичихгүй)';
  console.log('\n============================================================');
  console.log(`  OVERRIDE BACKFILL — ${mode}`);
  console.log('============================================================');
  console.log(`DB        : ${dbPath}`);
  console.log(`Хэрэглэгч : ${args.user != null ? `#${args.user}` : `бүгд (${userIds.join(', ') || 'алга'})`}`);
  console.log('');

  const rowsOf = (a) => a.rows;
  const listed = [...perOverride.values()].sort((a, b) => rowsOf(b) - rowsOf(a));
  for (const a of listed) {
    const { ov } = a;
    const place = trimOrNull(ov.friendly_name);
    const noteV = trimOrNull(ov.default_note);
    const detail = [
      place ? `place '${place}'` : null,
      noteV ? `note '${noteV}'` : null,
      trimOrNull(ov.category) ? `category '${ov.category}'` : null,
    ].filter(Boolean).join(' / ') || '(хоосон override)';
    console.log(
      `Override [u${ov.user_id}] ${ov.merchant_pattern} → ${detail}: `
      + `${a.rows} мөр өөрчлөгдөнө`
      + (a.rows ? `  (place ${a.place} · note ${a.note} · category ${a.cat})` : '')
      + (a.skipped ? `  [manually_edited=1 тул ${a.skipped} алгассан]` : '')
    );
  }

  console.log('');
  console.log('--- НИЙТ ---');
  console.log(`Шалгасан гүйлгээ        : ${stats.scanned}`);
  console.log(`Override-т таарсан      : ${stats.matched}  (таараагүй ${stats.unmatched})`);
  console.log(`Өөрчлөгдөх мөр (X)      : ${stats.changed}`);
  console.log(`Override (Y)            : ${stats.overrides}  (үүнээс нөлөөтэй ${stats.overridesUsed})`);
  console.log(`manually_edited=1 (Z)   : ${stats.skippedManual} мөр алгассан`);
  console.log(`Багана: merchant_place ${stats.place} · note ${stats.note} · category ${stats.category}`);
  if (stats.overwrite) {
    console.log(`\n⚠️  ХООСОН БИШ утгыг дарж бичих: ${stats.overwrite} тохиолдол —`
      + ' backfill-ийн ХҮЛЭЭГДЭЭГҮЙ нөхцөл, хүн шалгах ёстой:');
    for (const line of overwrites) console.log(line);
  } else {
    console.log('Дарж бичих (хоосон биш → өөр утга): 0 — бүх бичилт NULL→утга.');
  }
  if (stats.statusFix) {
    console.log(`⚠️  category бичигдэх ч status='pending_review' хэвээр: ${stats.statusFix} мөр`
      + (args.setStatus ? " → --set-status тул 'classified' болно" : ' (--set-status өгвөл засна)'));
  }

  if (!args.apply) {
    console.log('');
    console.log('DRY-RUN — DB-д ЮУ Ч бичээгүй. Бодитоор хийхийн тулд:');
    console.log('  1) DB backup (scripts/backup.sh эсвэл cp)');
    console.log('  2) дахин: --apply');
    console.log('============================================================\n');
    db.close();
    return;
  }

  if (!plan.length) {
    console.log('\nӨөрчлөх мөр алга — бичилт хийсэнгүй (идемпотент).');
    console.log('============================================================\n');
    db.close();
    return;
  }

  // ---------------------------- БИЧИЛТ ----------------------------
  // ⚠️ manually_edited-д ГАР ХҮРЭХГҮЙ (SET-д огт орохгүй) — автомат утга
  // автомат хэвээр. user_id нь WHERE-д ЗААВАЛ (per-user тусгаарлалт).
  const stmtCache = new Map();
  const stmtFor = (cols) => {
    const key = cols.join(',');
    let st = stmtCache.get(key);
    if (!st) {
      const setSql = cols.map((c) => `${c}=@${c}`).join(', ');
      st = db.prepare(`UPDATE transactions SET ${setSql} WHERE id=@id AND user_id=@user_id`);
      stmtCache.set(key, st);
    }
    return st;
  };

  let written = 0;
  db.exec('BEGIN');
  try {
    for (const p of plan) {
      const cols = Object.keys(p.sets).sort();
      written += stmtFor(cols).run({ ...p.sets, id: p.id, user_id: p.user_id }).changes;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    console.error(`\n❌ Алдаа — ROLLBACK хийлээ, DB хэвээр: ${err?.message}`);
    db.close();
    process.exit(1);
  }

  console.log(`\n✅ Бичигдлээ: ${written} мөр (төлөвлөсөн ${plan.length}).`);
  console.log('Дахин ажиллуулбал 0 өөрчлөлт байх ёстой (идемпотент шалгалт).');
  console.log('============================================================\n');
  db.close();
}

main();
