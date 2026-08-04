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
//   'n'  = "Талбар засах" товч           n|txnId  (POS→Газрын нэр / бусад→Шалтгаан)
//   'nm' = талбарын modal submit         nm|txnId|messageId
//   'ay'/'an' = applyToAll Тийм/Үгүй     ay|txnId / an|txnId
//   (утга/ангилал нь customId-д багтахгүй тул bot.js-ийн pendingConfirm Map-д)

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

/** "Талбар засах" товч (POS→Газрын нэр / бусад→Шалтгаан — модуль шийднэ) */
export function encodeFieldButtonId(txnId) {
  return `n|${txnId}`;
}

/** Талбарын modal submit (origin мессежийн id — дараа refresh хийнэ) */
export function encodeFieldModalId(txnId, messageId) {
  return `nm|${txnId}|${messageId}`;
}

/** applyToAll баталгаажуулалтын Тийм/Үгүй товч */
export function encodeApplyAllId(txnId, yes) {
  return `${yes ? 'ay' : 'an'}|${txnId}`;
}

export function parseId(customId) {
  const p = String(customId || '').split('|');
  if (p.length < 2) return null;
  const kind = p[0];
  const txnId = Number(p[1]);
  if (kind === 'e' || kind === 'n' || kind === 'ay' || kind === 'an') return { kind, txnId };
  if (kind === 'es' || kind === 'nm') return { kind, txnId, messageId: p[2] || null };
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
