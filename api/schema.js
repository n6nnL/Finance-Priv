// ============================================================
//  schema.js — zod validation schema + listener alias normalize
//
//  Каноник гэрээ (listener prompt-той ижил):
//    messageId (заавал, string), amount (заавал, эерэг тоо),
//    currency, date (ISO), type ('expense'|'income'),
//    description?, category?, accountLast4?, raw?
//
//  Listener одоогийн хувилбар нь дараах alias-уудыг явуулж болзошгүй тул
//  тэвчиж хувиргана (хоёр тал бат бөх нийцэхийн тулд):
//    direction ('debit'|'credit') → type ('expense'|'income')
//    accountTail                  → accountLast4
//    subject                      → raw (raw байхгүй үед)
// ============================================================

import { z } from 'zod';

/**
 * Validate-аас өмнө alias талбаруудыг каноник нэр рүү хөрвүүлнэ.
 */
export function normalizeBody(body) {
  if (!body || typeof body !== 'object') return body;
  const b = { ...body };

  // direction → type
  if (b.type == null && b.direction != null) {
    b.type = b.direction === 'credit' ? 'income' : 'expense';
  }
  // accountTail → accountLast4
  if (b.accountLast4 == null && b.accountTail != null) {
    b.accountLast4 = b.accountTail;
  }
  // subject → raw (raw байхгүй бол)
  if (b.raw == null && typeof b.subject === 'string') {
    b.raw = b.subject;
  }
  return b;
}

export const TransactionSchema = z.object({
  messageId: z.string().min(1, 'messageId заавал шаардлагатай'),
  amount: z
    .number({ invalid_type_error: 'amount нь тоо байх ёстой' })
    .finite()
    .positive('amount эерэг байх ёстой'),
  currency: z.string().min(1).max(8).default('MNT'),
  date: z.string().min(1).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  type: z.enum(['expense', 'income'], {
    errorMap: () => ({ message: "type нь 'expense' эсвэл 'income' байх ёстой" }),
  }),
  category: z.string().max(200).optional().nullable(),
  accountLast4: z.string().max(8).optional().nullable(),
  raw: z.string().optional().nullable(),
  isPos: z.boolean().optional().nullable(), // listener parser-аас (BOM дүрэм)
  // Multi-tenant listener: аль хэрэглэгчийн inbox-оос ирсэн гүйлгээ вэ.
  // Machine (API key) push-д ЗААВАЛ (route талд шалгана); JWT push-д үл тоомсорлоно.
  userId: z.number().int().positive().optional().nullable(),
});

/**
 * normalize → validate-г нэг дор хийнэ.
 * @returns {{ success: true, data } | { success: false, errors }}
 */
export function validateTransaction(rawBody) {
  const normalized = normalizeBody(rawBody);
  const result = TransactionSchema.safeParse(normalized);
  if (result.success) {
    return { success: true, data: result.data };
  }
  // zod алдааг талбар бүрээр ойлгомжтой болгоно
  const errors = result.error.issues.map((i) => ({
    field: i.path.join('.') || '(root)',
    message: i.message,
  }));
  return { success: false, errors };
}

export default { validateTransaction, normalizeBody, TransactionSchema };
