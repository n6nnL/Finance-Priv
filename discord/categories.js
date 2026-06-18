// ============================================================
//  discord/categories.js — 10 ангилал → товчлуур mapping
//  config/categories.js-ийн CATEGORIES-г ДАХИН АШИГЛАНА (нэг эх сурвалж).
//  customId урт богино байхын тулд ангиллыг ИНДЕКСЭЭР дамжуулна.
// ============================================================

import { CATEGORIES } from '../config/categories.js';

export { CATEGORIES };

/** index → ангиллын нэр (товч/modal customId-аас) */
export function categoryByIndex(i) {
  const idx = Number(i);
  return Number.isInteger(idx) && idx >= 0 && idx < CATEGORIES.length ? CATEGORIES[idx] : null;
}

/** ангиллын нэр → index */
export function indexOfCategory(name) {
  return CATEGORIES.indexOf(name);
}

// ---- customId кодлох/задлах (Discord 100 тэмдэгтийн хязгаар) ----
// Формат: <prefix>|<txnId>|<catIdx>|<isPos>[|<messageId>]
//   prefix: 'c' = button (ангилал сонгох), 'm' = modal submit

export function encodeButtonId(txnId, catIdx, isPos) {
  return `c|${txnId}|${catIdx}|${isPos ? 1 : 0}`;
}

export function encodeModalId(txnId, catIdx, isPos, messageId) {
  return `m|${txnId}|${catIdx}|${isPos ? 1 : 0}|${messageId}`;
}

export function parseId(customId) {
  const p = String(customId || '').split('|');
  if (p.length < 4) return null;
  return {
    kind: p[0], // 'c' | 'm'
    txnId: Number(p[1]),
    catIdx: Number(p[2]),
    isPos: p[3] === '1',
    messageId: p[4] || null,
  };
}
