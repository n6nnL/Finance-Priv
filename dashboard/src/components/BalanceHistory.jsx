import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { money, dateLabel, catLabel, catEmoji, catHex, hexTint, displayDesc } from '../lib/format.js';

// Үлдэгдлийн график (өдөр тутмын сэргээлт) — Бодит зарцуулалт (BudgetTracker)-аас
// тусдаа, НЭМЭЛТ view. READ-ONLY (GET /api/balance-history). Эхлэл огноо тогтмол
// (2026-04-01, payday цикльтэй холбоогүй, тодорхой сонголт).

const FROM = '2026-04-01';
const TEAL = '#1F7A6B';
const RED = '#D8483B';
const W = 640;
const H = 200;
const PAD_X = 8;
const PAD_Y = 18;

function buildPoints(series, domMin, domMax) {
  const n = series.length;
  const range = domMax - domMin || 1;
  return series.map((p, i) => {
    const x = n <= 1 ? W / 2 : PAD_X + (i * (W - 2 * PAD_X)) / (n - 1);
    const y = PAD_Y + (1 - (p.balance - domMin) / range) * (H - 2 * PAD_Y);
    return { ...p, x, y };
  });
}

function inGap(date, gaps) {
  return gaps.some((g) => date >= g.start && date <= g.end);
}

const cardCls = 'bg-cream-card border border-cream-border rounded-card p-[18px] flex flex-col gap-[16px]';

export default function BalanceHistory({ budgetFloor, onOpenSettings }) {
  const [data, setData] = useState(null); // { available, series, gaps, anchor, from, to } | null (ачаалж байна)
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState(null); // сонгосон цэгийн YYYY-MM-DD (drill-down)

  useEffect(() => {
    let alive = true;
    api.balanceHistory(FROM)
      .then((r) => {
        if (!alive) return;
        setData(r);
        // Анхдагч: хамгийн сүүлийн (өнөөдрийн) цэгийг сонгоно.
        if (r.series && r.series.length) setSelected(r.series[r.series.length - 1].date);
      })
      .catch((e) => { if (alive) setErr(e.message || 'Ачаалж чадсангүй'); });
    return () => { alive = false; };
  }, []);

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
  const values = series.map((p) => p.balance);
  const rawMin = Math.min(...values, budgetFloor);
  const rawMax = Math.max(...values, budgetFloor);
  const span = rawMax - rawMin || Math.max(1000, Math.abs(rawMax) * 0.1 || 1000);
  const domMin = rawMin - span * 0.08;
  const domMax = rawMax + span * 0.08;
  const points = buildPoints(series, domMin, domMax);
  const floorY = PAD_Y + (1 - (budgetFloor - domMin) / (domMax - domMin)) * (H - 2 * PAD_Y);
  const last = series[series.length - 1];
  const selectedPoint = series.find((p) => p.date === selected) || null;
  const selectedTxns = selectedPoint?.transactions || [];

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between flex-wrap gap-[8px]">
        <div className="font-display font-semibold text-[17px]">Үлдэгдлийн график</div>
        <span className="text-[13px] text-[#8C8578] whitespace-nowrap">{dateLabel(data.from)} – {dateLabel(data.to)}</span>
      </div>

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
          {/* Цоорхой мужууд — бага итгэлтэй хэсгийг дэвсгэрээр ялгана */}
          {gaps.map((g, i) => {
            const gp = points.filter((p) => p.date >= g.start && p.date <= g.end);
            if (!gp.length) return null;
            const x1 = Math.min(...gp.map((p) => p.x));
            const x2 = Math.max(...gp.map((p) => p.x));
            return <rect key={i} x={x1} y={PAD_Y} width={Math.max(2, x2 - x1)} height={H - 2 * PAD_Y} fill="rgba(140,133,120,0.14)" />;
          })}

          {/* Хамгаалах доод хэмжээний тасархай зураас */}
          <line x1={PAD_X} y1={floorY} x2={W - PAD_X} y2={floorY} stroke="#A39A8A" strokeWidth="1.5" strokeDasharray="5 4" />

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
