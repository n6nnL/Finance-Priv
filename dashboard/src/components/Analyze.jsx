import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { money, catLabel, catColor } from '../lib/format.js';

// Шинжилгээ: сарын орлого/зарлагын тренд + ангиллаар задаргаа (хөнгөн SVG/CSS bar)
export default function Analyze() {
  const [monthly, setMonthly] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.monthly(12), api.summary({})])
      .then(([m, s]) => { setMonthly(m.data || []); setSummary(s); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-slate-400 text-sm">Ачаалж байна...</div>;

  const maxM = Math.max(1, ...monthly.flatMap((m) => [m.income, m.expense]));
  const expenseByCat = {};
  for (const r of summary?.byCategory || []) {
    if (r.type === 'expense') expenseByCat[r.category ?? '_'] = (expenseByCat[r.category ?? '_'] || 0) + r.total;
  }
  const cats = Object.entries(expenseByCat).sort((a, b) => b[1] - a[1]);
  const maxC = cats.length ? cats[0][1] : 1;

  return (
    <div className="space-y-4">
      {/* Сарын тренд */}
      <div className="bg-white rounded-xl shadow p-4">
        <div className="text-sm font-medium mb-3">Сарын орлого / зарлага</div>
        {monthly.length === 0 ? (
          <div className="text-slate-400 text-sm">Өгөгдөл алга</div>
        ) : (
          <div className="space-y-2">
            {monthly.map((m) => (
              <div key={m.month} className="flex items-center gap-2 text-xs">
                <span className="w-16 shrink-0 text-slate-500">{m.month}</span>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="bg-green-100 rounded h-3 flex-1 overflow-hidden">
                      <div className="bg-green-500 h-3" style={{ width: `${(m.income / maxM) * 100}%` }} />
                    </div>
                    <span className="w-24 text-right text-green-700">{money(m.income)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="bg-red-100 rounded h-3 flex-1 overflow-hidden">
                      <div className="bg-red-500 h-3" style={{ width: `${(m.expense / maxM) * 100}%` }} />
                    </div>
                    <span className="w-24 text-right text-red-600">{money(m.expense)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 text-xs text-slate-400">🟢 орлого · 🔴 зарлага</div>
      </div>

      {/* Ангиллаар зарлага */}
      <div className="bg-white rounded-xl shadow p-4">
        <div className="text-sm font-medium mb-3">Зарлага ангиллаар (нийт)</div>
        <div className="space-y-2">
          {cats.map(([cat, total]) => (
            <div key={cat} className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full ${catColor(cat === '_' ? null : cat)} w-28 shrink-0 text-center`}>
                {catLabel(cat === '_' ? null : cat)}
              </span>
              <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                <div className="bg-indigo-500 h-3" style={{ width: `${(total / maxC) * 100}%` }} />
              </div>
              <span className="text-xs text-slate-600 w-28 text-right shrink-0">{money(total)}</span>
            </div>
          ))}
          {cats.length === 0 && <div className="text-slate-400 text-sm">Өгөгдөл алга</div>}
        </div>
      </div>
    </div>
  );
}
