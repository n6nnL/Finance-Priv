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
//
//  ★ ДЭД АНГИЛАЛ (018 миграц): `SUBCATEGORIES` (эцгийн id → дэд ангиллын жагсаалт)
//  + `subcategoriesFor()` / `subcategoryValid()`. Дэд ангилал нь DB-д МОНГОЛ
//  нэрээрээ хадгалагдана (ангиллынхтай ижил гэрээ). Автоматаар ХЭЗЭЭ Ч оногдохгүй —
//  зөвхөн override эсвэл хэрэглэгчийн тодорхой засвараар.
//
//  ★ ТОГТМОЛ id (019 refactor): ангилал бүр `CATEGORY_META[...].id` дээр богино
//  ASCII түлхүүртэй. Discord/Telegram нь товчны payload дотор ЭНЭ id-г дамжуулна
//  (өмнө нь массив дахь ИНДЕКС байсан). Тиймээс CATEGORIES-ийн дараалал өөрчлөгдөх/
//  дунд нь шинэ ангилал орох нь одоо болзошгүй БИШ — аюулгүй. Ангиллын нэр (label)
//  нь DB-д хадгалагдсан хэвээр; id нь ЗӨВХӨН payload-ын кодлол.
// ============================================================

// Бүх 12 ангилал (dropdown, валидаци, AI prompt-д). Дараалал хадгалагдсан.
// ⚠️ Шинэ ангилал ЗӨВХӨН ТӨГСГӨЛД нэмнэ (дунд нь БИШ) — дараалал нь UI-д
// харагдах эрэмбэ. Payload нь тогтмол id-ээр явдаг тул дундуур оруулах нь
// техникийн хувьд аюулгүй боловч хэрэглэгчийн нүдэнд товчнууд үсэрнэ.
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
  // ↓ 018-д нэмэгдсэн (шинэ id, ХУУЧНЫГ дахин ашиглаагүй)
  'Эрүүл мэнд',
  'Орон сууц & коммунал',
];

// Ангилал бүрийн metadata (★ ТОГТМОЛ id + emoji + hex) — ★ single source.
// Backend болон dashboard хоёул эндээс авна (format.js импортолдог) — нэрийг
// хоёр газар давхар бичихгүй. Зөвхөн канон 10 ангилал; танигдаагүйд default.
//
// ⚠️ `id` нь ТОГТМОЛ ГЭРЭЭ (bot-ын товчны payload-д кодлогдоно):
//   • ХЭЗЭЭ Ч бүү өөрчил/дахин ашигла — өөрчилбөл нислэг дунд байгаа бүх мэдэгдэл
//     тухайн ангиллаа алдана (fail-safe тул буруу ангилахгүй, зүгээр хуучирна).
//   • Богино ASCII байх ёстой: Telegram callback_data 64 БАЙТ, Discord customId
//     100 тэмдэгтийн ХАТУУ хязгаартай бөгөөд payload-д txnId зэрэг бусад талбар
//     аль хэдийн орсон байдаг.
//   • ЦЭВЭР ТОО байж БОЛОХГҮЙ — хуучин (индексээр кодлогдсон) payload-ыг ялгаж
//     таних чадвар яг үүн дээр тогтдог (доорх ID_TO_CATEGORY-ийн тайлбарыг үз).
export const CATEGORY_META = {
  'Гадуур хооллолт':            { id: 'dining',    emoji: '🍽️', hex: '#E8703A' },
  'Хүнсний зүйл':               { id: 'grocery',   emoji: '🛒', hex: '#4F9D69' },
  'Тээвэр':                     { id: 'transport', emoji: '🚗', hex: '#E0A33E' },
  'Орлого':                     { id: 'income',    emoji: '💰', hex: '#2E9E5B' },
  'Шилжүүлэг & гэр бүл':       { id: 'transfer',  emoji: '💸', hex: '#C2698F' },
  'Захиалга & сервис':          { id: 'subs',      emoji: '📱', hex: '#3FA9A0' },
  'Боловсрол':                   { id: 'edu',       emoji: '📚', hex: '#5566B5' },
  'Чөлөөт цаг / зугаа цэнгэл':  { id: 'leisure',   emoji: '🎬', hex: '#8B6FB8' },
  'Хувцас / гоо сайхан':       { id: 'apparel',   emoji: '👕', hex: '#D86A92' },
  'Бусад':                       { id: 'other',     emoji: '📦', hex: '#8A8275' },
  'Эрүүл мэнд':                  { id: 'health',    emoji: '🏥', hex: '#C05746' },
  'Орон сууц & коммунал':      { id: 'housing',   emoji: '🏠', hex: '#5B7B9A' },
};

