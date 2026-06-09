// ============================================================
//  scripts/collect-descriptions.js
//
//  Gmail дахь Голомт банкны (BANK_SENDER) БҮХ хуучин имэйлийг уншиж,
//  parseGolomt-оор задлан:
//    - transactions-export.json   (бүх задарсан гүйлгээ)
//    - descriptions-summary.csv   (тайлбар → давтамж, эрэмбэлсэн)
//  гаргана. Мөн нийт/амжилттай/parse_failed тоог хэвлэнэ.
//
//  Зорилго: categorize дүрмийг бодит мерчантуудад тааруулахад туслах.
//  Зөвхөн УНШИНА (имэйл устгахгүй/өөрчлөхгүй).
//
//  Ажиллуулах:  node scripts/collect-descriptions.js
// ============================================================

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { OAuth2Client } from 'google-auth-library';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from '../src/config.js';
import { parseGolomt } from '../src/parsers/golomt.js';
import { categorize } from '../src/categorize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..'); // үндсэн фолдерт гаргана

async function getAccessToken() {
  const o = new OAuth2Client(config.oauth.clientId, config.oauth.clientSecret, config.oauth.redirectUri);
  o.setCredentials({ refresh_token: config.oauth.refreshToken });
  const { token } = await o.getAccessToken();
  if (!token) throw new Error('Access token авч чадсангүй');
  return token;
}

/** CSV талбарыг хашилтлах (таслал/хашилт/мөр агуулж болзошгүй) */
function csvField(v) {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

async function main() {
  console.log(`🔌 Gmail-д холбогдож байна (${config.gmail.user})...`);
  const accessToken = await getAccessToken();

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: config.gmail.user, accessToken },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock(config.gmail.mailbox);

  const transactions = [];
  let total = 0;
  let parsed = 0;
  let failed = 0;
  const descCounts = new Map(); // description → { count, type, amount }

  try {
    // Голомтын илгээгчээр хайх
    console.log(`🔎 "${config.bankSender}"-аас ирсэн имэйлийг хайж байна...`);
    const uids = await client.search({ from: config.bankSender }, { uid: true });

    if (!uids || uids.length === 0) {
      console.log('⚠️ Голомт банкнаас ирсэн имэйл олдсонгүй.');
      console.log('   (BANK_SENDER зөв эсэх, эсвэл энэ хайрцагт банкны имэйл байгаа эсэхийг шалгана уу.)');
      return;
    }

    total = uids.length;
    console.log(`📥 ${total} имэйл олдлоо. Задалж байна...`);

    for await (const msg of client.fetch(uids, { uid: true, source: true }, { uid: true })) {
      try {
        const mail = await simpleParser(msg.source);
        const tx = parseGolomt(mail);

        if (!tx || tx.amount == null) {
          failed++;
          continue;
        }
        parsed++;
        tx.category = categorize(tx);
        transactions.push({
          uid: msg.uid,
          messageId: tx.messageId,
          date: tx.date,
          amount: tx.amount,
          type: tx.type,
          description: tx.description,
          category: tx.category,
          accountLast4: tx.accountLast4,
          balance: tx.balance,
        });

        const key = (tx.description || '(хоосон)').trim();
        const prev = descCounts.get(key) || { count: 0, type: tx.type, amountSample: tx.amount };
        prev.count++;
        descCounts.set(key, prev);
      } catch (err) {
        failed++;
        console.error(`  ⚠️ UID ${msg.uid} задлах алдаа: ${err.message}`);
      }
    }
  } finally {
    lock.release();
    await client.logout();
  }

  // --- transactions-export.json ---
  const jsonPath = join(OUT_DIR, 'transactions-export.json');
  writeFileSync(jsonPath, JSON.stringify(transactions, null, 2), 'utf8');

  // --- descriptions-summary.csv (давтамжаар буурахаар эрэмбэлсэн) ---
  const sorted = [...descCounts.entries()].sort((a, b) => b[1].count - a[1].count);
  const csvLines = ['count,description,type,amount_sample'];
  for (const [desc, info] of sorted) {
    csvLines.push(
      [csvField(info.count), csvField(desc), csvField(info.type), csvField(info.amountSample)].join(',')
    );
  }
  const csvPath = join(OUT_DIR, 'descriptions-summary.csv');
  // Excel кирилл зөв нээхэд BOM нэмнэ
  writeFileSync(csvPath, '﻿' + csvLines.join('\n'), 'utf8');

  // --- Тайлан ---
  console.log('\n============================================================');
  console.log('📊 ЦУГЛУУЛГЫН ТАЙЛАН');
  console.log('============================================================');
  console.log(`Нийт имэйл:           ${total}`);
  console.log(`Амжилттай задарсан:   ${parsed}`);
  console.log(`Задрахгүй (failed):   ${failed}`);
  console.log(`Ялгаатай тайлбар:     ${descCounts.size}`);
  console.log('\n🔝 Хамгийн их давтагддаг тайлбарууд (top 15):');
  for (const [desc, info] of sorted.slice(0, 15)) {
    console.log(`  ${String(info.count).padStart(4)} ×  ${desc}  [${info.type}]`);
  }
  console.log('\n📄 Гаргасан файлууд:');
  console.log(`  - ${jsonPath}`);
  console.log(`  - ${csvPath}`);
  console.log('============================================================\n');
}

main().catch((err) => {
  console.error('❌ Алдаа:', err.message);
  process.exit(1);
});
