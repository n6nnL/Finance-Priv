# Гүйлгээний Dashboard (React + Vite + Tailwind)

Банкны гүйлгээг харах, шүүх, AI ангилал баталгаажуулах **хялбар, түргэн,
responsive** dashboard. Express API-ийн өргөтгөлтэй хослон ажиллана.

## Боломжууд

- **Гүйлгээний хүснэгт** — огноо, тайлбар, ангилал, данс, дүн (зарлага улаан /
  орлого ногоон). Том дэлгэцэд хүснэгт, **утсан дээр карт** хэлбэр.
- **Шүүлтүүр** — текст хайлт, төрөл, огнооны хүрээ, дүнгийн хүрээ, ангилал (олон
  сонголт). Бүгд backend-ийн `GET /api/transactions` query-ээр (frontend дээр
  бүгдийг ачаалж шүүхгүй). Утсан дээр эвхэгддэг.
- **Хураангуй** — нийт зарлага/орлого/тоо + ангиллаар зарлагын задаргаа (bar).
- **Баталгаажуулах (AI)** — `pending_review` гүйлгээ бүрд: **огноо + данс + дүн**,
  AI санал (ангилал + итгэлийн түвшин), ангилал сонгох dropdown, **"Газрын нэр"**
  (friendly_name) оруулга, BOM зөвлөмж, "AI саналыг зөвшөөрөх" / "Сонгосноор
  хадгалах", "энэ мерчантын бүгдэд хэрэглэх" (learned override үүсгэнэ).
- **"Бусад" автоматаар оноогддоггүй** — танигдаагүй гүйлгээ "Ангилаагүй" (улбар шар)
  болж баталгаажуулах дараалалд орно. friendly_name өгсөн мерчантыг "Нэр (КОД)" гэж
  харуулна.
- **Ухаалаг (төрөл-мэдрэмжтэй) баталгаажуулалт:** карт дээр POS (🏪) эсвэл
  Шилжүүлэг/Төлбөр (↔) badge. POS бол "Ямар газар вэ? → **Газрын нэр**", POS биш бол
  "Яагаад хийсэн бэ? → **Шалтгаан**" гэж өөр асуулт/оролт. Баталгаажуулах картанд
  **огноо + данс** харагдана. Олон pending бол "Цааш ачаалах" (25-аар).
- **Тэмдэглэл (note):** гүйлгээ бүрд inline "📝 / ＋тэмдэглэл" дарж засна.
- **Газраар зарлага:** хураангуйд баталгаажсан газруудаар нийт дүн
  ("Шулуун дунд нийт хэдэн ₮").
- **Responsive** — Tailwind breakpoint (`sm`) ашиглана. ~380px өргөнд уншигдахуйц.

## Ажиллуулах

### Хөгжүүлэлт (hot reload)

API эхлээд асаалттай байх ёстой (`cd ../api && npm start`), дараа:

```bash
cd dashboard
npm install
npm run dev      # http://localhost:5173 (vite)
```

Dev server нь `/api` болон `/health`-г `http://localhost:3000` (Express API) руу
**proxy** хийдэг тул CORS тохиргоо хэрэггүй.

### Production (API-аар serve хийх)

```bash
cd dashboard
npm run build    # dashboard/dist үүснэ
```

`dist/` үүсмэгц **Express API нь түүнийг static-аар serve хийдэг** (нэг origin →
CORS байхгүй). Дараа нь зөвхөн API-г асаахад болно:

```bash
cd ../api && npm start
# Dashboard: http://localhost:3000/   (API: http://localhost:3000/api/...)
```

## Нэвтрэх

Эхэлж нээхэд **API key** асууна (listener-ийн `WEBSITE_API_KEY` =
API-ийн `LISTENER_API_KEY`). Key нь `localStorage`-д хадгалагдана.

> ⚠️ Энэ нь дотоод хэрэгсэлд зориулсан энгийн auth. Олон нийтэд нээхээр бол
> token-д суурилсан (JWT) auth руу шилжүүлнэ үү (доорх "Ирээдүйд" хэсэг).

## Бүтэц

```
dashboard/
  index.html
  vite.config.js          # /api → :3000 proxy (dev)
  tailwind.config.js
  src/
    main.jsx
    App.jsx               # tab (Гүйлгээ | Баталгаажуулах), fetch урсгал
    lib/
      api.js              # fetch wrapper (X-API-Key localStorage-оос)
      format.js           # ангиллын нэр/өнгө, мөнгөний формат
    components/
      Login.jsx           # API key оруулах
      Filters.jsx         # шүүлтүүр (collapsible)
      Summary.jsx         # хураангуй + bar
      TransactionTable.jsx# хүснэгт/карт + pagination
      PendingReview.jsx   # AI баталгаажуулах
```

## Ирээдүйд (одоо хэрэгжүүлээгүй, бэлэн)

- **Mobile app:** API нь цэвэр REST тул ирээдүйн mobile app ижил endpoint-уудыг
  ашиглана. Dashboard ба mobile нэг backend хуваалцана.
- **Push notification:** гүйлгээ ирмэгц "энэ мерчантыг ангилна уу?" мэдэгдэл
  (`pending_review` гарч ирэхэд). API-д webhook/push нэмэхэд бэлэн.
- **Token auth:** одоогийн API key-г JWT/refresh token-оор солих (mobile-д хялбар).
