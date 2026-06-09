import { useEffect, useState, useCallback } from 'react';
import { api, getApiKey, clearApiKey } from './lib/api.js';
import Login from './components/Login.jsx';
import Filters from './components/Filters.jsx';
import Summary from './components/Summary.jsx';
import TransactionTable from './components/TransactionTable.jsx';
import PendingReview from './components/PendingReview.jsx';

const PAGE = 50;
const emptyFilters = { q: '', type: '', from: '', to: '', minAmount: '', maxAmount: '', category: [], limit: PAGE, offset: 0 };

export default function App() {
  const [authed, setAuthed] = useState(!!getApiKey());
  const [tab, setTab] = useState('transactions'); // 'transactions' | 'pending'
  const [categories, setCategories] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);

  const [list, setList] = useState({ data: [], total: 0, limit: PAGE, offset: 0 });
  const [summary, setSummary] = useState(null);
  const [pending, setPending] = useState({ data: [], total: 0 });
  const [pendingLimit, setPendingLimit] = useState(25); // нэг дор хэдийг харуулах
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Ангиллын жагсаалт (нэг удаа)
  useEffect(() => {
    if (!authed) return;
    api.categories().then((r) => setCategories(r.categories)).catch(() => {});
  }, [authed]);

  // Гүйлгээ + хураангуй ачаалах
  const loadTransactions = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [t, s] = await Promise.all([api.transactions(filters), api.summary(filters)]);
      setList({ data: t.data, total: t.total, limit: t.limit, offset: t.offset });
      setSummary(s);
    } catch (e) {
      if (e.status === 401) { clearApiKey(); setAuthed(false); }
      else setError(e.message);
    } finally { setLoading(false); }
  }, [filters]);

  const loadPending = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = await api.pending({ limit: pendingLimit });
      setPending({ data: p.data, total: p.total });
    } catch (e) {
      if (e.status === 401) { clearApiKey(); setAuthed(false); }
      else setError(e.message);
    } finally { setLoading(false); }
  }, [pendingLimit]);

  useEffect(() => {
    if (!authed) return;
    if (tab === 'transactions') loadTransactions();
    else loadPending();
  }, [authed, tab, loadTransactions, loadPending]);

  // pending тоог badge-д харуулахаар үргэлж татна
  useEffect(() => {
    if (!authed) return;
    api.pending({ limit: 1 }).then((p) => setPending((cur) => ({ ...cur, total: p.total }))).catch(() => {});
  }, [authed]);

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;

  function onConfirmed() {
    // Баталгаажуулсны дараа pending + (харагдаж байвал) гүйлгээг сэргээнэ
    loadPending();
    api.pending({ limit: 1 }).then((p) => setPending((cur) => ({ ...cur, total: p.total }))).catch(() => {});
    if (tab === 'transactions') loadTransactions();
  }

  return (
    <div className="min-h-screen">
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="font-semibold">💳 Гүйлгээний Dashboard</h1>
          <button onClick={() => { clearApiKey(); setAuthed(false); }} className="text-sm text-slate-500 hover:text-slate-700">
            Гарах
          </button>
        </div>
        <div className="max-w-6xl mx-auto px-4 flex gap-1">
          <Tab active={tab === 'transactions'} onClick={() => setTab('transactions')}>Гүйлгээ</Tab>
          <Tab active={tab === 'pending'} onClick={() => setTab('pending')}>
            Баталгаажуулах{pending.total > 0 && <span className="ml-1 bg-orange-500 text-white text-xs rounded-full px-1.5">{pending.total}</span>}
          </Tab>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-4">
        {error && <div className="bg-red-50 text-red-700 rounded-lg px-4 py-2 mb-4 text-sm">{error}</div>}

        {tab === 'transactions' ? (
          <>
            <Filters
              categories={categories}
              value={filters}
              onChange={setFilters}
              onReset={() => setFilters(emptyFilters)}
            />
            <Summary summary={summary} />
            <TransactionTable
              {...list}
              loading={loading}
              onPage={(off) => setFilters((f) => ({ ...f, offset: Math.max(0, off) }))}
            />
          </>
        ) : (
          <>
            <div className="mb-3 text-sm text-slate-500">
              Нийт <b>{pending.total}</b> гүйлгээ баталгаажуулах хүлээж байна
              {pending.total > 0 && <> — <b>{pending.data.length}</b> харагдаж байна</>}
            </div>
            <PendingReview items={pending.data} categories={categories} onConfirmed={onConfirmed} />
            {pending.data.length < pending.total && (
              <div className="mt-4 text-center">
                <button
                  onClick={() => setPendingLimit((n) => n + 25)}
                  className="px-4 py-2 rounded-lg border bg-white text-sm font-medium hover:bg-slate-50"
                >
                  Цааш ачаалах (+25)
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Tab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
        active ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  );
}
