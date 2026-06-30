// ============================================================
//  lib/budget.js — Календарь + Төсвийн цэвэр логик (React-гүй, тестлэгдэх)
//
//  Бүх огнооны/циклийн тооцоо ЭНД. Компонентод огнооны логик бичихгүй.
//  Дараа Google Calendar-аас баяр/event нэмэгдэхэд marker shape нэг хэвээр
//  үлдэх тул гадны эх сурвалжийг merge хийхэд хялбар.
// ============================================================

// USD→MNT ханш — НЭГ газар. Дараа live болгож болно.
export const USD_MNT = 3578;

// Цалингийн дүн (MNT) — placeholder тогтмол. Дараа бодит орлогоос авч болно.
export const SALARY_MNT = 3000000;

// Тогтмол сарын захиалгууд (USD-ээр). day = сарын өдөр.
export const SUBSCRIPTIONS = [
  { id: 'sub-netflix', title: 'Netflix', day: 7, amountUsd: 3.99 },
  { id: 'sub-claude', title: 'Claude', day: 25, amountUsd: 20 },
];

const pad = (n) => String(n).padStart(2, '0');

/** Date → 'YYYY-MM-DD' (орон нутгийн цаг; sub-day нарийвчлал хэрэггүй). */
export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' → Date (орон нутгийн 00:00). */
export function parseYmd(s) {
  return new Date(String(s) + 'T00:00:00');
}

/** Бямба(6)/Ням(0) эсэх. */
export function isWeekend(d) {
  const g = d.getDay();
  return g === 0 || g === 6;
}

const usdToMnt = (usd) => Math.round(usd * USD_MNT);

/**
 * Цалингийн өдөр: сарын 15. Хэрэв 15 нь амралтын өдөр бол ажлын өдөр хүртэл
 * ухарна (14, 13, …). Энэ хувилбарт зөвхөн амралтын өдрийг шалгана (баяр
 * дараа Google-аас ирнэ). monthIndex 0-based (Date.getMonth()-тэй ижил).
 * @returns {Date}
 */
export function paydayFor(year, monthIndex) {
  const d = new Date(year, monthIndex, 15);
  let guard = 0;
  while (isWeekend(d) && guard < 7) {
    d.setDate(d.getDate() - 1);
    guard++;
  }
  return d;
}

/**
 * Нэг пэй цикл = энэ сарын payday → дараа сарын payday.
 * end нь дараагийн циклд хамаарна (exclusive).
 * @returns {{ start: Date, end: Date }}
 */
export function getCycle(year, monthIndex) {
  const start = paydayFor(year, monthIndex);
  const ny = monthIndex === 11 ? year + 1 : year;
  const nm = monthIndex === 11 ? 0 : monthIndex + 1;
  const end = paydayFor(ny, nm);
  return { start, end };
}

/** date ([Date|'YYYY-MM-DD']) нь [start, end) циклийн цонхонд багтах эсэх. */
export function isWithinCycle(date, start, end) {
  const t = (date instanceof Date ? date : parseYmd(date)).getTime();
  return t >= start.getTime() && t < end.getTime();
}

/** Тухайн сарын payday marker (ногоон). */
export function incomeMarker(year, monthIndex) {
  const d = paydayFor(year, monthIndex);
  return {
    id: `income-${ymd(d)}`, type: 'income', title: 'Цалин',
    date: ymd(d), amountMnt: SALARY_MNT, recurring: true,
  };
}

/** Тухайн сарын захиалгын marker-ууд (шар). */
export function subscriptionMarkers(year, monthIndex) {
  return SUBSCRIPTIONS.map((s) => {
    const d = new Date(year, monthIndex, s.day);
    return {
      id: `${s.id}-${ymd(d)}`, type: 'subscription', title: s.title, date: ymd(d),
      amountUsd: s.amountUsd, amountMnt: usdToMnt(s.amountUsd), recurring: true,
    };
  });
}

/**
 * Циклийн цонхонд (payday→payday) багтах захиалгын тохиолдлууд.
 * Цикл нь 2 хуанлийн сард тэлдэг тул start/end-ийн сарууд дээр scan хийнэ.
 */
export function cycleSubscriptions({ start, end }) {
  const months = [
    { y: start.getFullYear(), m: start.getMonth() },
    { y: end.getFullYear(), m: end.getMonth() },
  ];
  const out = [];
  for (const s of SUBSCRIPTIONS) {
    for (const { y, m } of months) {
      const d = new Date(y, m, s.day);
      if (isWithinCycle(d, start, end)) {
        out.push({
          id: `${s.id}-${ymd(d)}`, type: 'subscription', title: s.title, date: ymd(d),
          amountUsd: s.amountUsd, amountMnt: usdToMnt(s.amountUsd), recurring: true,
        });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Тухайн сарын бүх marker (payday + захиалга + хувийн event). */
export function monthMarkers(year, monthIndex, personalEvents = []) {
  const inMonth = (dateStr) => {
    const d = parseYmd(dateStr);
    return d.getFullYear() === year && d.getMonth() === monthIndex;
  };
  return [
    incomeMarker(year, monthIndex),
    ...subscriptionMarkers(year, monthIndex),
    ...personalEvents.filter((e) => inMonth(e.date)),
  ].sort((a, b) => a.date.localeCompare(b.date));
}

/** Сарын нэр (Монгол) — гарчигт. */
export const MONTHS_MN = [
  '1-р сар', '2-р сар', '3-р сар', '4-р сар', '5-р сар', '6-р сар',
  '7-р сар', '8-р сар', '9-р сар', '10-р сар', '11-р сар', '12-р сар',
];

/** Долоо хоногийн өдрүүд — Даваагаар эхэлнэ. */
export const WEEKDAYS_MN = ['Дав', 'Мяг', 'Лха', 'Пүр', 'Баа', 'Бям', 'Ням'];

/** Даваа=0 … Ням=6 болгож хувиргах (grid offset). */
export function mondayIndex(d) {
  return (d.getDay() + 6) % 7;
}
