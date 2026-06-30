import { catLabel, catEmoji, catHex, hexTint } from '../lib/format.js';

export default function Filters({ categories, value, onChange, onReset }) {
  const set = (patch) => onChange({ ...value, ...patch, offset: 0 });

  function toggleCat(c) {
    const cur = value.category || [];
    const next = cur.includes(c) ? cur.filter(x => x !== c) : [...cur, c];
    set({ category: next });
  }

  const filtersActive = !!(value.q || value.type || (value.category || []).length || value.from || value.to || value.minAmount || value.maxAmount);

  const inpCls = 'w-full h-[46px] px-[13px] border-[1.5px] border-cream-input rounded-[12px] bg-white font-body text-[14px] text-[#2A2722] outline-none';
  const lblCls = 'block text-[13px] font-medium text-[#6E665A] mb-[6px]';

  return (
    <div className="bg-cream-card border border-cream-border rounded-card pt-[18px] px-[18px] pb-[16px] mb-[18px]">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[14px]">
        {/* Search */}
        <div className="sm:col-span-2 lg:col-span-1">
          <label className={lblCls}>Хайлт (тайлбар)</label>
          <div className="flex items-center gap-[8px] bg-white border-[1.5px] border-cream-input rounded-[12px] px-[13px] h-[46px]">
            <span className="text-[#B0A696] text-[15px]">🔍</span>
            <input
              value={value.q || ''}
              onChange={e => set({ q: e.target.value })}
              placeholder="жишээ: Veranda, Nomin..."
              className="border-none bg-transparent outline-none font-body text-[14px] flex-1 text-[#2A2722] min-w-0"
            />
          </div>
        </div>

        {/* Type */}
        <div>
          <label className={lblCls}>Төрөл</label>
          <select value={value.type || ''} onChange={e => set({ type: e.target.value })} className={inpCls}>
            <option value="">Бүгд</option>
            <option value="income">Орлого</option>
            <option value="expense">Зарлага</option>
          </select>
        </div>

        {/* Date from */}
        <div>
          <label className={lblCls}>Огноо (эхлэх)</label>
          <input type="date" value={value.from || ''} onChange={e => set({ from: e.target.value })} className={inpCls} />
        </div>

        {/* Date to */}
        <div>
          <label className={lblCls}>Огноо (дуусах)</label>
          <input type="date" value={value.to || ''} onChange={e => set({ to: e.target.value })} className={inpCls} />
        </div>

        {/* Amount min */}
        <div>
          <label className={lblCls}>Дүн (доод)</label>
          <input type="number" value={value.minAmount || ''} onChange={e => set({ minAmount: e.target.value })} placeholder="0₮" className={inpCls} />
        </div>

        {/* Amount max */}
        <div>
          <label className={lblCls}>Дүн (дээд)</label>
          <input type="number" value={value.maxAmount || ''} onChange={e => set({ maxAmount: e.target.value })} placeholder="Хязгааргүй" className={inpCls} />
        </div>
      </div>

      {/* Category chips */}
      {categories.length > 0 && (
        <div className="mt-[16px]">
          <label className={lblCls}>Ангилал</label>
          <div className="flex flex-wrap gap-[8px]">
            {categories.map(c => {
              const active = (value.category || []).includes(c);
              const hex = catHex(c);
              return (
                <button
                  key={c}
                  onClick={() => toggleCat(c)}
                  className="flex items-center gap-[7px] h-[36px] px-[13px] border-[1.5px] rounded-full cursor-pointer font-body text-[13px]"
                  style={{
                    borderColor: active ? hex : '#EFE6D6',
                    background: active ? hexTint(hex, 0.13) : '#FFFDF9',
                    fontWeight: active ? 600 : 500,
                    color: active ? hex : '#6E665A',
                  }}
                >
                  <span className="text-[15px]">{catEmoji(c)}</span>
                  {catLabel(c)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {filtersActive && (
        <div className="flex justify-end mt-[14px]">
          <button
            onClick={onReset}
            className="border-none bg-transparent cursor-pointer font-body text-[13.5px] font-medium text-[#1F7A6B] underline underline-offset-[3px] p-[4px]"
          >
            Шүүлтүүр цэвэрлэх
          </button>
        </div>
      )}
    </div>
  );
}
