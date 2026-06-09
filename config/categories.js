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

export default { CATEGORIES, CATEGORY_RULES, INCOME_CATEGORY, DEFAULT_CATEGORY, OLD_TO_NEW };
