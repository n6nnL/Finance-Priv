// parsers/golomt.js
//
// Голомт банк (alert@golomtbank.com) -ийн гүйлгээний имэйлийг задлан, нэгдсэн
// transaction object буцаадаг parser.
//
// Дэмждэг загварууд (5):
//   1) EASYINFO  — "ЗАРЛАГЫН/ОРЛОГЫН ГҮЙЛГЭЭ", Гүйлгээний дүн/огноо/утга/Үлдэгдэл
//                  (огноо нь labelтэй ЭСВЭЛ дангаар мөрөнд "2022-12-04" байж болно)
//   2) VERBOSE   — "...ЭНЭ ӨДРИЙН МЭНД...", "Гүйлгээ хийгдсэн огноо", утга олон мөрт
//   3) CARD      — "Картын дугаар:****0930", "Огноо:2026/01/16 22:12:35" (налуу огноо)
//   4) FIRSTTXN  — "****0047 картын анхны гүйлгээ" (огноогүй)
//   5) OTHER     — интернэт банк шилжүүлэг (Дүн:/Огноо:/Утга:) — best-effort
//
// HTML (cheerio) болон plain text хоёуланд ажиллана.

import * as cheerio from 'cheerio';

/** "14,412.34" / "-14,412.34" / "MNT 37,000.00" → цэвэр тоо (null боломжтой) */
function parseAmount(str) {
  if (!str) return null;
  const cleaned = String(str).replace(/[^\d.,-]/g, '');
  if (!cleaned) return null;
  const normalized = cleaned.replace(/,/g, '');
  const num = parseFloat(normalized);
  return Number.isNaN(num) ? null : num;
}

