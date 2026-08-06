// ============================================================
//  config/categories.js — Голомт банкны гүйлгээ ангилах дүрмүүд
//  (10 ангиллын систем, хэрэглэгчид тохирсон)
//
//  keyword-ууд нь жишээ — хэрэглэгч өөрийн бодит мерчантуудад тааруулж
//  нэмж/засаж болно. ⚠️ Голомтын ТАСЛАГДСАН код (STOREBOM, THE LBOM г.м)-ийг
//  энд keyword-оор ТААМАГЛАХГҮЙ — learned override-оор л ангилагдана.
//
//  categorize() дараалал: override → Орлого(type) → keyword → null(pending).
//  "Бусад" нь зөвхөн хэрэглэгч баталгаажуулахдаа сонгосон үед оноогдоно.
// ============================================================

// Бүх 10 ангилал (dropdown, валидаци, AI prompt-д). Дараалал хадгалагдсан.
export const CATEGORIES = [
  'Гадуур хооллолт',
  'Хүнсний зүйл',
  'Тээвэр',
  'Орлого',
  'Шилжүүлэг & гэр бүл',
  'Захиалга & сервис',
  'Боловсрол',
  'Чөлөөт цаг / зугаа цэнгэл',
  'Хувцас / гоо сайхан',
  'Бусад',
];

// Ангилал бүрийн харагдах metadata (emoji + hex) — ★ single source.
// Backend болон dashboard хоёул эндээс авна (format.js импортолдог) — нэрийг
// хоёр газар давхар бичихгүй. Зөвхөн канон 10 ангилал; танигдаагүйд default.
export const CATEGORY_META = {
  'Гадуур хооллолт':            { emoji: '🍽️', hex: '#E8703A' },
  'Хүнсний зүйл':               { emoji: '🛒', hex: '#4F9D69' },
  'Тээвэр':                     { emoji: '🚗', hex: '#E0A33E' },
  'Орлого':                     { emoji: '💰', hex: '#2E9E5B' },
  'Шилжүүлэг & гэр бүл':       { emoji: '💸', hex: '#C2698F' },
  'Захиалга & сервис':          { emoji: '📱', hex: '#3FA9A0' },
  'Боловсрол':                   { emoji: '📚', hex: '#5566B5' },
  'Чөлөөт цаг / зугаа цэнгэл':  { emoji: '🎬', hex: '#8B6FB8' },
  'Хувцас / гоо сайхан':       { emoji: '👕', hex: '#D86A92' },
  'Бусад':                       { emoji: '📦', hex: '#8A8275' },
};

// ---- Ангиллын ХАМААРАЛ (applicability): аль төрлийн гүйлгээнд утгатай вэ ----
// ★ single source. Гурван клиент (Dashboard/Discord/Telegram) БА API хоёул эндээс
// шалгана — "Орлого" зарлагын мөрөнд, зарлагын ангилал орлогын мөрөнд гарахгүй.
//
// ОЛОНЛОГ (boolean БИШ) — учир нь зарим ангилал ХОЁУЛАНД утгатай:
//   • 'Шилжүүлэг & гэр бүл' — гэр бүлийн шилжүүлэг хоёр тийш явна (ээжид өгөх ба
//     ээжээс авах хоёулаа хэвийн)
//   • 'Бусад' — хэрэглэгчийн ГАРААР сонгох гарц; хэзээ ч автоматаар оногдохгүй
//     (categorize.js буцаахгүй) тул хоёуланд нээлттэй байх ёстой.
//
// ⚠️ CATEGORIES (жирийн мөрийн массив) БА CATEGORY_META-г ХЭВЭЭР үлдээв — bot-ууд
//    ангиллыг CATEGORIES дахь ИНДЕКСЭЭР кодолдог тул дараалал ариун (§ notify.js).
export const CATEGORY_APPLICABILITY = {
  'Гадуур хооллолт':            ['expense'],
  'Хүнсний зүйл':               ['expense'],
  'Тээвэр':                     ['expense'],
  'Орлого':                     ['income'],
  'Шилжүүлэг & гэр бүл':       ['income', 'expense'],
  'Захиалга & сервис':          ['expense'],
  'Боловсрол':                   ['expense'],
  'Чөлөөт цаг / зугаа цэнгэл':  ['expense'],
  'Хувцас / гоо сайхан':       ['expense'],
  'Бусад':                       ['income', 'expense'],
};

