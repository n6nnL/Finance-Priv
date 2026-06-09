// ============================================================
//  categorize.js — Дүрэмд суурилсан ангилал (API тал)
//  Listener-ийн config/categories.js-г ДАХИН АШИГЛАНА (нэг эх сурвалж).
// ============================================================

import { CATEGORY_RULES, CATEGORIES, INCOME_CATEGORY, DEFAULT_CATEGORY } from '../config/categories.js';

/**
 * Текстээс keyword-аар ангилал тодорхойлох.
 * ⚠️ Танигдаагүй бол 'other' БИШ, `null` буцаана — систем автоматаар "Бусад"
 * болгохгүй; оронд нь дуудагч тал pending_review болгож AI санал асууна.
 * "Бусад"-ыг зөвхөн хэрэглэгч өөрөө баталгаажуулахдаа сонгож болно.
 * @param {string} text  description (+ raw)
 * @returns {string|null} category эсвэл null (танигдаагүй)
 */
export function categorizeByRules(text) {
  const hay = String(text || '').toLowerCase();
  if (!hay.trim()) return null;
  for (const rule of CATEGORY_RULES) {
    for (const kw of rule.keywords) {
      if (hay.includes(kw.toLowerCase())) return rule.category;
    }
  }
  return null;
}

/** Боломжит бүх 10 ангиллын жагсаалт (dropdown болон AI prompt-д) */
export function listCategories() {
  return [...CATEGORIES];
}

/**
 * POS (картаар тодорхой газар) гүйлгээ эсэх — description нь BOM-оор төгссөн.
 * (parsers/golomt.js-ийн detectIsPos-той ижил дүрэм; API-д cheerio импортлохгүйн
 *  тулд энд давхарлав.)
 */
export function isPosDescription(desc) {
  if (!desc) return false;
  return /BOM\b/i.test(desc);
}

export { DEFAULT_CATEGORY, INCOME_CATEGORY };
export default { categorizeByRules, listCategories, isPosDescription, DEFAULT_CATEGORY, INCOME_CATEGORY };
