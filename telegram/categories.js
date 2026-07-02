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
//   'c'  = pending ангиллын товч   c|txnId|catIdx|isPos
//   'e'  = "Ангилал засах" товч     e|txnId
//   'sk' = "Алгасах" (follow-up)    sk|txnId

export function encodeButtonId(txnId, catIdx, isPos) {
  return `c|${txnId}|${catIdx}|${isPos ? 1 : 0}`;
}
export function encodeEditButtonId(txnId) {
  return `e|${txnId}`;
}
export function encodeSkipId(txnId) {
  return `sk|${txnId}`;
}

export function parseId(data) {
  const p = String(data || '').split('|');
  if (p.length < 2) return null;
  const kind = p[0];
  const txnId = Number(p[1]);
  if (!Number.isInteger(txnId)) return null;
  if (kind === 'e' || kind === 'sk') return { kind, txnId };
  if (kind === 'c') {
    if (p.length < 4) return null;
    return { kind, txnId, catIdx: Number(p[2]), isPos: p[3] === '1' };
  }
  return null;
}
