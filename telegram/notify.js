// ============================================================
//  telegram/notify.js — мессежийн текст + inline keyboard бүтээх
// ============================================================

import { Markup } from 'telegraf';
import { encodeButtonId, encodeEditButtonId, encodeFieldButtonId } from './categories.js';
import { isPendingTxn, detailFieldFor } from '../config/transactionActions.js';
import { listCategoriesWithIndexFor } from '../config/categories.js';

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
 * Гүйлгээний ТӨРӨЛД тохирох ангиллын товчлуурууд (эгнээнд 5).
 * kind='c' → pending баталгаажуулалт; kind='ec' → classified мөрийн засвар
 * (stale-check-гүй урсгал — bot.js-ийн handler ялгаж боловсруулна).
 *
 * ⚠️ ИНДЕКСИЙН УРХИ (discord/notify.js-тэй ижил): callback_data дотор ангиллыг
 * БҮТЭН CATEGORIES массив дахь индексээр дамжуулж, categoryByIndex()-ээр
 * задална. Шүүсэн массивын ШИНЭ индексийг кодловол товч бүр БУРУУ ангилал
 * илгээнэ. Тиймээс listCategoriesWithIndexFor()-ийн `index`-ийг кодолж,
 * `pos`-ийг зөвхөн эгнээ таслахад ашиглана.
 *
 * @param {number} txnId
 * @param {boolean} isPos
 * @param {'c'|'ec'} [kind]
 * @param {'income'|'expense'|null} [type] гүйлгээний төрөл (шүүлтэд)
 */
export function buildCategoryKeyboard(txnId, isPos, kind = 'c', type) {
  const opts = listCategoriesWithIndexFor(type);
  const rows = [];
  for (let r = 0; r < Math.ceil(opts.length / 5); r++) {
    const row = [];
    for (let pos = r * 5; pos < Math.min((r + 1) * 5, opts.length); pos++) {
      const { category, index } = opts[pos];
      // ★ index — pos БИШ (доторх дараалал шүүлтээс хамаарахгүй)
      row.push(Markup.button.callback(category, encodeButtonId(txnId, index, isPos, kind)));
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
    const kb = buildCategoryKeyboard(tx.id, tx.is_pos === 1, 'c', tx.type);
    kb.reply_markup.inline_keyboard.push(fieldButtonRow(tx));
    return kb;
  }
  return buildEditKeyboard(tx);
}

export default { buildText, keyboardFor, buildCategoryKeyboard, buildEditKeyboard, fmtMoney, fmtDate, displayName };
