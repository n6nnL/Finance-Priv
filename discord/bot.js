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
} from 'discord.js';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { config } from './config.js';
import { categoryByIndex, encodeModalId, parseId } from './categories.js';
import { sendNotification, buildEmbed } from './notify.js';
import { patchCategory } from './apiClient.js';

// --- DB (read-only polling) ---
const db = new DatabaseSync(config.dbPath);
const qNew = db.prepare('SELECT * FROM transactions WHERE id > ? ORDER BY id ASC LIMIT 25');
const qById = db.prepare('SELECT * FROM transactions WHERE id = ?');
const qMaxId = db.prepare('SELECT COALESCE(MAX(id),0) AS m FROM transactions');

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
    lastNotifiedId = Number(qMaxId.get().m);
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
    const rows = qNew.all(lastNotifiedId);
    if (rows.length) {
      const ch = await getChannel();
      for (const tx of rows) {
        try {
          await sendNotification(ch, tx);
        } catch (e) {
          log('error', `мэдэгдэл илгээх алдаа id=${tx.id}`, e.message);
        }
        lastNotifiedId = Math.max(lastNotifiedId, Number(tx.id));
        saveState({ lastNotifiedId }); // тус бүрд хадгална (давхар илгээхгүй)
      }
    }
  } catch (e) {
    log('error', 'poll алдаа', e.message);
  } finally {
    polling = false;
  }
}

// --- Interaction: товч → modal → PATCH → edit ---
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isButton()) {
      const p = parseId(interaction.customId);
      if (!p || p.kind !== 'c') return;
      const cat = categoryByIndex(p.catIdx);
      if (!cat) return;
      // POS бол газрын нэр, бусад бол шалтгаан асуух modal
      const modal = new ModalBuilder()
        .setCustomId(encodeModalId(p.txnId, p.catIdx, p.isPos, interaction.message.id))
        .setTitle(`${cat} болгох`);
      const input = new TextInputBuilder()
        .setCustomId('value')
        .setLabel(p.isPos ? 'Газрын нэр (заавал биш)' : 'Шалтгаан (заавал биш)')
        .setPlaceholder(p.isPos ? 'жишээ: Шулуун дун' : 'жишээ: Ээжид сарын мөнгө')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(200);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit()) {
      const p = parseId(interaction.customId);
      if (!p || p.kind !== 'm') return;
      const cat = categoryByIndex(p.catIdx);
      if (!cat) { await interaction.reply({ content: 'Ангилал танигдсангүй', ephemeral: true }); return; }

      await interaction.deferReply({ ephemeral: true });
      const value = (interaction.fields.getTextInputValue('value') || '').trim();
      const extra = p.isPos ? { merchantPlace: value } : { note: value };

      try {
        const r = await patchCategory(p.txnId, { category: cat, applyToAll: true, ...extra });
        // Мессежийг шинэчлэх: DB-ээс дахин уншиж embed-г classified болгоно
        const updated = qById.get(p.txnId);
        const ch = await getChannel();
        if (p.messageId && updated) {
          const msg = await ch.messages.fetch(p.messageId).catch(() => null);
          if (msg) await msg.edit({ embeds: [buildEmbed(updated)], components: [] });
        }
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
