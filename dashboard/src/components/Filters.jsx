import { catLabel, catEmoji, catHex, hexTint } from '../lib/format.js';

export default function Filters({ categories, value, onChange, onReset }) {
  const set = (patch) => onChange({ ...value, ...patch, offset: 0 });

  function toggleCat(c) {
    const cur = value.category || [];
    const next = cur.includes(c) ? cur.filter(x => x !== c) : [...cur, c];
    set({ category: next });
  }

  const filtersActive = !!(value.q || value.type || (value.category || []).length || value.from || value.to || value.minAmount || value.maxAmount);

  const inp = {
    width: '100%', height: 46, padding: '0 13px',
    border: '1.5px solid #E3DACB', borderRadius: 12,
    background: '#fff', fontFamily: 'Onest', fontSize: 14,
    color: '#2A2722', outline: 'none', boxSizing: 'border-box',
  };
  const lbl = { display: 'block', fontSize: 12.5, fontWeight: 500, color: '#6E665A', marginBottom: 6 };

  return (
    <div style={{ background: '#FFFDF9', border: '1px solid #EAE1D3', borderRadius: 18, padding: '18px 18px 16px', marginBottom: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }} className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {/* Search */}
        <div style={{ gridColumn: '1 / -1' }} className="lg:col-span-1">
          <label style={lbl}>Хайлт (тайлбар)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1.5px solid #E3DACB', borderRadius: 12, padding: '0 13px', height: 46 }}>
            <span style={{ color: '#B0A696', fontSize: 15 }}>🔍</span>
            <input
              value={value.q || ''}
              onChange={e => set({ q: e.target.value })}
              placeholder="жишээ: Veranda, Nomin..."
              style={{ border: 'none', background: 'none', outline: 'none', fontFamily: 'Onest', fontSize: 14, flex: 1, color: '#2A2722', minWidth: 0 }}
            />
          </div>
        </div>

        {/* Type */}
        <div>
          <label style={lbl}>Төрөл</label>
          <select value={value.type || ''} onChange={e => set({ type: e.target.value })} style={inp}>
            <option value="">Бүгд</option>
            <option value="income">Орлого</option>
            <option value="expense">Зарлага</option>
          </select>
        </div>

        {/* Date from */}
        <div>
          <label style={lbl}>Огноо (эхлэх)</label>
          <input type="date" value={value.from || ''} onChange={e => set({ from: e.target.value })} style={inp} />
        </div>

        {/* Date to */}
        <div>
          <label style={lbl}>Огноо (дуусах)</label>
          <input type="date" value={value.to || ''} onChange={e => set({ to: e.target.value })} style={inp} />
        </div>

        {/* Amount min */}
        <div>
          <label style={lbl}>Дүн (доод)</label>
          <input type="number" value={value.minAmount || ''} onChange={e => set({ minAmount: e.target.value })} placeholder="0₮" style={inp} />
        </div>

        {/* Amount max */}
        <div>
          <label style={lbl}>Дүн (дээд)</label>
          <input type="number" value={value.maxAmount || ''} onChange={e => set({ maxAmount: e.target.value })} placeholder="Хязгааргүй" style={inp} />
        </div>
      </div>

      {/* Category chips */}
      {categories.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <label style={lbl}>Ангилал</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {categories.map(c => {
              const active = (value.category || []).includes(c);
              const hex = catHex(c);
              return (
                <button
                  key={c}
                  onClick={() => toggleCat(c)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    height: 36, padding: '0 13px',
                    border: `1.5px solid ${active ? hex : '#EFE6D6'}`,
                    background: active ? hexTint(hex, 0.13) : '#FFFDF9',
                    borderRadius: 999, cursor: 'pointer',
                    fontFamily: 'Onest', fontWeight: active ? 600 : 500,
                    fontSize: 13, color: active ? hex : '#6E665A',
                  }}
                >
                  <span style={{ fontSize: 15 }}>{catEmoji(c)}</span>
                  {catLabel(c)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {filtersActive && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button
            onClick={onReset}
            style={{ border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'Onest', fontSize: 13.5, fontWeight: 500, color: '#1F7A6B', textDecoration: 'underline', textUnderlineOffset: 3, padding: 4 }}
          >
            Шүүлтүүр цэвэрлэх
          </button>
        </div>
      )}
    </div>
  );
}
