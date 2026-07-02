// ============================================================
//  telegram/notify.js — мессежийн текст + inline keyboard бүтээх
// ============================================================

import { Markup } from 'telegraf';
import { CATEGORIES, encodeButtonId, encodeEditButtonId } from './categories.js';

export function fmtMoney(n) {
  if (n == null) return '-';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(n)) + '₮';
}

export function fmtDate(d) {
  if (!d) return '-';
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : String(d);
}

export function displayName(tx) {
  return tx.merchant_place || tx.description || '(тайлбаргүй)';
}

/** Гүйлгээний мессежийн текст (Discord embed-ийн текст хувилбар). */
export function buildText(tx) {
  const isIncome = tx.type === 'income';
  const pending = tx.status === 'pending_review' || tx.category == null;
  const sign = isIncome ? '+' : '-';
  const lines = [
    `${pending ? '❓' : (isIncome ? '💰' : '🧾')} *${sign}${fmtMoney(tx.amount)}*  ·  ${displayName(tx)}`,
    `Огноо: ${fmtDate(tx.txn_date)}`,
    `Төрөл: ${isIncome ? 'Орлого' : 'Зарлага'}`,
    `Данс: ${tx.account_last4 ? '••' + tx.account_last4 : '-'}`,
    `Ангилал: ${pending ? '❓ (ангилаагүй)' : '✅ ' + tx.category}`,
  ];
  if (tx.is_pos === 1) lines.push('🏪 POS гүйлгээ');
  else if (pending) lines.push('↔ Шилжүүлэг/Төлбөр');
  return lines.join('\n');
}

/** 10 ангиллын товчлуурууд (2 эгнээ × 5) */
export function buildCategoryKeyboard(txnId, isPos) {
  const rows = [];
  for (let r = 0; r < Math.ceil(CATEGORIES.length / 5); r++) {
    const row = [];
    for (let i = r * 5; i < Math.min((r + 1) * 5, CATEGORIES.length); i++) {
      row.push(Markup.button.callback(CATEGORIES[i], encodeButtonId(txnId, i, isPos)));
    }
    rows.push(row);
  }
  return Markup.inlineKeyboard(rows);
}

export function buildEditKeyboard(txnId) {
  return Markup.inlineKeyboard([[Markup.button.callback('✏️ Ангилал засах', encodeEditButtonId(txnId))]]);
}

/** Гүйлгээний төлөвт тохирох keyboard (pending → ангиллын товч, classified → засах товч). */
export function keyboardFor(tx) {
  const pending = tx.status === 'pending_review' || tx.category == null;
  return pending ? buildCategoryKeyboard(tx.id, tx.is_pos === 1) : buildEditKeyboard(tx.id);
}

export default { buildText, keyboardFor, buildCategoryKeyboard, buildEditKeyboard, fmtMoney, fmtDate, displayName };
