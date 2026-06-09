// parsers/golomt.js
//
// Голомт банк (alert@golomtbank.com) -ийн "Easy Info гүйлгээний мэдээлэл"
// имэйлийг задлан, нэгдсэн transaction object буцаадаг parser.
//
// Имэйлийн бүтэц (label-value хосууд):
//   Гарчиг:           "ЗАРЛАГЫН ГҮЙЛГЭЭ"  (зарлага) / орлогын үед өөр байж болно
//   Гүйлгээний дүн:    "-14,412.34MNT"     (- = зарлага, дүн таслалтай, MNT залгаатай)
//   Гүйлгээний огноо:  "2026-06-07"
//   Дансны дугаар:     "116*****50"        (банк өөрөө нууцалсан)
//   Гүйлгээний утга:   "2266 NetflMCI"
//   Үлдэгдэл:          "17,499.92 MNT"
//
// Энэ parser нь HTML (cheerio) болон plain text хоёуланд ажиллахаар
// label текстийг хайж, түүний дараах утгыг авдаг найдвартай аргыг ашиглана.

import * as cheerio from 'cheerio';

/**
 * "14,412.34" эсвэл "-14,412.34" гэх мэт стрингээс цэвэр тоо гаргана.
 * Таслал (мянгатын тусгаарлагч) -г хасч, цэгийг (бутархай) хадгална.
 * @param {string} str
 * @returns {number|null}
 */
function parseAmount(str) {
  if (!str) return null;
  // Зөвхөн тоо, таслал, цэг, хасах тэмдгийг үлдээх
  const cleaned = str.replace(/[^\d.,-]/g, '');
  if (!cleaned) return null;
  // Мянгатын таслалыг устгах: "14,412.34" -> "14412.34"
  const normalized = cleaned.replace(/,/g, '');
  const num = parseFloat(normalized);
  return Number.isNaN(num) ? null : num;
}

/**
 * Имэйлийн нийт текстээс өгөгдсөн label-ийн дараах утгыг олж авна.
 * Жишээ: labelValue(text, "Гүйлгээний утга") -> "2266 NetflMCI"
 *
 * Label-ийн дараа цэг/хоёр цэг/зай байж болохыг тооцсон.
 * Утга нь мөрийн төгсгөл хүртэл, эсвэл дараагийн label хүртэл.
 * @param {string} text  цэвэр текст (HTML-ээс эсвэл plain)
 * @param {string} label хайх шошго
 * @returns {string|null}
 */
function labelValue(text, label) {
  // label-ийн дараах :, зай, мөр шинэчлэлийг алгасаад утгыг авах
  const re = new RegExp(
    label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[:：]?\\s*([^\\n\\r]+?)\\s*(?:\\n|\\r|$)',
    'i'
  );
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Голомт банкны имэйлийг задална.
 * @param {object} parsed  mailparser-ийн simpleParser үр дүн ({ html, text, subject, messageId, ... })
 * @returns {object} transaction object — API руу илгээхэд бэлэн
 */
export function parseGolomt(parsed) {
  // 1) Текст эх сурвалжийг бэлдэх: HTML байвал cheerio-оор текст болгох, үгүй бол plain text
  let text = '';
  if (parsed.html) {
    const $ = cheerio.load(parsed.html);
    // <br>, <td>, <p> зэргийг мөр болгож хувиргаад текст авах
    $('br').replaceWith('\n');
    $('td, th, p, div, tr').append('\n');
    text = $.root().text();
  } else {
    text = parsed.text || '';
  }

  // Олон зайг ганц зай болгож, мөр бүрийг цэвэрлэх (label хайхад тогтвортой болгох)
  text = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

  // 2) Талбаруудыг задлах
  const amountRaw = labelValue(text, 'Гүйлгээний дүн');
  const dateRaw = labelValue(text, 'Гүйлгээний огноо');
  const accountRaw = labelValue(text, 'Дансны дугаар');
  const descRaw = labelValue(text, 'Гүйлгээний утга');
  const balanceRaw = labelValue(text, 'Үлдэгдэл');

  // 3) Дүн ба төрөл (зарлага/орлого)
  // Дүнгийн "-" тэмдэг эсвэл гарчгийн "ЗАРЛАГА" гэдгээр төрлийг тодорхойлно
  const amountNum = parseAmount(amountRaw);
  const isExpense =
    (amountRaw && amountRaw.includes('-')) ||
    /зарлаг/i.test(text); // гарчигт "ЗАРЛАГЫН ГҮЙЛГЭЭ" гэж байвал
  const type = isExpense ? 'expense' : 'income';

  // amount-ийг үргэлж эерэг тоогоор хадгална (type талбар тэмдгийг илэрхийлнэ)
  const amount = amountNum === null ? null : Math.abs(amountNum);

  // 4) Данс — банк аль хэдийн нууцалсан ("116*****50") тул маскыг хэвээр хадгална.
  //    Сүүлийн харагдах орнуудыг (одны дараах хэсэг) тусад нь авна: "116*****50" -> "50"
  let accountMasked = accountRaw || null; // бүтэн масклагдсан хэлбэр: "116*****50"
  let accountLast4 = null;
  if (accountRaw) {
    // Мөрийн төгсгөлийн цифр блокийг авах (одны дараах хэсэг)
    const tail = accountRaw.match(/(\d+)\s*$/);
    accountLast4 = tail ? tail[1] : null; // "116*****50" -> "50"
  }

  return {
    messageId: parsed.messageId || null,
    amount,
    currency: 'MNT',
    date: dateRaw || null, // "2026-06-07" — аль хэдийн ISO формат
    description: descRaw || null,
    type,
    category: null, // categorize.js дараа нь онооно
    accountLast4,
    accountMasked, // банкны масклагдсан бүтэн хэлбэр: "116*****50"
    balance: parseAmount(balanceRaw), // нэмэлт мэдээлэл (хүсвэл хадгална)
    raw: (parsed.text || text || '').slice(0, 500),
  };
}
