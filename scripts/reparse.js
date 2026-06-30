// ============================================================
//  scripts/reparse.js — НЭГ УДААГИЙН: хуучин имэйлийг дахин parse
//
//  Засагдсан parseGolomt-оор Gmail дахь бүх Голомт имэйлийг дахин уншиж,
//  API DB дэх гүйлгээний NULL (дутуу) талбаруудыг нөхнө:
//    txn_date, description, account_last4, amount  + is_pos (BOM дүрэм)
//
//  ⚠️ Хэрэглэгчийн гараар оруулсныг ХӨНДӨХГҮЙ: category, status, note,
//     merchant_place, ai_*, learned override. Зөвхөн NULL raw талбар нөхнө.
//  is_pos нь зөвхөн дүрмээс гардаг (хэрэглэгчийн биш) тул үргэлж шинэчилнэ.
//
//  Ажиллуулах:  node scripts/reparse.js   (API серверийг түр зогсоосон байх)
// ============================================================

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../src/config.js';
import { parseGolomt } from '../src/parsers/golomt.js';
import { categorizeByRules, isPosDescription } from '../api/categorize.js';
import { createDb } from '../api/db.js';

const API_DB_PATH = process.env.API_DB_PATH || './api/data/transactions.sqlite';
const db = createDb(API_DB_PATH); // migrate-г автоматаар ажиллуулна (шинэ багана баталгаажна)

async function getAccessToken() {
  const o = new OAuth2Client(config.oauth.clientId, config.oauth.clientSecret, config.oauth.redirectUri);
  o.setCredentials({ refresh_token: config.oauth.refreshToken });
  const { token } = await o.getAccessToken();
  if (!token) throw new Error('Access token авч чадсангүй');
  return token;
}

async function fetchAll() {
  console.log(`🔌 Gmail-д холбогдож байна (${config.gmail.user})...`);
  const token = await getAccessToken();
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: config.gmail.user, accessToken: token }, logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock(config.gmail.mailbox);
  const byId = new Map();
  try {
    const uids = await client.search({ from: config.bankSender }, { uid: true });
    console.log(`📥 ${uids.length} имэйл. Дахин parse хийж байна...`);
    for await (const msg of client.fetch(uids, { uid: true, source: true }, { uid: true })) {
      try {
        const mail = await simpleParser(msg.source);
        const tx = parseGolomt(mail);
        if (tx.messageId) byId.set(tx.messageId, tx);
      } catch { /* нэг имэйлийн алдаа бусдыг зогсоохгүй */ }
    }
  } finally {
    lock.release();
    await client.logout();
  }
  return byId;
}

async function main() {
  const byId = await fetchAll();

  const rows = db._raw.prepare('SELECT * FROM transactions').all();
  let updated = 0, filledDate = 0, filledDesc = 0, filledAcct = 0, recategorized = 0, noEmail = 0, stillMissingDate = 0;

  const upd = (sets, vals, id) => db._raw.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id=?`).run(...vals, id);

  db._raw.exec('BEGIN');
  try {
    for (const r of rows) {
      const p = byId.get(r.message_id);
      if (!p) { noEmail++; if (r.txn_date == null) stillMissingDate++; continue; }

      const sets = [], vals = [];
      let descWasFilled = false;
      if (r.txn_date == null && p.date) { sets.push('txn_date=?'); vals.push(p.date); filledDate++; }
      if (r.description == null && p.description) { sets.push('description=?'); vals.push(p.description); filledDesc++; descWasFilled = true; }
      if (r.account_last4 == null && p.accountLast4) { sets.push('account_last4=?'); vals.push(p.accountLast4); filledAcct++; }
      if (r.amount == null && p.amount != null) { sets.push('amount=?'); vals.push(p.amount); }

      // is_pos — дүрмээс (эцсийн description дээр), үргэлж шинэчилнэ
      const finalDesc = r.description || p.description;
      const isPos = isPosDescription(finalDesc) ? 1 : 0;
      if (r.is_pos !== isPos) { sets.push('is_pos=?'); vals.push(isPos); }

      if (sets.length) { upd(sets, vals, r.id); updated++; }
      if (r.txn_date == null && !p.date) stillMissingDate++;

      // Шинээр тайлбар задарсан + pending + хэрэглэгч ангилаагүй → categorize дахин
      // ⚠️ Хэрэглэгч гараар баталгаажуулсан (manually_edited) мөрийг ХӨНДӨХГҮЙ.
      if (descWasFilled && r.status === 'pending_review' && r.category == null && r.manually_edited !== 1) {
        const cat = categorizeByRules(finalDesc);
        if (cat) {
          db._raw.prepare("UPDATE transactions SET category=?, status='classified', ai_suggested_category=NULL, ai_confidence=NULL WHERE id=?").run(cat, r.id);
          recategorized++;
        }
      }
    }
    db._raw.exec('COMMIT');
  } catch (e) {
    db._raw.exec('ROLLBACK');
    console.error('❌ Алдаа, буцаалаа:', e.message);
    process.exit(1);
  }

  console.log('\n============================================================');
  console.log('📊 REPARSE ТАЙЛАН');
  console.log('============================================================');
  console.log('DB нийт гүйлгээ:        ', rows.length);
  console.log('Шинэчлэгдсэн:           ', updated);
  console.log('  - огноо нөхсөн:       ', filledDate);
  console.log('  - тайлбар нөхсөн:     ', filledDesc);
  console.log('  - данс нөхсөн:        ', filledAcct);
  console.log('Дахин ангилагдсан:      ', recategorized);
  console.log('Имэйл олдоогүй:         ', noEmail, '(жишээ: гараар нэмсэн test мөр)');
  console.log('Огноо одоо ч дутуу:     ', stillMissingDate, '(имэйлд огноо байхгүй, жишээ анхны гүйлгээ)');
  console.log('============================================================');
  db.close();
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
