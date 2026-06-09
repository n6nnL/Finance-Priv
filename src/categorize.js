// ============================================================
//  categorize.js — Дүрэмд суурилсан (keyword) ангилагч (listener тал)
//
//  Дараалал: Орлого(type==='income') → keyword дүрэм → null.
//  ⚠️ Танигдаагүй бол 'Бусад' БИШ, `null` буцаана — систем автоматаар
//  "Бусад" болгохгүй. API тал null үед status='pending_review' болгож,
//  learned override-г энэ дүрмээс ӨМНӨ шалгана (classify.js).
// ============================================================

import { CATEGORY_RULES, INCOME_CATEGORY } from '../config/categories.js';

/**
 * Гүйлгээний object авч category буцаана (эсвэл null = танигдаагүй).
 * @param {{description?: string, raw?: string, type?: string}} tx
 * @returns {string|null}
 */
export function categorize(tx) {
  // Орлого бол шууд 'Орлого' (хүмүүсээс ирсэн шилжүүлэг ч энд багтана)
  if (tx?.type === 'income') return INCOME_CATEGORY;

  const haystack = `${tx?.description ?? ''} ${tx?.raw ?? ''}`.toLowerCase();
  if (!haystack.trim()) return null;

  for (const rule of CATEGORY_RULES) {
    for (const kw of rule.keywords) {
      if (haystack.includes(kw.toLowerCase())) return rule.category;
    }
  }
  return null; // танигдаагүй → API талд pending_review
}

export default categorize;
