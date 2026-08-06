// ============================================================
//  telegram/bot.js — Голомт гүйлгээний Telegram bot (multi-tenant)
//
//  - DB-г polling хийж холбогдсон хэрэглэгч бүрийн шинэ гүйлгээг илрүүлнэ
//    (Discord bot-той ижил загвар, зөвхөн олон хэрэглэгчид JOIN нэмэгдсэн).
//  - Ангилах: товч → (POS:Газрын нэр / бусад:Шалтгаан — config/
//    transactionActions.js шийднэ) текст хариу → applyToAll баталгаажуулалт
//    (Тийм/Үгүй, default OFF) → PATCH /api/.../category (Bearer JWT) → edit.
//  - Талбар засах: "📝 ..." товч → текст хариу → PATCH /api/.../note
//    (ангилал/override хөндөхгүй).
//  - Linking: /link <код> — dashboard-аас үүсгэсэн нэг удаагийн код.
//  - ⚠️ Холбоогүй chat_id-д bot ЮУ Ч илгээхгүй/ангилуулахгүй (эрх шалгалт
//    эхний check байдлаар бичигдсэн, requireLinked() бүх handler-т).
// ============================================================

import { Agent as HttpsAgent } from 'node:https';
import { Telegraf, Markup } from 'telegraf';
import { readFileSync, writeFileSync } from 'node:fs';
import { config } from './config.js';
import { createTelegramStore } from './db.js';
import { mintAccessToken } from './jwtAuth.js';
import { patchCategory, updateFields, getTransaction } from './apiClient.js';
import { categoryByIndex, parseId, encodeApplyAllId, encodeSkipId } from './categories.js';
import { buildText, keyboardFor, buildCategoryKeyboard } from './notify.js';
import { APPLY_TO_ALL_CONFIRM, detailFieldFor } from '../config/transactionActions.js';

function log(level, msg, extra) {
  console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...(extra ? { extra } : {}) }));
}

const store = createTelegramStore({ dbPath: config.dbPath });
// ⚠️ Зарим сервер (жишээ: AWS EC2) api.telegram.org-д AAAA (IPv6) DNS record
// буцаадаг ч бодит IPv6 route байхгүй тул анхны (family авто сонгодог) агент
// ETIMEDOUT алддаг (dns.setDefaultResultOrder ганцаараа шийдэхгүй байсныг
// туршилтаар баталгаажуулсан — Node 24-ийн Happy Eyeballs-тай холбоотой).
// IPv4-г шууд тулгаж энэ асуудлыг бүрмөсөн засна.
const bot = new Telegraf(config.botToken, {
  telegram: { agent: new HttpsAgent({ family: 4, keepAlive: true, keepAliveMsecs: 10000 }) },
});

// --- pending follow-up төлөв (chat бүрд нэг) ---
// chatId → { mode, txnId, ... }:
//   mode:'detail'  — ангилал сонгосны дараах талбарын текст хүлээж байна
//                    { catIdx, isPos, chatId, messageId }
//   mode:'confirm' — applyToAll Тийм/Үгүй товч хүлээж байна (+ value)
//   mode:'field'   — дан талбарын засварын текст хүлээж байна { apiField }
const pending = new Map();

function loadState() {
  try { return JSON.parse(readFileSync(config.statePath, 'utf8')); } catch { return null; }
}
function saveState(s) {
  try { writeFileSync(config.statePath, JSON.stringify(s), { mode: 0o600 }); } catch (e) { log('warn', 'state бичих алдаа', e.message); }
}
let lastNotifiedId = 0;

const onboardingText = () => [
  '👋 Тавтай морил! Энэ bot таны банкны мэдэгдлийг автоматаар ангилж, мэдэгдэнэ.',
  '',
  '1️⃣ Эхлээд банкны Gmail-аа dashboard дээрээ холбоно уу:',
  `   ${config.dashboardUrl}`,
  '2️⃣ Dashboard-ийн Тохиргоо → "Telegram холбох" дараад авсан кодоо энд бич:',
  '   /link 123456',
  '3️⃣ Холбогдсоны дараа шинэ гүйлгээ ирэх бүрд энд шууд мэдэгдэнэ.',
].join('\n');

