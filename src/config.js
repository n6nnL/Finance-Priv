// ============================================================
//  config.js — Орчны хувьсагч унших + валидаци
//  Бүх нууц утга ЗӨВХӨН process.env-ээс уншина (кодод хатуу бичихгүй).
// ============================================================

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEnv } from '../config/loadEnv.js';

// .env-г shared loader-ээр унших (root .env). Систем/pm2 env давамгайлна.
loadEnv(join(dirname(fileURLToPath(import.meta.url)), '..', '.env'));

// Заавал байх ёстой хувьсагчдыг шалгана. Дутуу бол шууд унтрана
// (чимээгүй буруу ажиллахаас сэргийлэх).
function required(name) {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Заавал орчны хувьсагч дутуу байна: ${name}`);
  }
  return v.trim();
}

function optional(name, fallback) {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : fallback;
}

function num(name, fallback) {
  const v = process.env[name];
  if (!v || v.trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  gmail: {
    // Legacy: зөвхөн owner-ийн анхны seed-д (accounts.js seedOwnerFromEnv).
    // Multi-tenant үед данс бүрийн email нь API DB-ийн google_tokens.gmail_email-ээс ирнэ.
    user: optional('GMAIL_USER', ''),
    mailbox: optional('IMAP_MAILBOX', 'INBOX'),
  },
  oauth: {
    clientId: required('GOOGLE_CLIENT_ID'),
    clientSecret: required('GOOGLE_CLIENT_SECRET'),
    // Legacy: зөвхөн owner seed-д. Шинэ хэрэглэгчид dashboard-оос холбоно.
    refreshToken: optional('GMAIL_REFRESH_TOKEN', ''),
    redirectUri: optional('OAUTH_REDIRECT_URI', 'http://localhost:53682/oauth2callback'),
  },
  // Multi-tenant: API-ийн DB (google_tokens/users) — listener эндээс холбогдсон
  // дансуудыг уншина. Token-ууд шифрлэгдсэн тул TOKEN_ENC_KEY (api/.env-тэй ИЖИЛ) заавал.
  apiDbPath: required('API_DB_PATH'),
  tokenEncKey: required('TOKEN_ENC_KEY'),
  accountsPollSeconds: num('ACCOUNTS_POLL_SECONDS', 60),
  // Банкны илгээгчийн хаяг — env-ээс, default нь Голомт
  bankSender: optional('BANK_SENDER', 'alert@golomtbank.com').toLowerCase(),
  website: {
    apiUrl: required('WEBSITE_API_URL'),
    apiKey: required('WEBSITE_API_KEY'),
    hmacSecret: optional('WEBSITE_HMAC_SECRET', ''),
    maxRetries: num('PUSH_MAX_RETRIES', 4),
  },
  dbPath: optional('DB_PATH', './data/listener.sqlite'),
  tokenRefreshMinutes: num('TOKEN_REFRESH_MINUTES', 50),
  heartbeatSeconds: num('HEARTBEAT_SECONDS', 300),
  idleWarnMinutes: num('IDLE_WARN_MINUTES', 720),
  logLevel: optional('LOG_LEVEL', 'info'),
};

export default config;
