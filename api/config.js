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
  // Dashboard нэвтрэлт (хуучин — seed admin-д ашиглана). Password .env-д.
  dashboard: {
    user: optional('DASHBOARD_USER', 'admin'),
    password: optional('DASHBOARD_PASSWORD', ''),
  },
  // JWT (token-д суурилсан хэрэглэгчийн нэвтрэлт). secret тогтвортой байх ёстой
  // (солих бүрд бүх token хүчингүй болно). Default нь apiKey (тогтвортой, нууц).
  jwt: {
    secret: optional('JWT_SECRET', '') || required('LISTENER_API_KEY'),
    accessTtl: optional('JWT_ACCESS_TTL', '30m'),
    refreshTtl: optional('JWT_REFRESH_TTL', '30d'),
  },
  // Auth foundation
  auth: {
    // Анхны admin хэрэглэгч (users хоосон бол үүснэ). Login = энэ email/password.
    seedEmail: optional('SEED_ADMIN_EMAIL', 'admin'),
    seedPassword: optional('SEED_ADMIN_PASSWORD', '') || optional('DASHBOARD_PASSWORD', ''),
    // Олон нийтэд нээлттэй бүртгэл (default OFF — одоо хувийн систем)
    allowRegister: bool('AUTH_ALLOW_REGISTER', false),
    // Email/нууц үг нэвтрэлт (UI-аас хассан; зөвхөн тест/яаралтай). Prod default OFF.
    // OFF үед /api/auth/login, /register → 404. Google нь хүний цорын ганц нэвтрэлт.
    localAuth: bool('AUTH_LOCAL_ENABLED', false),
  },
  // Google OAuth (хүний нэвтрэлт) — нэвтрэх + Calendar (readonly) зөвшөөрөл.
  // Нууц утга api/.env-д (root .env-ийнхээс ТУСДАА — config нь api/.env уншина).
  google: {
    clientId: optional('GOOGLE_CLIENT_ID', ''),
    clientSecret: optional('GOOGLE_CLIENT_SECRET', ''),
    redirectUri: optional('GOOGLE_OAUTH_REDIRECT_URI', 'http://localhost:3000/api/auth/google/callback'),
    // Зөвшөөрөгдсөн Google email-үүд (таслалаар). Зөвхөн эдгээр нэвтэрнэ.
    allowedEmails: new Set(
      optional('GOOGLE_ALLOWED_EMAILS', '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    ),
    // Нэвтэрсний дараа browser-г буцаах SPA суурь (dev: http://localhost:5173).
    dashboardBaseUrl: optional('DASHBOARD_BASE_URL', ''),
  },
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
