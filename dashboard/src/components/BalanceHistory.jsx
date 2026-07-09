import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { money, dateLabel, catLabel, catEmoji, catHex, hexTint, displayDesc, isAmountsMasked } from '../lib/format.js';

// Үлдэгдлийн график (өдөр тутмын сэргээлт) — Бодит зарцуулалт (BudgetTracker)-аас
// тусдаа, НЭМЭЛТ view. READ-ONLY (GET /api/balance-history). Хугацааны муж
// динамик: бэлэн preset (7 хоног/30 хоног/3 сар/6 сар/1 жил) ЭСВЭЛ хэрэглэгчийн
// өөрөө сонгосон эхлэх/дуусах огноо (custom). Preset-ийн хувьд "өнөөдөр" гэдгийг
// сервер өөрөө (УБ-ийн цагаар) тооцдог тул client timezone-оос үл хамаарна.

const RANGE_PRESETS = [
  { key: '7d', label: '7 хоног' },
  { key: '30d', label: '30 хоног' },
  { key: '90d', label: '3 сар' },
  { key: '180d', label: '6 сар' },
  { key: '365d', label: '1 жил' },
];
const DEFAULT_RANGE = '90d';

const TEAL = '#1F7A6B';
const RED = '#D8483B';
const GRID = '#E3DACB';
const W = 640;
const H = 220;
const PAD_LEFT = 56; // Y тэнхлэгийн тоон утгад зориулсан зай
const PAD_RIGHT = 10;
const PAD_Y = 18;

function buildPoints(series, domMin, domMax) {
  const n = series.length;
  const range = domMax - domMin || 1;
  const plotW = W - PAD_LEFT - PAD_RIGHT;
  return series.map((p, i) => {
    const x = n <= 1 ? PAD_LEFT + plotW / 2 : PAD_LEFT + (i * plotW) / (n - 1);
    const y = PAD_Y + (1 - (p.balance - domMin) / range) * (H - 2 * PAD_Y);
    return { ...p, x, y };
  });
}

function inGap(date, gaps) {
  return gaps.some((g) => date >= g.start && date <= g.end);
}

// Y тэнхлэгийн "тэгш" тоо (1/2/5 × 10^n алхамтай) сонгоно — d3-style nice ticks,
// гадаад сан ашиглахгүйгээр.
function niceTicks(min, max, count = 4) {
  if (!(max > min)) return [Math.round(min)];
  const rawStep = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const niceMin = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= max + step * 0.001; v += step) ticks.push(Math.round(v));
  return ticks;
}

// Тэнхлэгийн богино формат (жижиг зайд багтаах) — нууцлал горимд бусад дүнтэй адил нуугдана.
function axisLabel(v) {
  if (isAmountsMasked()) return '•••';
  const sign = v < 0 ? '−' : '';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}сая₮`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1000)}мян₮`;
  return `${sign}${Math.round(abs)}₮`;
}

const cardCls = 'bg-cream-card border border-cream-border rounded-card p-[18px] flex flex-col gap-[16px]';
const rangeBtnBase = 'h-[32px] px-[12px] rounded-[8px] text-[13px] font-medium cursor-pointer whitespace-nowrap border transition-colors';
const dateInputCls = 'h-[34px] px-[10px] border-[1.5px] border-cream-input rounded-[9px] bg-white font-body text-[13px] text-[#2A2722] outline-none';

