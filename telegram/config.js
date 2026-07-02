// ============================================================
//  telegram/config.js — bot-ийн тохиргоо (root .env-ээс уншина)
//  Нууц утга (TELEGRAM_BOT_TOKEN, JWT_SECRET) кодод хатуу бичигдэхгүй.
//  ⚠️ JWT_SECRET нь api/.env-ийнхтэй ЯГ ИЖИЛ байх ЁСТОЙ (энэ bot мессежийг
//  тухайн хэрэглэгчид зориулж процесс дотроо mint хийж, API-д Bearer-ээр
//  илгээнэ — API JWT_SECRET-ээрээ verify хийдэг).
// ============================================================

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadEnv } from '../config/loadEnv.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Root .env-г shared loader-ээр унших. Систем/pm2 env давамгайлна.
loadEnv(join(__dirname, '..', '.env'));

const req = (n) => {
  const v = process.env[n];
  if (!v || !v.trim()) throw new Error(`Заавал env дутуу: ${n}`);
  return v.trim();
};
const opt = (n, d) => (process.env[n] && process.env[n].trim() ? process.env[n].trim() : d);
const num = (n, d) => {
  const v = Number(process.env[n]);
  return Number.isFinite(v) ? v : d;
};

export const config = {
  botToken: req('TELEGRAM_BOT_TOKEN'),
  // API-ийн api/.env-д тохируулсан JWT_SECRET-тэй ЯГ ИЖИЛ утга байх ЁСТОЙ (энэ
  // bot тухайн хэрэглэгчид зориулсан access token-ыг өөрөө mint хийдэг тул).
  // ⚠️ api/config.js-ийн LISTENER_API_KEY fallback-ийг ЭНД дахин ашиглаагүй —
  // LISTENER_API_KEY нь зөвхөн api/.env-д байдаг тул root .env-д JWT_SECRET-г
  // ТОДОРХОЙ бичих ЗААВАЛ.
  jwtSecret: req('JWT_SECRET'),
  jwtAccessTtl: opt('TELEGRAM_JWT_TTL', '5m'),
  // API үндсэн хаяг (dashboard-той ижил API)
  apiBase: opt('TELEGRAM_API_BASE', 'http://localhost:3000'),
  // Гүйлгээ илрүүлэхэд DB-г шууд polling + linking bookkeeping (API-ийн DB,
  // discord/config.js-ийн dbPath-тай ижил загвар).
  dbPath: resolve(__dirname, opt('TELEGRAM_DB_PATH', '../api/data/transactions.sqlite')),
  pollSeconds: num('TELEGRAM_POLL_SECONDS', 15),
  // bot-ийн төлөв (хамгийн сүүлд мэдэгдсэн id) хадгалах файл (Discord-той ижил загвар)
  statePath: resolve(__dirname, opt('TELEGRAM_STATE_PATH', './.bot-state.json')),
  // Dashboard холбоос (onboarding зааварт харуулна)
  dashboardUrl: opt('DASHBOARD_PUBLIC_URL', 'http://localhost:3000'),
};

export default config;
