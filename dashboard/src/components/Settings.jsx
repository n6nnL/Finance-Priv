import { useEffect, useState } from 'react';
import { money } from '../lib/format.js';

// Тохиргооны форм — цалин/payday/ханш/захиалга/хуваарилалт. Хэрэглэгч засна,
// "Хадгалах" дээр sanitize хийгээд onSave(settings) дуудна (Calendar PUT хийнэ).
// САНХҮҮ нь зөвхөн энд (хэрэглэгчээс) — код дотор хуурамч дүн байхгүй.

const inputCls = 'h-[42px] px-[12px] border-[1.5px] border-cream-input rounded-[10px] bg-white font-body text-[14px] text-[#2A2722] outline-none w-full min-w-0';
const labelCls = 'text-[13px] font-medium text-[#6E665A] mb-[6px] block';

const intOrNull = (v) => {
  if (v === '' || v == null) return null;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.max(0, n) : null;
};
const intOr = (v, def) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : def; };
const numOr = (v, def) => { const n = Number(v); return Number.isFinite(n) ? n : def; };

function sanitize(d) {
  return {
    salaryAmount: intOrNull(d.salaryAmount),
    paydayDay: Math.min(Math.max(intOr(d.paydayDay, 15), 1), 28),
    usdMnt: Math.max(1, numOr(d.usdMnt, 3578)),
    subscriptions: (d.subscriptions || [])
      .filter((s) => String(s.name).trim())
      .map((s) => ({
        name: String(s.name).trim().slice(0, 60),
        day: Math.min(Math.max(intOr(s.day, 1), 1), 28),
        amountUsd: Math.max(0, numOr(s.amountUsd, 0)),
      })),
    categoryAllocations: (d.categoryAllocations || [])
      .filter((a) => String(a.category).trim())
      .map((a) => ({ category: String(a.category).trim().slice(0, 60), amountMnt: Math.max(0, intOr(a.amountMnt, 0)) })),
  };
}