export default function BalanceHistory({ budgetFloor, onOpenSettings }) {
  const [range, setRange] = useState(DEFAULT_RANGE); // preset key | 'custom'
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [data, setData] = useState(null); // { available, series, gaps, anchor, from, to } | null (эхний ачаалал)
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState(null); // сонгосон цэгийн YYYY-MM-DD (drill-down)

  const customReady = range !== 'custom' || (customFrom && (!customTo || customTo >= customFrom));

  useEffect(() => {
    if (!customReady) return;
    let alive = true;
    setLoading(true);
    const params = range === 'custom' ? { from: customFrom, to: customTo || undefined } : { range };
    api.balanceHistory(params)
      .then((r) => {
        if (!alive) return;
        setData(r);
        setErr('');
        // Сонгосон цэг шинэ цувралд байхгүй бол хамгийн сүүлийн (өнөөдрийн) цэгийг сонгоно.
        setSelected((prevSel) => {
          if (r.series?.some((p) => p.date === prevSel)) return prevSel;
          return r.series && r.series.length ? r.series[r.series.length - 1].date : null;
        });
      })
      .catch((e) => { if (alive) setErr(e.message || 'Ачаалж чадсангүй'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [range, customFrom, customTo, customReady]);

  const selectPreset = (key) => {
    setRange(key);
  };
  const openCustom = () => {
    if (range !== 'custom') {
      // Custom руу анх шилжихдээ одоогийн харагдаж буй мужаар эхлүүлнэ (тав тухтай).
      if (data?.from) setCustomFrom(data.from);
      if (data?.to) setCustomTo(data.to);
    }
    setRange('custom');
  };

  const rangeControls = (
    <div className="flex flex-col gap-[8px]">
      <div className="flex items-center gap-[6px] flex-wrap">
        {RANGE_PRESETS.map((p) => (
          <button key={p.key} onClick={() => selectPreset(p.key)}
            className={`${rangeBtnBase} ${range === p.key ? 'bg-brand text-white border-brand' : 'bg-white text-[#6E665A] border-cream-border'}`}>
            {p.label}
          </button>
        ))}
        <button onClick={openCustom}
          className={`${rangeBtnBase} ${range === 'custom' ? 'bg-brand text-white border-brand' : 'bg-white text-[#6E665A] border-cream-border'}`}>
          Хугацаа сонгох
        </button>
      </div>
      {range === 'custom' && (
        <div className="flex items-center gap-[8px] flex-wrap">
          <input type="date" className={dateInputCls} value={customFrom} max={customTo || undefined}
            onChange={(e) => setCustomFrom(e.target.value)} aria-label="Эхлэх огноо" />
          <span className="text-[13px] text-[#A39A8A]">–</span>
          <input type="date" className={dateInputCls} value={customTo} min={customFrom || undefined}
            onChange={(e) => setCustomTo(e.target.value)} aria-label="Дуусах огноо (хоосон бол өнөөдөр)" />
          {!customFrom && <span className="text-[13px] text-[#C2698F]">Эхлэх огноогоо сонгоно уу</span>}
        </div>
      )}
    </div>
  );

  if (err) {
    return <div className={cardCls}><div className="text-[14px] text-[#D8483B]">{err}</div></div>;
  }
  if (!data) {
    return <div className={cardCls}><div className="text-[14px] text-[#8C8578]">Ачаалж байна…</div></div>;
  }

  // Хамгаалах доод хэмжээ тохируулаагүй бол хуурамч түвшин ХАРУУЛАХГҮЙ — тохируулах санал.
  if (budgetFloor == null) {
    return (
      <div className={`${cardCls} items-center text-center`}>
        <div className="text-[30px]">📉</div>
        <div className="font-display font-semibold text-[16px]">Хамгаалах доод үлдэгдлээ тохируулаарай</div>
        <div className="text-[14px] text-[#8C8578] max-w-[360px]">
          Үлдэгдлийн график дээр аюулын түвшнийг харуулахын тулд Тохиргоо хэсэгт хамгаалах доод үлдэгдлээ оруулна уу.
        </div>
        {onOpenSettings && (
          <button onClick={onOpenSettings}
            className="mt-[4px] h-[42px] px-[20px] border-none bg-brand text-white font-body font-semibold text-[14px] rounded-[10px] cursor-pointer whitespace-nowrap">
            Тохиргоо нээх
          </button>
        )}
      </div>
    );
  }

  // Anchor (мэдэгдэж буй бодит үлдэгдэл) хараахан алга — хуурамч цуврал ХЭЗЭЭ Ч зохиохгүй.
  if (!data.available) {
    return (
      <div className={`${cardCls} items-center text-center`}>
        <div className="text-[30px]">⏳</div>
        <div className="font-display font-semibold text-[16px]">Одоогоор бодит үлдэгдэл тодорхойгүй</div>
        <div className="text-[14px] text-[#8C8578] max-w-[360px]">
          Банкны имэйл ирж, эхний гүйлгээ бүртгэгдмэгц үлдэгдлийн график энд харагдана.
        </div>
      </div>
    );
  }

  const series = data.series;
  const gaps = data.gaps || [];

  if (series.length === 0) {
    return (
      <div className={cardCls}>
        <div className="flex items-center justify-between flex-wrap gap-[8px]">
          <div className="font-display font-semibold text-[17px]">Үлдэгдлийн график</div>
        </div>
        {rangeControls}
        <div className="text-[13px] text-[#A39A8A]">Энэ хугацаанд харуулах өдөр алга.</div>
      </div>
    );
  }

  const values = series.map((p) => p.balance);
  const rawMin = Math.min(...values, budgetFloor);
  const rawMax = Math.max(...values, budgetFloor);
  const span = rawMax - rawMin || Math.max(1000, Math.abs(rawMax) * 0.1 || 1000);
  const domMin = rawMin - span * 0.08;
  const domMax = rawMax + span * 0.08;
  const points = buildPoints(series, domMin, domMax);
  const floorY = PAD_Y + (1 - (budgetFloor - domMin) / (domMax - domMin)) * (H - 2 * PAD_Y);
  const yTicks = niceTicks(domMin, domMax, 4);
  const last = series[series.length - 1];
  const selectedPoint = series.find((p) => p.date === selected) || null;
  const selectedTxns = selectedPoint?.transactions || [];

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between flex-wrap gap-[8px]">
        <div className="font-display font-semibold text-[17px]">Үлдэгдлийн график</div>
        <span className="text-[13px] text-[#8C8578] whitespace-nowrap">
          {dateLabel(data.from)} – {dateLabel(data.to)}{loading ? ' · ачаалж байна…' : ''}
        </span>
      </div>

      {rangeControls}

      {/* Мэдэгдэж буй эрсдэл — үргэлж харагдана, нуухгүй */}
      <div className="text-[13px] text-[#A39A8A] leading-[1.5]">
        ℹ️ Энэ график зөвхөн бүртгэгдсэн гүйлгээнд үндэслэн ухраан тооцоолсон болно. Gmail холболт тасалдсан үед
        зарим өдрийн гүйлгээ дутуу байж болзошгүй тул тухайн хугацааны утга бага итгэлтэй байна.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-[12px]">
        <div className="bg-white border border-cream-border rounded-[12px] p-[14px]">
          <div className="text-[13px] text-[#8C8578] mb-[6px]">Сүүлд мэдэгдсэн үлдэгдэл</div>
          <div className="font-display font-semibold text-[20px] whitespace-nowrap" style={{ color: last.balance < budgetFloor ? RED : TEAL }}>
            {money(last.balance)}
          </div>
        </div>
        <div className="bg-white border border-cream-border rounded-[12px] p-[14px]">
          <div className="text-[13px] text-[#8C8578] mb-[6px]">Хамгаалах доод хэмжээ</div>
          <div className="font-display font-semibold text-[20px] text-[#4A453D] whitespace-nowrap">{money(budgetFloor)}</div>
        </div>
      </div>

      <div className="w-full overflow-hidden">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Үлдэгдлийн график">
          {/* Y тэнхлэгийн шугам + тоон утга — босоо тэнхлэгт хэмжээ харуулна */}
          {yTicks.map((t) => {
            const y = PAD_Y + (1 - (t - domMin) / (domMax - domMin)) * (H - 2 * PAD_Y);
            return (
              <g key={t}>
                <line x1={PAD_LEFT} y1={y} x2={W - PAD_RIGHT} y2={y} stroke={GRID} strokeWidth="1" />
                <text x={PAD_LEFT - 6} y={y + 3} textAnchor="end" fontSize="9.5" fill="#A39A8A">{axisLabel(t)}</text>
              </g>
            );
          })}

          {/* Цоорхой мужууд — бага итгэлтэй хэсгийг дэвсгэрээр ялгана */}
          {gaps.map((g, i) => {
            const gp = points.filter((p) => p.date >= g.start && p.date <= g.end);
            if (!gp.length) return null;
            const x1 = Math.min(...gp.map((p) => p.x));
            const x2 = Math.max(...gp.map((p) => p.x));
            return <rect key={i} x={x1} y={PAD_Y} width={Math.max(2, x2 - x1)} height={H - 2 * PAD_Y} fill="rgba(140,133,120,0.14)" />;
          })}

          {/* Хамгаалах доод хэмжээний тасархай зураас */}
          <line x1={PAD_LEFT} y1={floorY} x2={W - PAD_RIGHT} y2={floorY} stroke="#A39A8A" strokeWidth="1.5" strokeDasharray="5 4" />

          {/* Үлдэгдлийн шугам — сегмент бүрийг floor-той харьцуулж өнгөлнө (доогуур бол улаан) */}
          {points.slice(1).map((p, i) => {
            const prev = points[i];
            const gapSeg = inGap(prev.date, gaps) || inGap(p.date, gaps);
            const belowFloor = prev.balance < budgetFloor || p.balance < budgetFloor;
            return (
              <line key={i} x1={prev.x} y1={prev.y} x2={p.x} y2={p.y}
                stroke={belowFloor ? RED : TEAL} strokeWidth="2.5"
                strokeDasharray={gapSeg ? '4 3' : undefined}
                opacity={gapSeg ? 0.55 : 1} strokeLinecap="round" />
            );
          })}

          {/* Цэг бүр дээр дарж тухайн өдрийн гүйлгээг доор нь харуулна (drill-down) */}
          {points.map((p) => {
            const isSelected = p.date === selected;
            const belowFloor = p.balance < budgetFloor;
            return (
              <g key={p.date} onClick={() => setSelected(p.date)} style={{ cursor: 'pointer' }}>
                {/* Даралтын хамгаалалтын бүс — цэг жижиг ч хүрэлцэхэд амар */}
                <circle cx={p.x} cy={p.y} r="9" fill="transparent" />
                <circle cx={p.x} cy={p.y} r={isSelected ? 5 : 2.5}
                  fill={belowFloor ? RED : TEAL}
                  stroke={isSelected ? '#fff' : 'none'} strokeWidth={isSelected ? 2 : 0} />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex flex-col sm:flex-row items-center sm:justify-between gap-[10px] text-[13px] text-[#8C8578]">
        <span className="hidden sm:inline whitespace-nowrap">{dateLabel(series[0].date)}</span>
        <div className="flex items-center gap-[14px] flex-wrap justify-center">
          <span className="flex items-center gap-[6px] whitespace-nowrap"><span className="w-[10px] h-[10px] rounded-[3px] inline-block shrink-0" style={{ background: TEAL }} />Хэвийн</span>
          <span className="flex items-center gap-[6px] whitespace-nowrap"><span className="w-[10px] h-[10px] rounded-[3px] inline-block shrink-0" style={{ background: RED }} />Доод хэмжээнээс доогуур</span>
        </div>
        <span className="hidden sm:inline whitespace-nowrap">{dateLabel(series[series.length - 1].date)}</span>
        <span className="sm:hidden whitespace-nowrap">{dateLabel(series[0].date)} – {dateLabel(series[series.length - 1].date)}</span>
      </div>

      {gaps.length > 0 && (
        <div className="bg-[#FBF7EF] border border-[#E3DACB] rounded-[12px] px-[14px] py-[10px] flex flex-col gap-[6px]">
          <div className="text-[13px] font-semibold text-[#8C6D3F]">⚠️ Мэдээллийн цоорхой байж болзошгүй</div>
          {gaps.map((g, i) => (
            <div key={i} className="text-[13px] text-[#6E665A]">
              {dateLabel(g.start)} – {dateLabel(g.end)}: энэ хугацаанд ямар ч гүйлгээ бүртгэгдээгүй тул сэргээлт бага итгэлтэй.
            </div>
          ))}
        </div>
      )}

      {/* Сонгосон өдрийн drill-down жагсаалт — графикийн цэг дээр дарж сонгоно */}
      {selectedPoint && (
        <div className="pt-[14px] border-t border-cream-border flex flex-col gap-[12px]">
          <div className="flex items-center justify-between flex-wrap gap-[8px]">
            <div className="font-display font-semibold text-[15px] whitespace-nowrap">{dateLabel(selectedPoint.date)}</div>
            <span className="font-display font-semibold text-[15px] whitespace-nowrap" style={{ color: selectedPoint.balance < budgetFloor ? RED : TEAL }}>
              {money(selectedPoint.balance)}
            </span>
          </div>
          {selectedTxns.length === 0 ? (
            <div className="text-[13px] text-[#A39A8A]">Энэ өдөр гүйлгээ алга.</div>
          ) : (
            <div className="flex flex-col gap-[10px]">
              {selectedTxns.map((t) => {
                const hex = catHex(t.category);
                const isIncome = t.type === 'income';
                return (
                  <div key={t.id} className="flex flex-col gap-[3px] sm:flex-row sm:items-center sm:gap-[10px]">
                    <span className="flex items-center gap-[8px] min-w-0 sm:flex-1">
                      <span className="w-[30px] h-[30px] shrink-0 rounded-[9px] flex items-center justify-center text-[15px]" style={{ background: hexTint(hex, 0.14) }}>
                        {catEmoji(t.category)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{displayDesc(t)}</span>
                    </span>
                    <span className="text-[13px] font-semibold px-[8px] py-[2px] rounded-full whitespace-nowrap shrink-0" style={{ color: hex, background: hexTint(hex, 0.12) }}>
                      {catLabel(t.category)}
                    </span>
                    <span className="font-display font-semibold text-[14px] whitespace-nowrap shrink-0 min-w-[84px] sm:text-right" style={{ color: isIncome ? '#2E9E5B' : '#D8483B' }}>
                      {isIncome ? '+' : '−'}{money(t.amount)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
