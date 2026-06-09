import { useState } from 'react';
import { money, catLabel, catColor, displayDesc } from '../lib/format.js';
import { api } from '../lib/api.js';

// Гүйлгээний хүснэгт. Том дэлгэцэд <table>, утсан дээр карт хэлбэр.
// Тайлбар дор note (тэмдэглэл) inline засах боломжтой.
export default function TransactionTable({ data, total, limit, offset, loading, onPage }) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="bg-white rounded-xl shadow overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <h2 className="font-medium">Гүйлгээ <span className="text-slate-400 text-sm">({total})</span></h2>
        {loading && <span className="text-xs text-slate-400">Ачаалж байна...</span>}
      </div>

      {/* Desktop хүснэгт */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Огноо</th>
              <th className="px-4 py-2 font-medium">Тайлбар / Тэмдэглэл</th>
              <th className="px-4 py-2 font-medium">Ангилал</th>
              <th className="px-4 py-2 font-medium">Данс</th>
              <th className="px-4 py-2 font-medium text-right">Дүн</th>
            </tr>
          </thead>
          <tbody>
            {data.map((t) => (
              <tr key={t.id} className="border-t hover:bg-slate-50 align-top">
                <td className="px-4 py-2 whitespace-nowrap text-slate-500">{t.txn_date || '-'}</td>
                <td className="px-4 py-2 max-w-xs">
                  <div className="truncate" title={t.description}>{displayDesc(t)}</div>
                  <NoteEditor row={t} />
                </td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${catColor(t.category)}`}>{catLabel(t.category)}</span>
                  {t.is_pos === 1 && <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-teal-50 text-teal-600">POS</span>}
                  {t.status === 'pending_review' && (
                    <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">хүлээгдэж буй</span>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-500">{t.account_last4 ? '••' + t.account_last4 : '-'}</td>
                <td className={`px-4 py-2 text-right font-medium whitespace-nowrap ${t.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                  {t.type === 'income' ? '+' : '-'}{money(t.amount)}
                </td>
              </tr>
            ))}
            {data.length === 0 && !loading && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Гүйлгээ алга</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile карт */}
      <div className="sm:hidden divide-y">
        {data.map((t) => (
          <div key={t.id} className="px-4 py-3">
            <div className="flex justify-between items-start">
              <div className="min-w-0">
                <div className="truncate font-medium" title={t.description}>{displayDesc(t)}</div>
                <div className="text-xs text-slate-500 mt-0.5">{t.txn_date || '-'}{t.account_last4 ? ' · ••' + t.account_last4 : ''}</div>
              </div>
              <div className={`font-semibold whitespace-nowrap ml-2 ${t.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                {t.type === 'income' ? '+' : '-'}{money(t.amount)}
              </div>
            </div>
            <div className="mt-1">
              <span className={`text-xs px-2 py-0.5 rounded-full ${catColor(t.category)}`}>{catLabel(t.category)}</span>
              {t.is_pos === 1 && <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-teal-50 text-teal-600">POS</span>}
              {t.status === 'pending_review' && (
                <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">хүлээгдэж буй</span>
              )}
            </div>
            <NoteEditor row={t} />
          </div>
        ))}
        {data.length === 0 && !loading && <div className="px-4 py-8 text-center text-slate-400">Гүйлгээ алга</div>}
      </div>

      {/* Pagination */}
      <div className="px-4 py-3 border-t flex items-center justify-between text-sm">
        <button onClick={() => onPage(offset - limit)} disabled={offset <= 0}
          className="px-3 py-1 rounded border disabled:opacity-40">← Өмнөх</button>
        <span className="text-slate-500">{page} / {pages}</span>
        <button onClick={() => onPage(offset + limit)} disabled={offset + limit >= total}
          className="px-3 py-1 rounded border disabled:opacity-40">Дараах →</button>
      </div>
    </div>
  );
}

// Inline note засагч: note (эсвэл override-ийн санал) харуулж, дарж засна.
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
      <div className="mt-1 flex items-center gap-1">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
          autoComplete="off"
          placeholder="тэмдэглэл..."
          className="border rounded px-2 py-0.5 text-xs flex-1 min-w-0"
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        />
        <button disabled={busy} onClick={save} className="text-xs text-green-600">хадгалах</button>
        <button onClick={() => { setDraft(note); setEditing(false); }} className="text-xs text-slate-400">×</button>
      </div>
    );
  }

  return (
    <div
      className="mt-0.5 text-xs text-slate-500 cursor-pointer hover:text-indigo-600"
      onClick={() => { setDraft(note); setEditing(true); }}
      title="Тэмдэглэл засах"
    >
      {note ? <span>📝 {note}</span> : <span className="text-slate-300">＋ тэмдэглэл</span>}
    </div>
  );
}
