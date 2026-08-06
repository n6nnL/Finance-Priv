// ============================================================
//  payload.js — API руу илгээх push payload-ыг бүтээх ЦЭВЭР функц
//
//  index.js-ийн processEmail() эндээс дуудна. Тусад нь гаргасан шалтгаан:
//  каноник гэрээ (api/schema.js-тэй тохирох талбарууд) нь тестлэгдэх ёстой —
//  index.js нь import хийхэд listener-ээ асаадаг тул шууд тестлэх боломжгүй.
// ============================================================

/**
 * @param {object} p
 * @param {string} p.messageId          идэмпотентность түлхүүр (Message-ID эсвэл uid-key)
 * @param {number} p.userId             аль хэрэглэгчийн inbox-оос ирсэн (machine push-д ЗААВАЛ)
 * @param {object} p.tx                 parseGolomt-ийн үр дүн
 * @param {string|null} p.category      categorize()-ийн үр дүн
 * @param {string|null} p.emailReceivedAt  имэйлийн `Date:` header, ISO 8601 UTC эсвэл null
 * @param {string} [p.subject]          raw-д fallback
 * @returns {object} API-ийн каноник body
 */
export function buildPushPayload({ messageId, userId, tx, category, emailReceivedAt, subject = '' }) {
  return {
    messageId,
    userId,
    amount: tx.amount,
    currency: tx.currency,
    date: tx.date,
    description: tx.description,
    type: tx.type, // parser шууд 'expense'|'income' буцаана
    category,
    accountLast4: tx.accountLast4,
    isPos: tx.isPos, // BOM дүрэм (POS гүйлгээ эсэх)
    balance: tx.balance, // Үлдэгдэл; parse амжилтгүй бол null
    // Банкны мэдэгдэл ирсэн цаг (ISO 8601 UTC) — имэйлд `Date:` header байхгүй бол
    // null. Одоогийн цагаар ХЭЗЭЭ Ч нөхөхгүй (хуурамч цаг гаргахгүй).
    emailReceivedAt: emailReceivedAt ?? null,
    raw: (tx.raw || subject || '').slice(0, 4000),
  };
}

export default buildPushPayload;