/**
 * Тухайн ангилал энэ төрлийн гүйлгээнд зөвшөөрөгдөх үү — ★ ганц эх сурвалж.
 * Picker (3 клиент) БА API-ийн баталгаажуулалт хоёул ЭНЭ функцээр шийднэ.
 *
 * ⚠️ FAIL-OPEN: metadata-гүй (шинээр нэмэгдсэн, хараахан бичигдээгүй) ангилал →
 * ХОЁУЛАНД зөвшөөрнө. Ингэснээр шинэ ангилал нэмэхэд metadata мартагдвал бүх
 * picker-ээс ЧИМЭЭГҮЙ алга болохгүй (алдаа нь харагдах ёстой, нуугдах биш).
 * type мэдэгдэхгүй (null/undefined/танихгүй) бол мөн зөвшөөрнө — шүүлт нь
 * мэдэгдэж буй type дээр л хатуу ажиллана.
 *
 * @param {string} category
 * @param {'income'|'expense'|null|undefined} type
 * @returns {boolean}
 */
export function isCategoryAllowedFor(category, type) {
  if (type !== 'income' && type !== 'expense') return true; // type тодорхойгүй → хязгаарлахгүй
  const allowed = CATEGORY_APPLICABILITY[category];
  if (!allowed) return true; // metadata алга → fail-open
  return allowed.includes(type);
}

/**
 * Тухайн төрөлд тохирох ангиллын жагсаалт (дараалал ХАДГАЛАГДАНА).
 * ⚠️ Bot-ууд ЭНЭ функцийг индекс кодлоход ШУУД ашиглаж БОЛОХГҮЙ — индекс
 * шилжинэ. Тэнд listCategoriesWithIndexFor()-г ашиглана.
 * @param {'income'|'expense'|null|undefined} type
 */
export function categoriesFor(type) {
  return CATEGORIES.filter((c) => isCategoryAllowedFor(c, type));
}

/**
 * ★ Bot-уудад ЗОРИУЛСАН: { category, index } хосууд — index нь БҮТЭН CATEGORIES
 * массив дахь ЖИНХЭНЭ байрлал (шүүлтийн дараах байрлал БИШ).
 *
 * ⚠️ Discord/Telegram нь сонгосон ангиллыг customId/callback_data дотор ИНДЕКСЭЭР
 * дамжуулж, CATEGORIES[idx]-ээр задалдаг. Хэрэв шүүсэн массивын шинэ индексийг
 * кодловол товч бүр БУРУУ ангилал илгээнэ (алдаа мэдэгдэхгүй, applyToAll нь
 * мерчантын бүх түүхэнд тараана). Тиймээс index-ийг ЭНД хамт буцаана.
 *
 * @param {'income'|'expense'|null|undefined} type
 * @returns {Array<{category: string, index: number}>}
 */
export function listCategoriesWithIndexFor(type) {
  return CATEGORIES
    .map((category, index) => ({ category, index }))
    .filter(({ category }) => isCategoryAllowedFor(category, type));
}

// type==='income' үед автоматаар оногдох ангилал
export const INCOME_CATEGORY = 'Орлого';

// Зөвхөн хэрэглэгч өөрөө сонгох ангилал (categorize автоматаар буцаахгүй)
export const DEFAULT_CATEGORY = 'Бусад';

