import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { money, catLabel, catEmoji, catHex, hexTint } from '../lib/format.js';

const PERIODS = [
  { id: 1, label: 'Энэ сар' },
  { id: 3, label: '3 сар' },
  { id: 12, label: 'Жил' },
];

function monthShort(m) {
  const match = String(m || '').match(/^(\d{4})-(\d{2})$/);
  return match ? `${Number(match[2])}-р` : String(m || '').slice(0, 6);
}

export default function Analyze() {
  const [monthly, setMonthly] = useState([]);
  const [summary, setSummary] = useState(null);
  const [period, setPeriod] = useState(6);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.monthly(12), api.summary({})])
      .then(([m, s]) => { setMonthly(m.data || []); setSummary(s); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#A39A8A', fontSize: 14 }}>
      Ачаалж байна...
    </div>
  );

  const shown = monthly.slice(-period);
  const maxV = Math.max(1, ...shown.flatMap(m => [m.income || 0, m.expense || 0]));

  const expByCat = {};
  for (const r of summary?.byCategory || []) {
    if (r.type === 'expense') {
      const key = r.category ?? '_null_';
      expByCat[key] = (expByCat[key] || 0) + r.total;
    }
  }
  const cats = Object.entries(expByCat).sort((a, b) => b[1] - a[1]);
  const totalExp = cats.reduce((s, [, v]) => s + v, 0) || 1;

  const R = 48, C = 2 * Math.PI * R;
  let acc = 0;
  const donut = cats.map(([cat, val]) => {
    const realCat = cat === '_null_' ? null : cat;
    const len = (val / totalExp) * C;
    const seg = { hex: catHex(realCat), dash: len, gap: C - len, offset: acc, cat: realCat, val };
    acc += len;
    return seg;
  });

  const card = { background: '#FFFDF9', border: '1px solid #EAE1D3', borderRadius: 18, padding: 22 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Period tabs */}
      <div style={{ display: 'flex', gap: 8 }}>
        {PERIODS.map(p => {
          const active = period === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              style={{
                height: 38, padding: '0 16px',
                border: `1px solid ${active ? '#1F7A6B' : '#EAE1D3'}`,
                background: active ? '#1F7A6B' : '#FFFDF9',
                color: active ? '#fff' : '#6E665A',
                borderRadius: 999, fontFamily: 'Onest', fontWeight: active ? 600 : 500,
                fontSize: 13.5, cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Monthly trend chart */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontFamily: 'Rubik', fontWeight: 600, fontSize: 17 }}>Сарын тренд</div>
          <div style={{ display: 'flex', gap: 16, fontSize: 12.5, color: '#8C8578' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: '#2E9E5B', display: 'inline-block' }} />Орлого
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: '#D8483B', display: 'inline-block' }} />Зарлага
            </span>
          </div>
        </div>

        {shown.length === 0 ? (
          <div style={{ color: '#A39A8A', fontSize: 14, padding: '20px 0' }}>Өгөгдөл алга</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 210, paddingTop: 24 }}>
            {shown.map(m => (
              <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, height: '100%', justifyContent: 'flex-end' }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: '100%', width: '100%', justifyContent: 'center' }}>
                  <div style={{ width: 14, background: 'linear-gradient(180deg,#3BB572,#2E9E5B)', borderRadius: '6px 6px 0 0', height: `${((m.income || 0) / maxV) * 100}%`, minHeight: (m.income || 0) > 0 ? 4 : 0 }} />
                  <div style={{ width: 14, background: 'linear-gradient(180deg,#E55A4D,#D8483B)', borderRadius: '6px 6px 0 0', height: `${((m.expense || 0) / maxV) * 100}%`, minHeight: (m.expense || 0) > 0 ? 4 : 0 }} />
                </div>
                <span style={{ fontSize: 12, color: '#8C8578', fontWeight: 500, whiteSpace: 'nowrap' }}>{monthShort(m.month)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 18 }} className="lg:grid-cols-[minmax(0,300px)_1fr]">
        {/* Donut */}
        <div style={{ ...card, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ fontFamily: 'Rubik', fontWeight: 600, fontSize: 17, alignSelf: 'flex-start', marginBottom: 18 }}>Зарлагын бүтэц</div>
          {cats.length === 0 ? (
            <div style={{ color: '#A39A8A', fontSize: 14 }}>Өгөгдөл алга</div>
          ) : (
            <div style={{ position: 'relative', width: 200, height: 200 }}>
              <svg viewBox="0 0 120 120" width="200" height="200" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx="60" cy="60" r="48" fill="none" stroke="#F2EADC" strokeWidth="16" />
                {donut.map((seg, i) => (
                  <circle key={i} cx="60" cy="60" r="48" fill="none" stroke={seg.hex} strokeWidth="16"
                    strokeDasharray={`${seg.dash} ${seg.gap}`} strokeDashoffset={-seg.offset} />
                ))}
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontSize: 12, color: '#8C8578' }}>Нийт зарлага</div>
                <div style={{ fontFamily: 'Rubik', fontWeight: 600, fontSize: 18, color: '#D8483B' }}>{money(totalExp)}</div>
              </div>
            </div>
          )}
        </div>

        {/* Category bars */}
        <div style={card}>
          <div style={{ fontFamily: 'Rubik', fontWeight: 600, fontSize: 17, marginBottom: 18 }}>Мөнгө юунд урссан</div>
          {cats.length === 0 ? (
            <div style={{ color: '#A39A8A', fontSize: 14 }}>Өгөгдөл алга</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
              {cats.map(([rawCat, val]) => {
                const cat = rawCat === '_null_' ? null : rawCat;
                const pct = Math.round(val / totalExp * 100);
                const hex = catHex(cat);
                return (
                  <div key={rawCat}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 7 }}>
                      <span style={{ fontSize: 17 }}>{catEmoji(cat)}</span>
                      <span style={{ fontWeight: 500, fontSize: 14, flex: 1 }}>{catLabel(cat)}</span>
                      <span style={{ fontSize: 13, color: '#8C8578', fontWeight: 500 }}>{pct}%</span>
                      <span style={{ fontFamily: 'Rubik', fontWeight: 600, fontSize: 14, minWidth: 84, textAlign: 'right' }}>{money(val)}</span>
                    </div>
                    <div style={{ height: 9, background: '#F2EADC', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: hex, borderRadius: 999 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
