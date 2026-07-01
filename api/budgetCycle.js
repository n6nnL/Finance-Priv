// ============================================================
//  budgetCycle.js — циклийн огнооны хүрээ (server-side, цэвэр, тестлэгдэх)
//
//  Цикл = цалингийн өдрөөс (anchor day, default 15) дараагийн цалин хүртэл.
//  Хил: [start inclusive, end exclusive) — нэг гүйлгээ зөвхөн нэг циклд (давхцал
//  ҮГҮЙ). Frontend dashboard/src/lib/budget.js-ийн paydayFor-той ИЖИЛ дүрэм:
//  anchor day амралтын өдөр (Бямба/Ням) дээр буувал ажлын өдөр хүртэл УХАРНА.
//
//  Огноог зөвхөн ӨДРИЙН нарийвчлалаар ('YYYY-MM-DD') ажиллана — txn_date нь UB
//  орон нутгийн өдрийн утга тул цаг/timezone-ийн хямрал үүсэхгүй. Date-ийг local
//  бүрэлдэхүүнээр (getFullYear/Month/Date) тууштай форматлана.
// ============================================================

const pad = (n) => String(n).padStart(2, '0');

/** Date → 'YYYY-MM-DD' (local бүрэлдэхүүн). */
export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isWeekend(d) {
  const g = d.getDay();
  return g === 0 || g === 6;
}

/**
 * Цалингийн өдөр. anchorDay (1–28); амралтын өдөр бол ажлын өдөр хүртэл ухарна.
 * guard нь backward walk-ийг хязгаарлаж infinite loop-аас сэргийлнэ.
 * @returns {Date} local midnight
 */
export function paydayFor(year, monthIndex, anchorDay = 15) {
  const day = Math.min(Math.max(Math.trunc(Number(anchorDay) || 15), 1), 28);
  const d = new Date(year, monthIndex, day);
  let guard = 0;
  while (isWeekend(d) && guard < 7) {
    d.setDate(d.getDate() - 1);
    guard++;
  }
  return d;
}

/**
 * `now`-г агуулсан идэвхтэй цикл. now >= энэ сарын payday бол [payday, дараа сар);
 * үгүй бол [өмнөх сар, энэ сарын payday).
 * @returns {{ start: string, end: string, anchorDay: number }} ('YYYY-MM-DD')
 */
export function currentCycle(now = new Date(), anchorDay = 15) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const thisPay = paydayFor(y, m, anchorDay);
  // Зөвхөн өдрөөр харьцуулах (цагийн нөлөөг арилгана).
  const today = ymd(now);
  let start;
  let end;
  if (today >= ymd(thisPay)) {
    start = thisPay;
    const nm = m === 11 ? 0 : m + 1;
    const ny = m === 11 ? y + 1 : y;
    end = paydayFor(ny, nm, anchorDay);
  } else {
    const pm = m === 0 ? 11 : m - 1;
    const py = m === 0 ? y - 1 : y;
    start = paydayFor(py, pm, anchorDay);
    end = thisPay;
  }
  return { start: ymd(start), end: ymd(end), anchorDay: Math.min(Math.max(Math.trunc(Number(anchorDay) || 15), 1), 28) };
}