// Keyword дүрмүүд (илүү тодорхой нь дээр). "Орлого", "Шилжүүлэг & гэр бүл",
// "Бусад" нь keyword биш — тусгай логикоор (categorize.js / classify.js).
export const CATEGORY_RULES = [
  {
    category: 'Гадуур хооллолт', // ресторан, кафе, fast food
    keywords: [
      'restaurant', 'rest', 'cafe', 'coffee', 'kfc', 'pizza', 'burger', 'food',
      'shulu', 'khool', 'hool', // ShuluBOM зэрэг ХЭРЭГЛЭГЧ ТАНЬСАН хоолны газар
    ],
  },
  {
    category: 'Хүнсний зүйл', // хүнсний дэлгүүр, маркет, супермаркет
    keywords: [
      'market', 'supermarket', 'mart', 'cu-', 'gs25', 'gs-25', 'circle', 'nomin',
      'emart', 'minii', 'delguur',
      // ⚠️ 'store'-г ОРУУЛААГҮЙ: Голомтын STOREBOM (таслагдсан, таниулашгүй)-той
      //    давхцаж буруу ангилахаас сэргийлэв. STOREBOM-ийг override-оор ангилна.
    ],
  },
  {
    category: 'Тээвэр', // шатахуун, такси, нийтийн тээвэр, машины засвар
    keywords: [
      'petrol', 'shell', 'magnai', 'shunkhlai', 'sod', 'taxi', 'ubcab',
      'transport', 'shatahuun', 'benzin',
    ],
  },
  {
    category: 'Захиалга & сервис', // апп, цэнэглэлт, интернет, цахим төлбөр
    keywords: [
      'netfl', 'netflix', 'spotify', 'youtube', 'icloud', 'apple', 'google',
      'amazon', 'socialpay', 'qpay', 'ezpay', 'mobicom', 'unitel', 'skytel',
      'gmobile', 'topup', 'internet', 'subscription', 'claud',
    ],
  },
  {
    category: 'Боловсрол', // сургалт, курс, ном, академи
    keywords: [
      'academy', 'amjilt', 'school', 'university', 'course', 'training',
      'surguuli', 'surgalt', 'book', 'nom',
    ],
  },
  {
    category: 'Чөлөөт цаг / зугаа цэнгэл', // кино, концерт, спорт, зугаа
    keywords: [
      'cinema', 'kino', 'urgoo', 'tengis', 'concert', 'game', 'gym', 'fitness',
      'spa', 'entertainment', 'zugaa',
    ],
  },
  {
    category: 'Хувцас / гоо сайхан', // хувцас, гутал, гоо сайхан, salon
    keywords: [
      'fashion', 'cloth', 'shoes', 'salon', 'beauty', 'cosmetic', 'huvtsas',
      'gutal', 'zassal',
    ],
  },
];

/**
 * Текстээс keyword дүрмээр ангилал тодорхойлох (танигдаагүй → null).
 * ★ src/categorize.js БА api/categorize.js хоёул эндээс дуудна — давхардлыг нэгтгэв.
 * "Орлого"/income-логик нь дуудагч талд (энэ функц зөвхөн keyword харна).
 * @param {string} text  description (+ raw)
 * @returns {string|null}
 */
export function matchByKeywords(text) {
  const hay = String(text || '').toLowerCase();
  if (!hay.trim()) return null;
  for (const rule of CATEGORY_RULES) {
    for (const kw of rule.keywords) {
      if (hay.includes(kw.toLowerCase())) return rule.category;
    }
  }
  return null;
}

// Хуучин (англи key) ангиллыг шинэ нэр рүү буулгах (нэг удаагийн миграцид).
// Утга/санааг хадгална — зөвхөн нэрийг шинэ 10-ангиллын схемд тааруулна.
export const OLD_TO_NEW = {
  food: 'Гадуур хооллолт', // энэ хэрэглэгчийн food override-ууд бүгд хоолны газар
  transport: 'Тээвэр',
  wallet: 'Захиалга & сервис',
  subscription: 'Захиалга & сервис',
  bills: 'Захиалга & сервис',
  transfer: 'Шилжүүлэг & гэр бүл',
  salary: 'Орлого',
  cash: 'Орлого',
  other: 'Бусад',
};

export default {
  CATEGORIES, CATEGORY_META, CATEGORY_RULES, matchByKeywords,
  CATEGORY_APPLICABILITY, isCategoryAllowedFor, categoriesFor, listCategoriesWithIndexFor,
  INCOME_CATEGORY, DEFAULT_CATEGORY, OLD_TO_NEW,
};
