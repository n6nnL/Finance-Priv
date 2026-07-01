// ============================================================
//  discord/config.js — bot-ийн тохиргоо (root .env-ээс уншина)
//  Нууц утга (DISCORD_BOT_TOKEN) кодод хатуу бичигдэхгүй.
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
  token: req('DISCORD_BOT_TOKEN'),
  channelId: req('DISCORD_CHANNEL_ID'),
  // API key — dashboard/listener-тэй ижил (PATCH/overrides-д)
  apiKey: opt('DISCORD_API_KEY', '') || req('WEBSITE_API_KEY'),
  // API үндсэн хаяг (dashboard-той ижил API)
  apiBase: opt('DISCORD_API_BASE', 'http://localhost:3000'),
  // Гүйлгээ илрүүлэхэд DB-г шууд polling (API-ийн DB)
  dbPath: resolve(__dirname, opt('DISCORD_DB_PATH', '../api/data/transactions.sqlite')),
  pollSeconds: num('DISCORD_POLL_SECONDS', 15),
  // bot-ийн төлөв (хамгийн сүүлд мэдэгдсэн id) хадгалах файл
  statePath: resolve(__dirname, opt('DISCORD_STATE_PATH', './.bot-state.json')),
};

export default config;
