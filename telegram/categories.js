// ============================================================
//  telegram/categories.js — 10 ангилал → inline keyboard mapping
//  config/categories.js-ийн CATEGORIES-г ДАХИН АШИГЛАНА (нэг эх сурвалж).
//  discord/categories.js-тэй ижил зарчим (★ ТОГТМОЛ id-ээр encode), гэхдээ
//  Telegram callback_data 64 BYTE хязгаартай тул discord-ийн кодыг ХӨНДӨЛГҮЙ
//  энд тусад нь бичсэн (жижиг давхардал, эрсдэлгүй).
//
//  ⚠️ Өмнө нь массив дахь ИНДЕКС кодлогддог байсан — CATEGORIES-ийн дараалал
//  өөрчлөгдвөл нислэг дунд байгаа бүх товч чимээгүй өөр ангилал руу шилждэг байв.
// ============================================================

import { CATEGORIES, byId, idFor } from '../config/categories.js';

export { CATEGORIES };

/**
 * Тогтмол id → ангиллын нэр. Танихгүй бол `null`.
 *
 * ⚠️ FAIL-SAFE: deploy-ийн ӨМНӨ илгээгдсэн мессежийн товч индексээр кодлогдсон
 * (`c|123|4|1`) — тэндээс `"4"` ирнэ. Бүх тогтмол id үсгэн тул таарахгүй → `null`
 * → bot.js "мэдэгдэл хуучирсан" гэж хариулна. Массив руу индекслэх fallback
 * ОГТ БАЙХГҮЙ (тэр нь чимээгүй буруу ангилал бичих байсан).
 */
export function categoryById(id) {
  return byId(id);
}

/** ангиллын нэр → тогтмол id (танихгүй → null) */
export function idOfCategory(name) {
  return idFor(name);
}

// ---- callback_data кодлох/задлах (Telegram 64 byte хязгаар) ----
//   'c'  = pending ангиллын товч          c|txnId|catId|isPos
//   'ec' = засварын ангиллын товч          ec|txnId|catId|isPos
//        (classified мөр — stale-check-гүй, дахин засах нь ХЭВИЙН)
//   'e'  = "Ангилал засах" товч            e|txnId
//   'n'  = "Талбар засах" товч             n|txnId  (POS→Газрын нэр / бусад→Шалтгаан)
//   'sk' = "Алгасах/Болих" (follow-up)     sk|txnId
//   'ay' / 'an' = applyToAll Тийм/Үгүй     ay|txnId / an|txnId
//
// Хамгийн урт: ec|999999|transport|0 = 21 байт — 64-д тайван багтана
// (catId нь ≤9 тэмдэгт байхаар config/categories.js-д сонгогдсон).

export function encodeButtonId(txnId, catId, isPos, kind = 'c') {
  return `${kind}|${txnId}|${catId}|${isPos ? 1 : 0}`;
}
export function encodeEditButtonId(txnId) {
  return `e|${txnId}`;
}
export function encodeFieldButtonId(txnId) {
  return `n|${txnId}`;
}
export function encodeSkipId(txnId) {
  return `sk|${txnId}`;
}
export function encodeApplyAllId(txnId, yes) {
  return `${yes ? 'ay' : 'an'}|${txnId}`;
}

export function parseId(data) {
  const p = String(data || '').split('|');
  if (p.length < 2) return null;
  const kind = p[0];
  const txnId = Number(p[1]);
  if (!Number.isInteger(txnId)) return null;
  if (kind === 'e' || kind === 'sk' || kind === 'n' || kind === 'ay' || kind === 'an') return { kind, txnId };
  if (kind === 'c' || kind === 'ec') {
    if (p.length < 4) return null;
    // catId-г ТҮҮХИЙГЭЭР нь буцаана; хүчинтэй эсэхийг categoryById() шийднэ.
    return { kind, txnId, catId: p[2], isPos: p[3] === '1' };
  }
  return null;
}
