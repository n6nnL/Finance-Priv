// ============================================================
//  balanceHistory.js — Үлдэгдлийн түүхийн сэргээлт (backward/forward reconstruction)
//
//  budgetCycle.js-тэй адил: цэвэр функц (DB/HTTP-ээс тусгаарлагдсан, тестлэгдэх).
//  Гэхдээ энд өдрийг ЗААВАЛ UTC+8 (Ulaanbaatar) offset-оор тооцно — сервер/тестийн
//  орчны OS timezone-оос үл хамааран тогтвортой байлгах зорилготой (budgetCycle.js
//  нь prod дээр timedatectl-ээр Asia/Ulaanbaatar тохируулсан гэдэгт найддаг;
//  энд илүү бат бөх, орчноос үл хамаарах хандлага ашиглав).
//
//  Reconstruction: balance(day) = anchorBalance + prefix(day) - prefix(anchorDate)
//  (prefix = rangeStart-ээс тухайн өдөр хүртэлх cumulative цэвэр өөрчлөлтийн
//  нийлбэр). day <= anchorDate үед энэ нь "ухраад хасах" (spec-ийн томьёо) БОЛНО;
//  day > anchorDate үед л мэдэгдэж буй бодит гүйлгээгээр урагшлуулна (anchor нь
//  ихэвчлэн хамгийн сүүлийн гүйлгээ тул энэ тохиолдол ховор).
// ============================================================

const pad = (n) => String(n).padStart(2, '0');
const DAY_MS = 86400000;
const UB_OFFSET_MS = 8 * 3600 * 1000;

function toEpochDay(ymdStr) {
  const m = String(ymdStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
}
function fromEpochDay(epochDay) {
  const d = new Date(epochDay * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Дурын Date instant → УБ-ийн (UTC+8) огноо 'YYYY-MM-DD'. Сервер/тестийн OS TZ-ээс үл хамаарна. */
export function ubYmd(now = new Date()) {
  const shifted = new Date(now.getTime() + UB_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** ymd + n хоног (n сөрөг байж болно). */
export function addDaysYmd(ymdStr, n) {
  return fromEpochDay(toEpochDay(ymdStr) + n);
}

/** [from, to] хоёуланг оролцуулсан өдрийн жагсаалт (ascending, YYYY-MM-DD). */
export function enumerateDays(from, to) {
  const a = toEpochDay(from);
  const b = toEpochDay(to);
  if (Number.isNaN(a) || Number.isNaN(b) || a > b) return [];
  const out = [];
  for (let e = a; e <= b; e++) out.push(fromEpochDay(e));
  return out;
}

/**
 * Anchor (сүүлийн мэдэгдэж буй бодит үлдэгдэл)-аас [from, to] мужид өдөр тутмын
 * үлдэгдлийг сэргээнэ. Мэдэгдэж буй гүйлгээгээр л тооцно — ХЭЗЭЭ Ч тоо зохиохгүй.
 * @param {{ anchorDate: string, anchorBalance: number, dailyNetMap: Map<string,number>, from: string, to: string }} args
 *   dailyNetMap: тухайн өдрийн цэвэр өөрчлөлт (орлого - зарлага); гүйлгээгүй өдөр 0 гэж үзнэ.
 * @returns {{date:string, balance:number}[]}
 */
export function reconstructBalanceSeries({ anchorDate, anchorBalance, dailyNetMap, from, to }) {
  const rangeStart = from < anchorDate ? from : anchorDate;
  const rangeEnd = to > anchorDate ? to : anchorDate;
  const rangeDays = enumerateDays(rangeStart, rangeEnd);
  const prefix = new Map();
  let running = 0;
  for (const d of rangeDays) {
    running += dailyNetMap.get(d) || 0;
    prefix.set(d, running);
  }
  const anchorPrefix = prefix.get(anchorDate) ?? 0;
  return enumerateDays(from, to).map((day) => ({
    date: day,
    balance: Math.round((anchorBalance + (prefix.get(day) ?? 0) - anchorPrefix) * 100) / 100,
  }));
}

/**
 * [from, to] цонхонд >2 дараалсан өдөр ЯМАР Ч гүйлгээгүй мөчүүдийг илрүүлнэ
 * (Gmail listener-ийн downtime-ийн улмаас тухайн хугацааны сэргээлт алдаатай
 * байж болзошгүйг тэмдэглэхэд). READ-ONLY — зөвхөн тэмдэглэнэ, дүн засахгүй.
 * @param {{ from: string, to: string, daysWithTxn: Set<string> }} args
 * @returns {{start:string, end:string}[]}
 */
export function detectGaps({ from, to, daysWithTxn }) {
  const days = enumerateDays(from, to);
  const gaps = [];
  let runStart = null;
  const flush = (endDay) => {
    if (runStart == null) return;
    const len = toEpochDay(endDay) - toEpochDay(runStart) + 1;
    if (len > 2) gaps.push({ start: runStart, end: endDay });
    runStart = null;
  };
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    if (!daysWithTxn.has(d)) {
      if (runStart == null) runStart = d;
    } else {
      flush(days[i - 1]);
    }
  }
  if (days.length) flush(days[days.length - 1]);
  return gaps;
}

export default { ubYmd, addDaysYmd, enumerateDays, reconstructBalanceSeries, detectGaps };
