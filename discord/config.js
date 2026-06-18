// ============================================================
//  discord/config.js — bot-ийн тохиргоо (root .env-ээс уншина)
//  Нууц утга (DISCORD_BOT_TOKEN) кодод хатуу бичигдэхгүй.
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Root .env-г энгийнээр унших (нэмэлт пакетгүй)
function loadDotEnv() {
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
    /* .env байхгүй бол shell/pm2 env */
  }
}
loadDotEnv();

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