/** Тухайн chat холбогдсон эсэхийг шалгаж userId буцаана; үгүй бол сануулаад null. */
async function requireLinked(ctx) {
  const userId = store.resolveUserByChatId(ctx.chat.id);
  if (userId == null) {
    await ctx.reply(`Эхлээд dashboard-аас холбоно уу:\n${config.dashboardUrl}\n\n/start-ээр зааврыг дахин үзнэ үү.`);
    return null;
  }
  return userId;
}

// ===================== КОМАНД =====================

bot.start(async (ctx) => {
  const userId = store.resolveUserByChatId(ctx.chat.id);
  if (userId != null) {
    await ctx.reply('✓ Та аль хэдийн холбогдсон байна. /status — төлөв харах, /unlink — салгах.');
    return;
  }
  await ctx.reply(onboardingText());
});

bot.command('link', async (ctx) => {
  const code = (ctx.message.text || '').split(/\s+/)[1];
  if (!code) {
    await ctx.reply('Хэрэглээ: /link 123456 (dashboard-аас авсан 6 оронтой код)');
    return;
  }
  const r = store.consumeLinkCode(code, ctx.chat.id);
  if (r.ok) {
    const gmail = store.getGmailStatus(r.userId);
    let msg = '✓ Холбогдлоо. Дараагийн гүйлгээ ирэхэд шууд мэдэгдэнэ.';
    if (!gmail.connected) msg += `\n\n⚠️ Та Gmail-аа хараахан холбоогүй байна — dashboard дээрээ холбоно уу:\n${config.dashboardUrl}`;
    await ctx.reply(msg);
    log('info', 'linked', `userId=${r.userId} chatId=${ctx.chat.id}`);
    return;
  }
  const messages = {
    invalid: '❌ Код буруу байна. Dashboard-ийн Тохиргоо хэсгээс шинэ код авна уу.',
    expired: '❌ Кодны хугацаа дууссан (10 мин). Dashboard-аас шинэ код авна уу.',
    used: '❌ Энэ код аль хэдийн ашиглагдсан. Dashboard-аас шинэ код авна уу.',
    chat_taken: '❌ Энэ Telegram акаунт өөр хэрэглэгчтэй аль хэдийн холбогдсон байна. Эхлээд /unlink хийнэ үү.',
  };
  await ctx.reply(messages[r.reason] || '❌ Холбоход алдаа гарлаа.');
});

bot.command('unlink', async (ctx) => {
  const removed = store.unlinkByChatId(ctx.chat.id);
  await ctx.reply(removed ? '✓ Холболт салгагдлаа.' : 'Та холбогдоогүй байна.');
});

bot.command('status', async (ctx) => {
  const userId = await requireLinked(ctx);
  if (userId == null) return;
  const gmail = store.getGmailStatus(userId);
  const gmailLine = gmail.connected
    ? (gmail.status === 'reauth_needed' ? '⚠️ Gmail: дахин холбох шаардлагатай' : '✓ Gmail: холбогдсон')
    : `✗ Gmail: холбогдоогүй (${config.dashboardUrl})`;
  await ctx.reply(`✓ Telegram: холбогдсон\n${gmailLine}`);
});

// ===================== ГҮЙЛГЭЭ ПОЛЛИНГ (мэдэгдэл) =====================

let polling = false;
async function pollOnce() {
  if (polling) return;
  polling = true;
  try {
    const currentMax = store.getMaxTransactionId();
    if (currentMax > lastNotifiedId) {
      const rows = store.listNewLinkedTransactions(lastNotifiedId);
      for (const row of rows) {
        if (!store.markNotified(row.id, row.chat_id)) continue; // аль хэдийн мэдэгдсэн
        try {
          await bot.telegram.sendMessage(row.chat_id, buildText(row), {
            parse_mode: 'Markdown',
            ...keyboardFor(row),
          });
        } catch (e) {
          log('error', `мэдэгдэл илгээх алдаа txn=${row.id} chat=${row.chat_id}`, e.message);
        }
      }
      lastNotifiedId = currentMax;
      saveState({ lastNotifiedId });
    }
  } catch (e) {
    log('error', 'poll алдаа', e.message);
  } finally {
    polling = false;
  }
}

