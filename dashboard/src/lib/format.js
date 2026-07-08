// Ангиллын нэр/metadata (emoji/hex) + хуучин нэрийн mapping нь config/categories.js-д
// (★ single source). Энд зөвхөн frontend-ийн Tailwind badge өнгө + туслах функц.
import { OLD_TO_NEW, CATEGORY_META } from '../../../config/categories.js';

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

export function catLabel(c) {
  if (c == null) return 'Ангилаагүй';
  return OLD_TO_NEW[c] || c;
}
export function catColor(c) {
  if (c == null) return 'bg-orange-100 text-orange-700';
  const name = OLD_TO_NEW[c] || c;
  return CATEGORY_COLORS[name] || 'bg-slate-200 text-slate-700';
}
export function catEmoji(c) {
  if (c == null) return '⏳';
  const name = OLD_TO_NEW[c] || c;
  return CATEGORY_META[name]?.emoji || '📦';
}
export function catHex(c) {
  if (c == null) return '#F0A93C';
  const name = OLD_TO_NEW[c] || c;
  return CATEGORY_META[name]?.hex || '#8A8275';
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

// ── Дүнг нуух (privacy) горим ──────────────────────────────────────────────
// Бүх мөнгөн дүн money()-оор дамждаг тул энэ ганц цэгээс нууна. Модул түвшний
// туг — App өөрийн state-тэй нь render үедээ applyAmountsMasked()-ээр тааруулна,
// ингэснээр доор render хийгдэх бүх money() дуудлага зөв утга уншина. Анхны
// ачаалалд localStorage-оос уншина (refresh хийсэн ч сонголт хадгалагдана).
let _amountsMasked = (() => {
  try { return localStorage.getItem('maskAmounts') === '1'; } catch { return false; }
})();
export function applyAmountsMasked(v) { _amountsMasked = !!v; }
export function isAmountsMasked() { return _amountsMasked; }

const nf = new Intl.NumberFormat('mn-MN', { maximumFractionDigits: 2 });
export function money(n) {
  if (_amountsMasked) return '*****₮'; // нуусан үед — тоог харуулахгүй
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
