// ============================================================
//  discord/bot.js — Голомт гүйлгээний Discord bot
//
//  - DB-г polling хийж шинэ гүйлгээ илрүүлнэ (эхлэхдээ одоогийн max id-ээс →
//    хуучин catch-up flood-г МЭДЭГДЭХГҮЙ).
//  - classified → мэдээллийн embed; pending_review → embed + ангиллын товч.
//  - Товч → (POS:Газрын нэр / бусад:Шалтгаан) modal → PATCH /api/.../category
//    (applyToAll, learned override) → мессежийг "✓ хадгаллаа" болгож edit.
//  - Идэмпотентность: хамгийн сүүлд мэдэгдсэн id-г файлд хадгална.
// ============================================================

import {
  Client, GatewayIntentBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { config } from './config.js';
import {
  categoryById, encodeModalId, encodeCatSelectId, encodeFieldModalId,
  encodeApplyAllId, parseId,
} from './categories.js';
import { categoriesFor } from '../config/categories.js';
import { sendNotification, buildEmbed, buildComponentsFor } from './notify.js';
import { patchCategory, updateFields, getTransaction } from './apiClient.js';
import { APPLY_TO_ALL_CONFIRM, detailFieldFor } from '../config/transactionActions.js';

// --- DB (read-only polling) — зөвхөн шинэ гүйлгээ ИЛРҮҮЛЭХЭД ашиглана.
//     Interaction үеийн төлөв шалгалт/бичилт нь API-аар явна (write нь
//     шууд-DB биш, dashboard-той нийцтэй байхын тулд). ---
const db = new DatabaseSync(config.dbPath);

// ⚠️ Discord bot ЗӨВХӨН owner-т зориулагдсан (multi-tenant Telegram-аас ялгаатай).
// Owner = хамгийн бага id-тэй хэрэглэгч (api/db.js-ийн getOwnerUserId()-тэй ИЖИЛ
// логик — тэр функцийг импортлох боломжгүй тул давхардуулсан). Polling query-д
// user_id шүүлт ЗААВАЛ байхгүй бол multi-tenant Gmail идэвхжсэний дараа өөр
// хэрэглэгчийн гүйлгээ энэ (owner-ийн) Discord суваг руу алдагдана.
const OWNER_ID = (db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get() || {}).id ?? 0;
const qNew = db.prepare('SELECT * FROM transactions WHERE id > ? AND user_id = ? ORDER BY id ASC LIMIT 25');
const qMaxId = db.prepare('SELECT COALESCE(MAX(id),0) AS m FROM transactions WHERE user_id = ?');

// --- Bot төлөв (хамгийн сүүлд мэдэгдсэн id) ---
function loadState() {
  try { return JSON.parse(readFileSync(config.statePath, 'utf8')); } catch { return null; }
}
function saveState(s) {
  try { writeFileSync(config.statePath, JSON.stringify(s), { mode: 0o600 }); } catch (e) { log('warn', 'state бичих алдаа', e.message); }
}
let lastNotifiedId = 0;

function log(level, msg, extra) {
  console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...(extra ? { extra } : {}) }));
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async () => {
  log('info', `Discord bot нэвтэрлээ: ${client.user.tag}`);
  const st = loadState();
  if (st && Number.isInteger(st.lastNotifiedId)) {
    lastNotifiedId = st.lastNotifiedId;
    log('info', `Үргэлжлүүлж байна, lastNotifiedId=${lastNotifiedId}`);
  } else {
    // Анх асахад: одоогийн max id-ээс эхэлнэ (хуучин түүхийг МЭДЭГДЭХГҮЙ)
    lastNotifiedId = Number(qMaxId.get(OWNER_ID).m);
    saveState({ lastNotifiedId });
    log('info', `Анхны асаалт — backlog алгасч, id>${lastNotifiedId}-ээс эхэлнэ`);
  }
  poll();
  setInterval(poll, config.pollSeconds * 1000);
});