// ===================== АНГИЛАХ (callback) =====================

async function refreshMessage(chatId, messageId, tx) {
  if (!chatId || !messageId) return;
  try {
    await bot.telegram.editMessageText(chatId, messageId, undefined, buildText(tx), {
      parse_mode: 'Markdown',
      ...keyboardFor(tx),
    });
  } catch { /* мессеж засаж чадахгүй ч урсгалыг унагаахгүй */ }
}

async function applyCategory(ctx, userId, txnId, category, extra, applyToAll, originChatId, originMessageId) {
  const token = mintAccessToken(store.getUserBasic(userId));
  try {
    // applyToAll = зөвхөн хэрэглэгч "Тийм" гэж баталгаажуулсан үед true
    const r = await patchCategory(token, txnId, { category, applyToAll, ...extra });
    const updated = await getTransaction(token, txnId).catch(() => null);
    if (updated) await refreshMessage(originChatId, originMessageId, updated);
    const tail = applyToAll ? ' Цаашид энэ мерчант автоматаар ийм ангилалтай болно.' : '';
    await ctx.reply(`✅ *${category}* болгож хадгаллаа${r.updated > 1 ? ` (${r.updated} гүйлгээнд)` : ''}.${tail}`, { parse_mode: 'Markdown' });
    log('info', `ангилагдлаа txn=${txnId} → ${category}`, `applyToAll=${applyToAll} updated=${r.updated}`);
  } catch (e) {
    log('error', `PATCH алдаа txn=${txnId}`, e.message);
    await ctx.reply('❌ Хадгалахад алдаа гарлаа. Дахин оролдоно уу.');
  }
}

/** Ангилал+талбар цугласны дараах applyToAll баталгаажуулалт (default = Үгүй товч). */
async function askApplyToAll(ctx, st) {
  pending.set(ctx.chat.id, { ...st, mode: 'confirm' });
  await ctx.reply(`${APPLY_TO_ALL_CONFIRM.question}\n${APPLY_TO_ALL_CONFIRM.hint}`,
    Markup.inlineKeyboard([[
      Markup.button.callback(APPLY_TO_ALL_CONFIRM.yesLabel, encodeApplyAllId(st.txnId, true)),
      Markup.button.callback(APPLY_TO_ALL_CONFIRM.noLabel, encodeApplyAllId(st.txnId, false)),
    ]]));
}

