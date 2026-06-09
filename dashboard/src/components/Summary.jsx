import { money, catLabel, catColor } from '../lib/format.js';

// Хураангуй: нийт зарлага/орлого/тоо + ангиллаар задаргаа (хөнгөн bar).
export default function Summary({ summary }) {
  if (!summary) return null;
  const { totalExpense, totalIncome, count, byCategory = [], byPlace = [] } = summary;

  // Зарлагыг ангиллаар нэгтгэх (bar-д). Map нь null түлхүүрийг (ангилаагүй) хадгална.
  const expenseByCat = new Map();
  for (const r of byCategory) {
    if (r.type === 'expense') expenseByCat.set(r.category, (expenseByCat.get(r.category) || 0) + r.total);
  }
  const cats = [...expenseByCat.entries()].sort((a, b) => b[1] - a[1]);
  const maxCat = cats.length ? cats[0][1] : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
      <div className="bg-white rounded-xl shadow p-4">
        <div className="text-xs text-slate-500">Нийт зарлага</div>
        <div className="text-2xl font-semibold text-red-600 mt-1">{money(totalExpense)}</div>
      </div>
      <div className="bg-white rounded-xl shadow p-4">
        <div className="text-xs text-slate-500">Нийт орлого</div>
        <div className="text-2xl font-semibold text-green-600 mt-1">{money(totalIncome)}</div>
      </div>
      <div className="bg-white rounded-xl shadow p-4">
        <div className="text-xs text-slate-500">Гүйлгээний тоо</div>
        <div className="text-2xl font-semibold mt-1">{count}</div>
      </div>

      {/* Ангиллаар зарлагын задаргаа */}
      {cats.length > 0 && (
        <div className="bg-white rounded-xl shadow p-4 lg:col-span-3">
          <div className="text-sm font-medium mb-3">Зарлага ангиллаар</div>
          <div className="space-y-2">
            {cats.map(([cat, total]) => (
              <div key={cat ?? '_uncat'} className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full ${catColor(cat)} w-28 shrink-0 text-center`}>
                  {catLabel(cat)}
                </span>
                <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                  <div className="bg-indigo-500 h-3" style={{ width: `${maxCat ? (total / maxCat) * 100 : 0}%` }} />
                </div>
                <span className="text-xs text-slate-600 w-28 text-right shrink-0">{money(total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Газраар (баталгаажсан POS газрууд) — "Шулуун дунд нийт хэдэн ₮" */}
      {byPlace.length > 0 && (
        <div className="bg-white rounded-xl shadow p-4 lg:col-span-3">
          <div className="text-sm font-medium mb-3">Газраар зарлага</div>
          <div className="space-y-2">
            {byPlace.map((p) => (
              <div key={p.place} className="flex items-center justify-between text-sm">
                <span className="text-slate-700">🏪 {p.place} <span className="text-slate-400 text-xs">({p.count})</span></span>
                <span className="text-slate-600">{money(p.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