let channel = null;
async function getChannel() {
  if (channel) return channel;
  channel = await client.channels.fetch(config.channelId);
  return channel;
}

let polling = false;
async function poll() {
  if (polling) return; // давхцахаас сэргийлэх
  polling = true;
  try {
    const rows = qNew.all(lastNotifiedId, OWNER_ID);
    if (rows.length) {
      const ch = await getChannel();
      for (const tx of rows) {
        try {
          await sendNotification(ch, tx);
          lastNotifiedId = Math.max(lastNotifiedId, Number(tx.id));
          saveState({ lastNotifiedId }); // тус бүрд хадгална (давхар илгээхгүй)
        } catch (e) {
          log('error', `мэдэгдэл илгээх алдаа id=${tx.id}`, e.message);
          break; // дараагийнхыг оролдохгүй — дараагийн poll-д retry
        }
      }
    }
  } catch (e) {
    log('error', 'poll алдаа', e.message);
  } finally {
    polling = false;
  }
}

/** Мессежийг гүйлгээний одоогийн төлөвт нь шинэчлэх (component-ийг төлөвт нь тааруулна). */
async function refreshStaleMessage(messageId, row) {
  if (!messageId || !row) return;
  try {
    const ch = await getChannel();
    const msg = await ch.messages.fetch(messageId).catch(() => null);
    if (msg) await msg.edit({ embeds: [buildEmbed(row)], components: buildComponentsFor(row) });
  } catch { /* мессеж засаж чадахгүй ч interaction-г унагаахгүй */ }
}

// --- applyToAll баталгаажуулалтын түр төлөв ---
// customId 100 тэмдэгтэд утга (ангилал+текст) багтахгүй тул энд хадгална.
// txnId → { category, extra, messageId }. Restart-д алдагдвал товч дарахад
// "хугацаа дууссан" гэж эелдэг хариулна (эрсдэлгүй).
const pendingConfirm = new Map();

// ⚠️ ХУУЧИН (нислэг дунд) PAYLOAD. Энэ deploy-ийн ӨМНӨ илгээгдсэн мэдэгдлийн
// товчнууд ангиллыг ИНДЕКСЭЭР кодолсон байдаг ('c|123|4|1'). Шинэ парсер тэдгээрийг
// ТАНИХГҮЙ бөгөөд ЗОРИУДААР массив руу индекслэх fallback хийхгүй — таамагласан
// ангилал нь applyToAll-аар мерчантын БҮХ түүхэнд тарах эрсдэлтэй. Оронд нь
// эелдэг унаж, мессежийг шинэ товчнуудаар сэргээнэ.
const STALE_PAYLOAD_MSG =
  '⚠️ Энэ мэдэгдэл хуучирсан байна. Дахин ачаална уу — доорх шинэчлэгдсэн товчнуудыг ашиглана уу.';

/** applyToAll Тийм/Үгүй товчны эгнээ (текст нь дундын модулиас). */
function applyAllButtons(txnId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(encodeApplyAllId(txnId, true))
      .setLabel(APPLY_TO_ALL_CONFIRM.yesLabel).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(encodeApplyAllId(txnId, false))
      .setLabel(APPLY_TO_ALL_CONFIRM.noLabel).setStyle(ButtonStyle.Secondary)
  );
}

/**
 * Засварын ангилал select — одоогийн ангиллыг default болгож харуулна.
 * Гүйлгээний ТӨРӨЛД тохирох ангиллыг л санал болгоно (зарлагад "Орлого" гарахгүй).
 * ⚠️ Энэ select нь ангиллыг НЭРЭЭР (setValue) дамжуулдаг тул шүүхэд индексийн
 * урхи БАЙХГҮЙ (товчны эгнээнээс ялгаатай — notify.js-ийн тайлбарыг үз).
 * @param {'income'|'expense'|null} [type]
 */
