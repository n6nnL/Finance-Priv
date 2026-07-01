// ============================================================
//  lib/budget.js — Календарь + Төсвийн цэвэр логик (React-гүй, тестлэгдэх)
//
//  Бүх огнооны/циклийн тооцоо ЭНД. Компонентод огнооны логик бичихгүй.
//
//  ⚠️ САНХҮҮГИЙН УТГА ЭНД ХАТУУ БИЧИГДЭХГҮЙ. Цалин/ханш/захиалга/хуваарилалт
//  бүгд хэрэглэгчийн сервер дэх тохиргооноос (`settings`) дамжина. Доорх функцууд
//  settings-г параметрээр авна.
// ============================================================

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

/** USD → MNT (өгөгдсөн ханшаар). */
export function usdToMnt(usd, rate) {
  return Math.round((Number(usd) || 0) * (Number(rate) || 0));
}

/**
 * Цалингийн өдөр: тохируулсан `paydayDay` (1–28). Хэрэв тэр өдөр амралтын
 * (Бямба/Ням) бол ажлын өдөр хүртэл УХАРНА (14, 13, …). guard нь backward
 * walk-ийг хязгаарлаж infinite loop-аас хамгаална. monthIndex 0-based.
 * @returns {Date}
 */
export function paydayFor(year, monthIndex, paydayDay = 15) {
  const day = Math.min(Math.max(Math.trunc(Number(paydayDay) || 15), 1), 28);
  const d = new Date(year, monthIndex, day);
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
export function getCycle(year, monthIndex, paydayDay = 15) {
  const start = paydayFor(year, monthIndex, paydayDay);
  const ny = monthIndex === 11 ? year + 1 : year;
  const nm = monthIndex === 11 ? 0 : monthIndex + 1;
  const end = paydayFor(ny, nm, paydayDay);
  return { start, end };
}

/** date ([Date|'YYYY-MM-DD']) нь [start, end) циклийн цонхонд багтах эсэх. */
export function isWithinCycle(date, start, end) {
  const t = (date instanceof Date ? date : parseYmd(date)).getTime();
  return t >= start.getTime() && t < end.getTime();
}

/**
 * Тухайн сарын payday marker (ногоон). Цалин (amountMnt) нь тохиргооноос;
 * хараахан оруулаагүй бол null (хуурамч тоо ХАРУУЛАХГҮЙ — зөвхөн огноо).
 */
export function incomeMarker(year, monthIndex, settings) {
  const d = paydayFor(year, monthIndex, settings?.paydayDay);
  const salary = settings?.salaryAmount;
  return {
    id: `income-${ymd(d)}`, type: 'income', title: 'Цалин',
    date: ymd(d), amountMnt: salary == null ? null : salary, recurring: true,
  };
}

/** Захиалгыг (settings.subscriptions) тухайн оны/сарын marker болгох (шар). */
function subToMarker(sub, year, monthIndex, usdMnt) {
  const day = Math.min(Math.max(Math.trunc(Number(sub.day) || 1), 1), 28);
  const d = new Date(year, monthIndex, day);
  return {
    id: `sub-${sub.name}-${ymd(d)}`, type: 'subscription', title: sub.name, date: ymd(d),
    amountUsd: sub.amountUsd, amountMnt: usdToMnt(sub.amountUsd, usdMnt), recurring: true,
  };
}

/** Тухайн сарын захиалгын marker-ууд (шар). */
export function subscriptionMarkers(year, monthIndex, settings) {
  const subs = settings?.subscriptions || [];
  return subs.map((s) => subToMarker(s, year, monthIndex, settings?.usdMnt));
}

/**
 * Циклийн цонхонд (payday→payday) багтах захиалгын тохиолдлууд.
 * Цикл нь 2 хуанлийн сард тэлдэг тул start/end-ийн сарууд дээр scan хийнэ.
 */
export function cycleSubscriptions({ start, end }, settings) {
  const subs = settings?.subscriptions || [];
  const usdMnt = settings?.usdMnt;
  const months = [
    { y: start.getFullYear(), m: start.getMonth() },
    { y: end.getFullYear(), m: end.getMonth() },
  ];
  const out = [];
  for (const s of subs) {
    for (const { y, m } of months) {
      const mk = subToMarker(s, y, m, usdMnt);
      if (isWithinCycle(mk.date, start, end)) out.push(mk);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Тухайн сарын бүх marker (payday + захиалга + хувийн event). */
export function monthMarkers(year, monthIndex, settings, personalEvents = []) {
  const inMonth = (dateStr) => {
    const d = parseYmd(dateStr);
    return d.getFullYear() === year && d.getMonth() === monthIndex;
  };
  return [
    incomeMarker(year, monthIndex, settings),
    ...subscriptionMarkers(year, monthIndex, settings),
    ...personalEvents
      .filter((e) => inMonth(e.date))
      .map((e) => ({ ...e, type: 'personal', eventId: e.id, id: e.id != null ? `ev-${e.id}` : `ev-${e.date}-${e.title}` })),
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
