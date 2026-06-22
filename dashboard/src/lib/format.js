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

const OLD_KEY_TO_NEW = {
  food: 'Гадуур хооллолт', transport: 'Тээвэр', wallet: 'Захиалга & сервис',
  subscription: 'Захиалга & сервис', bills: 'Захиалга & сервис',
  transfer: 'Шилжүүлэг & гэр бүл', salary: 'Орлого', cash: 'Орлого', other: 'Бусад',
};

const CAT_META = {
  'Гадуур хооллолт':           { emoji: '🍽️', hex: '#E8703A' },
  'Хүнсний зүйл':              { emoji: '🛒', hex: '#4F9D69' },
  'Тээвэр':                    { emoji: '🚗', hex: '#E0A33E' },
  'Орлого':                    { emoji: '💰', hex: '#2E9E5B' },
  'Шилжүүлэг & гэр бүл':      { emoji: '💸', hex: '#C2698F' },
  'Захиалга & сервис':         { emoji: '📱', hex: '#3FA9A0' },
  'Боловсрол':                  { emoji: '📚', hex: '#5566B5' },
  'Чөлөөт цаг / зугаа цэнгэл': { emoji: '🎬', hex: '#8B6FB8' },
  'Хувцас / гоо сайхан':      { emoji: '👕', hex: '#D86A92' },
  'Эрүүл мэнд':                { emoji: '🏥', hex: '#D85A5A' },
  'Ахуйн хэрэглээ':            { emoji: '🏠', hex: '#3E7CB1' },
  'Амралт зугаалга':           { emoji: '✈️', hex: '#56AEBE' },
  'Бусад':                      { emoji: '📦', hex: '#8A8275' },
};

export function catLabel(c) {
  if (c == null) return 'Ангилаагүй';
  return OLD_KEY_TO_NEW[c] || c;
}
export function catColor(c) {
  if (c == null) return 'bg-orange-100 text-orange-700';
  const name = OLD_KEY_TO_NEW[c] || c;
  return CATEGORY_COLORS[name] || 'bg-slate-200 text-slate-700';
}
export function catEmoji(c) {
  if (c == null) return '⏳';
  const name = OLD_KEY_TO_NEW[c] || c;
  return CAT_META[name]?.emoji || '📦';
}
export function catHex(c) {
  if (c == null) return '#F0A93C';
  const name = OLD_KEY_TO_NEW[c] || c;
  return CAT_META[name]?.hex || '#8A8275';
}
export function hexTint(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function displayDesc(row) {
  const desc = row.description || '-';
  const place = row.merchant_place || row.friendly_name;
  if (place) return `${place} (${desc})`;
  return desc;
}

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
