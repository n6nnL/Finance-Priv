import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { money, catLabel, catEmoji, catHex } from '../lib/format.js';

// Өдөр тутмын зарлагын түүх (баганан диаграм + өдөр дээр даран задаргаа).
// Analyze.jsx-ийн бусад карттай АДИЛ хэлбэрээр (chart library-гүй, гар SVG/CSS)
// зурсан, ТУСДАА, НЭМЭЛТ карт — тэдгээрийг хөндөхгүй.

const TEAL = '#1F7A6B';
const cardCls = 'bg-cream-card border border-cream-border rounded-card p-[22px]';

function dayLabel(dateStr) {
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[2])}-р сарын ${Number(m[3])}` : String(dateStr);
}
// displayDesc (format.js)-той адил логик, гэхдээ энэ endpoint-ийн camelCase хэлбэрт зориулав.
function displayTxn(t) {
  const desc = t.description || '-';
  return t.merchantPlace ? `${t.merchantPlace} (${desc})` : desc;
}

export default function SpendingHistory() {
  const [data, setData] = useState(null); // { from, to, series } | null (ачаалж байна)
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState(null); // сонгосон өдрийн YYYY-MM-DD

  useEffect(() => {
    let alive = true;
    api.spendingHistory()
      .then((r) => {
        if (!alive) return;
        setData(r);
        const lastWithSpend = [...r.series].reverse().find((d) => d.total > 0);
        setSelected(lastWithSpend ? lastWithSpend.date : null);
      })
      .catch((e) => { if (alive) setErr(e.message || 'Ачаалж чадсангүй'); });
    return () => { alive = false; };
  }, []);

  if (err) return <div className={cardCls}><div className="text-[14px] text-[#D8483B]">{err}</div></div>;
  if (!data) return <div className={cardCls}><div className="text-[14px] text-[#8C8578]">Ачаалж байна…</div></div>;

  const { series } = data;
  const hasAny = series.some((d) => d.total > 0);
  const maxV = Math.max(1, ...series.map((d) => d.total));
  const selectedDay = series.find((d) => d.date === selected) || null;

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between mb-[6px] flex-wrap gap-[8px]">
        <div className="font-display font-semibold text-[17px]">Өдөр тутмын зарлага</div>
        <span className="text-[13px] text-[#8C8578] whitespace-nowrap">{dayLabel(data.from)} – {dayLabel(data.to)}</span>
      </div>

      {!hasAny ? (
        <div className="text-[#A39A8A] text-[14px] py-[20px] text-center">Энэ хугацаанд зарлага алга.</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <div className="flex items-end gap-[6px] h-[160px] pt-[16px] min-w-fit">
              {series.map((d) => {
                const h = maxV > 0 ? (d.total / maxV) * 100 : 0;
                const isSel = d.date === selected;
                return (
                  <button
                    key={d.date}
                    onClick={() => setSelected(d.date)}
                    title={`${dayLabel(d.date)} — ${money(d.total)}`}
                    aria-label={`${dayLabel(d.date)}, ${money(d.total)}`}
                    className="flex-1 min-w-[9px] max-w-[26px] h-full flex flex-col items-center justify-end cursor-pointer border-none bg-transparent p-0"
                  >
                    <div
                      className="w-full rounded-t-[4px]"
                      style={{
                        height: `${Math.max(h, d.total > 0 ? 3 : 0)}%`,
                        background: isSel ? TEAL : d.total > 0 ? '#BFE0D5' : '#F2EADC',
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex justify-between text-[13px] text-[#8C8578] mt-[6px]">
            <span className="whitespace-nowrap">{dayLabel(series[0].date)}</span>
            <span className="whitespace-nowrap">{dayLabel(series[series.length - 1].date)}</span>
          </div>

          {/* Сонгосон өдрийн drill-down жагсаалт */}
          <div className="mt-[18px] pt-[18px] border-t border-cream-border">
            {!selectedDay || selectedDay.transactions.length === 0 ? (
              <div className="text-[13px] text-[#A39A8A]">Багана дээр дараад тухайн өдрийн гүйлгээг харна уу.</div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-[12px] flex-wrap gap-[8px]">
                  <div className="font-display font-semibold text-[15px] whitespace-nowrap">{dayLabel(selectedDay.date)}</div>
                  <span className="font-display font-semibold text-[15px] text-[#D8483B] whitespace-nowrap">{money(selectedDay.total)}</span>
                </div>
                <div className="flex flex-col gap-[12px]">
                  {selectedDay.transactions.map((t) => (
                    <div key={t.id} className="flex flex-col gap-[3px] sm:flex-row sm:items-center sm:gap-[10px]">
                      <span className="flex items-center gap-[8px] min-w-0 sm:flex-1">
                        <span className="text-[16px] shrink-0">{catEmoji(t.category)}</span>
                        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{displayTxn(t)}</span>
                      </span>
                      <span className="flex items-center gap-[6px] text-[13px] text-[#8C8578] whitespace-nowrap shrink-0">
                        <span className="w-[8px] h-[8px] rounded-full shrink-0 inline-block" style={{ background: catHex(t.category) }} />
                        {catLabel(t.category)}
                      </span>
                      <span className="font-display font-semibold text-[14px] whitespace-nowrap shrink-0 min-w-[84px] sm:text-right">{money(t.amount)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
