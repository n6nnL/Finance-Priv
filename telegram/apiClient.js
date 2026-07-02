// ============================================================
//  telegram/apiClient.js — одоо байгаа API руу бичих (dashboard SPA-той ижил)
//  Bot шинэ endpoint нэмэхгүй — PATCH /api/transactions/:id/category ашиглана,
//  ЗӨВХӨН тухайн хэрэглэгчид mint хийсэн Bearer JWT-ээр (machine X-API-Key БИШ).
//  Иймээс db.getById(req.userId,id)-ийн одоо байгаа scoping өөрөө "энэ
//  гүйлгээ энэ хэрэглэгчийнх мөн үү" эрх шалгалтыг хийж өгнө (404 = рэйжект).
// ============================================================

import { config } from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(path, { method = 'GET', body, accessToken } = {}, retries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(config.apiBase + path, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      const json = await res.json().catch(() => ({}));
      if (res.ok) return json;
      const err = new Error(`HTTP ${res.status}: ${json.error || ''}`);
      err.status = res.status;
      // 4xx (404/401 г.м) дахин оролдоод нэмэргүй — шууд таслана.
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

/** Гүйлгээ ангилах (баталгаажуулах). accessToken = тухайн хэрэглэгчид mint хийсэн JWT. */
export function patchCategory(accessToken, id, { category, applyToAll = true, merchantPlace, note }) {
  return req(`/api/transactions/${id}/category`, {
    method: 'PATCH',
    accessToken,
    body: { category, applyToAll, merchantPlace: merchantPlace || undefined, note: note || undefined },
  });
}

/**
 * Нэг гүйлгээний ОДООГИЙН төлөвийг API-аас татах — 404 = энэ хэрэглэгчид
 * хамаарахгүй (эсвэл устсан). Энэ бол callback-ийн эрх шалгалтын гол цэг.
 */
export async function getTransaction(accessToken, id) {
  try {
    const j = await req(`/api/transactions/${id}`, { accessToken });
    return j.data ?? null;
  } catch (e) {
    if (e?.status === 404) return null;
    throw e;
  }
}

export default { patchCategory, getTransaction };
