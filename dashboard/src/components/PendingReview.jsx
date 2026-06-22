import { useState } from 'react';
import { money, catLabel, catEmoji, catHex, hexTint, displayDesc } from '../lib/format.js';
import { api } from '../lib/api.js';

// Inline pending banner — shows at top of txn page
export default function PendingReview({ items, total, categories, onConfirmed }) {
  const [editingId, setEditingId] = useState(null);

  if (!items.length && !total) return null;

  const editItem = items.find(t => t.id === editingId);

  return (
    <>
      <div style={{ background: 'linear-gradient(135deg,#FFF6E9,#FFEFD6)', border: '1.5px solid #F4DDB0', borderRadius: 18, padding: '18px 20px', marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: '#F0A93C', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>⚡</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 15, color: '#8A5A12' }}>
              {total} гүйлгээ ангилахыг хүлээж байна
            </div>
            <div style={{ fontSize: 13, color: '#A87C36' }}>Систем автоматаар барьлаа — та зөвхөн баталгаажуулна уу</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {items.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 13, background: '#FFFDF9', border: '1px solid #F1E4CC', borderRadius: 13, padding: '12px 14px' }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, background: '#F3ECDD', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                {t.ai_suggested_category ? catEmoji(t.ai_suggested_category) : '🔔'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayDesc(t)}</div>
                <div style={{ fontSize: 12, color: '#A39A8A' }}>{t.txn_date}{t.account_last4 ? ` · ••${t.account_last4}` : ''}</div>
              </div>
              <div style={{ fontFamily: 'Rubik', fontWeight: 600, fontSize: 15, color: t.type === 'income' ? '#2E9E5B' : '#D8483B', whiteSpace: 'nowrap' }}>
                {t.type === 'income' ? '+' : '−'}{money(t.amount)}
              </div>
              <button
                onClick={() => setEditingId(t.id)}
                style={{ border: 'none', background: '#1F7A6B', color: '#fff', fontFamily: 'Onest', fontWeight: 600, fontSize: 13, padding: '9px 15px', borderRadius: 10, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                Ангилах
              </button>
            </div>
          ))}
        </div>
      </div>

      {editItem && (
        <ConfirmModal
          t={editItem}
          categories={categories}
          onClose={() => setEditingId(null)}
          onSaved={(t, cat) => { setEditingId(null); onConfirmed(t, cat); }}
        />
      )}
    </>
  );
}

function ConfirmModal({ t, categories, onClose, onSaved }) {
  const isPos = t.is_pos === 1;
  const suggest = t.ai_suggested_category;
  const [cat, setCat] = useState(null);
  const [note, setNote] = useState(t.note || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    if (!cat) return;
    setBusy(true); setErr('');
    try {
      const extra = isPos ? { merchantPlace: note.trim() } : { note: note.trim() };
      await api.patchCategory(t.id, { category: cat, applyToAll: true, ...extra });
      onSaved(t, cat);
    } catch (e) {
      setErr(e.message || 'Алдаа гарлаа');
      setBusy(false);
    }
  }

  const disabled = !cat || busy;

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(42,39,34,.42)', backdropFilter: 'blur(3px)', zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#FFFDF9', width: '100%', maxWidth: 480, borderRadius: '24px 24px 0 0', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 -10px 40px rgba(0,0,0,.18)' }}
      >
        {/* Modal header */}
        <div style={{ padding: '20px 22px 14px', position: 'sticky', top: 0, background: '#FFFDF9', borderBottom: '1px solid #F2EADC', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: 'Rubik', fontWeight: 600, fontSize: 18 }}>Гүйлгээ баталгаажуулах</div>
            <div style={{ fontSize: 12.5, color: '#A39A8A', marginTop: 2 }}>Систем барьсан — ангилаад хадгал</div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, border: 'none', background: '#F2EADC', borderRadius: '50%', cursor: 'pointer', fontSize: 16, color: '#8C8578', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>

        <div style={{ padding: '20px 22px 24px' }}>
          {/* Transaction preview */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, background: '#FBF6EC', border: '1px solid #F0E6D4', borderRadius: 14, padding: '14px 16px', marginBottom: 22 }}>
            <div style={{ width: 46, height: 46, borderRadius: 13, background: cat ? hexTint(catHex(cat), 0.15) : '#F3ECDD', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
              {cat ? catEmoji(cat) : '🔔'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayDesc(t)}</div>
              <div style={{ fontSize: 12.5, color: '#A39A8A' }}>{t.txn_date}{t.account_last4 ? ` · ••${t.account_last4}` : ''}</div>
            </div>
            <div style={{ fontFamily: 'Rubik', fontWeight: 600, fontSize: 18, color: t.type === 'income' ? '#2E9E5B' : '#D8483B', flexShrink: 0 }}>
              {t.type === 'income' ? '+' : '−'}{money(t.amount)}
            </div>
          </div>

          {/* Note input */}
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#6E665A', marginBottom: 7 }}>
            {isPos ? 'Газрын нэр' : 'Юунд зарцуулсан бэ?'}
          </label>
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={isPos ? 'ж: Тэнгис кино театр' : 'ж: Ээжийн сарын мөнгө'}
            style={{ width: '100%', height: 48, padding: '0 15px', border: '1.5px solid #E3DACB', borderRadius: 13, background: '#fff', fontFamily: 'Onest', fontSize: 15, color: '#2A2722', outline: 'none', marginBottom: 22, boxSizing: 'border-box' }}
          />

          {/* Category chips */}
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#6E665A', marginBottom: 10 }}>Ангилал сонгох</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 24 }}>
            {categories.map(c => {
              const sel = cat === c;
              const isSug = !cat && c === suggest;
              const hex = catHex(c);
              return (
                <button
                  key={c}
                  onClick={() => setCat(c)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9,
                    padding: '11px 12px',
                    border: `1.5px solid ${sel ? hex : isSug ? 'rgba(240,169,60,.55)' : '#EFE6D6'}`,
                    background: sel ? hexTint(hex, 0.14) : isSug ? 'rgba(240,169,60,.08)' : '#FFFDF9',
                    borderRadius: 13, cursor: 'pointer',
                    fontFamily: 'Onest', fontSize: 13.5, fontWeight: sel ? 600 : 500,
                    color: sel ? hex : '#4A453D', textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 17, flexShrink: 0 }}>{catEmoji(c)}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{catLabel(c)}</span>
                  {isSug && <span style={{ fontSize: 13, color: '#F0A93C', flexShrink: 0 }}>★</span>}
                </button>
              );
            })}
          </div>

          {err && <div style={{ color: '#D8483B', fontSize: 13, marginBottom: 12 }}>{err}</div>}

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 11 }}>
            <button onClick={onClose} style={{ flexShrink: 0, padding: '0 20px', height: 52, border: '1.5px solid #E3DACB', background: '#fff', borderRadius: 14, fontFamily: 'Onest', fontWeight: 600, fontSize: 15, color: '#6E665A', cursor: 'pointer' }}>
              Болих
            </button>
            <button
              onClick={save}
              disabled={disabled}
              style={{ flex: 1, height: 52, border: 'none', borderRadius: 14, background: disabled ? '#E7DECF' : '#1F7A6B', color: disabled ? '#B7AD9C' : '#fff', fontFamily: 'Onest', fontWeight: 600, fontSize: 16, cursor: disabled ? 'not-allowed' : 'pointer' }}
            >
              {busy ? 'Хадгалж байна...' : !cat ? 'Ангилал сонгоно уу' : 'Баталгаажуулах'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
