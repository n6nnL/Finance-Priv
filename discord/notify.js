// ============================================================
//  discord/notify.js — embed + товчлуур бүтээх, мэдэгдэл илгээх
// ============================================================

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { encodeButtonId, encodeEditButtonId, encodeFieldButtonId } from './categories.js';
import { isPendingTxn, detailFieldFor } from '../config/transactionActions.js';
import { listCategoriesWithIndexFor } from '../config/categories.js';
import { ubTimeLabel } from '../config/txfields.js';

const COLOR_EXPENSE = 0xef4444; // улаан
const COLOR_INCOME = 0x22c55e; // ногоон
const COLOR_PENDING = 0xf59e0b; // улбар шар (ангилаагүй)

export function fmtMoney(n) {
  if (n == null) return '-';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(n)) + '₮';
}

export function fmtDate(d) {
  if (!d) return '-';
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : String(d);
}

/**
 * Огноо + (боломжтой бол) мэдэгдэл ирсэн цаг: "2026-08-05 · 14:32".
 * email_received_at NULL бол ЗӨВХӨН огноо — хуурамч "00:00" ХЭЗЭЭ Ч гаргахгүй.
 * Цагийг ISO UTC-ээс УБ (Asia/Ulaanbaatar) болгож дундын ubTimeLabel хөрвүүлнэ.
 */
export function fmtDateTime(tx) {
  const date = fmtDate(tx?.txn_date);
  const time = ubTimeLabel(tx?.email_received_at);
  return time ? `${date} · ${time}` : date;
}

/** Харуулах нэр: газрын нэр (merchant_place) байвал тэр, үгүй бол description */
export function displayName(tx) {
  return tx.merchant_place || tx.description || '(тайлбаргүй)';
}

/** Гүйлгээний embed бүтээх */
export function buildEmbed(tx) {
  const isIncome = tx.type === 'income';
  const pending = isPendingTxn(tx);
  const color = pending ? COLOR_PENDING : isIncome ? COLOR_INCOME : COLOR_EXPENSE;
  const sign = isIncome ? '+' : '-';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${sign}${fmtMoney(tx.amount)}  ·  ${displayName(tx)}`)
    .addFields(
      { name: 'Огноо', value: fmtDateTime(tx), inline: true },
      { name: 'Төрөл', value: isIncome ? 'Орлого' : 'Зарлага', inline: true },
      { name: 'Данс', value: tx.account_last4 ? '••' + tx.account_last4 : '-', inline: true },
      { name: 'Ангилал', value: pending ? '❓ (ангилаагүй)' : '✅ ' + tx.category, inline: false }
    );
  if (tx.is_pos === 1) embed.setFooter({ text: '🏪 POS гүйлгээ' });
  else if (pending) embed.setFooter({ text: '↔ Шилжүүлэг/Төлбөр' });
  return embed;
}

/**
 * Танигдаагүй гүйлгээнд тохирох ангиллын товчлуурууд (эгнээнд 5).
 *
 * ⚠️ ИНДЕКСИЙН УРХИ: customId дотор ангиллыг БҮТЭН CATEGORIES массив дахь
 * индексээр дамжуулж, categoryByIndex()-ээр задалдаг. Хэрэв CATEGORIES-г
 * шүүгээд ШИНЭ индексийг кодловол товч бүр БУРУУ ангилал илгээх ба алдаа
 * мэдэгдэхгүй (applyToAll нь мерчантын бүх түүхэнд тараана). Тиймээс
 * listCategoriesWithIndexFor() нь ЖИНХЭНЭ индексийг хамт буцаана — доор
 * `index`-ийг кодолж, `pos`-ийг зөвхөн эгнээ таслахад ашиглана.
 *
 * @param {number} txnId
 * @param {boolean} isPos
 * @param {'income'|'expense'|null} [type] гүйлгээний төрөл (шүүлтэд)
 */
export function buildButtonRows(txnId, isPos, type) {
  const opts = listCategoriesWithIndexFor(type);
  const rows = [];
  for (let r = 0; r < Math.ceil(opts.length / 5); r++) {
    const row = new ActionRowBuilder();
    for (let pos = r * 5; pos < Math.min((r + 1) * 5, opts.length); pos++) {
      const { category, index } = opts[pos];
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(encodeButtonId(txnId, index, isPos)) // ★ index — pos БИШ
          .setLabel(category)
          .setStyle(ButtonStyle.Secondary)
      );
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Засварын эгнээ: "Ангилал засах" + "Талбар засах" (шошго дундын модулиас —
 * POS→Газрын нэр / бусад→Шалтгаан).
 */
export function buildEditRow(tx) {
  const detail = detailFieldFor(tx);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeEditButtonId(tx.id))
      .setLabel('✏️ Ангилал засах')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(encodeFieldButtonId(tx.id))
      .setLabel(`📝 ${detail.label} засах`)
      .setStyle(ButtonStyle.Secondary)
  );
}

/** Pending мөрөнд дан талбар засах эгнээ (ангилалгүйгээр — гурван client ижил чадвар). */
function buildFieldRow(tx) {
  const detail = detailFieldFor(tx);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeFieldButtonId(tx.id))
      .setLabel(`📝 ${detail.label} засах`)
      .setStyle(ButtonStyle.Secondary)
  );
}

/**
 * Гүйлгээний төлөвт тохирох component-ууд:
 *  - pending_review → ангиллын товчлуурууд + талбар засах
 *  - classified     → "Ангилал засах" + "Талбар засах" (дахин засах боломж)
 */
export function buildComponentsFor(tx) {
  return isPendingTxn(tx)
    ? [...buildButtonRows(tx.id, tx.is_pos === 1, tx.type), buildFieldRow(tx)]
    : [buildEditRow(tx)];
}

/**
 * Гүйлгээний мэдэгдэл илгээх.
 * - classified → embed + "Ангилал засах" товч
 * - pending_review → embed + ангиллын товчлуурууд
 * @returns {Promise<import('discord.js').Message>}
 */
export async function sendNotification(channel, tx) {
  return channel.send({ embeds: [buildEmbed(tx)], components: buildComponentsFor(tx) });
}

export default { buildEmbed, buildButtonRows, buildEditRow, buildComponentsFor, sendNotification, fmtMoney, fmtDate, fmtDateTime, displayName };