// ---- id ↔ ангилал хос (★ Map — байрлалын таамаглал ОГТ ОРООГҮЙ) ----
// Модуль ачаалагдахад НЭГ УДАА бүтээгдэнэ. Map сонгосон шалтгаан: энгийн объект
// байсан бол `byId('constructor')` мэтийн prototype-ын түлхүүр утга буцаах эрсдэлтэй.
const ID_TO_CATEGORY = new Map();
const CATEGORY_TO_ID = new Map();
for (const category of CATEGORIES) {
  const id = CATEGORY_META[category]?.id;
  // Хөгжүүлэлтийн алдааг ЧИМЭЭГҮЙ өнгөрөөхгүй: id-гүй ангилал bot дээр товч болж
  // кодлогдох боломжгүй тул модуль ачаалахдаа шууд унана (код дээрх алдаа —
  // ажиллах үеийн өгөгдлөөс ХАМААРАХГҮЙ, тиймээс тест дээр л баригдана).
  if (typeof id !== 'string' || !id) {
    throw new Error(`config/categories.js: "${category}" ангилалд тогтмол id алга`);
  }
  if (ID_TO_CATEGORY.has(id)) {
    throw new Error(`config/categories.js: id давхардсан — "${id}"`);
  }
  ID_TO_CATEGORY.set(id, category);
  CATEGORY_TO_ID.set(category, id);
}

/**
 * ★ Тогтмол id → ангиллын нэр. Танихгүй бол `null` (ХЭЗЭЭ Ч таамаглахгүй).
 *
 * ⚠️ FAIL-SAFE: энэ функц массив руу ИНДЕКСЛЭХГҮЙ. Хуучин (deploy-ийн ӨМНӨ
 * илгээгдсэн) мэдэгдлийн товч нь индексээр кодлогдсон — тэнд `"4"` гэх ЦЭВЭР ТОО
 * ирнэ. Бүх id нь үсгэн (тоо БИШ) тул Map-д огт олдохгүй → `null` буцна →
 * дуудагч bot "мэдэгдэл хуучирсан" гэж эелдэг унана. Хэрэв энд `CATEGORIES[id]`
 * гэсэн fallback байсан бол хуучин товч ЧИМЭЭГҮЙ БУРУУ ангилал бичих байсан
 * (applyToAll нь мерчантын БҮХ түүхэнд тараана).
 *
 * @param {string} id
 * @returns {string|null}
 */
export function byId(id) {
  if (typeof id !== 'string') return null;
  return ID_TO_CATEGORY.get(id) ?? null;
}

/**
 * Ангиллын нэр → тогтмол id (танихгүй нэр → `null`).
 * @param {string} category
 * @returns {string|null}
 */
export function idFor(category) {
  if (typeof category !== 'string') return null;
  return CATEGORY_TO_ID.get(category) ?? null;
}

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
// ⚠️ Түлхүүр нь ангиллын НЭР (label) — DB-д хадгалагддаг яг тэр утга. Тогтмол
//    id нь CATEGORY_META дээр амьдардаг (энд давхардуулахгүй).
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
  // 018: хоёулаа ЗӨВХӨН ЗАРЛАГА (эмнэлгийн төлбөр, түрээс/коммунал нь орлого биш).
  // ⚠️ Энэ мөрийг бичихээ мартвал fail-open дүрмээр орлогын мөрөнд ч гарч ирнэ.
  'Эрүүл мэнд':                  ['expense'],
  'Орон сууц & коммунал':      ['expense'],
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
 * Нэрээр кодлодог UI (dashboard-ийн chip, Discord-ийн засварын select) энийг авна.
 * @param {'income'|'expense'|null|undefined} type
 */
export function categoriesFor(type) {
  return CATEGORIES.filter((c) => isCategoryAllowedFor(c, type));
}

/**
 * ★ Bot-уудад ЗОРИУЛСАН: { category, id } хосууд, дараалал ХАДГАЛАГДАНА.
 *
 * Discord/Telegram нь товчны payload дотор ЭНЭ `id`-г дамжуулж, `byId()`-ээр
 * задална. Массив дахь байрлал (index) ХААНА Ч кодлогдохгүй тул CATEGORIES-ийн
 * дараалал өөрчлөгдөх/шинэ ангилал дунд нь орох нь одоо БҮРЭН аюулгүй —
 * давталтын байрлалыг зөвхөн эгнээ таслахад ашиглана.
 *
 * @param {'income'|'expense'|null|undefined} type
 * @returns {Array<{category: string, id: string}>}
 */
