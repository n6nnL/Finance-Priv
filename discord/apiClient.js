// ============================================================
//  discord/apiClient.js — одоо байгаа API руу бичих (dashboard-той ижил)
//  Bot шинэ endpoint нэмэхгүй — PATCH /api/transactions/:id/category ашиглана.
// ============================================================

import { config } from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(path, { method = 'GET', body } = {}, retries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(config.apiBase + path, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-API-Key': config.apiKey },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      const json = await res.json().catch(() => ({}));
      if (res.ok) return json;
      const err = new Error(`HTTP ${res.status}: ${json.error || ''}`);
      err.status = res.status;
      // 4xx (404 г.м) нь дахин оролдоод нэмэргүй — шууд таслана (interaction-ийн
      // 3с төсвийг хэмнэнэ). Зөвхөн 5xx/network-ийг retry хийнэ.
      if (res.status >= 400 && res.status < 500) throw err;
      lastErr = err;
    } catch (e) {
      if (e?.status >= 400 && e?.status < 500) throw e;
      lastErr = e;
    }
    if (attempt < retries) await sleep(1000 * attempt);
  }
  throw lastErr;
}

/**
 * Гүйлгээ ангилах (баталгаажуулах). ⚠️ applyToAll default OFF — зөвхөн
 * хэрэглэгч баталгаажуулалтад "Тийм" гэсэн үед true (санамсаргүй override үгүй).
 * POS бол merchantPlace, бусад бол note.
 */
export function patchCategory(id, { category, applyToAll = false, merchantPlace, note }) {
  return req(`/api/transactions/${id}/category`, {
    method: 'PATCH',
    body: { category, applyToAll, merchantPlace: merchantPlace || undefined, note: note || undefined },
  });
}

/**
 * Тэмдэглэл/газрын нэр — ангилал хөндөхгүй, override үүсгэхгүй.
 * fields = { note } ЭСВЭЛ { merchantPlace }; '' → NULL (утга устгана).
 */
export function updateFields(id, fields) {
  return req(`/api/transactions/${id}/note`, { method: 'PATCH', body: fields });
}

/**
 * Нэг гүйлгээний ОДООГИЙН төлөвийг API-аас татах (interaction үед "stale эсэх"
 * шалгахад). Олдохгүй бол (404) null буцаана — алдаа шиддэхгүй.
 */
export async function getTransaction(id) {
  try {
    const j = await req(`/api/transactions/${id}`);
    return j.data ?? null;
  } catch (e) {
    if (e?.status === 404) return null;
    throw e;
  }
}

export default { patchCategory, updateFields, getTransaction };
