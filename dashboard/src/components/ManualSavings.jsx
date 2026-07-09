import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';

// Гар аргаар удирдсан хөрөнгө (бэлэн мөнгө/EUR) — Голомт Gmail listener харахгүй
// мөнгө. BudgetTracker/BalanceHistory-аас тусдаа, НЭМЭЛТ view (тэднийг хөндөхгүй).
// amount (MNT) ЗААВАЛ, эерэг — balance-д ашиглагдах цорын ганц утга. EUR/ханш нь
// зөвхөн лавлагаа, frontend талд MNT-г автоматаар тооцож бөглөнө (гараар засаж болно).

const TEAL = '#1F7A6B';
const RED = '#D8483B';

const emptyForm = { date: '', type: 'deposit', amount: '', amountEur: '', exchangeRate: '', note: '' };

const inputCls = 'h-[42px] px-[12px] border-[1.5px] border-cream-input rounded-[10px] bg-white font-body text-[14px] text-[#2A2722] outline-none w-full min-w-0';
const labelCls = 'text-[13px] font-medium text-[#6E665A] mb-[6px] block';
const cardCls = 'bg-cream-card border border-cream-border rounded-card p-[18px] flex flex-col gap-[16px]';

export default function ManualSavings() {
  const [data, setData] = useState(null); // { rows, balance } | null (ачаалж байна)
  const [err, setErr] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  // Тохиргоонд хадгалсан EUR→MNT ханш — "Өнөөдрийн ханш" товчоор хурдан бөглөхөд.
  const [defaultEurMnt, setDefaultEurMnt] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await api.manualSavings();
      setData({ rows: r.data, balance: r.balance });
    } catch (e) {
      setErr(e.message || 'Ачаалж чадсангүй');
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.getSettings().then((r) => setDefaultEurMnt(r?.settings?.eurMnt ?? null)).catch(() => {});
  }, []);

  // EUR + ханш хоёул эерэг бол MNT-г автоматаар тооцож бөглөнө (хэрэглэгч дараа нь гараар засаж болно).
  const set = (patch) => setForm((f) => {
    const next = { ...f, ...patch };
    const eur = Number(next.amountEur);
    const rate = Number(next.exchangeRate);
    if (('amountEur' in patch || 'exchangeRate' in patch) && eur > 0 && rate > 0) {
      next.amount = String(Math.round(eur * rate));
    }
    return next;
  });

  const resetForm = () => { setForm(emptyForm); setEditingId(null); setFormErr(''); };

  const startEdit = (row) => {
    setEditingId(row.id);
    setForm({
      date: row.date,
      type: row.type,
      amount: String(row.amount),
      amountEur: row.amountEur == null ? '' : String(row.amountEur),
      exchangeRate: row.exchangeRate == null ? '' : String(row.exchangeRate),
      note: row.note || '',
    });
    setFormErr('');
  };

  const submit = async () => {
    setFormErr('');
    const amount = Number(form.amount);
    if (!form.date) { setFormErr('Огноо шаардлагатай'); return; }
    if (!(amount > 0)) { setFormErr('MNT дүн эерэг байх ёстой'); return; }
    const payload = {
      date: form.date,
      type: form.type,
      amount,
      amountEur: form.amountEur === '' ? null : Number(form.amountEur),
      exchangeRate: form.exchangeRate === '' ? null : Number(form.exchangeRate),
      note: form.note.trim() || null,
    };
    setSaving(true);
    try {
      if (editingId) await api.updateManualSaving(editingId, payload);
      else await api.addManualSaving(payload);
      resetForm();
      await load();
    } catch (e) {
      setFormErr(e.body?.error || e.message || 'Хадгалахад алдаа гарлаа');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    try {
      await api.deleteManualSaving(id);
      if (editingId === id) resetForm();
      await load();
    } catch { /* ignore — жагсаалт хэвээр, дараа дахин оролдож болно */ }
  };

  if (err) return <div className={cardCls}><div className="text-[14px] text-[#D8483B]">{err}</div></div>;
  if (!data) return <div className={cardCls}><div className="text-[14px] text-[#8C8578]">Ачаалж байна…</div></div>;

  const { rows, balance } = data;
  const balNeg = balance < 0;

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between flex-wrap gap-[8px]">
        <div className="font-display font-semibold text-[17px]">Гар аргаар удирдсан хөрөнгө</div>
      </div>
      <div className="text-[13px] text-[#A39A8A] leading-[1.5]">
        Банкны имэйлээр харагдахгүй мөнгө (гэрт байгаа бэлэн EUR, хараахан хөрвүүлээгүй хэсэг г.м) — эндээс гараар нэмнэ/засна.
      </div>

      <div className="rounded-[12px] p-[16px] text-white" style={{ background: 'linear-gradient(135deg,#1F7A6B,#2E9E7E)' }}>
        <div className="text-[13px] text-[rgba(255,255,255,0.82)] mb-[6px]">Гар аргаар удирдсан үлдэгдэл</div>
        <div className="font-display font-semibold text-[26px] tracking-[-0.5px] whitespace-nowrap">
          {balNeg ? '−' : ''}{money(Math.abs(balance))}
        </div>
      </div>

      {/* Форм: нэмэх/засах */}
      <div className="bg-white border border-cream-border rounded-[12px] p-[14px] flex flex-col gap-[12px]">
        <div className="font-display font-semibold text-[14px]">{editingId ? 'Мөр засах' : 'Шинэ мөр нэмэх'}</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[10px]">
          <div>
            <label className={labelCls}>Огноо</label>
            <input type="date" className={inputCls} value={form.date} onChange={(e) => set({ date: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Төрөл</label>
            <select className={inputCls} value={form.type} onChange={(e) => set({ type: e.target.value })}>
              <option value="deposit">Орлого (нэмэгдэл)</option>
              <option value="withdrawal">Зарлага (хасагдал)</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>EUR дүн (сонголт)</label>
            <input type="number" inputMode="decimal" className={inputCls} placeholder="ж: 100"
              value={form.amountEur} onChange={(e) => set({ amountEur: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Ханш (сонголт)</label>
            <div className="flex gap-[6px]">
              <input type="number" inputMode="decimal" className={inputCls} placeholder="ж: 3910"
                value={form.exchangeRate} onChange={(e) => set({ exchangeRate: e.target.value })} />
              {defaultEurMnt != null && (
                <button type="button" onClick={() => set({ exchangeRate: String(defaultEurMnt) })}
                  title={`Тохиргооны EUR→MNT ханш ашиглах (${defaultEurMnt}₮)`}
                  className="h-[42px] px-[10px] shrink-0 border border-cream-border bg-white rounded-[10px] text-[12px] font-medium text-[#1F7A6B] cursor-pointer whitespace-nowrap">
                  Өнөөдрийн
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-[10px]">
          <div>
            <label className={labelCls}>MNT дүн (заавал)</label>
            <input type="number" inputMode="numeric" className={inputCls} placeholder="ж: 391000"
              value={form.amount} onChange={(e) => set({ amount: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Тэмдэглэл (сонголт)</label>
            <input className={inputCls} placeholder="ж: цалингийн үлдэгдэл" value={form.note} onChange={(e) => set({ note: e.target.value })} />
          </div>
        </div>
        {formErr && <div className="text-[13px] text-[#D8483B]">{formErr}</div>}
        <div className="flex items-center gap-[10px] flex-wrap">
          <button onClick={submit} disabled={saving}
            className="h-[42px] px-[20px] border-none bg-brand text-white font-body font-semibold text-[14px] rounded-[10px] cursor-pointer whitespace-nowrap disabled:opacity-60">
            {saving ? 'Хадгалж байна…' : editingId ? 'Хадгалах' : '+ Нэмэх'}
          </button>
          {editingId && (
            <button onClick={resetForm}
              className="h-[42px] px-[16px] border border-cream-border bg-white rounded-[10px] text-[14px] font-medium text-[#6E665A] cursor-pointer whitespace-nowrap">
              Цуцлах
            </button>
          )}
        </div>
      </div>

      {/* Жагсаалт */}
      <div className="flex flex-col gap-[10px]">
        {rows.length === 0 && <div className="text-[13px] text-[#A39A8A]">Мөр алга</div>}
        {rows.map((r) => (
          <div key={r.id}
            className="flex flex-col gap-[4px] sm:flex-row sm:items-center sm:gap-[10px] border-b border-cream-border pb-[10px] last:border-none last:pb-0">
            <span className="text-[13px] text-[#8C8578] whitespace-nowrap shrink-0">{r.date}</span>
            <span className="text-[13px] font-medium whitespace-nowrap shrink-0" style={{ color: r.type === 'deposit' ? TEAL : RED }}>
              {r.type === 'deposit' ? '↓ Орлого' : '↑ Зарлага'}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-[#6E665A]">
              {r.note || ''}
              {r.amountEur != null && r.exchangeRate != null && (
                <span className="text-[#A39A8A]"> (€{r.amountEur} × {r.exchangeRate})</span>
              )}
            </span>
            <span className="font-display font-semibold text-[14px] whitespace-nowrap shrink-0" style={{ color: r.type === 'deposit' ? TEAL : RED }}>
              {r.type === 'deposit' ? '+' : '−'}{money(r.amount)}
            </span>
            <div className="flex items-center gap-[6px] shrink-0">
              <button onClick={() => startEdit(r)} aria-label="Засах"
                className="w-[32px] h-[32px] rounded-[8px] border border-cream-border bg-white text-[#6E665A] text-[14px] cursor-pointer flex items-center justify-center">✎</button>
              <button onClick={() => remove(r.id)} aria-label="Устгах"
                className="w-[32px] h-[32px] rounded-[8px] border border-cream-border bg-white text-[#C2698F] text-[14px] cursor-pointer flex items-center justify-center">🗑</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
