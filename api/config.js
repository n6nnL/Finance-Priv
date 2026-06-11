// ============================================================
//  config.js — env унших + валидаци (нэмэлт пакетгүй .env parser)
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function loadDotEnv() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  try {
    const raw = readFileSync(join(__dirname, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* .env байхгүй бол shell/pm2 env ашиглана */
  }
}
loadDotEnv();

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
function bool(name, fallback) {
  const v = process.env[name];
  if (v == null || v.trim() === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

export const config = {
  port: num('PORT', 3000),
  apiKey: required('LISTENER_API_KEY'),
  hmacSecret: optional('LISTENER_HMAC_SECRET', ''),
  dbPath: optional('DB_PATH', './data/transactions.sqlite'),
  rateLimit: {
    windowSeconds: num('RATE_LIMIT_WINDOW_SECONDS', 60),
    max: num('RATE_LIMIT_MAX', 120),
  },
  bodyLimit: optional('BODY_LIMIT', '100kb'),
  logLevel: optional('LOG_LEVEL', 'info'),
  ai: {
    // AI ангилал СОНГОЛТТОЙ. Идэвхтэй болохын тулд toggle=true БА key байх ёстой.
    // Default: унтраалттай (хэрэглэгч одоогоор credit-гүй). AI-гүй үед танигдаагүй
    // гүйлгээ AI саналгүйгээр pending_review болж, хэрэглэгчээс асууна.
    enabled: bool('AI_CATEGORIZATION_ENABLED', false),
    apiKey: optional('ANTHROPIC_API_KEY', ''),
    model: optional('ANTHROPIC_MODEL', 'claude-haiku-4-5'),
  },
};

export default config;
