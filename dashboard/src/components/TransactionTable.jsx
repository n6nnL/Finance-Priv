import { useState } from 'react';
import { money, catLabel, catEmoji, catHex, hexTint, displayDesc } from '../lib/format.js';
import { api } from '../lib/api.js';

export default function TransactionTable({ data, total, limit, offset, loading, onPage }) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));

  if (!loading && data.length === 0) {
    return (
      <div className="bg-cream-card border border-dashed border-cream-input rounded-card pt-[40px] px-[20px] pb-[40px] text-center text-[#A39A8A]">
        <div className="text-[32px] mb-[10px]">🔍</div>
        <div className="text-[14px]">Тохирох гүйлгээ олдсонгүй</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-[10px]">
        <div className="font-display font-semibold text-[16px] text-[#2A2722]">
          Гүйлгээ <span className="font-body font-normal text-[13px] text-[#A39A8A]">({total})</span>
        </div>
        {loading && <span className="text-[13px] text-[#A39A8A]">Ачаалж байна...</span>}
      </div>

      {/* List */}
      <div className="bg-cream-card border border-cream-border rounded-card overflow-hidden">
        {data.map((t, i) => {
          const hex = catHex(t.category);
          const isIncome = t.type === 'income';
          return (
            <div
              key={t.id}
              className={`flex items-start sm:items-center gap-[14px] py-[14px] px-[18px] ${i < data.length - 1 ? 'border-b border-[#F2EADC]' : ''}`}
            >
              {/* Icon (fixed) */}
              <div
                className="w-[42px] h-[42px] shrink-0 rounded-[12px] flex items-center justify-center text-[20px]"
                style={{ background: hexTint(hex, 0.12) }}
              >
                {catEmoji(t.category)}
              </div>

              {/* Flexible region: stacks on mobile, icon·info·amount on sm+ */}
              <div className="min-w-0 flex-1 flex flex-col gap-[4px] sm:flex-row sm:items-center sm:justify-between sm:gap-[14px]">
                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[14.5px] truncate" title={t.description}>
                    {displayDesc(t)}
                  </div>
                  <div className="flex flex-wrap items-center gap-[8px] mt-[3px]">
                    <span className="text-[13px] font-semibold px-[8px] py-[2px] rounded-full whitespace-nowrap" style={{ color: hex, background: hexTint(hex, 0.12) }}>
                      {catLabel(t.category)}
                    </span>
                    {t.account_last4 && <span className="text-[13px] text-[#A39A8A] whitespace-nowrap">••{t.account_last4}</span>}
                    {t.is_pos === 1 && <span className="text-[13px] text-[#3FA9A0] whitespace-nowrap">POS</span>}
                  </div>
                  <NoteEditor row={t} />
                </div>

                {/* Amount + date */}
                <div className="text-left sm:text-right shrink-0">
                  <div className="font-display font-semibold text-[15.5px] whitespace-nowrap" style={{ color: isIncome ? '#2E9E5B' : '#D8483B' }}>
                    {isIncome ? '+' : '−'}{money(t.amount)}
                  </div>
                  <div className="text-[13px] text-[#A39A8A] mt-[2px] whitespace-nowrap">{t.txn_date || '-'}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-[14px]">
        <button
          onClick={() => onPage(offset - limit)}
          disabled={offset <= 0}
          className="h-[38px] px-[16px] border border-cream-border bg-cream-card rounded-[10px] font-body text-[13.5px] text-[#6E665A] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← Өмнөх
        </button>
        <span className="text-[13px] text-[#A39A8A]">{page} / {pages}</span>
        <button
          onClick={() => onPage(offset + limit)}
          disabled={offset + limit >= total}
          className="h-[38px] px-[16px] border border-cream-border bg-cream-card rounded-[10px] font-body text-[13.5px] text-[#6E665A] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
        >
          Дараах →
        </button>
      </div>
    </div>
  );
}

function NoteEditor({ row }) {
  const [note, setNote] = useState(row.note || '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.note || '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.updateNote(row.id, draft);
      setNote(draft.trim());
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="mt-[4px] flex items-center gap-[6px]">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          autoFocus
          autoComplete="off"
          placeholder="тэмдэглэл..."
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          className="border border-cream-input rounded-[8px] px-[8px] py-[3px] text-[13px] flex-1 min-w-0 font-body outline-none text-[#2A2722]"
        />
        <button disabled={busy} onClick={save} className="text-[13px] text-[#1F7A6B] border-none bg-transparent cursor-pointer">хадгалах</button>
        <button onClick={() => { setDraft(note); setEditing(false); }} className="text-[13px] text-[#A39A8A] border-none bg-transparent cursor-pointer">×</button>
      </div>
    );
  }

  return (
    <div
      onClick={() => { setDraft(note); setEditing(true); }}
      title="Тэмдэглэл засах"
      className="mt-[2px] text-[13px] cursor-pointer"
      style={{ color: note ? '#8C8578' : '#D8CFBF' }}
    >
      {note ? `📝 ${note}` : '＋ тэмдэглэл'}
    </div>
  );
}
