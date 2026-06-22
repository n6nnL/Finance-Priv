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

const SECTIONS = [
  { key: 'txn',      label: 'Бүртгэл',   icon: '🧾' },
  { key: 'analyze',  label: 'Шинжилгээ', icon: '📊' },
  { key: 'insights', label: 'Шийдвэр',   icon: '💡' },
];

const PAGE_TITLE = { txn: 'Бүртгэл', analyze: 'Шинжилгээ', insights: 'Шийдвэр' };

function currentMonthLabel() {
  const d = new Date();
  return `${d.getMonth() + 1}-р сар, ${d.getFullYear()}`;
}

export default function App() {
  const [authed, setAuthed] = useState(isAuthed());
  const [user, setUser] = useState(null);
  const [section, setSection] = useState('txn');

  const [categories, setCategories] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [list, setList] = useState({ data: [], total: 0, limit: PAGE, offset: 0 });
  const [summary, setSummary] = useState(null);
  const [pending, setPending] = useState({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function logout() { clearTokens(); setAuthed(false); setUser(null); }
  function handle401(e) { if (e.status === 401) { clearTokens(); setAuthed(false); return true; } return false; }

  useEffect(() => {
    if (!authed) return;
    api.me().then(r => setUser(r.user)).catch(() => {});
    api.categories().then(r => setCategories(r.categories)).catch(() => {});
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
    try {
      const p = await api.pending({ limit: 25 });
      setPending({ data: p.data, total: p.total });
    } catch (e) { handle401(e); }
  }, []);

  useEffect(() => {
    if (!authed || section !== 'txn') return;
    loadTransactions();
  }, [authed, section, loadTransactions]);

  useEffect(() => {
    if (!authed) return;
    loadPending();
  }, [authed, loadPending]);

  function onConfirmed() {
    loadPending();
    loadTransactions();
  }

  if (!authed) return <Login onLogin={u => { setUser(u); setAuthed(true); }} />;

  const userEmail = user?.email || '';
  const userInitial = userEmail[0]?.toUpperCase() || '?';

  return (
    <div style={{ minHeight: '100vh', background: '#F4EEE4', display: 'flex', fontFamily: 'Onest, system-ui, sans-serif' }}>

      {/* ── Sidebar (desktop only) ── */}
      <aside style={{
        width: 248, flexShrink: 0,
        background: '#FFFDF9', borderRight: '1px solid #EAE1D3',
        padding: '24px 16px', display: 'flex', flexDirection: 'column',
        position: 'sticky', top: 0, height: '100vh',
      }} className="hidden lg:flex">
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '6px 8px 24px' }}>
          <BrandLogo size={36} r={11} />
          <span style={{ fontFamily: 'Rubik', fontWeight: 600, fontSize: 18, letterSpacing: '-.3px', color: '#2A2722' }}>Санхүү</span>
        </div>

        {/* Nav */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {SECTIONS.map(s => {
            const active = section === s.key;
            return (
              <button key={s.key} onClick={() => setSection(s.key)} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                width: '100%', padding: '12px 14px', border: 'none',
                borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                background: active ? 'rgba(31,122,107,.10)' : 'transparent',
                color: active ? '#1F7A6B' : '#6E665A',
                fontFamily: 'Onest', fontWeight: active ? 600 : 500, fontSize: 15,
              }}>
                <span style={{ fontSize: 18, width: 22, textAlign: 'center' }}>{s.icon}</span>
                {s.label}
              </button>
            );
          })}
        </nav>

        {/* User */}
        <div style={{ marginTop: 'auto', borderTop: '1px solid #EFE7D9', paddingTop: 16, display: 'flex', alignItems: 'center', gap: 11 }}>
          <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#F0D9C9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 15, color: '#B5662F', flexShrink: 0 }}>
            {userInitial}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Хэрэглэгч</div>
            <div style={{ fontSize: 12, color: '#A39A8A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userEmail}</div>
          </div>
          <button onClick={logout} title="Гарах" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#B0A696', fontSize: 18, padding: 4, flexShrink: 0 }}>⎋</button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', paddingBottom: 76 }} className="lg:pb-6">

        {/* Topbar */}
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 24px', borderBottom: '1px solid #EAE1D3',
          background: 'rgba(244,238,228,.85)', backdropFilter: 'blur(8px)',
          position: 'sticky', top: 0, zIndex: 5,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            {/* Mobile logo */}
            <div className="lg:hidden">
              <BrandLogo size={32} r={10} />
            </div>
            <h1 style={{ fontFamily: 'Rubik', fontWeight: 600, fontSize: 22, letterSpacing: '-.4px', margin: 0, color: '#2A2722' }}>
              {PAGE_TITLE[section]}
            </h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 13, color: '#8C8578', background: '#FFFDF9', border: '1px solid #EAE1D3', padding: '8px 13px', borderRadius: 999 }}>
              {currentMonthLabel()}
            </div>
            {/* Mobile logout */}
            <button onClick={logout} className="lg:hidden" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#B0A696', fontSize: 18, padding: 4 }}>⎋</button>
          </div>
        </header>

        {/* Content */}
        <div style={{ padding: 24, maxWidth: 1180, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
          {error && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, padding: '12px 16px', marginBottom: 16, color: '#D8483B', fontSize: 14 }}>
              {error}
            </div>
          )}

          {section === 'txn' && (
            <>
              <Summary summary={summary} />
              <PendingReview items={pending.data} total={pending.total} categories={categories} onConfirmed={onConfirmed} />
              <Filters categories={categories} value={filters} onChange={setFilters} onReset={() => setFilters(emptyFilters)} />
              <TransactionTable
                {...list}
                loading={loading}
                onPage={off => setFilters(f => ({ ...f, offset: Math.max(0, off) }))}
              />
            </>
          )}

          {section === 'analyze' && <Analyze />}
          {section === 'insights' && <Insights />}
        </div>
      </main>

      {/* ── Bottom tabs (mobile only) ── */}
      <nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'rgba(255,253,249,.96)', backdropFilter: 'blur(12px)',
        borderTop: '1px solid #EAE1D3',
        display: 'flex', padding: '8px 8px calc(8px + env(safe-area-inset-bottom,0px))',
        zIndex: 20,
      }} className="lg:hidden">
        {SECTIONS.map(s => {
          const active = section === s.key;
          return (
            <button key={s.key} onClick={() => setSection(s.key)} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              border: 'none', background: 'none', cursor: 'pointer', padding: '6px 0',
              color: active ? '#1F7A6B' : '#9A9182',
            }}>
              <span style={{ fontSize: 21 }}>{s.icon}</span>
              <span style={{ fontSize: 11, fontWeight: active ? 600 : 500 }}>{s.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function BrandLogo({ size, r }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: r,
      background: 'linear-gradient(135deg,#1F7A6B,#2E9E7E)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      <div style={{
        width: size * 0.42, height: size * 0.42,
        border: `${size * 0.07}px solid #fff`,
        borderRadius: '50%', borderRightColor: 'transparent',
        transform: 'rotate(-45deg)',
      }} />
    </div>
  );
}
