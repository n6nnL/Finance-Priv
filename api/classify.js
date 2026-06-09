// ============================================================
//  classify.js — Гүйлгээ хүлээн авах үеийн ангилал шийдвэр
//
//  Дараалал:
//    1) Learned override (хэрэглэгчийн баталгаажуулсан) — ЭХЭНД
//    2) Орлого: type==='income' → 'Орлого'
//    3) Keyword дүрэм (categorize.js)
//    4) Танигдаагүй → category=NULL, status='pending_review' + AI санал
//
//  ⚠️ Автоматаар "Бусад" болгохгүй. "Бусад"-ыг зөвхөн хэрэглэгч сонгоно.
// ============================================================

import { categorizeByRules, INCOME_CATEGORY } from './categorize.js';
import { normalizeMerchant } from './db.js';

/**
 * @param {object} args
 * @param {string} args.description
 * @param {string} [args.type]   'expense' | 'income'
 * @param {object} args.db
 * @param {object} [args.ai]
 */
export async function classifyTransaction({ description, type, db, ai }) {
  const norm = normalizeMerchant(description);

  // 1) Learned override — эхэнд
  if (norm) {
    for (const ov of db.getOverrides()) {
      if (ov.merchant_pattern && norm.includes(ov.merchant_pattern)) {
        return { category: ov.category, status: 'classified', aiSuggestedCategory: null, aiConfidence: null };
      }
    }
  }

  // 2) Орлого → 'Орлого' (хүмүүсээс ирсэн шилжүүлэг ч энд)
  if (type === 'income') {
    return { category: INCOME_CATEGORY, status: 'classified', aiSuggestedCategory: null, aiConfidence: null };
  }

  // 3) Keyword дүрэм
  const ruleCat = categorizeByRules(description);
  if (ruleCat) {
    return { category: ruleCat, status: 'classified', aiSuggestedCategory: null, aiConfidence: null };
  }

  // 4) Танигдаагүй → AI санал (best-effort), category NULL хэвээр
  let aiSuggestedCategory = null;
  let aiConfidence = null;
  if (ai && ai.enabled) {
    try {
      const r = await ai.aiCategorize(description);
      aiSuggestedCategory = r.category ?? null;
      aiConfidence = r.confidence ?? null;
    } catch {
      /* AI алдаа → санал null, pending_review хэвээр */
    }
  }
  return { category: null, status: 'pending_review', aiSuggestedCategory, aiConfidence };
}

export default classifyTransaction;
