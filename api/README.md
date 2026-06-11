# Bank Transactions API

Banking email **listener service**-ээс илгээсэн гүйлгээг хүлээн авч,
баталгаажуулж, давхардлыг таслаж, өгөгдлийн санд хадгалдаг REST API endpoint.
Энэ нь listener-ийн "хүлээн авах тал" — хоёр тал **ижил гэрээтэй** (contract).

- ✅ `POST /api/transactions` — гүйлгээ хүлээн авах (auth → validate → idempotent insert)
- ✅ `GET /api/transactions` — жагсаалт (from/to/category/type/limit/offset шүүлт)
- ✅ Authentication: API key (+ сонголтоор HMAC)
- ✅ Идэмпотентность: `messageId` UNIQUE → давхардлыг `INSERT OR IGNORE`-оор таслана
- ✅ zod validation, rate limiting, body size limit, SQL injection хамгаалалт
- ✅ `node:sqlite` — native compile (Python/Build Tools) **хэрэггүй**

> Стек: Node.js 22.5+ · Express · zod · `node:sqlite`

---

## 1. Суулгах

```bash
cd api
npm install
```

> SQLite-д Node-ийн суурилуулсан `node:sqlite` ашигладаг тул нэмэлт native
> build шаардлагагүй. `npm install` зөвхөн Express, zod-г татна.

---

## 2. `.env` бөглөх

```bash
cp .env.example .env
```

| Хувьсагч | Тайлбар |
|---|---|
| `PORT` | Сервер порт (default 3000) |
| `LISTENER_API_KEY` | **Listener-ийн `WEBSITE_API_KEY`-тэй ЯГ ИЖИЛ** урт санамсаргүй secret |
| `LISTENER_HMAC_SECRET` | (Сонголт) HMAC. Listener-ийн `WEBSITE_HMAC_SECRET`-тэй ижил |
| `DB_PATH` | SQLite файлын зам (default `./data/transactions.sqlite`) |
| `RATE_LIMIT_WINDOW_SECONDS` / `RATE_LIMIT_MAX` | Rate limit |
| `BODY_LIMIT` | Body хэмжээний хязгаар (default `100kb`) |

---

## 3. DB үүсгэх (миграц)

```bash
npm run migrate
```

> `db.js` нь асахдаа автоматаар миграц хийдэг тул заавал биш — гэхдээ DB-г
> урьдчилан үүсгэх/шалгахад ашиглаж болно. SQL миграц
> [`migrations/001_init.sqlite.sql`](migrations/001_init.sqlite.sql)-д бий.

---

## 4. Ажиллуулах

```bash
npm start
# 🚀 http://localhost:3000
```

Эрүүл мэндийн шалгалт: `GET /health` → `{ "status": "ok" }` (auth-гүй).

---

## 5. Тест

```bash
npm test
```

Integration test (node:test + fetch, нэмэлт пакетгүй): 201 created, 200
duplicate, 401 (буруу/байхгүй key), 400 (validation), HMAC, listener alias
нормализаци, GET шүүлт.

---

## 6. Listener талтай тааруулах (ЧУХАЛ)

Хоёр тал ижил гэрээтэй ажиллахын тулд env нэрс таарах ёстой:

| Listener (`../`) | API (энд) | Утга |
|---|---|---|
| `WEBSITE_API_URL` | — | `http://<api-host>:<PORT>/api/transactions` |
| `WEBSITE_API_KEY` | `LISTENER_API_KEY` | **ЯГ ижил secret** |
| `WEBSITE_HMAC_SECRET` | `LISTENER_HMAC_SECRET` | **ЯГ ижил** (HMAC хэрэглэвэл) |

Жишээ — listener-ийн `.env`:

```
WEBSITE_API_URL=http://localhost:3000/api/transactions
WEBSITE_API_KEY=replace-with-a-long-random-secret
WEBSITE_HMAC_SECRET=
```

API-ийн `.env`:

```
LISTENER_API_KEY=replace-with-a-long-random-secret
LISTENER_HMAC_SECRET=
```

### Гэрээний body (хоёр талд ижил)

```json
{
  "messageId": "<unique-email-message-id>",
  "amount": 25000,
  "currency": "MNT",
  "date": "2026-06-08",
  "description": "POS гүйлгээ - дэлгүүрийн нэр",
  "type": "expense",
  "category": "Хүнс",
  "accountLast4": "1234",
  "raw": "имэйлийн түүхий текст"
}
```

Listener нь `X-API-Key` (+ HMAC үед `X-Signature`) header-т явуулдаг. API нь
`Authorization: Bearer <key>`-г ч хүлээн авна.

