// ============================================================
//  balanceAlert.js — Үлдэгдэл (Үлдэгдэл) талбарын parse-ийн ажиглалт
//
//  Ганц имэйл дээр Үлдэгдэл задрахгүй байх нь хэвийн (Голомтын зарим
//  загварт байхгүй байж болно) тул ганц miss дээр сэрэмжлүүлэхгүй.
//  Харин ЗАЛГААГҮЙ N удаа дараалж задрахгүй бол имэйл загвар өөрчлөгдсөн
//  байж магадгүй тул notifyError('balance-parse-drift')-оор ops-д мэдэгдэнэ
//  (notifyOps өөрөө 15 минутын debounce-той — src/ops-notify.js).
// ============================================================

import { notifyError } from './logger.js';

export const BALANCE_MISS_THRESHOLD = 5;

let consecutiveMisses = 0;

/**
 * Гүйлгээ бүрийн Үлдэгдэл parse амжилттай эсэхийг бүртгэнэ.
 * @param {boolean} success  tx.balance != null эсэх
 * @param {{ notify?: typeof notifyError }} [opts] тест дотор notifyError-г mock хийхэд
 */
export function trackBalanceParse(success, { notify = notifyError } = {}) {
  if (success) {
    consecutiveMisses = 0;
    return;
  }
  consecutiveMisses += 1;
  if (consecutiveMisses >= BALANCE_MISS_THRESHOLD) {
    notify(
      'balance-parse-drift',
      new Error(`Үлдэгдэл талбар ${consecutiveMisses} дараалсан гүйлгээнд задрахгүй байна — имэйл загвар өөрчлөгдсөн байж болзошгүй`)
    );
    consecutiveMisses = 0; // дараагийн batch хүртэл давтан сэрэмжлүүлэхгүй
  }
}

/** Тест/оношлогоонд: дотоод counter-г цэвэрлэх. */
export function _resetBalanceAlertState() {
  consecutiveMisses = 0;
}

export default { trackBalanceParse, BALANCE_MISS_THRESHOLD, _resetBalanceAlertState };
