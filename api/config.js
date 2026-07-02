// ============================================================
//  config.js — env унших + валидаци (нэмэлт пакетгүй .env parser)
// ============================================================

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEnv } from '../config/loadEnv.js';

// .env-г shared loader-ээр унших (api/.env). Систем/pm2 env давамгайлна.
loadEnv(join(dirname(fileURLToPath(import.meta.url)), '.env'));

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
  // OAuth refresh token-ы encryption-at-rest түлхүүр (32 byte hex, root .env-тэй ИЖИЛ).
  // ЗААВАЛ — token DB-д ил хадгалагдахгүй.
  tokenEncKey: required('TOKEN_ENC_KEY'),
  hmacSecret: optional('LISTENER_HMAC_SECRET', ''),
  dbPath: optional('DB_PATH', './data/transactions.sqlite'),
  rateLimit: {
    windowSeconds: num('RATE_LIMIT_WINDOW_SECONDS', 60),
    max: num('RATE_LIMIT_MAX', 120),
  },
  bodyLimit: optional('BODY_LIMIT', '100kb'),
  logLevel: optional('LOG_LEVEL', 'info'),
  // Ангилаагүй (pending_review) гүйлгээ N хоногоос дээш хугацаанд байвал → авто
  // 'Бусад' болгоно (хэрэглэгчийн бодлого). 0/сөрөг → унтраалттай. Default 3.
  pendingAutoClassifyDays: num('PENDING_AUTO_CLASSIFY_DAYS', 3),
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
    // Google allow-list-ийг алгасаж ямар ч Google хэрэглэгч бүртгүүлэх боломж (default OFF).
    // Per-user isolation (user_id) хамгаалалттай тул шинэ хэрэглэгч зөвхөн өөрийн (хоосон)
    // өгөгдлийг харна — owner-ийн гүйлгээнд хүрэхгүй.
    openSignup: bool('AUTH_OPEN_SIGNUP', false),
    // Email/нууц үг нэвтрэлт (UI-аас хассан; зөвхөн тест/яаралтай). Prod default OFF.
    // OFF үед /api/auth/login, /register → 404. Google нь хүний цорын ганц нэвтрэлт.
    localAuth: bool('AUTH_LOCAL_ENABLED', false),
  },
  // Google OAuth (хүний нэвтрэлт) — Login БА Calendar-холболт нь ТУСДАА OAuth client
  // ашиглана (listener-ийн Gmail client-тэй хуваалцахгүй → "баталгаажаагүй апп"
  // анхааруулга гарахгүй). Нууц утга api/.env-д.
  google: {
    // Login client — зөвхөн openid/email/profile (минимал scope). Calendar-холболт мөн
    // ЭНЭ client-ийг ашиглана (тусдаа redirect URI-аар), 3 дахь client шаардлагагүй.
    login: {
      clientId: optional('LOGIN_GOOGLE_CLIENT_ID', ''),
      clientSecret: optional('LOGIN_GOOGLE_CLIENT_SECRET', ''),
      redirectUri: optional('LOGIN_OAUTH_REDIRECT_URI', 'http://localhost:3000/api/auth/google/callback'),
    },
    // Calendar callback redirect URI — login redirectUri-аас deterministically тооцно
    // (шинэ env хувьсагч шаардахгүй). Google Console дээр хоёуланг нь бүртгэнэ.
    get calendarRedirectUri() {
      const login = optional('LOGIN_OAUTH_REDIRECT_URI', 'http://localhost:3000/api/auth/google/callback');
      return login.replace(/\/google\/callback$/, '/google/calendar/callback');
    },
    // Gmail холболт (multi-tenant listener) — listener-ийн Gmail client-ийг ашиглана
    // (root .env-ийн GOOGLE_CLIENT_ID/SECRET-тэй ИЖИЛ утга энд давхар орно; тухайн
    // client дээр /api/auth/gmail/callback redirect URI-г Console-д бүртгэнэ).
    gmail: {
      clientId: optional('GMAIL_GOOGLE_CLIENT_ID', ''),
      clientSecret: optional('GMAIL_GOOGLE_CLIENT_SECRET', ''),
    },
    get gmailRedirectUri() {
      const login = optional('LOGIN_OAUTH_REDIRECT_URI', 'http://localhost:3000/api/auth/google/callback');
      return login.replace(/\/google\/callback$/, '/gmail/callback');
    },
    // Зөвшөөрөгдсөн Google email-үүд (таслалаар). AUTH_OPEN_SIGNUP=true үед алгасагдана.
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
