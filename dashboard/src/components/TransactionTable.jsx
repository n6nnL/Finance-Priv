import { useState } from 'react';
import { money, catLabel, catEmoji, catHex, hexTint, displayDesc } from '../lib/format.js';
import { api } from '../lib/api.js';

export default function TransactionTable({ data, total, limit, offset, loading, onPage }) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));

  if (!loading && data.length === 0) {
    return (
      <div style={{ background: '#FFFDF9', border: '1px dashed #E3DACB', borderRadius: 18, padding: '40px 20px', textAlign: 'center', color: '#A39A8A' }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>🔍</div>
        <div style={{ fontSize: 14 }}>Тохирох гүйлгээ олдсонгүй</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontFamily: 'Rubik', fontWeight: 600, fontSize: 16, color: '#2A2722' }}>
          Гүйлгээ <span style={{ fontFamily: 'Onest', fontWeight: 400, fontSize: 13, color: '#A39A8A' }}>({total})</span>
        </div>
        {loading && <span style={{ fontSize: 13, color: '#A39A8A' }}>Ачаалж байна...</span>}
      </div>

      {/* List */}
      <div style={{ background: '#FFFDF9', border: '1px solid #EAE1D3', borderRadius: 18, overflow: 'hidden' }}>
        {data.map((t, i) => {
          const hex = catHex(t.category);
          const isIncome = t.type === 'income';
          return (
            <div
              key={t.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 18px',
                borderBottom: i < data.length - 1 ? '1px solid #F2EADC' : 'none',
              }}
            >
              {/* Icon */}
              <div style={{ width: 42, height: 42, flexShrink: 0, borderRadius: 12, background: hexTint(hex, 0.12), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                {catEmoji(t.category)}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={t.description}>
                  {displayDesc(t)}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: hex, background: hexTint(hex, 0.12), padding: '2px 8px', borderRadius: 999 }}>
                    {catLabel(t.category)}
                  </span>
                  {t.account_last4 && <span style={{ fontSize: 12, color: '#A39A8A' }}>••{t.account_last4}</span>}
                  {t.is_pos === 1 && <span style={{ fontSize: 11, color: '#3FA9A0' }}>POS</span>}
                </div>
                <NoteEditor row={t} />
              </div>

              {/* Amount + date */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontFamily: 'Rubik', fontWeight: 600, fontSize: 15.5, color: isIncome ? '#2E9E5B' : '#D8483B', whiteSpace: 'nowrap' }}>
                  {isIncome ? '+' : '−'}{money(t.amount)}
                </div>
                <div style={{ fontSize: 12, color: '#A39A8A', marginTop: 2 }}>{t.txn_date || '-'}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
        <button
          onClick={() => onPage(offset - limit)}
          disabled={offset <= 0}
          style={{ height: 38, padding: '0 16px', border: '1px solid #EAE1D3', background: '#FFFDF9', borderRadius: 10, fontFamily: 'Onest', fontSize: 13.5, color: '#6E665A', cursor: offset <= 0 ? 'not-allowed' : 'pointer', opacity: offset <= 0 ? 0.4 : 1 }}
        >
          ← Өмнөх
        </button>
        <span style={{ fontSize: 13, color: '#A39A8A' }}>{page} / {pages}</span>
        <button
          onClick={() => onPage(offset + limit)}
          disabled={offset + limit >= total}
          style={{ height: 38, padding: '0 16px', border: '1px solid #EAE1D3', background: '#FFFDF9', borderRadius: 10, fontFamily: 'Onest', fontSize: 13.5, color: '#6E665A', cursor: offset + limit >= total ? 'not-allowed' : 'pointer', opacity: offset + limit >= total ? 0.4 : 1 }}
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
      <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          autoFocus
          autoComplete="off"
          placeholder="тэмдэглэл..."
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          style={{ border: '1px solid #E3DACB', borderRadius: 8, padding: '3px 8px', fontSize: 12, flex: 1, minWidth: 0, fontFamily: 'Onest', outline: 'none', color: '#2A2722' }}
        />
        <button disabled={busy} onClick={save} style={{ fontSize: 12, color: '#1F7A6B', border: 'none', background: 'none', cursor: 'pointer' }}>хадгалах</button>
        <button onClick={() => { setDraft(note); setEditing(false); }} style={{ fontSize: 12, color: '#A39A8A', border: 'none', background: 'none', cursor: 'pointer' }}>×</button>
      </div>
    );
  }

  return (
    <div
      onClick={() => { setDraft(note); setEditing(true); }}
      title="Тэмдэглэл засах"
      style={{ marginTop: 2, fontSize: 12, color: note ? '#8C8578' : '#D8CFBF', cursor: 'pointer' }}
    >
      {note ? `📝 ${note}` : '＋ тэмдэглэл'}
    </div>
  );
}