// Бүх загварт гардаг label-ууд. Голомт нэг мөрөнд олон label зэрэгцүүлдэг тул
// утгыг дараагийн МЭДЭГДЭЖ БУЙ label дээр зогсооно.
const KNOWN_LABELS = [
  'Гүйлгээний дүн',
  'Гүйлгээ хийгдсэн огноо',
  'Гүйлгээний огноо',
  'Дансны дугаар',
  'Картын дугаар',
  'Гүйлгээний утга',
  'Үлдэгдэл',
  'Лавлах дугаар',
  'Гүйлгээний төлөв',
  'Дансны нэр',
  'Огноо',
  'Дүн',
  'Утга',
  'Банк',
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Label-ийн дараах утгыг авна.
 * @param {string} text
 * @param {string} label
 * @param {{multiline?: boolean}} [opts] multiline=true бол утга мөр алгасан,
 *        зөвхөн дараагийн label/төгсгөл дээр зогсоно (олон мөрт утгад).
 */
function labelValue(text, label, opts = {}) {
  const others = KNOWN_LABELS.filter((l) => l !== label).map(escapeRe).join('|');
  // multiline бол \n-д зогсохгүй; үгүй бол мөрийн төгсгөлд зогсоно
  const stopParts = [];
  if (others) stopParts.push('(?:' + others + ')');
  if (!opts.multiline) stopParts.push('\\n', '\\r');
  stopParts.push('$');
  const stop = stopParts.join('|');
  const re = new RegExp(escapeRe(label) + '\\s*[:：]?\\s*([\\s\\S]*?)\\s*(?=' + stop + ')', 'i');
  const m = text.match(re);
  let v = m ? m[1].trim() : null;
  if (v && opts.multiline) v = v.replace(/\s*\n\s*/g, ' ').trim(); // олон мөрийг нэг болгох
  return v ? v : null;
}

/** "2026/01/16" эсвэл "2026-01-16" → "2026-01-16" (ISO). Танихгүй бол null. */
function normalizeDateStr(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{4})[-/.](\d{2})[-/.](\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Огноог олох: олон label → дангаар scan (2 формат: YYYY-MM-DD, YYYY/MM/DD) */
function extractDate(text) {
  for (const lbl of ['Гүйлгээ хийгдсэн огноо', 'Гүйлгээний огноо', 'Огноо']) {
    const d = normalizeDateStr(labelValue(text, lbl));
    if (d) return d;
  }
  // Fallback: текстээс эхний огноо-төст токен (label-гүй EASYINFO/VERBOSE-д)
  const m = text.match(/\d{4}[-/.]\d{2}[-/.]\d{2}/);
  return m ? normalizeDateStr(m[0]) : null;
}

/** Данс/картын маск ба сүүлийн оронг олох */
function extractAccount(text) {
  let raw = labelValue(text, 'Дансны дугаар') || labelValue(text, 'Картын дугаар');
  let masked = null;
  let last4 = null;
  if (raw) {
    masked = raw;
    const tail = raw.match(/(\d{2,4})\s*$/);
    last4 = tail ? tail[1] : null;
  }
  if (!last4) {
    // Маск хэлбэр: "116*****50" → 50,  "****0930" → 0930,  "****0047 картын" → 0047
    const m = text.match(/(?:\d{2,4})?\*{2,}\s*(\d{2,4})/);
    if (m) {
      last4 = m[1];
      masked = masked || m[0].trim();
    }
  }
  return { masked, last4 };
}

/** Дүн олох: "Гүйлгээний дүн" эсвэл "Дүн" (OTHER формат) */
function extractAmountRaw(text) {
  return labelValue(text, 'Гүйлгээний дүн') || labelValue(text, 'Дүн');
}

/** Утга/тайлбар олох: "Гүйлгээний утга" эсвэл "Утга" (олон мөрт байж болно) */
function extractDescription(text) {
  return (
    labelValue(text, 'Гүйлгээний утга', { multiline: true }) ||
    labelValue(text, 'Утга', { multiline: true })
  );
}

/** POS (картаар тодорхой газар) гүйлгээ эсэх — description нь BOM-оор төгссөн/агуулсан */
export function detectIsPos(description) {
  if (!description) return false;
  return /BOM\b/i.test(description); // үгийн төгсгөлд BOM → POS дохио
}

/**
 * Голомт банкны имэйлийг задална.
 * @param {object} parsed  simpleParser үр дүн ({ html, text, subject, messageId })
 * @returns {object} transaction object
 */
export function parseGolomt(parsed) {
  // 1) Текст бэлдэх
  let text = '';
  if (parsed.html) {
    const $ = cheerio.load(parsed.html);
    $('br').replaceWith('\n');
    $('td, th, p, div, tr').append('\n');
    text = $.root().text();
  } else {
    text = parsed.text || '';
  }
  text = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

  // 2) Талбаруудыг задлах
  const amountRaw = extractAmountRaw(text);
  const date = extractDate(text);
  const { masked: accountMasked, last4: accountLast4 } = extractAccount(text);
  const description = extractDescription(text);
  const balanceRaw = labelValue(text, 'Үлдэгдэл');

  // 3) Дүн ба төрөл
  const amountNum = parseAmount(amountRaw);
  const isExpense =
    (amountRaw && amountRaw.includes('-')) ||
    /зарлага|данснаас|илгээв/i.test(text); // зарлага/шилжүүлэг гарсан дохио
  const isIncome = /орлог|дансанд|хүлээн авав/i.test(text);
  // Тэмдэг (-) тэргүүлнэ; үгүй бол keyword
  let type = 'expense';
  if (amountRaw && amountRaw.includes('-')) type = 'expense';
  else if (isIncome && !isExpense) type = 'income';
  else if (isExpense) type = 'expense';
  else type = 'income';

  const amount = amountNum === null ? null : Math.abs(amountNum);

  return {
    messageId: parsed.messageId || null,
    amount,
    currency: 'MNT',
    date: date || null,
    description: description || null,
    type,
    category: null, // categorize.js дараа онооно
    accountLast4: accountLast4 || null,
    accountMasked: accountMasked || null,
    isPos: detectIsPos(description),
    balance: parseAmount(balanceRaw),
    raw: (parsed.text || text || '').slice(0, 500),
  };
}

export default parseGolomt;
