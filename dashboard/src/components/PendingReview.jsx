import { useState } from 'react';
import { money, catLabel, catColor, confLabel, confColor, displayDesc, dateLabel } from '../lib/format.js';
import { api } from '../lib/api.js';

// Баталгаажуулах хүлээж буй (pending_review) гүйлгээ.
// Гүйлгээний ТӨРЛӨӨС хамаарч өөр асуулт:
//   POS (is_pos=1)      → "Ямар газар вэ?" → Газрын нэр (merchant_place)
//   Шилжүүлэг/Төлбөр    → "Яагаад хийсэн бэ?" → Шалтгаан (note)
export default function PendingReview({ items, categories, onConfirmed }) {
  if (!items.length) {
    return <div className="bg-white rounded-xl shadow p-8 text-center text-slate-400">Баталгаажуулах гүйлгээ алга 🎉</div>;
  }
  return (
    <div className="space-y-3">
      {items.map((t) => (
        <PendingRow key={t.id} t={t} categories={categories} onConfirmed={onConfirmed} />
      ))}
    </div>
  );
}

function PendingRow({ t, categories, onConfirmed }) {
  const isPos = t.is_pos === 1;
  const suggestion = t.ai_suggested_category;
  const hasSuggestion = suggestion && suggestion !== 'other';

  const [cat, setCat] = useState(hasSuggestion ? suggestion : 'other');
  const [place, setPlace] = useState(t.merchant_place || t.friendly_name || '');
  const [note, setNote] = useState(t.note || t.override_note || '');
  const [applyAll, setApplyAll] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function confirm(useCat) {
    setBusy(true); setErr('');
    try {
      const extra = isPos ? { merchantPlace: place.trim() } : { note: note.trim() };
      const r = await api.patchCategory(t.id, { category: useCat, applyToAll: applyAll, ...extra });
      onConfirmed(t, useCat, r.updated || 1);
    } catch (e) {
      setErr(e.message || 'Алдаа');
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow p-4">
      {/* Толгой: төрөл badge + тайлбар + дүн */}
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full ${isPos ? 'bg-teal-100 text-teal-700' : 'bg-violet-100 text-violet-700'}`}>
              {isPos ? '🏪 POS' : '↔ Шилжүүлэг/Төлбөр'}
            </span>
          </div>
          <div className="font-medium truncate mt-1" title={t.description}>{displayDesc(t)}</div>
          <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-2">
            <span>📅 {dateLabel(t.txn_date)}{t.txn_date ? ` · ${t.txn_date}` : ''}</span>
            {t.account_last4 && <span>· 💳 ••{t.account_last4}</span>}
          </div>
        </div>
        <div className={`font-semibold whitespace-nowrap ${t.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
          {t.type === 'income' ? '+' : '-'}{money(t.amount)}
        </div>
      </div>

      {/* Төрөл-мэдрэмжтэй асуулт */}
      <div className="mt-3 text-sm text-slate-700">
        {isPos ? 'Энэ POS гүйлгээ. Ямар газар вэ?' : 'Энэ шилжүүлэг/төлбөр. Яагаад хийсэн бэ? Хэнд, юунд?'}
      </div>

      {/* AI санал — ЗӨВХӨН санал байгаа үед харуулна (AI-гүй үед огт харагдахгүй) */}
      {hasSuggestion && (
        <div className="mt-1.5 flex items-center gap-2 text-sm">
          <span className="text-slate-500">AI санал:</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${catColor(suggestion)}`}>{catLabel(suggestion)}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${confColor(t.ai_confidence)}`}>{confLabel(t.ai_confidence)} итгэл</span>
        </div>
      )}

      {/* Төрлөөс хамаарсан оролт */}
      {isPos ? (
        <div className="mt-3">
          <label className="block text-xs text-slate-500 mb-1">Газрын нэр</label>
          <input type="text" value={place} onChange={(e) => setPlace(e.target.value)} autoComplete="off"
            placeholder='жишээ: "Шулуун дун"' className="w-full sm:w-72 border rounded-lg px-3 py-1.5 text-sm" />
        </div>
      ) : (
        <div className="mt-3">
          <label className="block text-xs text-slate-500 mb-1">Шалтгаан / тэмдэглэл</label>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off"
            placeholder='жишээ: "Ээжид сарын мөнгө"' className="w-full border rounded-lg px-3 py-1.5 text-sm" />
        </div>
      )}

      {/* Үйлдэл */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm bg-white">
          {categories.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
        </select>

        {hasSuggestion && (
          <button disabled={busy} onClick={() => confirm(suggestion)}
            className="bg-green-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50">
            ✓ AI саналыг зөвшөөрөх
          </button>
        )}
        <button disabled={busy} onClick={() => confirm(cat)}
          className="bg-indigo-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50">
          Хадгалах
        </button>

        <label className="flex items-center gap-1 text-xs text-slate-600 ml-auto">
          <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
          Энэ мерчантын бүгдэд хэрэглэх
        </label>
      </div>
      {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
    </div>
  );
}
