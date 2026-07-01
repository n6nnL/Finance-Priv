// ============================================================
//  config/loadEnv.js — .env унших НЭГ shared util (dotenv dependency-гүй).
//
//  Өмнө нь ижил parser 4 газар давхардсан байсан (src/config.js, api/config.js,
//  discord/config.js, scripts/get-token.js) — эндээс нэгтгэв. Дуудагч тал зөвхөн
//  өөрийн .env-ийн ЗАМ-ыг өгнө (root .env эсвэл api/.env).
// ============================================================

import { readFileSync } from 'node:fs';

/**
 * Өгөгдсөн .env файлыг уншиж process.env-д тавина. Зөвхөн одоо `undefined`
 * түлхүүрт бичнэ — систем/pm2/shell-ээс өгсөн env ДАВАМГАЙЛНА. Файл байхгүй бол
 * чимээгүй алгасна (env-ийг өөр газраас өгсөн гэж үзнэ).
 * @param {string} envPath  .env файлын бүтэн зам
 */
export function loadEnv(envPath) {
  let raw;
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    return; // .env байхгүй → shell/pm2 env ашиглана
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // Тэгш хашилтыг л авна ("...") ('...')
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

export default loadEnv;
