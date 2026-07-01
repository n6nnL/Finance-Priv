import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { money, catEmoji } from '../lib/format.js';

// Бодит зарцуулалт ↔ %-хуваарилалт (real-time tracker). Тусдаа view —
// Planner-г хөндөхгүй. Зарлага READ-ONLY (GET /api/budget-status). Хуваарилалт
// %-аар удирдагдаж backend-д хадгалагдана (debounced PUT /api/budget-allocations).

const TEAL = '#1F7A6B';
const AMBER = '#E0A33E';
const RED = '#D8483B';

// % дүүрсэн → bar өнгө (≥85% шар, >100% улаан).
function fillColor(pct) {
  if (pct > 100) return RED;
  if (pct >= 85) return AMBER;
  return TEAL;
}
// Хувийг 0–1 орон таслалаар.
function pctLabel(p) {
  const n = Number(p) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function Bar({ pct, hex }) {
  return (
    <div className="h-[8px] bg-[#F2EADC] rounded-full overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: hex }} />
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div className="bg-cream-card border border-cream-border rounded-card p-[16px]">
      <div className="text-[13px] text-[#8C8578] mb-[8px]">{label}</div>
      <div className="font-display font-semibold text-[20px] tracking-[-0.4px] whitespace-nowrap" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}

export default function BudgetTracker() {
  const [status, setStatus] = useState(null);    // /budget-status
  const [percents, setPercents] = useState(null); // { [category]: number }
  const [err, setErr] = useState('');
  const [saveState, setSaveState] = useState(''); // '' | 'saving' | 'saved' | 'error'
  const saveTimer = useRef(null);

  const load = useCallback(async () => {
    try {
      const [st, al] = await Promise.all([api.budgetStatus(), api.budgetAllocations()]);
      setStatus(st);
      const map = {};
      for (const a of al.allocations || []) map[a.category] = a.percent;
      setPercents(map);
    } catch (e) {
      setErr(e.message || 'Ачаалж чадсангүй');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Optimistic + debounced PUR (full list).
  const persist = useCallback((nextMap) => {
    setPercents(nextMap);
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const allocations = Object.entries(nextMap)
          .filter(([, v]) => Number(v) > 0)
          .map(([category, percent]) => ({ category, percent: Number(percent) }));
        await api.saveBudgetAllocations(allocations);
        setSaveState('saved');
        setTimeout(() => setSaveState(''), 1800);
      } catch {
        setSaveState('error');
        load(); // бичилт амжилтгүй → backend-ийн утгыг сэргээнэ
      }
    }, 400);
  }, [load]);

  const onPercent = (category, raw) => {
    const n = raw === '' ? 0 : Math.max(0, Number(raw) || 0);
    persist({ ...percents, [category]: n });
  };

  const rows = useMemo(() => {
    if (!status || !percents) return [];
    const spentByCat = new Map((status.byCategory || []).map((c) => [c.category, c.spent]));
    const income = status.income || 0;
    const cats = new Set([
      ...Object.keys(percents).filter((c) => Number(percents[c]) > 0),
      ...spentByCat.keys(),
    ]);
    return [...cats].map((category) => {
      const percent = Number(percents[category]) || 0;
      const spent = Number(spentByCat.get(category)) || 0;
      const allocated = Math.round((income * percent) / 100);
      const fill = allocated > 0 ? Math.round((spent / allocated) * 100) : (spent > 0 ? 101 : 0);
      return { category, percent, spent, allocated, fill };
    }).sort((a, b) => b.percent - a.percent || b.spent - a.spent);
  }, [status, percents]);

  if (err) {
    return <div className="bg-cream-card border border-cream-border rounded-card p-[18px] text-[14px] text-[#D8483B]">{err}</div>;
  }
  if (!status || !percents) {
    return <div className="bg-cream-card border border-cream-border rounded-card p-[18px] text-[14px] text-[#8C8578]">Ачаалж байна…</div>;
  }

  const income = status.income;
  // Цалин оруулаагүй бол хуурамч тоо ХАРУУЛАХГҮЙ.
  if (income == null) {
    return (
      <div className="bg-cream-card border border-cream-border rounded-card p-[24px] flex flex-col items-center text-center gap-[10px]">
        <div className="text-[30px]">📊</div>
        <div className="font-display font-semibold text-[16px]">Бодит зарцуулалтыг хянахын тулд цалингаа оруулаарай</div>
        <div className="text-[14px] text-[#8C8578] max-w-[340px]">Тохиргоо хэсэгт сарын цалингаа оруулсны дараа хуваарилалт ↔ бодит зарлагын харьцуулалт энд гарна.</div>
      </div>
    );
  }

  const free = income - status.totalSpend;
  const allocPctSum = Object.values(percents).reduce((s, v) => s + (Number(v) || 0), 0);
  const overAllocated = allocPctSum > 100;

  return (
    <div className="bg-cream-card border border-cream-border rounded-card p-[18px] flex flex-col gap-[18px]">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-[8px]">
        <div className="font-display font-semibold text-[17px]">Бодит зарцуулалт</div>
        <div className="flex items-center gap-[10px]">
          {saveState === 'saving' && <span className="text-[13px] text-[#A39A8A] whitespace-nowrap">Хадгалж байна…</span>}
          {saveState === 'saved' && <span className="text-[13px] font-medium text-[#1F7A6B] whitespace-nowrap">✓ Хадгалагдлаа</span>}
          {saveState === 'error' && <span className="text-[13px] font-medium text-[#D8483B] whitespace-nowrap">Алдаа</span>}
          <span className="text-[13px] text-[#8C8578] whitespace-nowrap">Цикл: {status.cycle.start} – {status.cycle.end}</span>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-[12px]">
        <Stat label="Циклийн орлого" value={`+${money(income)}`} color="#2E9E5B" />
        <Stat label="Нийт зарлага" value={money(status.totalSpend)} />
        <Stat label="Чөлөөт үлдэгдэл" value={`${free < 0 ? '−' : ''}${money(Math.abs(free))}`} color={free < 0 ? RED : TEAL} />
      </div>

      {overAllocated && (
        <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-[12px] px-[14px] py-[10px] text-[13px] text-[#D8483B]">
          ⚠️ Хуваарилалт {pctLabel(allocPctSum)}% — орлогоос хэтэрсэн.
        </div>
      )}

      {/* Category rows: spent vs allocated */}
      <div className="flex flex-col gap-[16px]">
        {rows.map((r) => {
          const hex = fillColor(r.fill);
          const over = r.spent > r.allocated;
          return (
            <div key={r.category} className="flex flex-col gap-[8px]">
              {/* line 1: name · spent/allocated · fill% (stacks on mobile) */}
              <div className="flex flex-col gap-[4px] sm:flex-row sm:items-center sm:gap-[10px]">
                <div className="flex items-center gap-[8px] min-w-0 sm:flex-1">
                  <span className="text-[16px] shrink-0">{catEmoji(r.category)}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-[14px]">{r.category}</span>
                </div>
                <span className="text-[13px] text-[#6E665A] whitespace-nowrap shrink-0">
                  {money(r.spent)} / {r.allocated > 0 ? money(r.allocated) : '—'}
                </span>
                <span className="text-[13px] font-semibold whitespace-nowrap shrink-0 min-w-[42px] sm:text-right" style={{ color: over ? RED : '#8C8578' }}>
                  {r.allocated > 0 ? `${r.fill}%` : 'хэтэрсэн'}
                </span>
              </div>
              <Bar pct={r.fill} hex={hex} />
              {/* line 2: % control (slider + input) */}
              <div className="flex items-center gap-[10px]">
                <input
                  type="range" min="0" max="100" step="1"
                  value={Math.min(100, Math.round(r.percent))}
                  onChange={(e) => onPercent(r.category, e.target.value)}
                  className="flex-1 min-w-0 accent-brand"
                  aria-label={`${r.category} хувь`}
                />
                <div className="flex items-center gap-[4px] shrink-0">
                  <input
                    type="number" inputMode="decimal" min="0"
                    value={r.percent === 0 ? '' : r.percent}
                    onChange={(e) => onPercent(r.category, e.target.value)}
                    placeholder="0"
                    className="w-[58px] h-[36px] px-[8px] text-right border-[1.5px] border-cream-input rounded-[9px] bg-white font-body text-[14px] text-[#2A2722] outline-none"
                    aria-label={`${r.category} хувь оруулах`}
                  />
                  <span className="text-[13px] text-[#8C8578]">%</span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Unclassified — тусдаа, далдлахгүй (#2) */}
        <div className="flex flex-col gap-[8px] pt-[14px] border-t border-cream-border">
          <div className="flex items-center gap-[8px]">
            <span className="text-[16px] shrink-0">❓</span>
            <span className="min-w-0 flex-1 truncate font-medium text-[14px]" title="Ангилагдаагүй мерчантууд (BOM кодууд)">Тодорхойгүй / ангилагдаагүй</span>
            <span className="text-[13px] text-[#6E665A] whitespace-nowrap shrink-0">{money(status.unclassified)}</span>
          </div>
          <div className="text-[13px] text-[#A39A8A]">
            Нийт зарлага: {money(status.totalSpend)} (ангилсан + тодорхойгүй)
          </div>
        </div>
      </div>
    </div>
  );
}
