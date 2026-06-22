const CARDS = [
  { icon: '🎯', title: 'Ухаалаг төсөв', desc: 'Хэвшилд тань тааруулсан сарын төсөв автоматаар санал болгоно.' },
  { icon: '🔮', title: 'Урсгалын таамаг', desc: 'Ирэх сард хэр зарцуулахыг урьдчилан харуулна.' },
  { icon: '💚', title: 'Хэмнэх зөвлөгөө', desc: 'Хаанаас хэмнэх боломжтойг олж, тодорхой алхам зөвлөнө.' },
];

export default function Insights() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '40px 16px 24px' }}>
      <div style={{ width: 80, height: 80, borderRadius: 24, background: 'linear-gradient(135deg,#1F7A6B,#2E9E7E)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 38, boxShadow: '0 12px 30px rgba(31,122,107,.28)', marginBottom: 22 }}>
        💡
      </div>
      <div style={{ display: 'inline-block', background: '#F0D9C9', color: '#B5662F', fontSize: 12.5, fontWeight: 600, padding: '5px 13px', borderRadius: 999, marginBottom: 16 }}>
        Удахгүй
      </div>
      <h2 style={{ fontFamily: 'Rubik', fontWeight: 600, fontSize: 26, letterSpacing: '-.5px', margin: '0 0 10px' }}>
        Ухаалаг санхүүгийн туслах
      </h2>
      <p style={{ margin: '0 0 36px', maxWidth: 480, color: '#8C8578', fontSize: 15, lineHeight: 1.6 }}>
        Таны зарлагын хэвшилд тулгуурлан төсөв санал болгох, ирэх сарын урсгалыг таамаглах, хэмнэх боломжийг олж харах ухаалаг туслах.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, maxWidth: 760, width: '100%' }} className="grid-cols-1 sm:grid-cols-3">
        {CARDS.map(c => (
          <div key={c.title} style={{ background: '#FFFDF9', border: '1px solid #EAE1D3', borderRadius: 18, padding: 22, textAlign: 'left', position: 'relative', overflow: 'hidden' }}>
            <div style={{ fontSize: 30, marginBottom: 14, filter: 'saturate(.85)' }}>{c.icon}</div>
            <div style={{ fontFamily: 'Rubik', fontWeight: 600, fontSize: 16, marginBottom: 6 }}>{c.title}</div>
            <div style={{ fontSize: 13.5, color: '#8C8578', lineHeight: 1.5 }}>{c.desc}</div>
            <div style={{ position: 'absolute', top: 14, right: 14, fontSize: 14 }}>🔒</div>
          </div>
        ))}
      </div>
    </div>
  );
}