> **Тэвчих хамгаалалт:** Хэрэв listener хуучин талбар (`direction`,
> `accountTail`, `subject`) явуулбал API автоматаар каноник нэр рүү
> хөрвүүлнэ (`type`, `accountLast4`, `raw`). Гэхдээ энэ репозиторийн listener
> аль хэдийн каноник гэрээгээр явуулдаг.

---

## API лавлах

### `POST /api/transactions`
**Headers:** `X-API-Key` (заавал), `Content-Type: application/json`, `X-Signature` (HMAC үед)

| Хариу | Утга |
|---|---|
| `201` `{ "status":"created", "id": <n> }` | Шинээр орлоо |
| `200` `{ "status":"duplicate", "id": <n> }` | `messageId` аль хэдийн байсан (алдаа биш) |
| `400` `{ "status":"error", "errors":[...] }` | Validation алдаа |
| `401` | Auth амжилтгүй |
| `413` | Body хэт том |
| `429` | Rate limit хэтэрсэн |
| `500` | Серверийн алдаа (listener retry хийнэ) |

### `GET /api/transactions`
**Headers:** `X-API-Key` (заавал)
**Query:** `from`, `to` (YYYY-MM-DD), `category`, `type` (`expense`|`income`), `limit` (≤500), `offset`

```json
{ "status":"ok", "total":120, "limit":50, "offset":0, "count":50, "data":[ ... ] }
```

---

## Бүтэц

```
api/
  server.js                  # entry (config → db → app → listen)
  app.js                     # express app factory (тест боломжтой)
  config.js                  # env унших + валидаци
  logger.js                  # structured JSON logger
  db.js                      # node:sqlite холболт + query функцууд
  schema.js                  # zod schema + listener alias normalize
  migrate.js                 # миграц runner
  middleware/
    auth.js                  # API key + HMAC
    rateLimit.js             # in-memory rate limit
  routes/
    transactions.js          # POST + GET
  migrations/
    001_init.sqlite.sql      # SQLite схем
    001_init.postgres.sql    # PostgreSQL схем (production)
  test/
    api.test.js
```

---

## Production: PostgreSQL руу шилжих

Энэ репо хөгжүүлэлт/энгийн ашиглалтад `node:sqlite` ашигладаг. Том хэмжээний
вэбсайтад PostgreSQL зөвлөнө:

1. [`migrations/001_init.postgres.sql`](migrations/001_init.postgres.sql)-г
   `psql "$DATABASE_URL" -f ...`-ээр ажиллуул.
2. `npm i pg` суулгаад `db.js`-г `pg` Pool ашиглахаар адаптацла. Insert-д
   идэмпотентностьд:
   ```sql
   INSERT INTO transactions (...) VALUES (...)
   ON CONFLICT (message_id) DO NOTHING
   RETURNING id;
   ```
   `rows.length === 0` бол давхардсан → одоо байгаа id-г `SELECT`-оор ав.
3. Олон instance ажиллуулбал in-memory rate limit-ийг Redis суурьтай болго.

---

## Аюулгүй байдал (хэрэгжсэн)

- Бүх нууц утга env-ээс. `.gitignore`-д `.env`, `*.sqlite`.
- Body хэмжээний хязгаар (`express.json({ limit })`) → 413.
- Бүх query **parameterized** (SQL injection хамгаалалт).
- timing-safe API key/HMAC харьцуулалт.
- GET endpoint-д ч auth (хувийн санхүүгийн өгөгдөл хамгаалалт).
- Rate limiting (нэг API key + IP).

---

## Dashboard + AI ангилал өргөтгөл

### Шинэ endpoint-ууд (бүгд auth-тай)

| Endpoint | Тайлбар |
|---|---|
| `GET /api/transactions` | Өргөтгөсөн шүүлт: `from,to,category(олон,таслалаар),type,q(текст),minAmount,maxAmount,status,limit,offset` |
| `GET /api/transactions/pending` | `pending_review` гүйлгээ (баталгаажуулах хүлээж буй) |
| `PATCH /api/transactions/:id/category` | Ангилал засах. Body: `{ category, applyToAll }`. `applyToAll:true` → тэр мерчантын бүх мөр + learned override |
| `GET /api/summary` | Нийт зарлага/орлого/тоо + ангиллаар (шүүлттэй) |
| `GET /api/categories` | Боломжит ангиллын жагсаалт (dropdown-д) |
| `POST /api/ai-categorize` | AI ангилал санал. Body: `{ description }` → `{ category, confidence }` |
| `GET /api/overrides` / `POST /api/overrides` | Learned override харах / нэмэх (`{ merchantPattern, category }`) |

### Ангилал шийдвэрлэх дараалал (ингест дээр, `classify.js`)

