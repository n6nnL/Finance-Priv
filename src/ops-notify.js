// ============================================================
//  ops-notify.js — Бие даасан операцийн сэрэмжлүүлэг (Discord webhook)
//
//  Зорилго: процесс доторх ноцтой/давтагдах алдаа гарвал ШУУД зориулсан
//  Discord суваг руу webhook-оор мэдэгдэх. bank-api, sqlite DB, эсвэл
//  үндсэн discord.js client-ээс ХАМААРАХГҮЙ (яг тэдгээр нь унасан байж болзошгүй).
//
//  Аюулгүй байдал: payload-д токен/refresh token/.env/PII ОРУУЛАХГҮЙ.
//  Зөвхөн: процессын нэр, алдааны түлхүүр, богино мессеж, timestamp (UTC).
//
//  Debounce: ижил түлхүүрийн давталтыг 15 минутын дотор дарна.
//  Recovery: өмнө асаж байсан нөхцөл арилвал нэг л "✅ recovered" илгээнэ.
//  Webhook өөрөө амжилтгүй бол локал logger-т бичээд цааш үргэлжилнэ (throw хийхгүй).
// ============================================================

import { logger } from './logger.js';

const COOLDOWN_MS = 15 * 60 * 1000; // нэг түлхүүрийн дахин сэрэмжлүүлгийн хөргөлт
const POST_TIMEOUT_MS = 10_000;
const PROCESS_NAME = process.env.OPS_PROCESS_NAME || 'bank-listener';

// key -> сүүлд сэрэмжлүүлэг илгээсэн ms (in-memory; restart дээр reset — зөвшөөрөгдсөн)
const lastSent = new Map();
// одоо "асаж" буй (сэрэмжлүүлэг илгээгдсэн, хараахан сэргээгүй) түлхүүрүүд
const firing = new Set();

/** Нууц/PII-г payload-аас цэвэрлэх. Зөвхөн богино, аюулгүй мессеж үлдээнэ. */
export function scrub(detail) {
  let msg =
    typeof detail === 'string'
      ? detail
      : detail?.message ?? detail?.code ?? (detail == null ? '' : String(detail));
  msg = String(msg).slice(0, 300);
  // Имэйл хаяг
  msg = msg.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>');
  // Google refresh token (1//...) ба access token (ya29....)
  msg = msg.replace(/\b1\/\/[A-Za-z0-9_-]+/g, '<token>');
  msg = msg.replace(/\bya29\.[A-Za-z0-9._-]+/g, '<token>');
  // Bearer header
  msg = msg.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <token>');
  // Урт opaque token/secret (40+ тэмдэгт)
  msg = msg.replace(/\b[A-Za-z0-9_-]{40,}\b/g, '<redacted>');
  return msg || '(no detail)';
}

/** Webhook руу нэг POST. Хэзээ ч throw хийхгүй — амжилтгүй бол локал log. */
async function post(payload) {
  const url = process.env.OPS_WEBHOOK_URL || '';
  if (!url) return; // тохируулаагүй бол no-op
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`webhook HTTP ${res.status}`);
  } catch (err) {
    // Сэрэмжлүүлэгчээс throw гаргахгүй — зөвхөн локал бичнэ.
    logger.error({ err: err?.message }, 'ops webhook илгээх амжилтгүй');
  }
}

function alertEmbed(errorKey, detail) {
  return {
    username: 'Bank Ops',
    embeds: [
      {
        title: `🚨 ${PROCESS_NAME} · ${errorKey}`,
        description: scrub(detail),
        color: 0xef4444,
        timestamp: new Date().toISOString(),
        fields: [
          { name: 'process', value: PROCESS_NAME, inline: true },
          { name: 'key', value: errorKey, inline: true },
        ],
      },
    ],
  };
}

function recoveredEmbed(errorKey, detail) {
  return {
    username: 'Bank Ops',
    embeds: [
      {
        title: `✅ ${PROCESS_NAME} · ${errorKey} сэргэлээ`,
        description: scrub(detail || 'нөхцөл арилсан'),
        color: 0x22c55e,
        timestamp: new Date().toISOString(),
        fields: [
          { name: 'process', value: PROCESS_NAME, inline: true },
          { name: 'key', value: errorKey, inline: true },
        ],
      },
    ],
  };
}

/**
 * Алдааны сэрэмжлүүлэг. Ижил түлхүүрийг 15 минутын дотор дарна (debounce).
 * Нөхцөл асаж буйг тэмдэглэнэ (recovery-д хэрэгтэй).
 */
export async function notifyOps(errorKey, detail) {
  if (!process.env.OPS_WEBHOOK_URL) return;
  const now = Date.now();
  const last = lastSent.get(errorKey) || 0;
  // Нөхцөл идэвхтэйг дарагдсан ч гэсэн тэмдэглэнэ (recovery зөв ажиллахын тулд)
  firing.add(errorKey);
  if (now - last < COOLDOWN_MS) return; // давталтыг дарна
  lastSent.set(errorKey, now);
  await post(alertEmbed(errorKey, detail));
}

/**
 * Өмнө асаж байсан нөхцөл арилсныг мэдэгдэх. Зөвхөн асаж байсан түлхүүрт
 * ЯГ НЭГ удаа илгээнэ. Дараа дахин алдвал шинээр сэрэмжлүүлэх боломжтой болгоно.
 */
export async function notifyOpsRecovered(errorKey, detail) {
  if (!process.env.OPS_WEBHOOK_URL) return;
  if (!firing.has(errorKey)) return; // асаагүй байсан бол юу ч хийхгүй
  firing.delete(errorKey);
  lastSent.delete(errorKey); // дараагийн алдаа дахин шууд сэрэмжлүүлэхийг зөвшөөрнө
  await post(recoveredEmbed(errorKey, detail));
}

/** Тест/оношлогоонд: дотоод төлөвийг цэвэрлэх. */
export function _resetOpsState() {
  lastSent.clear();
  firing.clear();
}

export default { notifyOps, notifyOpsRecovered, scrub, _resetOpsState };
