import { money } from '../lib/format.js';

export default function Summary({ summary, balance }) {
  if (!summary) return null;
  const { totalExpense = 0, totalIncome = 0 } = summary;
  // Үлдэгдэл = GET /api/balance (сүүлийн txn_date-тэй бодит гүйлгээний account_balance),
  // САРЫН орлого/зарлагын зөрүү (cashflow) БИШ — тэдгээр нь өөр өөр зүйл.
  const balKnown = balance != null;
  const balStr = balKnown ? ((balance >= 0 ? '+' : '−') + money(Math.abs(balance))) : 'Тодорхойгүй';

  const cardBase = 'bg-cream-card rounded-card p-[20px]';
  const labelBase = 'text-[13px] mb-[10px] flex items-center gap-[7px]';
  const valBase = 'font-display font-semibold text-[28px] tracking-[-0.5px]';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-[14px] mb-[22px]">
      <div className={`${cardBase} border border-cream-border`}>
        <div className={`${labelBase} text-[#8C8578]`}><span className="text-[15px]">💰</span> Энэ сарын орлого</div>
        <div className={`${valBase} text-[#2E9E5B]`}>+{money(totalIncome)}</div>
      </div>
      <div className={`${cardBase} border border-cream-border`}>
        <div className={`${labelBase} text-[#8C8578]`}><span className="text-[15px]">🧾</span> Энэ сарын зарлага</div>
        <div className={`${valBase} text-[#D8483B]`}>−{money(totalExpense)}</div>
      </div>
      <div className={`${cardBase} text-white`} style={{ background: 'linear-gradient(135deg,#1F7A6B,#2E9E7E)' }}>
        <div className={`${labelBase} text-[rgba(255,255,255,0.82)]`}><span className="text-[15px]">✨</span> Үлдэгдэл</div>
        <div className={balKnown ? `${valBase} text-white` : 'font-display font-semibold text-[17px] text-[rgba(255,255,255,0.88)]'}>{balStr}</div>
        {!balKnown && (
          <div className="text-[13px] text-[rgba(255,255,255,0.72)] mt-[6px]">Банкны имэйл ирж эхэлмэгц харагдана</div>
        )}
      </div>
    </div>
  );
}
