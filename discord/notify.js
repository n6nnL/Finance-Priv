// ============================================================
//  discord/notify.js — embed + товчлуур бүтээх, мэдэгдэл илгээх
// ============================================================

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { CATEGORIES, encodeButtonId, encodeEditButtonId, encodeFieldButtonId } from './categories.js';
import { isPendingTxn, detailFieldFor } from '../config/transactionActions.js';

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
      { name: 'Огноо', value: fmtDate(tx.txn_date), inline: true },
      { name: 'Төрөл', value: isIncome ? 'Орлого' : 'Зарлага', inline: true },
      { name: 'Данс', value: tx.account_last4 ? '••' + tx.account_last4 : '-', inline: true },
      { name: 'Ангилал', value: pending ? '❓ (ангилаагүй)' : '✅ ' + tx.category, inline: false }
    );
  if (tx.is_pos === 1) embed.setFooter({ text: '🏪 POS гүйлгээ' });
  else if (pending) embed.setFooter({ text: '↔ Шилжүүлэг/Төлбөр' });
  return embed;
}

/** Танигдаагүй гүйлгээнд 10 ангиллын товчлуурууд (2 эгнээ × 5) */
export function buildButtonRows(txnId, isPos) {
  const rows = [];
  for (let r = 0; r < Math.ceil(CATEGORIES.length / 5); r++) {
    const row = new ActionRowBuilder();
    for (let i = r * 5; i < Math.min((r + 1) * 5, CATEGORIES.length); i++) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(encodeButtonId(txnId, i, isPos))
          .setLabel(CATEGORIES[i])
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
    ? [...buildButtonRows(tx.id, tx.is_pos === 1), buildFieldRow(tx)]
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

export default { buildEmbed, buildButtonRows, buildEditRow, buildComponentsFor, sendNotification, fmtMoney, fmtDate, displayName };
