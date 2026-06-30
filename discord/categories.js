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
// Формат: <prefix>|<txnId>|...
//   'c'  = pending ангиллын товч        c|txnId|catIdx|isPos
//   'm'  = pending modal submit         m|txnId|catIdx|isPos|messageId
//   'e'  = "Ангилал засах" товч          e|txnId
//   'es' = засварын ангилал select       es|txnId|messageId (origin мессеж)

export function encodeButtonId(txnId, catIdx, isPos) {
  return `c|${txnId}|${catIdx}|${isPos ? 1 : 0}`;
}

export function encodeModalId(txnId, catIdx, isPos, messageId) {
  return `m|${txnId}|${catIdx}|${isPos ? 1 : 0}|${messageId}`;
}

/** Аль хэдийн бүртгэгдсэн гүйлгээний "Ангилал засах" товч */
export function encodeEditButtonId(txnId) {
  return `e|${txnId}`;
}

/** Засварын ангилал select (origin мессежийн id-г дамжуулна — дараа edit хийнэ) */
export function encodeCatSelectId(txnId, messageId) {
  return `es|${txnId}|${messageId}`;
}

export function parseId(customId) {
  const p = String(customId || '').split('|');
  if (p.length < 2) return null;
  const kind = p[0];
  const txnId = Number(p[1]);
  if (kind === 'e') return { kind, txnId };
  if (kind === 'es') return { kind, txnId, messageId: p[2] || null };
  // 'c' | 'm' — урт формат
  if (p.length < 4) return null;
  return {
    kind,
    txnId,
    catIdx: Number(p[2]),
    isPos: p[3] === '1',
    messageId: p[4] || null,
  };
}
