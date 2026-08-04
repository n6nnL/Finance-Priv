// ============================================================
//  telegram/notify.js — мессежийн текст + inline keyboard бүтээх
// ============================================================

import { Markup } from 'telegraf';
import { CATEGORIES, encodeButtonId, encodeEditButtonId, encodeFieldButtonId } from './categories.js';
import { isPendingTxn, detailFieldFor } from '../config/transactionActions.js';

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
  const pending = isPendingTxn(tx);
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

/**
 * 10 ангиллын товчлуурууд (2 эгнээ × 5).
 * kind='c' → pending баталгаажуулалт; kind='ec' → classified мөрийн засвар
 * (stale-check-гүй урсгал — bot.js-ийн handler ялгаж боловсруулна).
 */
export function buildCategoryKeyboard(txnId, isPos, kind = 'c') {
  const rows = [];
  for (let r = 0; r < Math.ceil(CATEGORIES.length / 5); r++) {
    const row = [];
    for (let i = r * 5; i < Math.min((r + 1) * 5, CATEGORIES.length); i++) {
      row.push(Markup.button.callback(CATEGORIES[i], encodeButtonId(txnId, i, isPos, kind)));
    }
    rows.push(row);
  }
  return Markup.inlineKeyboard(rows);
}

/** "Талбар засах" товчны мөр — шошго дундын модулиас (POS→Газрын нэр / бусад→Шалтгаан). */
function fieldButtonRow(tx) {
  const detail = detailFieldFor(tx);
  return [Markup.button.callback(`📝 ${detail.label} засах`, encodeFieldButtonId(tx.id))];
}

/** Classified мөр: ангилал дахин засах + талбар засах. */
export function buildEditKeyboard(tx) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✏️ Ангилал засах', encodeEditButtonId(tx.id))],
    fieldButtonRow(tx),
  ]);
}

/**
 * Гүйлгээний төлөвт тохирох keyboard:
 *  - pending    → ангиллын товчнууд + талбар засах (капабилити гурван client ижил)
 *  - classified → ангилал засах + талбар засах
 */
export function keyboardFor(tx) {
  if (isPendingTxn(tx)) {
    const kb = buildCategoryKeyboard(tx.id, tx.is_pos === 1);
    kb.reply_markup.inline_keyboard.push(fieldButtonRow(tx));
    return kb;
  }
  return buildEditKeyboard(tx);
}

export default { buildText, keyboardFor, buildCategoryKeyboard, buildEditKeyboard, fmtMoney, fmtDate, displayName };
