// 10 ангиллын систем — категори VALUE нь шууд монгол нэр (key биш).
// 10 ангиллын өнгө:
export const CATEGORY_COLORS = {
  'Гадуур хооллолт': 'bg-green-100 text-green-800',
  'Хүнсний зүйл': 'bg-lime-100 text-lime-800',
  'Тээвэр': 'bg-amber-100 text-amber-800',
  'Орлого': 'bg-emerald-100 text-emerald-800',
  'Шилжүүлэг & гэр бүл': 'bg-blue-100 text-blue-800',
  'Захиалга & сервис': 'bg-indigo-100 text-indigo-800',
  'Боловсрол': 'bg-purple-100 text-purple-800',
  'Чөлөөт цаг / зугаа цэнгэл': 'bg-pink-100 text-pink-800',
  'Хувцас / гоо сайхан': 'bg-rose-100 text-rose-800',
  'Бусад': 'bg-slate-200 text-slate-700',
};

// Хуучин (англи key) өгөгдөл үлдсэн бол шинэ нэр рүү харуулах fallback
const OLD_KEY_TO_NEW = {
  food: 'Гадуур хооллолт', transport: 'Тээвэр', wallet: 'Захиалга & сервис',
  subscription: 'Захиалга & сервис', bills: 'Захиалга & сервис',
  transfer: 'Шилжүүлэг & гэр бүл', salary: 'Орлого', cash: 'Орлого', other: 'Бусад',
};

export function catLabel(c) {
  if (c == null) return 'Ангилаагүй'; // null = баталгаажаагүй (pending), "Бусад"-аас ялгаатай
  return OLD_KEY_TO_NEW[c] || c; // шинэ нэр шууд, хуучин key бол буулгана
}
export function catColor(c) {
  if (c == null) return 'bg-orange-100 text-orange-700';
  const name = OLD_KEY_TO_NEW[c] || c;
  return CATEGORY_COLORS[name] || 'bg-slate-200 text-slate-700';
}

// Тайлбарыг харуулах: газрын нэр (merchant_place эсвэл override friendly_name)
// байвал "Шулуун дун (ShuluBOM)"
export function displayDesc(row) {
  const desc = row.description || '-';
  const place = row.merchant_place || row.friendly_name;
  if (place) return `${place} (${desc})`;
  return desc;
}

// Огноог уншигдахуйц болгох: "2026-06-07" → "6-р сарын 7"
export function dateLabel(d) {
  if (!d) return '-';
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return d;
  return `${Number(m[2])}-р сарын ${Number(m[3])}`;
}

const nf = new Intl.NumberFormat('mn-MN', { maximumFractionDigits: 2 });
export function money(n) {
  if (n == null) return '-';
  return nf.format(Number(n)) + '₮';
}

export function confLabel(c) {
  return { high: 'Өндөр', medium: 'Дунд', low: 'Бага' }[c] || c || '-';
}
export function confColor(c) {
  return (
    { high: 'bg-green-100 text-green-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-red-100 text-red-700' }[c] ||
    'bg-slate-100 text-slate-600'
  );
}
