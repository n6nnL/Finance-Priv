// ============================================================
//  categorize.js — Дүрэмд суурилсан ангилал (API тал)
//  Keyword-логик (matchByKeywords) + isPos (detectIsPos) нь дундын эх сурвалжаас
//  (config/) — давхардал үгүй, listener талтай ЯГ ижил дүрэм.
// ============================================================

import { CATEGORIES, INCOME_CATEGORY, DEFAULT_CATEGORY, matchByKeywords } from '../config/categories.js';
import { detectIsPos } from '../config/txfields.js';

/**
 * Текстээс keyword-аар ангилал тодорхойлох.
 * ⚠️ Танигдаагүй бол 'other'/'Бусад' БИШ, `null` — дуудагч тал pending_review болгоно.
 * @param {string} text  description (+ raw)
 * @returns {string|null}
 */
export function categorizeByRules(text) {
  return matchByKeywords(text);
}

/** Боломжит бүх 10 ангиллын жагсаалт (dropdown болон AI prompt-д) */
export function listCategories() {
  return [...CATEGORIES];
}

/** POS (картаар тодорхой газар) гүйлгээ эсэх — config/txfields.js-ийн detectIsPos. */
export function isPosDescription(desc) {
  return detectIsPos(desc);
}

export { DEFAULT_CATEGORY, INCOME_CATEGORY };
export default { categorizeByRules, listCategories, isPosDescription, DEFAULT_CATEGORY, INCOME_CATEGORY };
