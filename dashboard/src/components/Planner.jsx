import { money, catEmoji, catHex } from '../lib/format.js';
import { SALARY_MNT, cycleSubscriptions, isWithinCycle, ymd } from '../lib/budget.js';

// Хуваарилах ангиллууд (нэр/эмодзи/өнгө) — format.js-ийн өнгийг дахин ашиглана.
export const ALLOC_SEED = [
  { key: 'Хадгаламж', emoji: '🏦', hex: '#1F7A6B' },
  { key: 'Хүнсний зүйл', emoji: catEmoji('Хүнсний зүйл'), hex: catHex('Хүнсний зүйл') },
  { key: 'Гадуур хооллолт', emoji: catEmoji('Гадуур хооллолт'), hex: catHex('Гадуур хооллолт') },
  { key: 'Тээвэр', emoji: catEmoji('Тээвэр'), hex: catHex('Тээвэр') },
];

export const ALLOC_DEFAULTS = {
  'Хадгаламж': 500000, 'Хүнсний зүйл': 400000, 'Гадуур хооллолт': 250000, 'Тээвэр': 150000,
};

const TYPE_HEX = { subscription: '#E0A33E', personal: '#D86A92' };

function shortDate(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
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

export default function Planner({ cycle, personalEvents, allocations, onAlloc }) {
  const income = SALARY_MNT;

  // Циклийн цонхонд багтах авто мөрүүд (захиалга + хувийн event)
  const autoSubs = cycleSubscriptions(cycle).map((s) => ({
    key: s.id, name: s.title, sub: `$${s.amountUsd}`, amount: s.amountMnt, hex: TYPE_HEX.subscription, type: 'subscription',
  }));
  const autoEvents = personalEvents
    .filter((e) => isWithinCycle(e.date, cycle.start, cycle.end) && (e.amountMnt || 0) > 0)
    .map((e) => ({ key: e.id, name: e.title, sub: e.date, amount: e.amountMnt || 0, hex: TYPE_HEX.personal, type: 'personal' }));
  const autoRows = [...autoSubs, ...autoEvents];

  const manualTotal = ALLOC_SEED.reduce((s, a) => s + (Number(allocations[a.key]) || 0), 0);
  const autoTotal = autoRows.reduce((s, r) => s + r.amount, 0);
  const allocated = manualTotal + autoTotal;
  const free = income - allocated;
  const pctOf = (n) => (income > 0 ? Math.round((n / income) * 100) : 0);

  const inputCls = 'w-[120px] h-[40px] px-[12px] text-right border-[1.5px] border-cream-input rounded-[10px] bg-white font-body text-[14px] text-[#2A2722] outline-none';

  return (
    <div className="bg-cream-card border border-cream-border rounded-card p-[18px] flex flex-col gap-[18px]">
      <div className="flex items-center justify-between flex-wrap gap-[8px]">
        <div className="font-display font-semibold text-[17px]">Төсвийн төлөвлөгөө</div>
        <div className="text-[13px] text-[#8C8578] whitespace-nowrap">
          Цикл: {shortDate(cycle.start)} – {shortDate(cycle.end)}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-[12px]">
        <Stat label="Циклийн орлого" value={`+${money(income)}`} color="#2E9E5B" />
        <Stat label="Хуваарилсан" value={money(allocated)} />
        <Stat label="Чөлөөт үлдэгдэл" value={`${free < 0 ? '−' : ''}${money(Math.abs(free))}`} color={free < 0 ? '#D8483B' : '#1F7A6B'} />
      </div>

      {/* Auto rows (subscriptions + events) */}
      {autoRows.length > 0 && (
        <div className="flex flex-col gap-[14px]">
          <div className="text-[13px] font-medium text-[#6E665A]">Автоматаар (календарь дээрх)</div>
          {autoRows.map((r) => (
            <div key={r.key} className="flex flex-col gap-[6px]">
              <div className="flex items-center gap-[10px]">
                <span className="w-[10px] h-[10px] rounded-full shrink-0" style={{ background: r.hex }} />
                <span className="min-w-0 flex-1 truncate font-medium text-[14px]">
                  {r.name} <span className="text-[#A39A8A] font-normal">{r.sub}</span>
                </span>
                <span className="text-[13px] font-semibold text-[#A87C36] bg-[#FBEFD6] px-[7px] py-[2px] rounded-full whitespace-nowrap shrink-0">авто</span>
                <span className="text-[13px] text-[#8C8578] whitespace-nowrap shrink-0">{pctOf(r.amount)}%</span>
                <span className="font-display font-semibold text-[14px] whitespace-nowrap shrink-0 min-w-[84px] text-right">{money(r.amount)}</span>
              </div>
              <Bar pct={pctOf(r.amount)} hex={r.hex} />
            </div>
          ))}
        </div>
      )}

      {/* Manual allocation rows */}
      <div className="flex flex-col gap-[14px]">
        <div className="text-[13px] font-medium text-[#6E665A]">Гар хуваарилалт</div>
        {ALLOC_SEED.map((a) => {
          const amt = Number(allocations[a.key]) || 0;
          return (
            <div key={a.key} className="flex flex-col gap-[6px]">
              <div className="flex items-center gap-[10px]">
                <span className="text-[17px] shrink-0">{a.emoji}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-[14px]">{a.key}</span>
                <span className="text-[13px] text-[#8C8578] whitespace-nowrap shrink-0">{pctOf(amt)}%</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={allocations[a.key] ?? ''}
                  onChange={(e) => onAlloc(a.key, e.target.value)}
                  className={inputCls}
                  aria-label={`${a.key} хуваарилалт`}
                />
              </div>
              <Bar pct={pctOf(amt)} hex={a.hex} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
