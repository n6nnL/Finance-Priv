// ============================================================
//  telegram/categories.js — 10 ангилал → inline keyboard mapping
//  config/categories.js-ийн CATEGORIES-г ДАХИН АШИГЛАНА (нэг эх сурвалж).
//  discord/categories.js-тэй ижил зарчим (index-ээр encode), гэхдээ Telegram
//  callback_data 64 byte хязгаартай тул discord-ийн кодыг ХӨНДӨЛГҮЙ энд
//  тусад нь бичсэн (жижиг давхардал, эрсдэлгүй).
// ============================================================

import { CATEGORIES } from '../config/categories.js';

export { CATEGORIES };

export function categoryByIndex(i) {
  const idx = Number(i);
  return Number.isInteger(idx) && idx >= 0 && idx < CATEGORIES.length ? CATEGORIES[idx] : null;
}

// ---- callback_data кодлох/задлах (Telegram 64 byte хязгаар) ----
//   'c'  = pending ангиллын товч          c|txnId|catIdx|isPos
//   'ec' = засварын ангиллын товч          ec|txnId|catIdx|isPos
//        (classified мөр — stale-check-гүй, дахин засах нь ХЭВИЙН)
//   'e'  = "Ангилал засах" товч            e|txnId
//   'n'  = "Талбар засах" товч             n|txnId  (POS→Газрын нэр / бусад→Шалтгаан)
//   'sk' = "Алгасах/Болих" (follow-up)     sk|txnId
//   'ay' / 'an' = applyToAll Тийм/Үгүй     ay|txnId / an|txnId

export function encodeButtonId(txnId, catIdx, isPos, kind = 'c') {
  return `${kind}|${txnId}|${catIdx}|${isPos ? 1 : 0}`;
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
    return { kind, txnId, catIdx: Number(p[2]), isPos: p[3] === '1' };
  }
  return null;
}
