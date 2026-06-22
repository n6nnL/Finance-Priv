// ============================================================
//  Insights.jsx — "Шийдвэр" хэсэг (ГАЗАР БЭЛДЭХ — одоо placeholder)
//
//  ⚠️ Энэ хэсгийг одоо БҮРЭН бүтээхгүй (хэрэглэгч хараахан тодорхойлоогүй).
//  Зөвхөн route/газар үлдээв. Архитектур нь дараах enterprise шийдвэрийн
//  хэрэгслүүдийг нэмэхэд бэлэн:
//    - Төсөв vs бодит (budget vs actual)
//    - Cash flow таамаглал
//    - Хэт зарцуулалтын анхааруулга
//    - Хэлтэс/төслөөр задаргаа (multi-tenant дээр)
// ============================================================

export default function Insights() {
  const ideas = [
    'Төсөв vs бодит зарлага',
    'Cash flow таамаглал',
    'Хэт зарцуулалтын анхааруулга',
    'Хэлтэс / төслөөр задаргаа',
  ];
  return (
    <div className="bg-white rounded-xl shadow p-8 text-center">
      <div className="text-4xl mb-3">🧭</div>
      <h2 className="text-lg font-semibold">Шийдвэр</h2>
      <p className="text-slate-500 mt-1">Удахгүй…</p>
      <p className="text-sm text-slate-400 mt-4 max-w-md mx-auto">
        Энэ хэсэгт цуглуулсан өгөгдөл дээр тулгуурлан санхүүгийн шийдвэр гаргахад туслах
        хэрэгслүүд нэмэгдэнэ:
      </p>
      <ul className="mt-3 inline-flex flex-col gap-1 text-sm text-slate-600">
        {ideas.map((i) => <li key={i}>• {i}</li>)}
      </ul>
    </div>
  );
}