export function listCategoriesWithIdFor(type) {
  return CATEGORIES
    .filter((category) => isCategoryAllowedFor(category, type))
    .map((category) => ({ category, id: CATEGORY_TO_ID.get(category) }));
}

// ============================================================
//  ДЭД АНГИЛАЛ (subcategory) — 018-д нэмэгдсэн, ★ single source
// ============================================================
//
//  Бүтэц: эцэг ангиллын ТОГТМОЛ id → эрэмбэлэгдсэн дэд ангиллын жагсаалт.
//  Дэд ангилал бүр өөрийн богино ascii `id` + монгол `label`-тай.
//
//  ⚠️ ХАДГАЛАЛТЫН ГЭРЭЭ (ангиллынхтай ЯГ ИЖИЛ): DB-д (`transactions.subcategory`,
//     `category_overrides.subcategory`) **МОНГОЛ LABEL** хадгална. `id` нь зөвхөн
//     config (болон хожмын bot payload)-д амьдарна — DB id ХЭЗЭЭ Ч хадгалахгүй.
//
//  ⚠️ id нь ЭЦЭГ ДОТРОО л давхардахгүй байхад хангалттай — түлхүүр нь
//     (эцгийн id, дэдийн id) ХОС. Тиймээс `transfer/family` ба `housing/rent`
//     зэрэг нь бие биедээ огт саад болохгүй.
//
//  ⚠️ ЖАГСААЛТАД ОРООГҮЙ АНГИЛАЛ = ДЭД АНГИЛАЛГҮЙ (хоосон массив) — энэ нь
//     ХЭВИЙН төлөв, алдаа БИШ. `other`/`apparel`/`edu`/`leisure` одоогоор хоосон.
//
//  ⚠️ ДЭД АНГИЛАЛ АВТОМАТААР ОНООГДОХГҮЙ. `matchByKeywords` дэд ангилал
//     МЭДЭХГҮЙ бөгөөд мэдэх ч ЁСГҮЙ. Гүйлгээнд дэд ангилал орох ганц хоёр зам:
//       (1) таарсан learned override дээр бичигдсэн байх (classify.js),
//       (2) хэрэглэгч ТОДОРХОЙ PATCH-аар оноох.
export const SUBCATEGORIES = {
  health: [
    { id: 'insurance',  label: 'Даатгал' },
    { id: 'clinic',     label: 'Эмнэлэг' },
    { id: 'pharmacy',   label: 'Эм/эмийн сан' },
    { id: 'dental',     label: 'Шүд' },
    { id: 'diagnostic', label: 'Оношилгоо' },
  ],
  housing: [
    { id: 'rent',     label: 'Түрээс/зээл' },
    { id: 'electric', label: 'Цахилгаан' },
    { id: 'heating',  label: 'Дулаан' },
    { id: 'water',    label: 'Ус' },
  ],
  dining: [
    { id: 'restaurant', label: 'Ресторан' },
    { id: 'cafe',       label: 'Кафе/кофе' },
    { id: 'delivery',   label: 'Хүргэлт' },
  ],
  grocery: [
    { id: 'supermarket', label: 'Супермаркет' },
    { id: 'store',       label: 'Дэлгүүр' },
    { id: 'market',      label: 'Зах' },
  ],
  transport: [
    { id: 'fuel',    label: 'Түлш' },
    { id: 'taxi',    label: 'Такси' },
    { id: 'transit', label: 'Нийтийн тээвэр' },
    { id: 'repair',  label: 'Засвар' },
  ],
  income: [
    { id: 'salary',  label: 'Цалин' },
    { id: 'loan',    label: 'Зээл' },
    { id: 'sidejob', label: 'Side job' },
    { id: 'gift',    label: 'Бэлэг/Буцаалт' },
  ],
  transfer: [
    { id: 'family',  label: 'Гэр бүл' },
    { id: 'friend',  label: 'Найз' },
    { id: 'savings', label: 'Хадгаламж руу' },
  ],
  subs: [
    { id: 'streaming',  label: 'Streaming' },
    { id: 'saas',       label: 'Апп/SaaS' },
    { id: 'membership', label: 'Гишүүнчлэл' },
  ],
};