function buildCategorySelect(txnId, originMessageId, currentCategory, type) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(encodeCatSelectId(txnId, originMessageId))
    .setPlaceholder('Шинэ ангилал сонгох…')
    .addOptions(
      categoriesFor(type).map((c) =>
        new StringSelectMenuOptionBuilder().setLabel(c).setValue(c).setDefault(c === currentCategory)
      )
    );
  return new ActionRowBuilder().addComponents(menu);
}

// --- Interaction: товч → modal → PATCH → edit ---
//  POS (BOM) → "Ямар газар?", шилжүүлэг → "Юунд?" (асуултын логик хадгалагдсан).
//  Interaction бүрийг 3с дотор ack хийнэ (button=showModal, submit=deferReply),
//  API бичихээс ӨМНӨ. Interaction үед төлөвийг API-аас дахин татаж, аль хэдийн
//  шийдэгдсэн/устсан бол алдаа биш — эелдэг мессеж харуулна.
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isButton()) {
      const p = parseId(interaction.customId);
      if (!p) return;

      // --- "Ангилал засах" товч (аль хэдийн бүртгэгдсэн гүйлгээ) ---
      if (p.kind === 'e') {
        // Interaction үед одоогийн утгыг API-аас татаж, default болгож харуулна
        // (Dashboard-аар саяхан өөрчилсөн байж болзошгүй — stale бичихгүй).
        let current = null;
        try { current = await getTransaction(p.txnId); } catch { current = null; }
        if (!current) {
          await interaction.reply({ content: '⚠️ Энэ гүйлгээ олдсонгүй (устсан байж магадгүй).', ephemeral: true });
          return;
        }
        const row = buildCategorySelect(p.txnId, interaction.message.id, current.category, current.type);
        await interaction.reply({
          content: `Одоогийн ангилал: **${current.category || '(ангилаагүй)'}**\nШинэ ангилал сонгоно уу:`,
          components: [row],
          ephemeral: true,
        });
        return;
      }

      // --- "Талбар засах" товч (📝 — ангилал хөндөхгүй, POS/энгийн модуль шийднэ) ---
      if (p.kind === 'n') {
        let current = null;
        try { current = await getTransaction(p.txnId); } catch { current = null; }
        if (!current) {
          await interaction.reply({ content: '⚠️ Энэ гүйлгээ олдсонгүй (устсан байж магадгүй).', ephemeral: true });
          return;
        }
        const detail = detailFieldFor(current);
        const modal = new ModalBuilder()
          .setCustomId(encodeFieldModalId(p.txnId, interaction.message.id))
          .setTitle(`${detail.label} засах`);
        const input = new TextInputBuilder()
          .setCustomId('value')
          .setLabel(detail.question)
          .setPlaceholder(detail.placeholder)
          .setStyle(TextInputStyle.Short)
          .setRequired(false) // хоосон submit = утга устгах
          .setMaxLength(detail.maxLength);
        if (detail.current) input.setValue(String(detail.current).slice(0, detail.maxLength));
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        return;
      }

      // --- applyToAll Тийм/Үгүй (баталгаажуулалтын товч, ephemeral мессежид) ---
      if (p.kind === 'ay' || p.kind === 'an') {
        await interaction.deferUpdate();
        const st = pendingConfirm.get(p.txnId);
        if (!st) {
          await interaction.editReply({ content: '⚠️ Хугацаа дууссан. Дахин оролдоно уу.', components: [] });
          return;
        }
        pendingConfirm.delete(p.txnId);
        const applyToAll = p.kind === 'ay';
        try {
          const r = await patchCategory(p.txnId, { category: st.category, applyToAll, ...st.extra });
          const updated = await getTransaction(p.txnId).catch(() => null);
          if (st.messageId && updated) await refreshStaleMessage(st.messageId, updated);
          const tail = applyToAll ? ' Цаашид энэ мерчант автоматаар ийм ангилалтай болно.' : '';
          await interaction.editReply({
            content: `✅ **${st.category}** болгож хадгаллаа${r.updated > 1 ? ` (${r.updated} гүйлгээнд)` : ''}.${tail}`,
            components: [],
          });
          log('info', `ангилагдлаа id=${p.txnId} → ${st.category}`, `applyToAll=${applyToAll} updated=${r.updated}`);
        } catch (e) {
          log('error', `PATCH алдаа id=${p.txnId}`, e.message);
          await interaction.editReply({ content: '❌ Хадгалахад алдаа гарлаа. Дахин оролдоно уу.', components: [] });
        }
        return;
      }

      // --- pending ангиллын товч (Prompt 2) ---
      if (p.kind !== 'c') return;
      const cat = categoryById(p.catId);
      if (!cat) {
        // Хуучин индекс-кодлолтой товч → БУРУУ ангилал бичихийн оронд эелдэг унана
        await interaction.reply({ content: STALE_PAYLOAD_MSG, ephemeral: true });
        const fresh = await getTransaction(p.txnId).catch(() => null);
        if (fresh) await refreshStaleMessage(interaction.message.id, fresh); // шинэ товчнууд
        return;
      }

      // Одоогийн төлөвийг API-аас шалгах (Dashboard-аар шийдэгдсэн эсэх).
      // localhost GET — хурдан тул showModal-ийн 3с төсөвт багтана.
      let current = null;
      try { current = await getTransaction(p.txnId); } catch { current = null; }
      if (!current) {
        await interaction.reply({ content: '⚠️ Энэ гүйлгээ олдсонгүй (устсан байж магадгүй).', ephemeral: true });
        return;
      }
      if (current.status !== 'pending_review') {
        await interaction.reply({
          content: `✓ Энэ гүйлгээ аль хэдийн **${current.category || 'шийдэгдсэн'}** болсон байна.`,
          ephemeral: true,
        });
        await refreshStaleMessage(interaction.message.id, current);
        return;
      }

      // Асуулт/жишээ дундын модулиас — POS бол Газрын нэр, бусад бол Шалтгаан
      const detail = detailFieldFor({ is_pos: p.isPos ? 1 : 0 });
      const modal = new ModalBuilder()
        .setCustomId(encodeModalId(p.txnId, p.catId, p.isPos, interaction.message.id))
        .setTitle(`${cat} болгох`);
      const input = new TextInputBuilder()
        .setCustomId('value')
        .setLabel(detail.question)
        .setPlaceholder(detail.placeholder)
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(detail.maxLength);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

    // --- Засварын ангилал select submit ---
    if (interaction.isStringSelectMenu()) {
      const p = parseId(interaction.customId);
      if (!p || p.kind !== 'es') return;
      // ack (3с дотор) — API дуудахаас ӨМНӨ
      await interaction.deferUpdate();
      const chosen = interaction.values?.[0];
      if (!chosen) return;

      // Interaction үед одоогийн төлөвийг дахин татах (stale бичихгүй)
      let current = null;
      try { current = await getTransaction(p.txnId); } catch { current = null; }
      if (!current) {
        await interaction.editReply({ content: '⚠️ Энэ гүйлгээ олдсонгүй (устсан байж магадгүй).', components: [] });
        return;
      }
      // Өөрчлөлтгүй бол бичихгүй (unchanged field-ийг дарж бичихгүй)
      if (current.category === chosen) {
        await interaction.editReply({ content: `✓ Аль хэдийн **${chosen}** байна. Өөрчлөлтгүй.`, components: [] });
        return;
      }
      // Шууд бичихгүй — эхлээд applyToAll баталгаажуулалт (default = Үгүй).
      // Бичилт нь 'ay'/'an' товчны handler-т Dashboard-тай ИЖИЛ /category-оор.
      pendingConfirm.set(p.txnId, { category: chosen, extra: {}, messageId: p.messageId });
      await interaction.editReply({
        content: `**${chosen}** болгож өөрчилнө.\n${APPLY_TO_ALL_CONFIRM.question}\n*${APPLY_TO_ALL_CONFIRM.hint}*`,
        components: [applyAllButtons(p.txnId)],
      });
      return;
    }

    if (interaction.isModalSubmit()) {
      const p = parseId(interaction.customId);
      if (!p) return;

      // --- Талбарын modal ('nm') — ангилал хөндөхгүй, PATCH /note-оор ---
      if (p.kind === 'nm') {
        await interaction.deferReply({ ephemeral: true });
        let current = null;
        try { current = await getTransaction(p.txnId); } catch { current = null; }
        if (!current) {
          await interaction.editReply('⚠️ Энэ гүйлгээ олдсонгүй (устсан байж магадгүй).');
          return;
        }
        const detail = detailFieldFor(current);
        const value = (interaction.fields.getTextInputValue('value') || '').trim();
        try {
          await updateFields(p.txnId, { [detail.apiField]: value }); // '' → NULL (устгана)
          const updated = await getTransaction(p.txnId).catch(() => null);
          if (p.messageId && updated) await refreshStaleMessage(p.messageId, updated);
          await interaction.editReply(value ? `✅ ${detail.label} хадгалагдлаа.` : `✅ ${detail.label} устгагдлаа.`);
          log('info', `талбар засав id=${p.txnId}`, `field=${detail.apiField}`);
        } catch (e) {
          log('error', `updateFields алдаа id=${p.txnId}`, e.message);
          await interaction.editReply('❌ Хадгалахад алдаа гарлаа. Дахин оролдоно уу.');
        }
        return;
      }

      if (p.kind !== 'm') return;
      // ⚠️ API бичихээс ӨМНӨ заавал ack (3с дотор) — "interaction failed"-аас сэргийлнэ.
      await interaction.deferReply({ ephemeral: true });
      const cat = categoryById(p.catId);
      if (!cat) { await interaction.editReply(STALE_PAYLOAD_MSG); return; }

      // Interaction үед төлөвийг дахин татах (modal нээгдсэнээс хойш Dashboard-аар
      // шийдэгдсэн байж болзошгүй).
      let current = null;
      try { current = await getTransaction(p.txnId); } catch { current = null; }
      if (!current) {
        await interaction.editReply('⚠️ Энэ гүйлгээ олдсонгүй (устсан байж магадгүй).');
        return;
      }
      if (current.status !== 'pending_review') {
        await interaction.editReply(`✓ Энэ гүйлгээ аль хэдийн **${current.category || 'шийдэгдсэн'}** болсон. Дахин бичсэнгүй.`);
        await refreshStaleMessage(p.messageId, current);
        return;
      }

      const value = (interaction.fields.getTextInputValue('value') || '').trim();
      // Талбарын түлхүүрийг модулиас (client өөрөө merchantPlace/note шийдэхгүй)
      const extra = value ? { [detailFieldFor({ is_pos: p.isPos ? 1 : 0 }).apiField]: value } : {};

      // Шууд бичихгүй — applyToAll баталгаажуулалт (default = Үгүй). Бичилт нь
      // 'ay'/'an' handler-т: applyToAll → бүгдэд + learned override (API талд).
      pendingConfirm.set(p.txnId, { category: cat, extra, messageId: p.messageId });
      await interaction.editReply({
        content: `**${cat}**${value ? ` · ${value}` : ''} болгож хадгална.\n${APPLY_TO_ALL_CONFIRM.question}\n*${APPLY_TO_ALL_CONFIRM.hint}*`,
        components: [applyAllButtons(p.txnId)],
      });
    }
  } catch (e) {
    log('error', 'interaction алдаа', e.message);
  }
});

client.on('error', (e) => log('error', 'discord client error', e?.message));
process.on('unhandledRejection', (r) => log('error', 'unhandledRejection', r?.message ?? String(r)));

client.login(config.token);
