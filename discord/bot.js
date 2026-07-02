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
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} from 'discord.js';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { config } from './config.js';
import { CATEGORIES, categoryByIndex, encodeModalId, encodeCatSelectId, parseId } from './categories.js';
import { sendNotification, buildEmbed, buildComponentsFor } from './notify.js';
import { patchCategory, getTransaction } from './apiClient.js';

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

/** Засварын ангилал select — одоогийн ангиллыг default болгож харуулна. */
function buildCategorySelect(txnId, originMessageId, currentCategory) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(encodeCatSelectId(txnId, originMessageId))
    .setPlaceholder('Шинэ ангилал сонгох…')
    .addOptions(
      CATEGORIES.map((c) =>
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
        const row = buildCategorySelect(p.txnId, interaction.message.id, current.category);
        await interaction.reply({
          content: `Одоогийн ангилал: **${current.category || '(ангилаагүй)'}**\nШинэ ангилал сонгоно уу:`,
          components: [row],
          ephemeral: true,
        });
        return;
      }

      // --- pending ангиллын товч (Prompt 2) ---
      if (p.kind !== 'c') return;
      const cat = categoryByIndex(p.catIdx);
      if (!cat) return;

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

      // POS бол "Ямар газар?", шилжүүлэг бол "Юунд?"
      const modal = new ModalBuilder()
        .setCustomId(encodeModalId(p.txnId, p.catIdx, p.isPos, interaction.message.id))
        .setTitle(`${cat} болгох`);
      const input = new TextInputBuilder()
        .setCustomId('value')
        .setLabel(p.isPos ? 'Ямар газар?' : 'Юунд?')
        .setPlaceholder(p.isPos ? 'жишээ: Шулуун дун' : 'жишээ: Ээжид сарын мөнгө')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(200);
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
      try {
        // Категорийн өөрчлөлт нь Dashboard-тай ИЖИЛ /category endpoint-оор:
        // applyToAll → learned override шинэчлэх + manually_edited=1 (API талд).
        const r = await patchCategory(p.txnId, { category: chosen, applyToAll: true });
        const updated = await getTransaction(p.txnId).catch(() => null);
        if (p.messageId && updated) await refreshStaleMessage(p.messageId, updated);
        await interaction.editReply({
          content: `✅ **${chosen}** болгож өөрчиллөө${r.updated > 1 ? ` (${r.updated} гүйлгээнд)` : ''}.`,
          components: [],
        });
        log('info', `Discord-оор ангилал засав id=${p.txnId} → ${chosen}`, `updated=${r.updated}`);
      } catch (e) {
        log('error', `ангилал засах алдаа id=${p.txnId}`, e.message);
        await interaction.editReply({ content: '❌ Засахад алдаа гарлаа. Дахин оролдоно уу.', components: [] });
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      const p = parseId(interaction.customId);
      if (!p || p.kind !== 'm') return;
      // ⚠️ API бичихээс ӨМНӨ заавал ack (3с дотор) — "interaction failed"-аас сэргийлнэ.
      await interaction.deferReply({ ephemeral: true });
      const cat = categoryByIndex(p.catIdx);
      if (!cat) { await interaction.editReply('Ангилал танигдсангүй'); return; }

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
      const extra = p.isPos ? { merchantPlace: value } : { note: value };

      try {
        // applyToAll → тэр мерчантын бүгдэд + learned override + manually_edited=1
        // (API талд). Бүх бичилт API-аар → Dashboard-той нийцтэй.
        const r = await patchCategory(p.txnId, { category: cat, applyToAll: true, ...extra });
        // Шинэчилсэн төлөвийг API-аас уншиж мессежийг classified болгоно.
        const updated = await getTransaction(p.txnId).catch(() => null);
        if (p.messageId && updated) await refreshStaleMessage(p.messageId, updated);
        await interaction.editReply(`✅ **${cat}** болгож хадгаллаа${r.updated > 1 ? ` (${r.updated} гүйлгээнд)` : ''}.`);
        log('info', `ангилагдлаа id=${p.txnId} → ${cat}`, `updated=${r.updated}`);
      } catch (e) {
        log('error', `PATCH алдаа id=${p.txnId}`, e.message);
        await interaction.editReply('❌ Хадгалахад алдаа гарлаа. Дахин оролдоно уу.');
      }
    }
  } catch (e) {
    log('error', 'interaction алдаа', e.message);
  }
});

client.on('error', (e) => log('error', 'discord client error', e?.message));
process.on('unhandledRejection', (r) => log('error', 'unhandledRejection', r?.message ?? String(r)));

client.login(config.token);
