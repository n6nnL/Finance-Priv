// ============================================================
//  config/transactionActions.js — гүйлгээн дээр хийж болох ҮЙЛДЛИЙН дундын логик
//  (categories.js-ийн "single source" загварыг үйлдлийн капабилити дээр хэрэглэв)
//
//  Discord / Telegram / Website ГУРВУУЛАА эндээс уншина:
//    • аль үйлдэл боломжтой (availableActions)
//    • POS эсэхээс хамаарч ЯМАР талбар асуух (detailFieldFor):
//        is_pos → "Газрын нэр" (merchant_place), бусад → "Шалтгаан" (note)
//    • applyToAll (learned override) аль үйлдэлд, ямар баталгаажуулалттай
//
//  Энд ОРОХГҮЙ: өнгө, товчны байрлал, API дуудлагын нарийн ширийн — тэдгээр нь
//  client бүрийн рендерийн асуудал. Модуль нь Node (bot/backend) БА Vite
//  (frontend) хоёуланд импортлогдоно — цэвэр, dependency-гүй функц ЛГХЭ.
//
//  ⚠️ applyToAll = default OFF. Зөвхөн setCategory дэмжинэ, мөн хэрэглэгч
//  APPLY_TO_ALL_CONFIRM.question-д ТОДОРХОЙ "тийм" гэж хариулсан үед л
//  client applyToAll=true явуулна. Дан талбарын засвар (setPlace/setNote)
//  override-д ХЭЗЭЭ Ч хүрэхгүй.
// ============================================================

// Үйлдлийн нэрс (client-үүд string harcode хийхгүй, эндээс авна)
export const ACTION_SET_CATEGORY = 'setCategory';
export const ACTION_SET_PLACE = 'setPlace'; // POS → merchant_place
export const ACTION_SET_NOTE = 'setNote'; // бусад → note

/**
 * POS гүйлгээ мөн үү — DB-д 0/1 (INTEGER), listener талд boolean байж
 * болно тул хоёуланг хүлээн зөвшөөрнө. Client бүр өөрөө шийдэхгүй.
 * @param {{is_pos?: number|boolean}} txn
 */
export function isPosTxn(txn) {
  return txn?.is_pos === 1 || txn?.is_pos === true;
}

/**
 * Ангилагдаагүй (баталгаажуулах хүлээж буй) мөн үү — Discord/Telegram-ийн
 * notify давхардуулж бичдэг байсан шалгалтын нэг эх сурвалж.
 * @param {{status?: string, category?: string|null}} txn
 */
export function isPendingTxn(txn) {
  return txn?.status === 'pending_review' || txn?.category == null;
}

/**
 * applyToAll-ийн баталгаажуулалтын ИЖИЛ утгатай текст (гурван client).
 * Client рендерээ өөрөө сонгоно (checkbox / товч / дараалсан асуулт) —
 * гэхдээ асуулт, тийм/үгүй-ийн утга эндээс гарна.
 */
export const APPLY_TO_ALL_CONFIRM = {
  question: 'Дараагийн бүх ижил мерчантад хэрэглэх үү?',
  hint: 'Тийм гэвэл энэ мерчантын өмнөх бүх гүйлгээ өөрчлөгдөж, цаашид автоматаар ийм ангилалтай болно.',
  yesLabel: 'Тийм',
  noLabel: 'Үгүй',
};

/**
 * POS эсэхээс хамаарсан НЭГ дэлгэрэнгүй талбар:
 *   POS   → setPlace ("Газрын нэр", merchant_place)
 *   бусад → setNote  ("Шалтгаан", note)
 * apiField = PATCH body-ийн түлхүүр, rowField = DB мөрийн багана.
 * @param {object} txn
 */
export function detailFieldFor(txn) {
  if (isPosTxn(txn)) {
    return {
      action: ACTION_SET_PLACE,
      valueKind: 'text',
      apiField: 'merchantPlace',
      rowField: 'merchant_place',
      label: 'Газрын нэр',
      question: 'Ямар газар вэ?',
      placeholder: 'жишээ: Шулуун дун',
      maxLength: 200,
      supportsApplyToAll: false,
      current: txn?.merchant_place ?? null,
    };
  }
  return {
    action: ACTION_SET_NOTE,
    valueKind: 'text',
    apiField: 'note',
    rowField: 'note',
    label: 'Шалтгаан',
    question: 'Юунд зориулсан бэ?',
    placeholder: 'жишээ: Ээжид сарын мөнгө',
    maxLength: 200,
    supportsApplyToAll: false,
    current: txn?.note ?? null,
  };
}

/**
 * Нэг гүйлгээн дээр боломжтой үйлдлүүд. Classified мөрөнд ч ангилал ДАХИН
 * өөрчилж болно (pending/classified нь зөвхөн шошгонд нөлөөлнө, боломжийг
 * хаахгүй). setCategory ҮРГЭЛЖ supportsApplyToAll: true — гэхдээ default OFF,
 * баталгаажуулалт нь APPLY_TO_ALL_CONFIRM-оор (дээрх толгойн тайлбар).
 * @param {object} txn
 * @returns {Array<object>}
 */
export function availableActions(txn) {
  return [
    {
      action: ACTION_SET_CATEGORY,
      valueKind: 'category',
      label: isPendingTxn(txn) ? 'Ангилал сонгох' : 'Ангилал өөрчлөх',
      current: txn?.category ?? null,
      supportsApplyToAll: true,
    },
    detailFieldFor(txn),
  ];
}

/**
 * Нэрээр нь үйлдэл олох (client-ийн switch-г таслах туслах).
 * @param {object} txn
 * @param {string} action
 */
export function findAction(txn, action) {
  return availableActions(txn).find((a) => a.action === action) ?? null;
}

export default {
  ACTION_SET_CATEGORY, ACTION_SET_PLACE, ACTION_SET_NOTE,
  APPLY_TO_ALL_CONFIRM,
  isPosTxn, isPendingTxn, detailFieldFor, availableActions, findAction,
};
