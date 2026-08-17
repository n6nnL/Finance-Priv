import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { money, eurFmt } from '../lib/format.js';
import {
  groupByCounterparty, totalsByCurrency, eurToMntDisplay, balancePhrase,
  effectiveShare, remainingExcludable, isRepayment, outstandingOf,
} from '../lib/debt.js';

// Өр төлбөрийн дэвтэр (Шинжилгээ табын дотор). Хоёр харагдац:
//   (a) хүн бүрийн ЦЭВЭР үлдэгдэл — "Болд танд 20,000₮ өртэй"
//   (b) БҮХ түүх (зээлсэн/зээлүүлсэн/хаасан) — хэрэглэгч бүрэн түүхийг хүсдэг
// ⚠️ Бүх арифметик lib/debt.js-д (React-гүй, тестлэгдсэн). Энд зөвхөн рендер.
// ⚠️ EUR-ийг эх валютаар нь харуулж, MNT-ийн ойролцоо утгыг ЗӨВХӨН ханш
//    байгаа үед "≈" тэмдэгтэйгээр нэмнэ (ханшгүй бол огт харуулахгүй).
// ⚠️ ХУВААСАН зардал (016): гүйлгээ холбоход "энэ хүний хэсэг хэд вэ?" гэдгийг
//    заана — гүйлгээ БҮХЭЛДЭЭ төсвөөс гарахгүй, зөвхөн тэр хэсэг нь гарна.
// ⚠️ ХЭСЭГЧИЛСЭН БУЦААЛТ (019): "Буцаалт" нь эх бичлэгийг ЗАСАХГҮЙ — эсрэг
//    чиглэлтэй ТУСДАА эвент болж түүхэнд үлдэнэ, үлдэгдэл нь нийлбэрээр буурна.
//    Банкаар ирсэн буцаалтыг гүйлгээтэй холбовол тэр ОРЛОГО төсвөөс хасагдана
//    (сарын орлого хиймлээр өсөхгүй) — ҮЛДЭГДЭЛД ХЭЗЭЭ Ч нөлөөлөхгүй.

const cardCls = 'bg-cream-card border border-cream-border rounded-card p-[22px]';
const inputCls = 'w-full h-[44px] px-[13px] border-[1.5px] border-cream-input rounded-[12px] bg-white font-body text-[14px] text-[#2A2722] outline-none';
const labelCls = 'block text-[13px] font-medium text-[#6E665A] mb-[6px]';

const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Дүнг валютын дагуу форматлах (MNT → money(), EUR → "12.50 €"). */
function amountText(amount, currency) {
  return currency === 'EUR' ? `${eurFmt(amount)} €` : money(amount);
}

