// ============================================================
//  scripts/get-token.js — OAuth refresh_token авах нэг удаагийн туслах
//
//  Ажиллагаа:
//    1) Localhost callback сервер асаана
//    2) Google consent URL-г хэвлэнэ (browser-т нээнэ)
//    3) Хэрэглэгч зөвшөөрөл өгөхөд code ирнэ → refresh_token-д солино
//    4) refresh_token-г хэвлэнэ → .env-д GMAIL_REFRESH_TOKEN болгон тавина
//
//  Шаардлага (.env эсвэл shell env):
//    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_REDIRECT_URI
//
//  Ажиллуулах:  node scripts/get-token.js
// ============================================================

import http from 'node:http';
import { URL } from 'node:url';
import { OAuth2Client } from 'google-auth-library';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// --- .env-г энгийнээр унших (config.js-тэй ижил, тусдаа давхар хамаарал үүсгэхгүй) ---
function loadEnv() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  try {
    const raw = readFileSync(join(__dirname, '..', '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    /* .env байхгүй бол shell env ашиглана */
  }
}
loadEnv();

// ⚠️ Нууц утгыг ЗӨВХӨН .env-ээс уншина (кодод хатуу бичихгүй — GitHub-д аюулгүй).
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || 'http://localhost:53682/oauth2callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ GOOGLE_CLIENT_ID болон GOOGLE_CLIENT_SECRET-г .env-д тавина уу.');
  process.exit(1);
}

// Gmail унших IMAP-д https://mail.google.com/ scope шаардлагатай.
// (Энэ scope нь full IMAP/SMTP хандалт өгдөг — Google IMAP-д үүнээс
//  нарийн scope байхгүй. Refresh token-г найдвартай хадгална уу.)
const SCOPES = ['https://mail.google.com/'];

const oauth2 = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline', // refresh_token авахад заавал
  prompt: 'consent', // refresh_token дахин баталгаатай авах
  scope: SCOPES,
});

const redirectPath = new URL(REDIRECT_URI).pathname;
const redirectPort = Number(new URL(REDIRECT_URI).port) || 53682;

// ------------------------------------------------------------
// OOB (out-of-band) горим: `node scripts/get-token.js --manual`
// (эсвэл GET_TOKEN_MANUAL=1). VPS дээр SSH port-forwarding ажиллахгүй үед:
//   1) consent URL-г гэрийн браузерт нээж зөвшөөрөл өгнө.
//   2) Браузер http://localhost:53682/oauth2callback?code=... руу үсэрнэ
//      (гэрийн машинд сервер байхгүй тул "холбогдож чадсангүй" гарна — ЗҮГЭЭР).
//   3) Хаягийн мөрөн дэх БҮТЭН URL (эсвэл зөвхөн code)-г хуулж энд буулгана.
// ------------------------------------------------------------
async function runManual() {
  const { createInterface } = await import('node:readline/promises');
  console.log('\n🔐 (MANUAL) Доорх URL-г браузерт нээж зөвшөөрөл өг:\n');
  console.log(authUrl);
  console.log(
    '\nЗөвшөөрсний дараа браузер "localhost холбогдсонгүй" гэж гарна — ЗҮГЭЭР.\n' +
      'Хаягийн мөрөн дэх БҮТЭН URL эсвэл зөвхөн code-г доор буулгана уу.\n'
  );
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('code эсвэл redirect URL: ')).trim();
  rl.close();
  let code = answer;
  if (answer.includes('code=')) {
    try {
      code = new URL(answer).searchParams.get('code') || answer;
    } catch {
      code = decodeURIComponent(answer.split('code=')[1].split('&')[0]);
    }
  }
  try {
    const { tokens } = await oauth2.getToken(code);
    console.log('\n============================================================');
    if (tokens.refresh_token) {
      console.log('✅ refresh_token амжилттай. Доорхыг .env-д тавина уу:\n');
      console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
    } else {
      console.log('⚠️ refresh_token буцаагүй. https://myaccount.google.com/permissions');
      console.log('   -ээс хандалтыг устгаад дахин оролдоно уу.');
    }
    console.log('============================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('❌ Token солих алдаа:', err.message);
    process.exit(1);
  }
}

if (process.argv.includes('--manual') || process.env.GET_TOKEN_MANUAL === '1') {
  runManual();
} else {

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://localhost:${redirectPort}`);
    if (reqUrl.pathname !== redirectPath) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const code = reqUrl.searchParams.get('code');
    const error = reqUrl.searchParams.get('error');
    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`OAuth алдаа: ${error}`);
      console.error('❌ OAuth алдаа:', error);
      server.close();
      return;
    }
    if (!code) {
      res.writeHead(400);
      res.end('code дутуу');
      return;
    }

    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      '<h2>✅ Амжилттай. Терминал руугаа буцаж refresh_token-г хуулна уу. Энэ цонхыг хааж болно.</h2>'
    );

    console.log('\n============================================================');
    if (tokens.refresh_token) {
      console.log('✅ refresh_token амжилттай авлаа. Доорхыг .env-д тавина уу:\n');
      console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
    } else {
      console.log('⚠️ refresh_token буцаагүй. Google аккаунтын зөвшөөрлийг устгаад');
      console.log('   (https://myaccount.google.com/permissions) дахин оролдоно уу.');
    }
    console.log('============================================================\n');

    server.close();
    process.exit(0);
  } catch (err) {
    res.writeHead(500);
    res.end('Алдаа: ' + err.message);
    console.error('❌ Token солих алдаа:', err.message);
    server.close();
    process.exit(1);
  }
});

server.listen(redirectPort, () => {
  console.log('\n🔐 Google OAuth consent — доорх URL-г browser-т нээнэ үү:\n');
  console.log(authUrl);
  console.log(`\n(Localhost callback сервер :${redirectPort} дээр хүлээж байна...)\n`);
  console.log('VPS дээр port-forwarding ажиллахгүй бол: --manual горимыг ашиглана уу.\n');
});

} // end else (auto server mode)
