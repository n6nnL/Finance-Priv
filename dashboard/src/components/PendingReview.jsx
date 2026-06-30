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
      <div
        className="border-[1.5px] border-[#F4DDB0] rounded-card py-[18px] px-[20px] mb-[22px]"
        style={{ background: 'linear-gradient(135deg,#FFF6E9,#FFEFD6)' }}
      >
        <div className="flex items-center gap-[10px] mb-[14px]">
          <div className="w-[32px] h-[32px] rounded-[10px] bg-[#F0A93C] flex items-center justify-center text-[16px]">⚡</div>
          <div className="flex-1">
            <div className="font-semibold text-[15px] text-[#8A5A12]">
              {total} гүйлгээ ангилахыг хүлээж байна
            </div>
            <div className="text-[13px] text-[#A87C36]">Систем автоматаар барьлаа — та зөвхөн баталгаажуулна уу</div>
          </div>
        </div>

        <div className="flex flex-col gap-[9px]">
          {items.map(t => (
            <div key={t.id} className="flex items-start sm:items-center gap-[13px] bg-cream-card border border-[#F1E4CC] rounded-[13px] py-[12px] px-[14px]">
              <div className="w-[38px] h-[38px] shrink-0 rounded-[11px] bg-[#F3ECDD] flex items-center justify-center text-[18px]">
                {t.ai_suggested_category ? catEmoji(t.ai_suggested_category) : '🔔'}
              </div>
              <div className="min-w-0 flex-1 flex flex-col gap-[8px] sm:flex-row sm:items-center sm:gap-[13px]">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[14px] truncate">{displayDesc(t)}</div>
                  <div className="text-[13px] text-[#A39A8A] whitespace-nowrap">{t.txn_date}{t.account_last4 ? ` · ••${t.account_last4}` : ''}</div>
                </div>
                <div className="flex items-center justify-between gap-[12px] sm:justify-end">
                  <div className="font-display font-semibold text-[15px] whitespace-nowrap" style={{ color: t.type === 'income' ? '#2E9E5B' : '#D8483B' }}>
                    {t.type === 'income' ? '+' : '−'}{money(t.amount)}
                  </div>
                  <button
                    onClick={() => setEditingId(t.id)}
                    className="shrink-0 border-none bg-[#1F7A6B] text-white font-body font-semibold text-[13px] py-[9px] px-[15px] rounded-[10px] cursor-pointer whitespace-nowrap"
                  >
                    Ангилах
                  </button>
                </div>
              </div>
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
      className="fixed inset-0 bg-[rgba(42,39,34,0.42)] backdrop-blur-[3px] z-50 flex items-end justify-center"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-cream-card w-full max-w-[480px] rounded-t-[24px] max-h-[92vh] overflow-y-auto shadow-[0_-10px_40px_rgba(0,0,0,0.18)]"
      >
        {/* Modal header */}
        <div className="pt-[20px] px-[22px] pb-[14px] sticky top-0 bg-cream-card border-b border-[#F2EADC] flex items-center justify-between">
          <div>
            <div className="font-display font-semibold text-[18px]">Гүйлгээ баталгаажуулах</div>
            <div className="text-[13px] text-[#A39A8A] mt-[2px]">Систем барьсан — ангилаад хадгал</div>
          </div>
          <button onClick={onClose} className="w-[32px] h-[32px] border-none bg-[#F2EADC] rounded-full cursor-pointer text-[16px] text-[#8C8578] flex items-center justify-center">✕</button>
        </div>

        <div className="pt-[20px] px-[22px] pb-[24px]">
          {/* Transaction preview */}
          <div className="flex items-center gap-[13px] bg-[#FBF6EC] border border-[#F0E6D4] rounded-[14px] py-[14px] px-[16px] mb-[22px]">
            <div
              className="w-[46px] h-[46px] rounded-[13px] flex items-center justify-center text-[22px]"
              style={{ background: cat ? hexTint(catHex(cat), 0.15) : '#F3ECDD' }}
            >
              {cat ? catEmoji(cat) : '🔔'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[15px] truncate">{displayDesc(t)}</div>
              <div className="text-[13px] text-[#A39A8A]">{t.txn_date}{t.account_last4 ? ` · ••${t.account_last4}` : ''}</div>
            </div>
            <div className="font-display font-semibold text-[18px] shrink-0" style={{ color: t.type === 'income' ? '#2E9E5B' : '#D8483B' }}>
              {t.type === 'income' ? '+' : '−'}{money(t.amount)}
            </div>
          </div>

          {/* Note input */}
          <label className="block text-[13px] font-medium text-[#6E665A] mb-[7px]">
            {isPos ? 'Газрын нэр' : 'Юунд зарцуулсан бэ?'}
          </label>
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={isPos ? 'ж: Тэнгис кино театр' : 'ж: Ээжийн сарын мөнгө'}
            className="w-full h-[48px] px-[15px] border-[1.5px] border-cream-input rounded-[13px] bg-white font-body text-[15px] text-[#2A2722] outline-none mb-[22px]"
          />

          {/* Category chips */}
          <label className="block text-[13px] font-medium text-[#6E665A] mb-[10px]">Ангилал сонгох</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[8px] mb-[24px]">
            {categories.map(c => {
              const sel = cat === c;
              const isSug = !cat && c === suggest;
              const hex = catHex(c);
              return (
                <button
                  key={c}
                  onClick={() => setCat(c)}
                  className="flex items-center gap-[9px] py-[11px] px-[12px] border-[1.5px] rounded-[13px] cursor-pointer font-body text-[13.5px] text-left"
                  style={{
                    borderColor: sel ? hex : isSug ? 'rgba(240,169,60,.55)' : '#EFE6D6',
                    background: sel ? hexTint(hex, 0.14) : isSug ? 'rgba(240,169,60,.08)' : '#FFFDF9',
                    fontWeight: sel ? 600 : 500,
                    color: sel ? hex : '#4A453D',
                  }}
                >
                  <span className="text-[17px] shrink-0">{catEmoji(c)}</span>
                  <span className="flex-1 truncate">{catLabel(c)}</span>
                  {isSug && <span className="text-[13px] text-[#F0A93C] shrink-0">★</span>}
                </button>
              );
            })}
          </div>

          {err && <div className="text-[#D8483B] text-[13px] mb-[12px]">{err}</div>}

          {/* Buttons */}
          <div className="flex gap-[11px]">
            <button onClick={onClose} className="shrink-0 px-[20px] h-[52px] border-[1.5px] border-cream-input bg-white rounded-[14px] font-body font-semibold text-[15px] text-[#6E665A] cursor-pointer">
              Болих
            </button>
            <button
              onClick={save}
              disabled={disabled}
              className="flex-1 h-[52px] border-none rounded-[14px] font-body font-semibold text-[16px]"
              style={{
                background: disabled ? '#E7DECF' : '#1F7A6B',
                color: disabled ? '#B7AD9C' : '#fff',
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            >
              {busy ? 'Хадгалж байна...' : !cat ? 'Ангилал сонгоно уу' : 'Баталгаажуулах'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