1. **Learned override** (хэрэглэгчийн баталгаажуулсан) — ЭХЭНД шалгана.
2. **Дүрэм** — listener-ийн илгээсэн category эсвэл `categorize.js` keyword дүрэм.
   `categorize` нь танигдаагүй үед `null` буцаана ('other' БИШ).
3. **Танигдаагүй** → `category=NULL` (⚠️ автоматаар **"Бусад" болгохгүй**),
   `status='pending_review'`, AI санал (`ai_suggested_category`, `ai_confidence`).
   AI унтраалттай/амжилтгүй бол санал `null`, гүйлгээ `pending_review` хэвээр.
   **"Бусад"-ыг зөвхөн хэрэглэгч өөрөө** баталгаажуулахдаа сонгоно.

> **Хуучин 'other' → pending миграц:** Өмнө автоматаар 'other' болсон гүйлгээг
> дахин хянуулахаар `pending_review` (category NULL) руу буцаах нэг удаагийн скрипт:
> `node scripts/migrate-other-to-pending.mjs` (learned override-той мерчантыг хөндөхгүй).

### Газрын танигдсан нэр (`friendly_name`) — BOM мерчант сурах

Голомтын `...BOM` код = POS гүйлгээ (газрын товчилсон нэр). Хэрэглэгч баталгаажуулахдаа
**сонголтоор "Газрын нэр"** оруулж болно (жишээ: `ShuluBOM` → "Шулуун дун").

- `category_overrides.friendly_name` талбарт хадгална.
- `PATCH /api/transactions/:id/category` body-д `friendlyName` дамжуулна
  (friendly_name өгвөл тэр мерчантын бүх гүйлгээнд override болж хэрэгжинэ).
- Жагсаалт/pending хариунд мөр бүрт `friendly_name` хавсаргагдана (унших үед
  тооцоологдох тул хожим нэр өгсөн ч буцаан тусна). Dashboard "Шулуун дун (ShuluBOM)"
  гэж харуулна.
- ⚠️ friendly_name-г **автоматаар таамаглахгүй** — зөвхөн хэрэглэгч оноосныг санана.

> **Архитектур (overrides + 2 процесс):** Override-ууд API-ийн DB-д (`category_overrides`)
> нэг эх сурвалж болж хадгалагдана. Listener гүйлгээ илгээхэд **API нь ингест дээр
> override-г хэрэглэдэг** тул listener-ээс ирсэн гүйлгээ ч learned override-оор
> автоматаар ангилагдана. Ингэснээр хоёр процесс (listener + API) override-ийг
> хуваалцахын тулд DB хооронд холбогдох шаардлагагүй.

### AI тохиргоо (Claude API) — СОНГОЛТТОЙ (default унтраалттай)

```
AI_CATEGORIZATION_ENABLED=false   # default унтраалттай
ANTHROPIC_API_KEY=                 # хоосон бол ч AI унтраалттай
ANTHROPIC_MODEL=claude-haiku-4-5
```

- AI идэвхтэй = `AI_CATEGORIZATION_ENABLED=true` **БА** `ANTHROPIC_API_KEY` байгаа.
  Аль нэг нь дутвал AI унтраалттай.
- **AI-гүй үед систем бүрэн ажиллана:** танигдаагүй гүйлгээ AI **саналгүйгээр**
  (`ai_suggested_category=null`) шууд `pending_review` болж хэрэглэгчээс асуугдана.
- AI дуудлага try/catch-д; алдаа (credit алга, network, rate limit) гарвал warning
  log хийгээд гүйлгээ pending_review хэвээр — **систем хэзээ ч зогсохгүй**.
- AI prompt: ангиллын жагсаалт өгч, таслагдсан мерчантыг буруу таамаглахаас
  сэргийлж `other`/low буцаахыг шаарддаг. System prompt-д prompt caching.

**AI-г дараа залгах (credit нэмсэн үед):**
1. Anthropic данс руу credit нэмэх.
2. `api/.env`-д хүчинтэй `ANTHROPIC_API_KEY=sk-ant-...` тавих.
3. `AI_CATEGORIZATION_ENABLED=true` болгох.
4. `pm2 restart bank-api` (эсвэл `pm2 reload all`). Код өөрчлөх шаардлагагүй.

### DB миграц (002)

`transactions`-д нэмсэн (одоо байгаа мөрийг алдагдуулахгүй): `status`
(default `'classified'`), `ai_suggested_category`, `ai_confidence`. Шинэ хүснэгт:
`category_overrides`. `db.js` нь эдгээрийг **идемпотент** хэрэгжүүлдэг (багана/хүснэгт
байвал алгасна). SQL: [`migrations/002_dashboard.sqlite.sql`](migrations/002_dashboard.sqlite.sql).

### Dashboard serve