bot.on('callback_query', async (ctx) => {
  try {
    const data = ctx.callbackQuery?.data;
    const p = parseId(data);
    if (!p) { await ctx.answerCbQuery(); return; }

    const userId = await requireLinked(ctx);
    if (userId == null) { await ctx.answerCbQuery(); return; }

    const token = mintAccessToken(store.getUserBasic(userId));
    const originChatId = ctx.callbackQuery.message?.chat?.id;
    const originMessageId = ctx.callbackQuery.message?.message_id;

    // --- "Ангилал засах" (аль хэдийн бүртгэгдсэн) → ангиллын товчнуудыг дахин харуулна ---
    // 'ec' kind — доорх handler нь stale-check хийхгүй (classified засах нь хэвийн).
    if (p.kind === 'e') {
      await ctx.answerCbQuery();
      const current = await getTransaction(token, p.txnId);
      if (!current) { await ctx.reply('⚠️ Энэ гүйлгээ олдсонгүй.'); return; }
      await ctx.reply(`Одоогийн ангилал: *${current.category || '(ангилаагүй)'}*\nШинэ ангилал сонгоно уу:`, {
        parse_mode: 'Markdown',
        ...buildCategoryKeyboard(p.txnId, current.is_pos === 1, 'ec', current.type),
      });
      return;
    }

    // --- "Талбар засах" (📝 Газрын нэр/Шалтгаан — ангилал хөндөхгүй) ---
    if (p.kind === 'n') {
      await ctx.answerCbQuery();
      const current = await getTransaction(token, p.txnId);
      if (!current) { await ctx.reply('⚠️ Энэ гүйлгээ олдсонгүй.'); return; }
      const detail = detailFieldFor(current); // POS/энгийн ялгааг модуль шийднэ
      pending.set(ctx.chat.id, {
        mode: 'field', txnId: p.txnId, apiField: detail.apiField,
        chatId: originChatId, messageId: originMessageId,
      });
      const cur = detail.current ? `\nОдоогийн: ${detail.current}` : '';
      await ctx.reply(`${detail.question} («-» гэвэл устгана)${cur}`,
        Markup.inlineKeyboard([[Markup.button.callback('Болих', encodeSkipId(p.txnId))]]));
      return;
    }

    // --- "Алгасах/Болих" (follow-up товч) ---
    if (p.kind === 'sk') {
      await ctx.answerCbQuery();
      const st = pending.get(ctx.chat.id);
      if (!st || st.txnId !== p.txnId) return;
      if (st.mode === 'field') { // талбарын засвар болих — юу ч бичихгүй
        pending.delete(ctx.chat.id);
        await ctx.reply('Болилоо.');
        return;
      }
      // classify-ийн талбар алгасах → утгагүйгээр applyToAll баталгаажуулалт руу
      await askApplyToAll(ctx, { ...st, value: '' });
      return;
    }

    // --- applyToAll Тийм/Үгүй (баталгаажуулалтын товч) ---
    if (p.kind === 'ay' || p.kind === 'an') {
      await ctx.answerCbQuery();
      const st = pending.get(ctx.chat.id);
      if (!st || st.mode !== 'confirm' || st.txnId !== p.txnId) return;
      pending.delete(ctx.chat.id);
      const cat = categoryByIndex(st.catIdx);
      if (!cat) return;
      // Талбарын түлхүүрийг модулиас (client өөрөө merchantPlace/note шийдэхгүй)
      const extra = st.value ? { [detailFieldFor({ is_pos: st.isPos ? 1 : 0 }).apiField]: st.value } : {};
      await applyCategory(ctx, userId, st.txnId, cat, extra, p.kind === 'ay', st.chatId, st.messageId);
      return;
    }

    // --- Ангиллын товч ('c' = pending баталгаажуулах, 'ec' = classified засах) ---
    if (p.kind !== 'c' && p.kind !== 'ec') { await ctx.answerCbQuery(); return; }
    const cat = categoryByIndex(p.catIdx);
    if (!cat) { await ctx.answerCbQuery(); return; }

    const current = await getTransaction(token, p.txnId);
    if (!current) {
      await ctx.answerCbQuery('Гүйлгээ олдсонгүй');
      await ctx.reply('⚠️ Энэ гүйлгээ олдсонгүй (устсан байж магадгүй, эсвэл танд хамаарахгүй).');
      return;
    }
    // Stale-check ЗӨВХӨН pending мэдэгдлийн товчинд ('c') — dashboard-аар зэрэг
    // шийдсэн race-ээс хамгаална. Засварын урсгалд ('ec') classified байх нь хэвийн.
    if (p.kind === 'c' && current.status !== 'pending_review') {
      await ctx.answerCbQuery('Аль хэдийн шийдэгдсэн');
      await ctx.reply(`✓ Энэ гүйлгээ аль хэдийн *${current.category || 'шийдэгдсэн'}* болсон байна. Дахин засах бол «✏️ Ангилал засах» товчийг ашиглана уу.`, { parse_mode: 'Markdown' });
      await refreshMessage(originChatId, originMessageId, current);
      return;
    }

    await ctx.answerCbQuery();
    pending.set(ctx.chat.id, {
      mode: 'detail', txnId: p.txnId, catIdx: p.catIdx, isPos: p.isPos,
      chatId: originChatId, messageId: originMessageId,
    });
    // Асуулт/жишээ дундын модулиас — POS бол Газрын нэр, бусад бол Шалтгаан
    const detail = detailFieldFor({ is_pos: p.isPos ? 1 : 0 });
    await ctx.reply(`${detail.question} (${detail.placeholder})`,
      Markup.inlineKeyboard([[Markup.button.callback('Алгасах', encodeSkipId(p.txnId))]]));
  } catch (e) {
    log('error', 'callback алдаа', e.message);
  }
});

