import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { money, catLabel, catEmoji, catHex } from '../lib/format.js';
import SpendingHistory from './SpendingHistory.jsx';

const PERIODS = [
  { id: 1, label: 'Энэ сар' },
  { id: 3, label: '3 сар' },
  { id: 12, label: 'Жил' },
];

function monthShort(m) {
  const match = String(m || '').match(/^(\d{4})-(\d{2})$/);
  return match ? `${Number(match[2])}-р` : String(m || '').slice(0, 6);
}

function monthLabel(m) {
  const x = String(m || '').match(/^(\d{4})-(\d{2})$/);
  return x ? `${x[1]} оны ${Number(x[2])}-р сар` : String(m || '');
}

// API нь ангилаагүйг 'Ангилаагүй' мөрөөр буцаадаг. format.js-ийн emoji/өнгөний
// тусгай (⏳ / улбар шар) дүрэм нь null-ээр түлхүүрлэдэг тул түүн рүү буулгана.
const metaKey = (c) => (c === 'Ангилаагүй' ? null : c);

const cardCls = 'bg-cream-card border border-cream-border rounded-card p-[22px]';

export default function Analyze() {
  const [monthly, setMonthly] = useState([]);
  const [period, setPeriod] = useState(6);
  const [selMonth, setSelMonth] = useState('');
  const [byCat, setByCat] = useState(null);
  const [catLoading, setCatLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  // Сарын тренд + сонгогчийн жагсаалт
  useEffect(() => {
    setLoading(true);
    api.monthly(12)
      .then((m) => {
        const rows = m.data || [];
        setMonthly(rows);
        // Хамгийн сүүлийн (хамгийн шинэ) сарыг анхдагчаар сонгоно
        if (rows.length) setSelMonth(rows[rows.length - 1].month);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Сонгосон сарын ангиллын задаргаа (dedicated endpoint)
  useEffect(() => {
    if (!selMonth) return;
    setCatLoading(true);
    api.byCategory(selMonth)
      .then(setByCat)
      .catch(() => setByCat(null))
      .finally(() => setCatLoading(false));
  }, [selMonth]);

  if (loading) return (
    <div className="flex items-center justify-center h-[200px] text-[#A39A8A] text-[14px]">
      Ачаалж байна...
    </div>
  );

  const shown = monthly.slice(-period);
  const maxV = Math.max(1, ...shown.flatMap(m => [m.income || 0, m.expense || 0]));
  const monthOptions = [...monthly].reverse().map(m => m.month);

  // Donut segments — ТОГТМОЛ өнгө (catHex), эмодзи (catEmoji) ашиглана
  const cats = byCat?.byCategory || [];
  const totalExp = byCat?.totalExpense || 0;
  const totalInc = byCat?.totalIncome || 0;
  const denom = totalExp || 1;
  const R = 48, C = 2 * Math.PI * R;
  let acc = 0;
  const donut = cats.map((row) => {
    const len = (row.total / denom) * C;
    const seg = { hex: catHex(metaKey(row.category)), dash: len, gap: C - len, offset: acc };
    acc += len;
    return seg;
  });

  return (
    <div className="flex flex-col gap-[18px]">
      {/* Period tabs */}
      <div className="flex gap-[8px]">
        {PERIODS.map(p => {
          const active = period === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className="h-[38px] px-[16px] border rounded-full font-body text-[13.5px] cursor-pointer"
              style={{
                borderColor: active ? '#1F7A6B' : '#EAE1D3',
                background: active ? '#1F7A6B' : '#FFFDF9',
                color: active ? '#fff' : '#6E665A',
                fontWeight: active ? 600 : 500,
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Monthly trend chart */}
      <div className={cardCls}>
        <div className="flex items-center justify-between mb-[6px] flex-wrap gap-[8px]">
          <div className="font-display font-semibold text-[17px]">Сарын тренд</div>
          <div className="flex gap-[16px] text-[13px] text-[#8C8578]">
            <span className="flex items-center gap-[6px]">
              <span className="w-[10px] h-[10px] rounded-[3px] bg-[#2E9E5B] inline-block" />Орлого
            </span>
            <span className="flex items-center gap-[6px]">
              <span className="w-[10px] h-[10px] rounded-[3px] bg-[#D8483B] inline-block" />Зарлага
            </span>
          </div>
        </div>

        {shown.length === 0 ? (
          <div className="text-[#A39A8A] text-[14px] py-[20px]">Өгөгдөл алга</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="flex items-end gap-[14px] h-[210px] pt-[24px]">
              {shown.map(m => (
                <div key={m.month} className="flex-1 min-w-[36px] flex flex-col items-center gap-[8px] h-full justify-end">
                  <div className="flex items-end gap-[4px] h-full w-full justify-center">
                    <div className="w-[14px] rounded-t-[6px]" style={{ background: 'linear-gradient(180deg,#3BB572,#2E9E5B)', height: `${((m.income || 0) / maxV) * 100}%`, minHeight: (m.income || 0) > 0 ? 4 : 0 }} />
                    <div className="w-[14px] rounded-t-[6px]" style={{ background: 'linear-gradient(180deg,#E55A4D,#D8483B)', height: `${((m.expense || 0) / maxV) * 100}%`, minHeight: (m.expense || 0) > 0 ? 4 : 0 }} />
                  </div>
                  <span className="text-[13px] text-[#8C8578] font-medium whitespace-nowrap">{monthShort(m.month)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Сарын ангиллын задаргаа (dedicated endpoint, сар сонгогчтой) */}
      <div className={cardCls}>
        <div className="flex items-center justify-between mb-[18px] flex-wrap gap-[10px]">
          <div className="font-display font-semibold text-[17px]">Мөнгө юунд урссан</div>
          <select
            value={selMonth}
            onChange={(e) => setSelMonth(e.target.value)}
            aria-label="Сар сонгох"
            className="h-[36px] px-[12px] border border-cream-border bg-cream-card text-[#3A352C] rounded-[10px] font-body font-medium text-[13.5px] cursor-pointer"
          >
            {monthOptions.length === 0 && <option value="">—</option>}
            {monthOptions.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>

        {catLoading ? (
          <div className="text-[#A39A8A] text-[14px] py-[24px] text-center">Ачаалж байна...</div>
        ) : cats.length === 0 ? (
          <div className="text-[#A39A8A] text-[14px] py-[28px] text-center">
            {monthLabel(selMonth)}-д зарлага алга.
            {totalInc > 0 && <div className="mt-[8px] text-[#2E9E5B] font-semibold">Орлого: +{money(totalInc)}</div>}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,240px)_1fr] gap-[22px]">
            {/* Donut */}
            <div className="flex flex-col items-center gap-[12px]">
              <div className="relative w-[200px] h-[200px]">
                <svg viewBox="0 0 120 120" width="200" height="200" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="60" cy="60" r="48" fill="none" stroke="#F2EADC" strokeWidth="16" />
                  {donut.map((seg, i) => (
                    <circle key={i} cx="60" cy="60" r="48" fill="none" stroke={seg.hex} strokeWidth="16"
                      strokeDasharray={`${seg.dash} ${seg.gap}`} strokeDashoffset={-seg.offset} />
                  ))}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="text-[13px] text-[#8C8578]">Нийт зарлага</div>
                  <div className="font-display font-semibold text-[18px] text-[#D8483B]">{money(totalExp)}</div>
                </div>
              </div>
              {totalInc > 0 && (
                <div className="text-[13px] text-[#8C8578]">
                  Орлого: <span className="text-[#2E9E5B] font-semibold">+{money(totalInc)}</span>
                </div>
              )}
            </div>

            {/* Legend / category bars (эмодзи + нэр + тогтмол өнгө) */}
            <div className="flex flex-col gap-[15px]">
              {cats.map((row) => {
                const pct = Math.round((row.total / denom) * 100);
                const hex = catHex(metaKey(row.category));
                return (
                  <div key={row.category}>
                    <div className="flex items-center gap-[9px] mb-[7px]">
                      <span className="text-[17px]">{catEmoji(metaKey(row.category))}</span>
                      <span className="font-medium text-[14px] flex-1">{catLabel(metaKey(row.category))}</span>
                      <span className="text-[13px] text-[#A39A8A]">{row.count}×</span>
                      <span className="text-[13px] text-[#8C8578] font-medium">{pct}%</span>
                      <span className="font-display font-semibold text-[14px] min-w-[84px] text-right">{money(row.total)}</span>
                    </div>
                    <div className="h-[9px] bg-[#F2EADC] rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: hex }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Өдөр тутмын зарлагын түүх — ТУСДАА, НЭМЭЛТ карт (дээрхийг хөндөхгүй) */}
      <SpendingHistory />
    </div>
  );
}