export default function Settings({ settings, onSave, onClose, saving }) {
  // Засварлах draft — settings өөрчлөгдвөл дахин эхлэлжүүлнэ.
  const [draft, setDraft] = useState(settings);
  const [savedAt, setSavedAt] = useState(0);
  useEffect(() => { setDraft(settings); }, [settings]);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setSub = (i, patch) => set({ subscriptions: draft.subscriptions.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const addSub = () => set({ subscriptions: [...(draft.subscriptions || []), { name: '', day: 1, amountUsd: 0 }] });
  const removeSub = (i) => set({ subscriptions: draft.subscriptions.filter((_, j) => j !== i) });
  const setAlloc = (i, patch) => set({ categoryAllocations: draft.categoryAllocations.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const addAlloc = () => set({ categoryAllocations: [...(draft.categoryAllocations || []), { category: '', amountMnt: 0 }] });
  const removeAlloc = (i) => set({ categoryAllocations: draft.categoryAllocations.filter((_, j) => j !== i) });

  const save = async () => {
    await onSave(sanitize(draft));
    setSavedAt(Date.now());
    setTimeout(() => setSavedAt(0), 2500);
  };

  const allocTotal = (draft.categoryAllocations || []).reduce((s, a) => s + (Math.max(0, intOr(a.amountMnt, 0))), 0);

  return (
    <div className="bg-cream-card border border-cream-border rounded-card p-[18px] flex flex-col gap-[20px]">
      <div className="flex items-center justify-between gap-[10px]">
        <div className="font-display font-semibold text-[17px]">Тохиргоо</div>
        {onClose && (
          <button onClick={onClose} aria-label="Хаах"
            className="w-[36px] h-[36px] rounded-[10px] border border-cream-border bg-cream-card text-[#6E665A] text-[16px] cursor-pointer flex items-center justify-center shrink-0">✕</button>
        )}
      </div>

      {/* Цалин / payday / ханш */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-[12px]">
        <div>
          <label className={labelCls}>Цалин (₮)</label>
          <input type="number" inputMode="numeric" className={inputCls}
            placeholder="Цалингаа оруулна уу"
            value={draft.salaryAmount ?? ''}
            onChange={(e) => set({ salaryAmount: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>Цалингийн өдөр</label>
          <input type="number" inputMode="numeric" min={1} max={28} className={inputCls}
            value={draft.paydayDay ?? ''}
            onChange={(e) => set({ paydayDay: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>USD→MNT ханш</label>
          <input type="number" inputMode="numeric" className={inputCls}
            value={draft.usdMnt ?? ''}
            onChange={(e) => set({ usdMnt: e.target.value })} />
        </div>
      </div>

      {/* Захиалгууд */}
      <div className="flex flex-col gap-[10px]">
        <div className="flex items-center justify-between gap-[10px]">
          <div className="text-[14px] font-semibold text-[#4A453D]">Захиалгууд</div>
          <button onClick={addSub} className="h-[34px] px-[12px] border border-cream-border bg-white rounded-[9px] text-[13px] font-medium text-[#1F7A6B] cursor-pointer whitespace-nowrap shrink-0">+ Нэмэх</button>
        </div>
        {(draft.subscriptions || []).length === 0 && <div className="text-[13px] text-[#A39A8A]">Захиалга алга</div>}
        {(draft.subscriptions || []).map((s, i) => (
          <div key={i} className="flex flex-col sm:flex-row gap-[8px] sm:items-center">
            <input className={`${inputCls} sm:flex-1`} placeholder="Нэр (ж: Netflix)"
              value={s.name} onChange={(e) => setSub(i, { name: e.target.value })} />
            <div className="flex gap-[8px]">
              <input type="number" inputMode="numeric" min={1} max={28} className={`${inputCls} sm:w-[88px]`} placeholder="Өдөр" aria-label="Өдөр"
                value={s.day} onChange={(e) => setSub(i, { day: e.target.value })} />
              <input type="number" inputMode="decimal" className={`${inputCls} sm:w-[110px]`} placeholder="USD" aria-label="USD дүн"
                value={s.amountUsd} onChange={(e) => setSub(i, { amountUsd: e.target.value })} />
              <button onClick={() => removeSub(i)} aria-label="Устгах"
                className="h-[42px] w-[42px] shrink-0 border border-cream-border bg-white rounded-[10px] text-[#C2698F] text-[16px] cursor-pointer flex items-center justify-center">🗑</button>
            </div>
          </div>
        ))}
      </div>

      {/* Ангиллын хуваарилалт */}
      <div className="flex flex-col gap-[10px]">
        <div className="flex items-center justify-between gap-[10px]">
          <div className="text-[14px] font-semibold text-[#4A453D]">Ангиллын хуваарилалт</div>
          <button onClick={addAlloc} className="h-[34px] px-[12px] border border-cream-border bg-white rounded-[9px] text-[13px] font-medium text-[#1F7A6B] cursor-pointer whitespace-nowrap shrink-0">+ Нэмэх</button>
        </div>
        {(draft.categoryAllocations || []).map((a, i) => (
          <div key={i} className="flex flex-col sm:flex-row gap-[8px] sm:items-center">
            <input className={`${inputCls} sm:flex-1`} placeholder="Ангилал (ж: Хадгаламж)"
              value={a.category} onChange={(e) => setAlloc(i, { category: e.target.value })} />
            <div className="flex gap-[8px]">
              <input type="number" inputMode="numeric" className={`${inputCls} sm:w-[140px]`} placeholder="₮" aria-label="Дүн ₮"
                value={a.amountMnt} onChange={(e) => setAlloc(i, { amountMnt: e.target.value })} />
              <button onClick={() => removeAlloc(i)} aria-label="Устгах"
                className="h-[42px] w-[42px] shrink-0 border border-cream-border bg-white rounded-[10px] text-[#C2698F] text-[16px] cursor-pointer flex items-center justify-center">🗑</button>
            </div>
          </div>
        ))}
        <div className="text-[13px] text-[#8C8578] whitespace-nowrap">Нийт хуваарилсан: {money(allocTotal)}</div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-[12px] flex-wrap">
        <button onClick={save} disabled={saving}
          className="h-[44px] px-[22px] border-none bg-brand text-white font-body font-semibold text-[14px] rounded-[10px] cursor-pointer whitespace-nowrap disabled:opacity-60">
          {saving ? 'Хадгалж байна…' : 'Хадгалах'}
        </button>
        {savedAt > 0 && <span className="text-[13px] font-medium text-[#1F7A6B] whitespace-nowrap">✓ Хадгалагдлаа</span>}
      </div>
    </div>
  );
}
