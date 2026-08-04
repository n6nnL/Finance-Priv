// ============================================================
//  lib/debt.js — Өр төлбөрийн цэвэр логик (React-гүй, тестлэгдэх)
//
//  Хүн бүрийн, ВАЛЮТ ТУС БҮРИЙН цэвэр үлдэгдлийн бүх тооцоо ЭНД.
//  Компонент дотор өрийн арифметик бичихгүй (budget.js-ийн загвар).
//
//  ⚠️ MNT ба EUR-ийг ХЭЗЭЭ Ч нэг тоонд нийлүүлж цэвэршүүлэхгүй — хүн танд
//  50,000₮ өртэй бөгөөд та түүнд 20 EUR өртэй байж болно, эдгээр нь ӨӨР
//  өр. Хөрвүүлэлт зөвхөн ХАРУУЛАХ (display) үед, амьд ханшаар, тусад нь.
//  Ханш байхгүй бол хөрвүүлэлт хийхгүй (null) — хуурамч тоо ХЭЗЭЭ Ч гаргахгүй.
// ============================================================

/** Нээлттэй бичлэгийн тэмдэгтэй дүн: i_lent → эерэг (тэр өртэй), i_borrowed → сөрөг. */
export function signedAmount(entry) {
  const amt = Number(entry?.amount) || 0;
  return entry?.direction === 'i_lent' ? amt : -amt;
}

/**
 * Хүн × валют тус бүрийн цэвэр үлдэгдэл. ЗӨВХӨН status='open' бичлэг ороно
 * (хаагдсан өр үлдэгдэлд нөлөөлөхгүй). Тэг болж цэвэршсэн хосыг буцаахгүй.
 * Backend-ийн /debt-ledger/balances-тай ИЖИЛ дүрэм (frontend дахин тооцох
 * шаардлагатай үед — ж: optimistic update — зөрөхгүй байх баталгаа).
 * @param {Array} entries
 * @returns {{counterparty:string, currency:string, net:number, direction:string}[]}
 */
export function netBalances(entries) {
  // ⚠️ Нэр дотор зай байж болно ("Ээж эгч") тул түлхүүрийг задалж эргүүлэн
  // уншихгүй — задлагдсан утгыг Map-ийн VALUE-д хадгална.
  const map = new Map();
  for (const e of entries || []) {
    if (!e || e.status !== 'open') continue;
    const counterparty = String(e.counterparty || '').trim();
    if (!counterparty) continue;
    const currency = e.currency === 'EUR' ? 'EUR' : 'MNT';
    const key = `${currency} ${counterparty}`;
    const prev = map.get(key);
    if (prev) prev.net += signedAmount(e);
    else map.set(key, { counterparty, currency, net: signedAmount(e) });
  }
  const out = [];
  for (const b of map.values()) {
    if (b.net === 0) continue; // бүрэн цэвэршсэн — өр үлдээгүй
    out.push({ ...b, direction: b.net > 0 ? 'i_lent' : 'i_borrowed' });
  }
  out.sort((a, b) => a.counterparty.localeCompare(b.counterparty) || a.currency.localeCompare(b.currency));
  return out;
}

/**
 * Хүн бүрээр бүлэглэсэн үлдэгдэл (UI-д нэг хүн = нэг карт, дотор нь валютууд).
 * @returns {{counterparty:string, lines:{currency,net,direction}[]}[]}
 */
export function groupByCounterparty(balances) {
  const map = new Map();
  for (const b of balances || []) {
    if (!map.has(b.counterparty)) map.set(b.counterparty, []);
    map.get(b.counterparty).push({ currency: b.currency, net: b.net, direction: b.direction });
  }
  return [...map.entries()]
    .map(([counterparty, lines]) => ({ counterparty, lines }))
    .sort((a, b) => a.counterparty.localeCompare(b.counterparty));
}

/**
 * Нийт дүр зураг: надад хэдэн төгрөг/евро ирэх ба хэдийг өгөх вэ (валют тусад).
 * @returns {{MNT:{owedToMe:number, iOwe:number}, EUR:{owedToMe:number, iOwe:number}}}
 */
export function totalsByCurrency(balances) {
  const zero = () => ({ owedToMe: 0, iOwe: 0 });
  const out = { MNT: zero(), EUR: zero() };
  for (const b of balances || []) {
    const bucket = out[b.currency] || (out[b.currency] = zero());
    if (b.net > 0) bucket.owedToMe += b.net;
    else bucket.iOwe += -b.net;
  }
  return out;
}

/**
 * EUR дүнг MNT-ээр ХАРУУЛАХ (зөвхөн display). Ханш байхгүй/буруу бол null —
 * дуудагч тал "≈" мөрийг харуулахгүй (хуурамч тоо гаргахаас сэргийлнэ).
 * @param {number} amount  EUR дүн
 * @param {number|null|undefined} eurMnt  амьд эсвэл кэшлэгдсэн ханш
 * @returns {number|null}
 */
export function eurToMntDisplay(amount, eurMnt) {
  const rate = Number(eurMnt);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  // ⚠️ null/undefined-ийг тодорхой таслана — Number(null)===0 тул эс бөгөөс
  // "дүн байхгүй" гэдгийг "0₮" гэж ХУДАЛ харуулна.
  if (amount == null) return null;
  const a = Number(amount);
  if (!Number.isFinite(a)) return null;
  return a * rate;
}

/**
 * Нэг үлдэгдлийн мөрийн монгол өгүүлбэр: "Болд танд ... өртэй" /
 * "Та Болдод ... өртэй". Дүнг форматлах нь дуудагчийн ажил (money()),
 * энд зөвхөн бүтэц + чиглэлийн үг.
 * @returns {{subject:string, verb:string, isOwedToMe:boolean, abs:number}}
 */
export function balancePhrase(balance) {
  const isOwedToMe = balance.net > 0;
  return {
    subject: isOwedToMe ? `${balance.counterparty} танд` : `Та ${balance.counterparty}-д`,
    verb: 'өртэй',
    isOwedToMe,
    abs: Math.abs(balance.net),
  };
}

export default { signedAmount, netBalances, groupByCounterparty, totalsByCurrency, eurToMntDisplay, balancePhrase };
