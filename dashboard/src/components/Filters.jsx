import { useState } from 'react';
import { catLabel } from '../lib/format.js';

// Шүүлтүүр панел. Утсан дээр эвхэгддэг (collapsible).
export default function Filters({ categories, value, onChange, onReset }) {
  const [open, setOpen] = useState(false);
  const set = (patch) => onChange({ ...value, ...patch, offset: 0 });

  function toggleCat(c) {
    const cur = value.category || [];
    const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c];
    set({ category: next });
  }

  return (
    <div className="bg-white rounded-xl shadow mb-4">
      <button
        className="w-full flex items-center justify-between px-4 py-3 sm:hidden"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-medium">Шүүлтүүр</span>
        <span className="text-slate-400">{open ? '▲' : '▼'}</span>
      </button>

      <div className={`${open ? 'block' : 'hidden'} sm:block p-4 pt-0 sm:pt-4`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Текст хайлт */}
          <div className="lg:col-span-2">
            <label className="block text-xs text-slate-500 mb-1">Хайлт (тайлбар)</label>
            <input
              type="text"
              value={value.q || ''}
              onChange={(e) => set({ q: e.target.value })}
              placeholder="жишээ: SocialPay, CU..."
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          {/* Төрөл */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">Төрөл</label>
            <select
              value={value.type || ''}
              onChange={(e) => set({ type: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">Бүгд</option>
              <option value="expense">Зарлага</option>
              <option value="income">Орлого</option>
            </select>
          </div>
          {/* Огноо from */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">Огноо (эхэлэх)</label>
            <input type="date" value={value.from || ''} onChange={(e) => set({ from: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Огноо (дуусах)</label>
            <input type="date" value={value.to || ''} onChange={(e) => set({ to: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          {/* Дүн min/max */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">Дүн (доод)</label>
            <input type="number" value={value.minAmount || ''} onChange={(e) => set({ minAmount: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Дүн (дээд)</label>
            <input type="number" value={value.maxAmount || ''} onChange={(e) => set({ maxAmount: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>

        {/* Ангилал (олон сонголт) */}
        <div className="mt-3">
          <label className="block text-xs text-slate-500 mb-1">Ангилал</label>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => {
              const active = (value.category || []).includes(c);
              return (
                <button
                  key={c}
                  onClick={() => toggleCat(c)}
                  className={`px-3 py-1 rounded-full text-xs border ${
                    active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300'
                  }`}
                >
                  {catLabel(c)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-3 flex justify-end">
          <button onClick={onReset} className="text-sm text-slate-500 hover:text-slate-700 underline">
            Шүүлтүүр цэвэрлэх
          </button>
        </div>
      </div>
    </div>
  );
}