export default function DebtLedger() {
  const [entries, setEntries] = useState([]);
  const [balances, setBalances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState('balances'); // 'balances' | 'history'
  const [eurMnt, setEurMnt] = useState(null); // амьд ханш; байхгүй бол null

  async function load() {
    setLoading(true);
    try {
      const [l, b] = await Promise.all([api.debtLedger(), api.debtBalances()]);
      setEntries(l.data || []);
      setBalances(b.data || []);
      setErr('');
    } catch (e) {
      setErr(e.message || 'Ачаалахад алдаа гарлаа');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // EUR→MNT ойролцоо утга харуулахад л хэрэгтэй. Амьд ханш унавал тохиргооны
  // хадгалсан ханш руу шилжинэ; тэр ч байхгүй бол null (хөрвүүлэлт харуулахгүй).
  useEffect(() => {
    let alive = true;
    api.fxRates()
      .then((r) => { if (alive && r.eurMnt) setEurMnt(r.eurMnt); })
      .catch(() => api.getSettings()
        .then((s) => { if (alive && s.settings?.eurMnt) setEurMnt(s.settings.eurMnt); })
        .catch(() => {}));
    return () => { alive = false; };
  }, []);

  const groups = useMemo(() => groupByCounterparty(balances), [balances]);
  const totals = useMemo(() => totalsByCurrency(balances), [balances]);
  const hasEur = balances.some((b) => b.currency === 'EUR');

  async function onSettle(entry) {
    try {
      await api.updateDebt(entry.id, { status: 'settled' });
      await load();
    } catch (e) { setErr(e.message || 'Хаахад алдаа гарлаа'); }
  }
  async function onReopen(entry) {
    try {
      await api.updateDebt(entry.id, { status: 'open' });
      await load();
    } catch (e) { setErr(e.message || 'Нээхэд алдаа гарлаа'); }
  }
  async function onDelete(entry) {
    try {
      await api.deleteDebt(entry.id);
      await load();
    } catch (e) { setErr(e.message || 'Устгахад алдаа гарлаа'); }
  }

  // Эх бичлэг бүрийн counterparty-г буцаалтын мөр дээр харуулахад хэрэгтэй
  // (буцаалт өөрөө ч counterparty-тай ч "аль өрийнх вэ" гэдгийг заана).
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  return (
    <div className={cardCls}>
      {/* Толгой — 360px дээр багана болж хуваагдана */}
      <div className="flex flex-col gap-[12px] sm:flex-row sm:items-center sm:justify-between mb-[16px]">
        <div className="min-w-0">
          <div className="font-display font-semibold text-[17px]">Өр төлбөр</div>
          <div className="text-[13px] text-[#A39A8A] mt-[2px]">Хүн хоорондын зээл — хэнд хэдэн төгрөг өгөх/авах вэ</div>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="shrink-0 h-[44px] px-[16px] border-none bg-[#1F7A6B] text-white font-body font-semibold text-[13.5px] rounded-[12px] cursor-pointer whitespace-nowrap"
        >
          {showForm ? '✕ Хаах' : '+ Бичлэг нэмэх'}
        </button>
      </div>

      {showForm && <AddForm onDone={() => { setShowForm(false); load(); }} onError={setErr} />}

      {err && <div className="text-[#D8483B] text-[13px] mb-[12px]">{err}</div>}

      {/* Хураангуй — валют тусдаа */}
      {!loading && balances.length > 0 && (
        <div className="flex flex-col gap-[8px] sm:flex-row sm:gap-[10px] mb-[16px]">
          <SummaryTile label="Танд ирэх" mnt={totals.MNT.owedToMe} eur={totals.EUR.owedToMe} eurMnt={eurMnt} hex="#2E9E5B" />
          <SummaryTile label="Таны өгөх" mnt={totals.MNT.iOwe} eur={totals.EUR.iOwe} eurMnt={eurMnt} hex="#D8483B" />
        </div>
      )}

      {/* Харагдац сонгогч */}
      <div className="flex gap-[8px] mb-[14px]">
        {[{ id: 'balances', label: 'Үлдэгдэл' }, { id: 'history', label: `Түүх (${entries.length})` }].map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="h-[38px] px-[15px] border rounded-full font-body text-[13.5px] cursor-pointer whitespace-nowrap"
              style={{
                borderColor: active ? '#1F7A6B' : '#EAE1D3',
                background: active ? '#1F7A6B' : '#FFFDF9',
                color: active ? '#fff' : '#6E665A',
                fontWeight: active ? 600 : 500,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="text-[#A39A8A] text-[14px] py-[24px] text-center">Ачаалж байна...</div>
      ) : tab === 'balances' ? (
        groups.length === 0 ? (
          <EmptyState text="Нээлттэй өр алга." />
        ) : (
          <div className="flex flex-col gap-[10px]">
            {groups.map((g) => (
              <div key={g.counterparty} className="border border-[#F0E6D4] rounded-[13px] py-[13px] px-[15px] bg-[#FBF6EC]">
                <div className="font-semibold text-[14.5px] mb-[7px] truncate">{g.counterparty}</div>
                <div className="flex flex-col gap-[6px]">
                  {g.lines.map((line) => {
                    const p = balancePhrase({ ...line, counterparty: g.counterparty });
                    const approx = line.currency === 'EUR' ? eurToMntDisplay(p.abs, eurMnt) : null;
                    return (
                      <div key={line.currency} className="flex flex-col gap-[2px] sm:flex-row sm:items-baseline sm:justify-between sm:gap-[12px]">
                        <span className="text-[13.5px] text-[#6E665A] min-w-0">
                          {p.subject} <span className="font-semibold" style={{ color: p.isOwedToMe ? '#2E9E5B' : '#D8483B' }}>{p.verb}</span>
                        </span>
                        <span className="font-display font-semibold text-[15px] whitespace-nowrap" style={{ color: p.isOwedToMe ? '#2E9E5B' : '#D8483B' }}>
                          {amountText(p.abs, line.currency)}
                          {approx != null && <span className="font-body font-normal text-[13px] text-[#A39A8A]"> ≈ {money(approx)}</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {hasEur && eurMnt == null && (
              <div className="text-[13px] text-[#A39A8A]">EUR-ийн ханш татагдаагүй тул төгрөгийн ойролцоо утга харагдахгүй байна.</div>
            )}
          </div>
        )
      ) : entries.length === 0 ? (
        <EmptyState text="Бичлэг алга." />
      ) : (
        <div className="flex flex-col gap-[8px]">
          {entries.map((e) => (
            <HistoryRow
              key={e.id}
              entry={e}
              parent={isRepayment(e) ? byId.get(e.repaysEntryId) : null}
              eurMnt={eurMnt}
              onSettle={onSettle}
              onReopen={onReopen}
              onDelete={onDelete}
              onRepaid={load}
              onError={setErr}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ text }) {
  return <div className="text-[#A39A8A] text-[14px] py-[24px] text-center">{text}</div>;
}

function SummaryTile({ label, mnt, eur, eurMnt, hex }) {
  const approx = eur > 0 ? eurToMntDisplay(eur, eurMnt) : null;
  return (
    <div className="flex-1 border border-[#F0E6D4] rounded-[13px] py-[12px] px-[14px] bg-[#FBF6EC] min-w-0">
      <div className="text-[13px] text-[#8C8578] mb-[3px]">{label}</div>
      <div className="font-display font-semibold text-[16px] whitespace-nowrap" style={{ color: hex }}>{money(mnt)}</div>
      {eur > 0 && (
        <div className="text-[13px] mt-[2px] whitespace-nowrap" style={{ color: hex }}>
          {eurFmt(eur)} €{approx != null && <span className="text-[#A39A8A]"> ≈ {money(approx)}</span>}
        </div>
      )}
    </div>
  );
}

function HistoryRow({ entry, parent, eurMnt, onSettle, onReopen, onDelete, onRepaid, onError }) {
  const [busy, setBusy] = useState(false);
  const [repaying, setRepaying] = useState(false);
  const lent = entry.direction === 'i_lent';
  const settled = entry.status === 'settled';
  const approx = entry.currency === 'EUR' ? eurToMntDisplay(entry.amount, eurMnt) : null;
  // Холбосон гүйлгээнээс эзэлж буй хэсэг (тодорхойлоогүй бол бичлэгийн бүтэн дүн)
  const share = effectiveShare(entry);

  // 019: буцаалтын эвент нь ӨӨРӨӨ өр БИШ — эх бичлэгийнхээ хэсэг. Тиймээс
  // "зээлсэн/зээлүүлсэн" гэж БУРУУ шошголохгүй, "Хаах" товч ч гарахгүй
  // (хаалт нь эх бичлэг дээрээ хийгддэг бөгөөд буцаалтууд руугаа дамждаг).
  const repayment = isRepayment(entry);
  const outstanding = outstandingOf(entry);
  const repaid = Number(entry.repaid) || 0;
  const canRepay = !repayment && !settled && outstanding > 0;

  const run = async (fn) => { setBusy(true); try { await fn(entry); } finally { setBusy(false); } };

  return (
    <div
      className="border rounded-[13px] py-[12px] px-[14px]"
      style={{
        borderColor: repayment ? '#E4EFEC' : '#F0E6D4',
        background: settled ? '#F7F3EA' : repayment ? '#F6FBFA' : '#FFFDF9',
        opacity: settled ? 0.75 : 1,
      }}
    >
      <div className="flex flex-col gap-[10px] sm:flex-row sm:items-center sm:gap-[13px]">
        <div className="w-[38px] h-[38px] shrink-0 rounded-[11px] flex items-center justify-center text-[17px]"
          style={{ background: repayment ? 'rgba(31,122,107,.12)' : lent ? 'rgba(46,158,91,.12)' : 'rgba(216,72,59,.12)' }}>
          {settled ? '✓' : repayment ? '↩' : lent ? '↗' : '↘'}
        </div>

        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[14px] truncate">
            {entry.counterparty}
            <span className="font-normal text-[13px] text-[#8C8578]">
              {' · '}{repayment ? 'буцаалт' : lent ? 'зээлүүлсэн' : 'зээлсэн'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-[8px] mt-[2px]">
            <span className="text-[13px] text-[#A39A8A] whitespace-nowrap">{entry.entryDate}</span>
            {settled && <span className="text-[13px] text-[#2E9E5B] whitespace-nowrap">хаагдсан</span>}
            {repayment && parent && (
              <span className="text-[13px] text-[#1F7A6B] whitespace-nowrap">
                ↩ {amountText(parent.amount, parent.currency)}-ийн өрөөс
              </span>
            )}
            {/* Хэсэгчилсэн буцаалт хийгдсэн ЭХ бичлэг — үлдэгдлээ шууд харуулна */}
            {!repayment && repaid > 0 && !settled && (
              <span className="text-[13px] text-[#1F7A6B] whitespace-nowrap">
                {amountText(repaid, entry.currency)} буцаагдсан · үлдэгдэл{' '}
                <span className="font-semibold">{amountText(outstanding, entry.currency)}</span>
              </span>
            )}
            {entry.linkedTransactionId && (
              <span className="text-[13px] text-[#3FA9A0] whitespace-nowrap">
                🔗 #{entry.linkedTransactionId} · {amountText(share, entry.currency)} хасав
              </span>
            )}
            {entry.settledTransactionId && <span className="text-[13px] text-[#3FA9A0] whitespace-nowrap">✓#{entry.settledTransactionId}</span>}
          </div>
          {entry.note && <div className="text-[13px] text-[#8C8578] mt-[2px] truncate">📝 {entry.note}</div>}
        </div>

        <div className="flex items-center justify-between gap-[10px] sm:justify-end sm:shrink-0">
          <div className="font-display font-semibold text-[15px] whitespace-nowrap" style={{ color: lent ? '#2E9E5B' : '#D8483B' }}>
            {lent ? '+' : '−'}{amountText(entry.amount, entry.currency)}
            {approx != null && <div className="font-body font-normal text-[13px] text-[#A39A8A] text-right">≈ {money(approx)}</div>}
          </div>
          <div className="flex gap-[6px] shrink-0">
            {canRepay && (
              <button
                disabled={busy}
                onClick={() => setRepaying((v) => !v)}
                className="h-[44px] px-[13px] border rounded-[11px] font-body text-[13px] cursor-pointer whitespace-nowrap"
                style={{ borderColor: '#1F7A6B', background: repaying ? '#1F7A6B' : '#fff', color: repaying ? '#fff' : '#1F7A6B' }}
              >
                {repaying ? '✕' : 'Буцаалт'}
              </button>
            )}
            {!repayment && (
              <button
                disabled={busy}
                onClick={() => run(settled ? onReopen : onSettle)}
                className="h-[44px] px-[13px] border border-cream-input bg-white rounded-[11px] font-body text-[13px] text-[#6E665A] cursor-pointer whitespace-nowrap"
              >
                {settled ? 'Нээх' : 'Хаах'}
              </button>
            )}
            <button
              disabled={busy}
              onClick={() => run(onDelete)}
              title="Устгах"
              className="w-[44px] h-[44px] border border-cream-input bg-white rounded-[11px] text-[13px] text-[#A39A8A] cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      {repaying && (
        <RepayForm
          entry={entry}
          outstanding={outstanding}
          onDone={() => { setRepaying(false); onRepaid(); }}
          onCancel={() => setRepaying(false)}
          onError={onError}
        />
      )}
    </div>
  );
}

/**
 * Буцаалт бүртгэх маягт (эх бичлэгийн мөрөн дотор нээгдэнэ).
 * ⚠️ Хэн/валют нь эх бичлэгээс өвлөгддөг тул ЭНД талбар БАЙХГҮЙ — өөр хүн рүү
 *    эсвэл өөр валютаар "буцаах" боломжгүй (сервер ч мөн адил хамгаална).
 * ⚠️ Гүйлгээ холбовол тэр мөнгөн дүн ТӨСӨВ/ШИНЖИЛГЭЭНЭЭС хасагдана. Зээлүүлсэн
 *    өрийн буцаалт нь ОРЛОГО байдаг тул сарын орлого хиймлээр өсөхгүй болно.
 *    Бэлнээр буцаасан бол холбохгүй орхино — бүрэн хүчинтэй.
 */
function RepayForm({ entry, outstanding, onDone, onCancel, onError }) {
  const [amount, setAmount] = useState(String(outstanding || ''));
  const [entryDate, setEntryDate] = useState(todayYmd());
  const [note, setNote] = useState('');
  const [linkId, setLinkId] = useState('');
  const [txns, setTxns] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.transactions({ limit: 50 })
      .then((r) => { if (alive) setTxns(r.data || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const linkedTxn = useMemo(
    () => txns.find((t) => String(t.id) === String(linkId)) || null,
    [txns, linkId]
  );
  const txnCurrency = linkedTxn ? (linkedTxn.currency || 'MNT') : null;
  const currencyMismatch = !!linkedTxn && txnCurrency !== entry.currency;
  const amt = Number(amount);
  const amountInvalid = !Number.isFinite(amt) || amt <= 0;
  const amountTooBig = !amountInvalid && amt > outstanding + 1e-6;
  const blocked = currencyMismatch || amountInvalid || amountTooBig;

  async function submit() {
    if (blocked) return;
    setBusy(true);
    try {
      await api.repayDebt(entry.id, {
        amount: amt,
        entryDate,
        note: note.trim() || null,
        linkedTransactionId: linkId ? Number(linkId) : null,
      });
      onError('');
      onDone();
    } catch (e) {
      onError(e.message || 'Буцаалт бүртгэхэд алдаа гарлаа');
      setBusy(false);
    }
  }

  return (
    <div className="mt-[12px] pt-[12px] border-t" style={{ borderColor: '#F0E6D4' }}>
      <div className="text-[13px] text-[#6E665A] mb-[10px]">
        <span className="font-semibold">{entry.counterparty}</span>-ийн үлдэгдэл өр:{' '}
        <span className="font-semibold">{amountText(outstanding, entry.currency)}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-[12px]">
        <div>
          <label className={labelCls}>Буцаасан дүн</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal" placeholder="0" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Огноо</label>
          <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Тэмдэглэл (сонголттой)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)}
            maxLength={500} placeholder="жишээ: бэлнээр өгсөн" className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Банкаар ирсэн бол гүйлгээг холбох (сонголттой)</label>
          <select value={linkId} onChange={(e) => setLinkId(e.target.value)} className={inputCls + ' cursor-pointer'}>
            <option value="">— бэлнээр / холбохгүй —</option>
            {txns.map((t) => (
              <option key={t.id} value={t.id}>
                {t.txn_date} · {t.type === 'income' ? '+' : '−'}{amountText(t.amount, t.currency)} · {(t.merchant_place || t.description || '').slice(0, 40)}
              </option>
            ))}
          </select>
          <div className="text-[13px] mt-[5px]" style={{ color: blocked ? '#D8483B' : '#A39A8A' }}>
            {currencyMismatch
              ? `Гүйлгээ ${txnCurrency}, өр ${entry.currency} — валют таарахгүй тул холбох боломжгүй.`
              : amountInvalid
                ? 'Дүн эерэг тоо байх ёстой.'
                : amountTooBig
                  ? `Үлдэгдэл өр ${amountText(outstanding, entry.currency)}-аас их байж болохгүй.`
                  : 'Холбосон гүйлгээ төсөв/шинжилгээнээс хасагдана (орлого хиймлээр өсөхгүй). Дансны ҮЛДЭГДЭЛД нөлөөлөхгүй.'}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-[10px] sm:flex-row mt-[14px]">
        <button onClick={onCancel}
          className="h-[44px] px-[18px] border-[1.5px] border-cream-input bg-white rounded-[12px] font-body font-semibold text-[14px] text-[#6E665A] cursor-pointer">
          Болих
        </button>
        <button onClick={submit} disabled={busy || blocked}
          className="flex-1 h-[44px] border-none rounded-[12px] font-body font-semibold text-[14.5px]"
          style={{
            background: busy || blocked ? '#E7DECF' : '#1F7A6B',
            color: busy || blocked ? '#B7AD9C' : '#fff',
            cursor: busy || blocked ? 'not-allowed' : 'pointer',
          }}>
          {busy ? 'Бүртгэж байна...' : 'Буцаалт бүртгэх'}
        </button>
      </div>
    </div>
  );
}

function AddForm({ onDone, onError }) {
  const [counterparty, setCounterparty] = useState('');
  const [direction, setDirection] = useState('i_lent');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('MNT');
  const [entryDate, setEntryDate] = useState(todayYmd());
  const [note, setNote] = useState('');
  const [linkId, setLinkId] = useState('');
  const [share, setShare] = useState(''); // хоосон = "бичлэгийн бүтэн дүн"
  const [txns, setTxns] = useState([]);
  const [busy, setBusy] = useState(false);

  // Холбох гүйлгээний сонголт — сүүлийн үеийн гүйлгээ (сонголттой талбар)
  useEffect(() => {
    let alive = true;
    api.transactions({ limit: 50 })
      .then((r) => { if (alive) setTxns(r.data || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // --- Хуваасан зардлын тооцоо (бүгд lib/debt.js-ийн цэвэр функцээр) ---
  const linkedTxn = useMemo(
    () => txns.find((t) => String(t.id) === String(linkId)) || null,
    [txns, linkId]
  );
  const txnCurrency = linkedTxn ? (linkedTxn.currency || 'MNT') : null;
  // ⚠️ Валют таарахгүй бол хасалт УТГАГҮЙ (backend хөрвүүлэхгүй) — server 400
  // өгөхөөс өмнө энд тайлбарлана.
  const currencyMismatch = !!linkedTxn && txnCurrency !== currency;
  const remaining = linkedTxn ? remainingExcludable(linkedTxn) : 0;
  const shareValue = share.trim() === '' ? Number(amount) || 0 : Number(share);
  const shareInvalid = share.trim() !== '' && (!Number.isFinite(shareValue) || shareValue < 0);
  const shareTooBig = !!linkedTxn && !currencyMismatch && shareValue > remaining + 1e-6;
  const blocked = currencyMismatch || shareInvalid || shareTooBig;

  async function submit() {
    const amt = Number(amount);
    if (!counterparty.trim()) { onError('Хэний нэрийг бичнэ үү'); return; }
    if (!Number.isFinite(amt) || amt <= 0) { onError('Дүн эерэг тоо байх ёстой'); return; }
    if (currencyMismatch) { onError(`Гүйлгээний валют (${txnCurrency}) бичлэгийнхтэй таарахгүй байна`); return; }
    if (shareInvalid) { onError('Эзлэх хэсэг 0-ээс багагүй тоо байх ёстой'); return; }
    if (shareTooBig) { onError(`Эзлэх хэсэг үлдсэн ${amountText(remaining, txnCurrency)}-аас их байж болохгүй`); return; }
    setBusy(true);
    try {
      await api.addDebt({
        counterparty: counterparty.trim(),
        direction,
        amount: amt,
        currency,
        entryDate,
        note: note.trim() || null,
        linkedTransactionId: linkId ? Number(linkId) : null,
        exclusionShare: share.trim() === '' ? null : Number(share),
      });
      onError('');
      onDone();
    } catch (e) {
      onError(e.message || 'Хадгалахад алдаа гарлаа');
      setBusy(false);
    }
  }

  return (
    <div className="border border-[#F0E6D4] rounded-[14px] p-[16px] mb-[16px] bg-[#FBF6EC]">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-[12px]">
        <div>
          <label className={labelCls}>Хэн</label>
          <input value={counterparty} onChange={(e) => setCounterparty(e.target.value)}
            maxLength={100} placeholder="жишээ: Болд" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Чиглэл</label>
          <select value={direction} onChange={(e) => setDirection(e.target.value)} className={inputCls + ' cursor-pointer'}>
            <option value="i_lent">Би зээлүүлсэн (надад өртэй)</option>
            <option value="i_borrowed">Би зээлсэн (би өртэй)</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Дүн</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal" placeholder="0" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Валют</label>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls + ' cursor-pointer'}>
            <option value="MNT">MNT (₮)</option>
            <option value="EUR">EUR (€)</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Огноо</label>
          <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Тэмдэглэл</label>
          <input value={note} onChange={(e) => setNote(e.target.value)}
            maxLength={500} placeholder="жишээ: галт тэрэгний билет" className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Холбох гүйлгээ (сонголттой)</label>
          <select value={linkId} onChange={(e) => setLinkId(e.target.value)} className={inputCls + ' cursor-pointer'}>
            <option value="">— холбохгүй —</option>
            {txns.map((t) => (
              <option key={t.id} value={t.id}>
                {t.txn_date} · {t.type === 'income' ? '+' : '−'}{amountText(t.amount, t.currency)} · {(t.merchant_place || t.description || '').slice(0, 40)}
              </option>
            ))}
          </select>
          <div className="text-[13px] text-[#A39A8A] mt-[5px]">
            Холбосон гүйлгээнээс доорх хэсэг нь төсөв/ангиллын тооцооноос хасагдана.
            Үлдэгдэлд БҮТЭН дүнгээрээ тоологдсон хэвээр.
          </div>
        </div>

        {/* ХУВААСАН ЗАРДАЛ — зөвхөн гүйлгээ сонгосон үед утгатай */}
        {linkedTxn && (
          <div className="sm:col-span-2">
            <label className={labelCls}>Энэ гүйлгээнээс тухайн хүний хэсэг</label>
            <input
              value={share}
              onChange={(e) => setShare(e.target.value)}
              inputMode="decimal"
              placeholder={String(Number(amount) || 0)}
              className={inputCls}
            />
            <div className="text-[13px] mt-[5px]" style={{ color: currencyMismatch || shareTooBig || shareInvalid ? '#D8483B' : '#A39A8A' }}>
              {currencyMismatch
                ? `Гүйлгээ ${txnCurrency}, бичлэг ${currency} — валют таарахгүй тул холбох боломжгүй.`
                : shareInvalid
                  ? 'Эзлэх хэсэг 0-ээс багагүй тоо байх ёстой.'
                  : shareTooBig
                    ? `Үлдсэн ${amountText(remaining, txnCurrency)}-аас их байж болохгүй.`
                    : `Хоосон бол бичлэгийн дүнг эзэлнэ. Хасах боломжтой үлдэгдэл: ${amountText(remaining, txnCurrency)} / ${amountText(linkedTxn.amount, txnCurrency)}.`}
            </div>
            {!currencyMismatch && !shareInvalid && !shareTooBig && (
              <div className="text-[13px] text-[#6E665A] mt-[3px]">
                Ангилалд үлдэх таны зарлага: <span className="font-semibold whitespace-nowrap">
                  {amountText(Math.max(0, Number(linkedTxn.amount) - (Number(linkedTxn.excluded_amount) || 0) - shareValue), txnCurrency)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-[10px] sm:flex-row mt-[14px]">
        <button onClick={onDone}
          className="h-[44px] px-[18px] border-[1.5px] border-cream-input bg-white rounded-[12px] font-body font-semibold text-[14px] text-[#6E665A] cursor-pointer">
          Болих
        </button>
        <button onClick={submit} disabled={busy || blocked}
          className="flex-1 h-[44px] border-none rounded-[12px] font-body font-semibold text-[14.5px]"
          style={{
            background: busy || blocked ? '#E7DECF' : '#1F7A6B',
            color: busy || blocked ? '#B7AD9C' : '#fff',
            cursor: busy || blocked ? 'not-allowed' : 'pointer',
          }}>
          {busy ? 'Хадгалж байна...' : 'Хадгалах'}
        </button>
      </div>
    </div>
  );
}
