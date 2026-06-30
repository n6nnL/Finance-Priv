const CARDS = [
  { icon: '🎯', title: 'Ухаалаг төсөв', desc: 'Хэвшилд тань тааруулсан сарын төсөв автоматаар санал болгоно.' },
  { icon: '🔮', title: 'Урсгалын таамаг', desc: 'Ирэх сард хэр зарцуулахыг урьдчилан харуулна.' },
  { icon: '💚', title: 'Хэмнэх зөвлөгөө', desc: 'Хаанаас хэмнэх боломжтойг олж, тодорхой алхам зөвлөнө.' },
];

export default function Insights() {
  return (
    <div className="flex flex-col items-center text-center pt-[40px] px-[16px] pb-[24px]">
      <div
        className="w-[80px] h-[80px] rounded-[24px] flex items-center justify-center text-[38px] shadow-[0_12px_30px_rgba(31,122,107,0.28)] mb-[22px]"
        style={{ background: 'linear-gradient(135deg,#1F7A6B,#2E9E7E)' }}
      >
        💡
      </div>
      <div className="inline-block bg-[#F0D9C9] text-[#B5662F] text-[13px] font-semibold px-[13px] py-[5px] rounded-full mb-[16px]">
        Удахгүй
      </div>
      <h2 className="font-display font-semibold text-[26px] tracking-[-0.5px] m-0 mb-[10px]">
        Ухаалаг санхүүгийн туслах
      </h2>
      <p className="m-0 mb-[36px] max-w-[480px] text-[#8C8578] text-[15px] leading-[1.6]">
        Таны зарлагын хэвшилд тулгуурлан төсөв санал болгох, ирэх сарын урсгалыг таамаглах, хэмнэх боломжийг олж харах ухаалаг туслах.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-[14px] max-w-[760px] w-full">
        {CARDS.map(c => (
          <div key={c.title} className="bg-cream-card border border-cream-border rounded-card p-[22px] text-left relative overflow-hidden">
            <div className="text-[30px] mb-[14px] saturate-[.85]">{c.icon}</div>
            <div className="font-display font-semibold text-[16px] mb-[6px]">{c.title}</div>
            <div className="text-[13.5px] text-[#8C8578] leading-[1.5]">{c.desc}</div>
            <div className="absolute top-[14px] right-[14px] text-[14px]">🔒</div>
          </div>
        ))}
      </div>
    </div>
  );
}
