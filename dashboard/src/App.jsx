import { useEffect, useState, useCallback } from 'react';
import { api, isAuthed, clearTokens } from './lib/api.js';
import Login from './components/Login.jsx';
import Filters from './components/Filters.jsx';
import Summary from './components/Summary.jsx';
import TransactionTable from './components/TransactionTable.jsx';
import PendingReview from './components/PendingReview.jsx';
import Analyze from './components/Analyze.jsx';
import Insights from './components/Insights.jsx';

const PAGE = 50;
const emptyFilters = { q: '', type: '', from: '', to: '', minAmount: '', maxAmount: '', category: [], limit: PAGE, offset: 0 };

// 3 үндсэн хэсэг
const SECTIONS = [
  { key: 'record', label: 'Бүртгэл', icon: '📒' },
  { key: 'analyze', label: 'Шинжилгээ', icon: '📊' },
  { key: 'insights', label: 'Шийдвэр', icon: '🧭' },
];

export default function App() {
  const [authed, setAuthed] = useState(isAuthed());
  const [section, setSection] = useState('record'); // record | analyze | insights
  const [sub, setSub] = useState('transactions'); // record доторх: transactions | pending
  const [categories, setCategories] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);

  const [list, setList] = useState({ data: [], total: 0, limit: PAGE, offset: 0 });
  const [summary, setSummary] = useState(null);
  const [pending, setPending] = useState({ data: [], total: 0 });
  const [pendingLimit, setPendingLimit] = useState(25);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function logout() { clearTokens(); setAuthed(false); }
  function handle401(e) { if (e.status === 401) { clearTokens(); setAuthed(false); return true; } return false; }

  useEffect(() => {
    if (!authed) return;
    api.categories().then((r) => setCategories(r.categories)).catch(() => {});
    api.pending({ limit: 1 }).then((p) => setPending((c) => ({ ...c, total: p.total }))).catch(() => {});
  }, [authed]);

  const loadTransactions = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [t, s] = await Promise.all([api.transactions(filters), api.summary(filters)]);
      setList({ data: t.data, total: t.total, limit: t.limit, offset: t.offset });
      setSummary(s);
    } catch (e) { if (!handle401(e)) setError(e.message); } finally { setLoading(false); }
  }, [filters]);

  const loadPending = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = await api.pending({ limit: pendingLimit });
      setPending({ data: p.data, total: p.total });
    } catch (e) { if (!handle401(e)) setError(e.message); } finally { setLoading(false); }
  }, [pendingLimit]);

  useEffect(() => {
    if (!authed || section !== 'record') return;
    if (sub === 'transactions') loadTransactions();
    else loadPending();
  }, [authed, section, sub, loadTransactions, loadPending]);

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;

  function onConfirmed() {
    loadPending();
    api.pending({ limit: 1 }).then((p) => setPending((c) => ({ ...c, total: p.total }))).catch(() => {});
  }

  return (
    <div className="min-h-screen pb-20 sm:pb-0">
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="font-semibold">💳 Гүйлгээний Dashboard</h1>
          <div className="flex items-center gap-3">
            {/* Дээд цэс (зөвхөн дэлгэц) */}
            <nav className="hidden sm:flex gap-1">
              {SECTIONS.map((s) => (
                <NavBtn key={s.key} active={section === s.key} onClick={() => setSection(s.key)}>
                  {s.icon} {s.label}
                  {s.key === 'record' && pending.total > 0 && <Badge>{pending.total}</Badge>}
                </NavBtn>
              ))}
            </nav>
            <button onClick={logout} className="text-sm text-slate-500 hover:text-slate-700">Гарах</button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-4">
        {error && <div className="bg-red-50 text-red-700 rounded-lg px-4 py-2 mb-4 text-sm">{error}</div>}

        {section === 'record' && (
          <>
            {/* Бүртгэлийн дэд таб */}
            <div className="flex gap-1 mb-4 border-b">
              <SubTab active={sub === 'transactions'} onClick={() => setSub('transactions')}>Гүйлгээ</SubTab>
              <SubTab active={sub === 'pending'} onClick={() => setSub('pending')}>
                Баталгаажуулах{pending.total > 0 && <Badge>{pending.total}</Badge>}
              </SubTab>
            </div>
            {sub === 'transactions' ? (
              <>
                <Filters categories={categories} value={filters} onChange={setFilters} onReset={() => setFilters(emptyFilters)} />
                <Summary summary={summary} />
                <TransactionTable {...list} loading={loading} onPage={(off) => setFilters((f) => ({ ...f, offset: Math.max(0, off) }))} />
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
                    <button onClick={() => setPendingLimit((n) => n + 25)} className="px-4 py-2 rounded-lg border bg-white text-sm font-medium hover:bg-slate-50">
                      Цааш ачаалах (+25)
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {section === 'analyze' && <Analyze />}
        {section === 'insights' && <Insights />}
      </main>

      {/* Доод таб (зөвхөн утас) */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 bg-white border-t flex z-10">
        {SECTIONS.map((s) => (
          <button key={s.key} onClick={() => setSection(s.key)}
            className={`flex-1 py-2 text-xs flex flex-col items-center gap-0.5 ${section === s.key ? 'text-indigo-600' : 'text-slate-500'}`}>
            <span className="text-lg leading-none relative">
              {s.icon}
              {s.key === 'record' && pending.total > 0 && <span className="absolute -top-1 -right-3 bg-orange-500 text-white text-[10px] rounded-full px-1">{pending.total}</span>}
            </span>
            {s.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function NavBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${active ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}>
      {children}
    </button>
  );
}
function SubTab({ active, onClick, children }) {
  return (
    <button onClick={onClick} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${active ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
      {children}
    </button>
  );
}
function Badge({ children }) {
  return <span className="ml-1 bg-orange-500 text-white text-xs rounded-full px-1.5">{children}</span>;
}
