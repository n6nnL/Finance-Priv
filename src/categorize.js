// ============================================================
//  categorize.js — Дүрэмд суурилсан (keyword) ангилагч (listener тал)
//
//  Дараалал: Орлого(type==='income') → keyword дүрэм → null.
//  ⚠️ Танигдаагүй бол 'Бусад' БИШ, `null`. Keyword-логик нь
//  config/categories.js-д (matchByKeywords) — API тал ч мөн адил дуудна.
// ============================================================

import { INCOME_CATEGORY, matchByKeywords } from '../config/categories.js';

/**
 * Гүйлгээний object авч category буцаана (эсвэл null = танигдаагүй).
 * @param {{description?: string, raw?: string, type?: string}} tx
 * @returns {string|null}
 */
export function categorize(tx) {
  if (tx?.type === 'income') return INCOME_CATEGORY;
  return matchByKeywords(`${tx?.description ?? ''} ${tx?.raw ?? ''}`);
}

export default categorize;
