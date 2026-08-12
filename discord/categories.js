// ============================================================
//  discord/categories.js — 10 ангилал → товчлуур mapping
//  config/categories.js-ийн CATEGORIES-г ДАХИН АШИГЛАНА (нэг эх сурвалж).
//  customId урт богино байхын тулд ангиллыг ★ ТОГТМОЛ id-ЭЭР дамжуулна
//  ('dining', 'transport' г.м) — өмнө нь массив дахь ИНДЕКС байсан.
//
//  ⚠️ Индекс кодлол ЯАГААД арилсан бэ: CATEGORIES-д шинэ ангилал нэмэх/дараалал
//  солих бүрд нислэг дунд байгаа БҮХ товч чимээгүй өөр ангилал руу шилжинэ.
//  Тогтмол id-д энэ эрсдэл байхгүй.
// ============================================================

import { CATEGORIES, byId, idFor } from '../config/categories.js';

export { CATEGORIES };

/**
 * Тогтмол id → ангиллын нэр (товч/modal customId-аас). Танихгүй бол `null`.
 *
 * ⚠️ FAIL-SAFE: deploy-ийн ӨМНӨ илгээгдсэн мэдэгдлийн товч нь ИНДЕКСЭЭР
 * кодлогдсон (`c|123|4|1`) — тэндээс `"4"` ирнэ. Бүх тогтмол id үсгэн тул
 * энэ нь ХЭЗЭЭ Ч таарахгүй → `null` → bot.js "мэдэгдэл хуучирсан" гэж хариулна.
 * Массив руу индекслэх fallback ОГТ БАЙХГҮЙ (тэр нь буруу ангилал бичих байсан).
 */
export function categoryById(id) {
  return byId(id);
}

/** ангиллын нэр → тогтмол id (танихгүй → null) */
export function idOfCategory(name) {
  return idFor(name);
}

// ---- customId кодлох/задлах (Discord 100 тэмдэгтийн хязгаар) ----
// Формат: <prefix>|<txnId>|...
//   'c'  = pending ангиллын товч        c|txnId|catId|isPos
//   'm'  = pending modal submit         m|txnId|catId|isPos|messageId
//   'e'  = "Ангилал засах" товч          e|txnId
//   'es' = засварын ангилал select       es|txnId|messageId (origin мессеж)
//   'n'  = "Талбар засах" товч           n|txnId  (POS→Газрын нэр / бусад→Шалтгаан)
//   'nm' = талбарын modal submit         nm|txnId|messageId
//   'ay'/'an' = applyToAll Тийм/Үгүй     ay|txnId / an|txnId
//   (утга/ангилал нь customId-д багтахгүй тул bot.js-ийн pendingConfirm Map-д)
//
// Хамгийн урт: m|999999|transport|0|1234567890123456789 ≈ 40 тэмдэгт — 100-д
// тайван багтана (catId нь ≤9 тэмдэгт байхаар config-т сонгогдсон).

export function encodeButtonId(txnId, catId, isPos) {
  return `c|${txnId}|${catId}|${isPos ? 1 : 0}`;
}

export function encodeModalId(txnId, catId, isPos, messageId) {
  return `m|${txnId}|${catId}|${isPos ? 1 : 0}|${messageId}`;
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
  // 'c' | 'm' — урт формат. catId-г ТҮҮХИЙГЭЭР нь буцаана (энд шалгахгүй);
  // хүчинтэй эсэхийг categoryById() шийднэ → хуучин payload null болж унана.
  if (p.length < 4) return null;
  return {
    kind,
    txnId,
    catId: p[2],
    isPos: p[3] === '1',
    messageId: p[4] || null,
  };
}
