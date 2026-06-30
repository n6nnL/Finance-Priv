// ============================================================
//  ops-notify.js — Бие даасан операцийн сэрэмжлүүлэг (Discord webhook)
//
//  bank-listener дахь ижил нэртэй модулийн API-талын хувилбар. Энэ процесс
//  тусдаа logger (logger.error(msg, ctx)) ашигладаг тул тусдаа файл байна.
//
//  Бие даасан: зөвхөн built-in fetch ашиглана. DB, discord client-ээс
//  хамаарахгүй. payload-д токен/.env/PII ОРУУЛАХГҮЙ.
// ============================================================

import { logger } from './logger.js';

const COOLDOWN_MS = 15 * 60 * 1000;
const POST_TIMEOUT_MS = 10_000;
const PROCESS_NAME = process.env.OPS_PROCESS_NAME || 'bank-api';

// Sustained 5xx илрүүлэх цонх
const FIVEXX_WINDOW_MS = 5 * 60 * 1000;
const FIVEXX_THRESHOLD = 5;

const lastSent = new Map();
const firing = new Set();
const fivexxTimes = [];

/** Нууц/PII-г payload-аас цэвэрлэх. */
export function scrub(detail) {
  let msg =
    typeof detail === 'string'
      ? detail
      : detail?.message ?? detail?.code ?? (detail == null ? '' : String(detail));
  msg = String(msg).slice(0, 300);
  msg = msg.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>');
  msg = msg.replace(/\b1\/\/[A-Za-z0-9_-]+/g, '<token>');
  msg = msg.replace(/\bya29\.[A-Za-z0-9._-]+/g, '<token>');
  msg = msg.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <token>');
  msg = msg.replace(/\b[A-Za-z0-9_-]{40,}\b/g, '<redacted>');
  return msg || '(no detail)';
}

async function post(payload) {
  const url = process.env.OPS_WEBHOOK_URL || '';
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`webhook HTTP ${res.status}`);
  } catch (err) {
    logger.error('ops webhook илгээх амжилтгүй', { err: err?.message });
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

export async function notifyOps(errorKey, detail) {
  if (!process.env.OPS_WEBHOOK_URL) return;
  const now = Date.now();
  const last = lastSent.get(errorKey) || 0;
  firing.add(errorKey);
  if (now - last < COOLDOWN_MS) return;
  lastSent.set(errorKey, now);
  await post(alertEmbed(errorKey, detail));
}

export async function notifyOpsRecovered(errorKey, detail) {
  if (!process.env.OPS_WEBHOOK_URL) return;
  if (!firing.has(errorKey)) return;
  firing.delete(errorKey);
  lastSent.delete(errorKey);
  await post(recoveredEmbed(errorKey, detail));
}

/**
 * 5xx бүртгэх. Тогтвортой 5xx (5 минутад ≥5) илэрвэл нэг сэрэмжлүүлэг (debounce-тэй).
 */
export function record5xx(detail) {
  const now = Date.now();
  while (fivexxTimes.length && now - fivexxTimes[0] > FIVEXX_WINDOW_MS) fivexxTimes.shift();
  fivexxTimes.push(now);
  if (fivexxTimes.length >= FIVEXX_THRESHOLD) {
    notifyOps('api-5xx-sustained', detail);
  }
}

export function _resetOpsState() {
  lastSent.clear();
  firing.clear();
  fivexxTimes.length = 0;
}

export default { notifyOps, notifyOpsRecovered, record5xx, scrub, _resetOpsState };