`dashboard/dist` (build) байвал API нь түүнийг static-аар serve хийнэ (нэг origin →
CORS байхгүй). Дэлгэрэнгүй: [`../dashboard/README.md`](../dashboard/README.md).

### Тест

`test/dashboard.test.js` — pending, override (ингест дээр автомат), `applyToAll`
(тэр мерчантын бүх мөр + override), `POST /api/ai-categorize` (mock AI), summary,
шүүлтүүд (q/minAmount/maxAmount/category олон), **is_pos, POS/transfer ухаалаг
баталгаажуулалт (merchant_place/note), override_note, PATCH /:id/note**. Бүгд: `npm test`.

---

## Дахин parse + ухаалаг (төрөл-мэдрэмжтэй) баталгаажуулалт

### Parser — 5 загвар (`../src/parsers/golomt.js`)

EASYINFO (огноо labelтэй ЭСВЭЛ дангаар мөр), VERBOSE ("Гүйлгээ хийгдсэн огноо",
олон мөрт утга), CARD ("Картын дугаар", "Огноо:YYYY/MM/DD"), FIRSTTXN (огноогүй),
OTHER (интернэт банк — best-effort). Огноо **2 формат** (`-`, `/`).
`detectIsPos(desc)` — BOM-оор төгссөн → POS.

### Хуучин имэйл дахин parse: `node scripts/reparse.js`

Засагдсан parser-аар Gmail-ийн бүх имэйлийг дахин уншиж, API DB дэх NULL талбар
(txn_date, description, account_last4, amount) + is_pos нөхнө. ⚠️ Хэрэглэгчийн
гараар оруулсан (category, note, merchant_place, friendly_name, status)-г
ХӨНДӨХГҮЙ. (Ажиллуулсан: 670 огноо + 6 данс нөхсөн.)

### DB миграц (004) — note / is_pos / merchant_place

`transactions`-д: `note`, `is_pos` (1/0/NULL), `merchant_place`.
`category_overrides`-д: `default_note`. Бүгд идемпотент ALTER.

### Ухаалаг баталгаажуулалт (төрлөөс хамаарч)

`PATCH /api/transactions/:id/category` body:
- **POS** (`is_pos=1`): `{ category, merchantPlace, applyToAll }` → газрын нэрийг
  `merchant_place` (мөр) + override `friendly_name`-д хадгална.
- **POS биш**: `{ category, note, applyToAll }` → шалтгааныг `note` (мөр) + override
  `default_note`-д хадгална.
- `PATCH /api/transactions/:id/note` — зөвхөн тэмдэглэл засах (inline).
- `GET /api/summary` → `byPlace` (газраар зарлага: "Шулуун дунд нийт хэдэн ₮").

Dashboard баталгаажуулах карт POS бол "Ямар газар вэ? → Газрын нэр", POS биш бол
"Яагаад хийсэн бэ? → Шалтгаан" гэж өөр асуулт/оролт харуулна.

---

## 10-ангиллын систем (хэрэглэгчид тохирсон)

`config/categories.js`-д тодорхойлсон **10 ангилал** (category VALUE нь шууд монгол НЭР):

`Гадуур хооллолт`, `Хүнсний зүйл`, `Тээвэр`, `Орлого`, `Шилжүүлэг & гэр бүл`,
`Захиалга & сервис`, `Боловсрол`, `Чөлөөт цаг / зугаа цэнгэл`, `Хувцас / гоо сайхан`, `Бусад`.

**categorize() дараалал** (`classify.js`): learned override → `Орлого`
(type==='income') → keyword дүрэм → `null` (pending_review). ⚠️ Автоматаар "Бусад"
болгохгүй; "Бусад"-ыг зөвхөн хэрэглэгч сонгоно.

- ⚠️ `'store'` keyword-ийг ОРУУЛААГҮЙ — Голомтын `STOREBOM` (таслагдсан, таниулашгүй)-той
  давхцаж буруу ангилахаас сэргийлэв. Таслагдсан кодыг **override-оор** л ангилна.
- `'shulu'`, `'claud'`, `'qpay'` зэрэг хэрэглэгч таньсан keyword нэмсэн.

**Дахин ангилах:** `node scripts/recategorize.js` — (1) learned override-ийн хуучин
(англи key) ангиллыг шинэ нэр рүү буулгана (`OLD_TO_NEW`, хэрэглэгчийн шийдвэр
хадгалагдана), (2) override-той гүйлгээ override-ийн ангиллаар, (3) бусад
(автомат/pending) гүйлгээг шинэ дүрмээр. Хэрэглэгчийн баталгаажуулсан мерчантыг
ХӨНДӨХГҮЙ. (Ажиллуулсан: 246 Орлого, 188 Захиалга&сервис, 101 Хүнсний зүйл,
64 Гадуур хооллолт, 401 pending.)
```