// --- Follow-up текст хариулт (classify-ийн талбар ЭСВЭЛ дан талбарын засвар) ---
bot.on('text', async (ctx, next) => {
  if (String(ctx.message.text || '').startsWith('/')) return next(); // командыг дараагийн handler-т
  const st = pending.get(ctx.chat.id);
  if (!st) return; // холбогдоогүй эсвэл хүлээж буй асуултгүй үед bot дуугүй (спам мэдэгдэл илгээхгүй)
  const userId = store.resolveUserByChatId(ctx.chat.id);
  if (userId == null) return;
  const raw = String(ctx.message.text || '').trim().slice(0, 200);

  // Дан талбарын засвар: ангилал хөндөхгүй PATCH /note («-» → устгах)
  if (st.mode === 'field') {
    pending.delete(ctx.chat.id);
    const value = raw === '-' ? '' : raw;
    const token = mintAccessToken(store.getUserBasic(userId));
    try {
      await updateFields(token, st.txnId, { [st.apiField]: value });
      const updated = await getTransaction(token, st.txnId).catch(() => null);
      if (updated) await refreshMessage(st.chatId, st.messageId, updated);
      await ctx.reply(value ? '✅ Хадгаллаа.' : '✅ Устгалаа.');
      log('info', `талбар засав txn=${st.txnId}`, `field=${st.apiField}`);
    } catch (e) {
      log('error', `updateFields алдаа txn=${st.txnId}`, e.message);
      await ctx.reply('❌ Хадгалахад алдаа гарлаа. Дахин оролдоно уу.');
    }
    return;
  }

  // Classify-ийн талбарын хариу → applyToAll баталгаажуулалт руу (шууд бичихгүй)
  if (st.mode === 'confirm') return; // товчоор л хариулна — текстийг тоохгүй
  await askApplyToAll(ctx, { ...st, value: raw });
});

bot.catch((err) => log('error', 'bot-level алдаа', err?.message ?? String(err)));
process.on('unhandledRejection', (r) => log('error', 'unhandledRejection', r?.message ?? String(r)));

// ===================== ЭХЛҮҮЛЭХ =====================

const st0 = loadState();
if (st0 && Number.isInteger(st0.lastNotifiedId)) {
  lastNotifiedId = st0.lastNotifiedId;
  log('info', `Үргэлжлүүлж байна, lastNotifiedId=${lastNotifiedId}`);
} else {
  lastNotifiedId = store.getMaxTransactionId();
  saveState({ lastNotifiedId });
  log('info', `Анхны асаалт — backlog алгасч, id>${lastNotifiedId}-ээс эхэлнэ`);
}

// ⚠️ bot.launch()-ийн буцаах Promise нь bot зогсох хүртэл RESOLVE ХИЙХГҮЙ
// (telegraf-ийн long-polling Polling.loop() бол зогсох хүртэл гүйдэг async
// generator тул) — "амжилттай эхэллээ" гэдгийг ЭНД мэдэхийн тулд бид
// bot.polling шинжийг богино зайнаас шалгана. .catch() нь ГАГЦХАН getMe/
// deleteWebhook шатанд (эсвэл 401/409 зэрэг retry-гүй алдаанд) л буудаг.
bot.launch().catch((e) => log('error', 'launch() зогссон/алдаатай', e?.message ?? String(e)));
let loggedStarted = false;
const startedCheck = setInterval(() => {
  if (bot.polling && !loggedStarted) {
    loggedStarted = true;
    log('info', 'Telegram bot эхэллээ (long polling)');
    clearInterval(startedCheck);
  }
}, 500);
setInterval(pollOnce, config.pollSeconds * 1000);

function shutdown(signal) {
  log('info', `Зогсоох дохио: ${signal}`);
  bot.stop(signal);
  store.close();
  process.exit(0);
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
