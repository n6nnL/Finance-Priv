import { money } from '../lib/format.js';

export default function Summary({ summary }) {
  if (!summary) return null;
  const { totalExpense = 0, totalIncome = 0 } = summary;
  const balance = totalIncome - totalExpense;
  const balStr = (balance >= 0 ? '+' : '−') + money(Math.abs(balance));

  const card = {
    background: '#FFFDF9', border: '1px solid #EAE1D3',
    borderRadius: 18, padding: 20,
  };
  const label = { fontSize: 13, color: '#8C8578', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 7 };
  const val = { fontFamily: 'Rubik', fontWeight: 600, fontSize: 28, letterSpacing: '-.5px' };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 22 }} className="grid-cols-1 sm:grid-cols-3">
      <div style={card}>
        <div style={label}><span style={{ fontSize: 15 }}>💰</span> Энэ сарын орлого</div>
        <div style={{ ...val, color: '#2E9E5B' }}>+{money(totalIncome)}</div>
      </div>
      <div style={card}>
        <div style={label}><span style={{ fontSize: 15 }}>🧾</span> Энэ сарын зарлага</div>
        <div style={{ ...val, color: '#D8483B' }}>−{money(totalExpense)}</div>
      </div>
      <div style={{ ...card, background: 'linear-gradient(135deg,#1F7A6B,#2E9E7E)', border: 'none', color: '#fff' }}>
        <div style={{ ...label, color: 'rgba(255,255,255,.82)' }}><span style={{ fontSize: 15 }}>✨</span> Үлдэгдэл</div>
        <div style={{ ...val, color: '#fff' }}>{balStr}</div>
      </div>
    </div>
  );
}