// Модуль ачаалахад бүтцийн шалгалт (id-ийн дүрэм ангиллынхтай ижил).
for (const [parentId, subs] of Object.entries(SUBCATEGORIES)) {
  if (!ID_TO_CATEGORY.has(parentId)) {
    throw new Error(`config/categories.js: SUBCATEGORIES-ийн "${parentId}" эцэг ангилал байхгүй`);
  }
  const seenIds = new Set();
  const seenLabels = new Set();
  for (const { id, label } of subs) {
    if (typeof id !== 'string' || !id) throw new Error(`config/categories.js: ${parentId}-д id-гүй дэд ангилал`);
    if (typeof label !== 'string' || !label) throw new Error(`config/categories.js: ${parentId}/${id}-д label алга`);
    if (seenIds.has(id)) throw new Error(`config/categories.js: ${parentId}-д id давхардсан — "${id}"`);
    // Label нь DB-д хадгалагдах УТГА тул эцэг дотроо давхардвал ялгах боломжгүй болно
    if (seenLabels.has(label)) throw new Error(`config/categories.js: ${parentId}-д label давхардсан — "${label}"`);
    seenIds.add(id);
    seenLabels.add(label);
  }
}

/**
 * Эцэг ангиллын id → дэд ангиллын жагсаалт (эрэмбэ ХАДГАЛАГДАНА).
 * Дэд ангилалгүй / танихгүй эцэг → **хоосон массив** (throw хийхгүй, null биш).
 * @param {string} categoryId  ангиллын ТОГТМОЛ id (ж: 'health')
 * @returns {Array<{id: string, label: string}>}
 */
export function subcategoriesFor(categoryId) {
  if (typeof categoryId !== 'string') return [];
  return SUBCATEGORIES[categoryId] ? [...SUBCATEGORIES[categoryId]] : [];
}

/**
 * Ангилал (НЭР эсвэл id) → дэд ангиллын жагсаалт. API/DB давхарга нь НЭРТЭЙ
 * ажилладаг, config/bot нь id-тай — хоёуланг нь тэвчинэ (монгол нэр ба ascii id
 * хооронд давхцал үүсэх боломжгүй тул эргэлзээгүй).
 * @param {string} category  ангиллын нэр ('Эрүүл мэнд') ЭСВЭЛ id ('health')
 */
export function subcategoriesForCategory(category) {
  const id = idFor(category) ?? (byId(category) ? category : null);
  return id ? subcategoriesFor(id) : [];
}

/**
 * ★ Дэд ангилал тухайн ангилалд ХАРЬЯАЛАГДАХ уу — ганц предикат.
 * API-ийн баталгаажуулалт БА (хожим) клиентүүд ЭНЭ функцээр шийднэ.
 *
 * ⚠️ FAIL-CLOSED (ангиллын applicability-гээс ЯЛГААТАЙ): танихгүй ангилал,
 * дэд ангилалгүй ангилал, эсвэл харьяалагдахгүй нэр → `false`. Учир нь энд
 * "мэдэхгүй бол зөвшөөр" гэдэг нь ямар ч утга DB-д орохыг зөвшөөрөх тул
 * гэрээ (subcategory ⊂ category) алдагдана.
 *
 * @param {string} category  ангиллын нэр ЭСВЭЛ id
 * @param {string} subLabel  дэд ангиллын МОНГОЛ нэр (DB-д хадгалагддаг утга)
 * @returns {boolean}
 */
export function subcategoryValid(category, subLabel) {
  if (typeof subLabel !== 'string' || !subLabel) return false;
  return subcategoriesForCategory(category).some((s) => s.label === subLabel);
}

/**
 * Дэд ангиллын id → түүний МОНГОЛ нэр (эцэг дотор). Танихгүй → `null`.
 * (Prompt 3-ын bot payload-д хэрэгтэй болно.)
 */
export function subcategoryLabel(categoryId, subId) {
  const hit = subcategoriesFor(categoryId).find((s) => s.id === subId);
  return hit ? hit.label : null;
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
  CATEGORY_APPLICABILITY, isCategoryAllowedFor, categoriesFor, listCategoriesWithIdFor,
  byId, idFor, INCOME_CATEGORY, DEFAULT_CATEGORY, OLD_TO_NEW,
  SUBCATEGORIES, subcategoriesFor, subcategoriesForCategory, subcategoryValid, subcategoryLabel,
};
