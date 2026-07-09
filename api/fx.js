// ============================================================
//  fx.js — Гадаад валютын ханшийн live дүн (USD→MNT, EUR→MNT)
//
//  Провайдер: open.er-api.com (үнэгүй, түлхүүр шаардахгүй, өдөрт нэг сэргээгддэг).
//  Бие даасан: зөвхөн built-in fetch ашиглана (ops-notify.js-тэй адил загвар).
//  1 цагийн in-memory кэштэй — гадаад API-г дэмий олон удаа дуудахгүй (олон
//  хэрэглэгч зэрэг Тохиргоо нээвэл ч 1 л удаа гадагш дуудна).
// ============================================================

import { logger } from './logger.js';

const FX_URL = 'https://open.er-api.com/v6/latest/USD';
const FETCH_TIMEOUT_MS = 8_000;
const CACHE_MS = 60 * 60 * 1000; // 1 цаг

let cache = null; // { data, fetchedAt }

async function fetchFromProvider() {
  const res = await fetch(FX_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`FX provider HTTP ${res.status}`);
  const json = await res.json();
  const mnt = json?.rates?.MNT;
  const eur = json?.rates?.EUR;
  if (json?.result !== 'success' || !(mnt > 0) || !(eur > 0)) {
    throw new Error('FX provider буруу хариу');
  }
  return {
    usdMnt: Math.round(mnt * 100) / 100,
    eurMnt: Math.round((mnt / eur) * 100) / 100,
    asOf: json.time_last_update_utc || null,
    source: 'exchangerate-api.com (open.er-api.com)',
  };
}

/**
 * Өнөөдрийн USD→MNT, EUR→MNT ханш (1 цагийн кэштэй). Гадаад дуудалт унавал
 * throw хийнэ — дуудагч тал (route) кэш/хуучин утгаараа fallback хийж болно.
 * @returns {Promise<{usdMnt:number, eurMnt:number, asOf:string|null, source:string, cached?:boolean}>}
 */
export async function getLiveFxRates() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) {
    return { ...cache.data, cached: true };
  }
  try {
    const data = await fetchFromProvider();
    cache = { data, fetchedAt: Date.now() };
    return { ...data, cached: false };
  } catch (err) {
    logger.error('FX ханш татахад алдаа', { err: err?.message });
    if (cache) return { ...cache.data, cached: true, stale: true };
    throw err;
  }
}

export function _resetFxCache() {
  cache = null;
}

export default { getLiveFxRates, _resetFxCache };
