# Finance-Priv — төслийн context (Claude-д зориулсан handoff)

> **Зорилго:** Энэ баримтыг шинэ Claude чатад attachment болгон өгснөөр төслийн бүтэц,
> архитектур, одоогийн төлөвийг бүрэн ойлгуулна. **Нууц утга ЭНД БАЙХГҮЙ** (`.env`,
> token, key, server IP/SSH нь gitignored файлуудад). Баримт бэлдсэн үе: deploy commit
> **`c883862`** (`main`).

---

## 1. Товч танилцуулга

Голомт банкны имэйл мэдэгдлээс гүйлгээг автоматаар татаж, ангилж, хадгалж, dashboard-д
харуулдаг **хувийн санхүүгийн систем**. Нэг **monorepo**, 4 хэсэг:

| Хэсэг | Зам | Үүрэг |
|---|---|---|
| **listener** | `src/` | Gmail IMAP IDLE → имэйл parse → ангилал → API руу POST |
| **API** | `api/` | Express REST API + `dashboard/dist`-г static serve (нэг origin `:3000`) |
| **dashboard** | `dashboard/` | Vite + React + Tailwind (cream/brand загвар) |
| **discord bot** | `discord/` | Мэдэгдэл + товч/modal-аар ангилах |

**Тех стек:** Node **24** (ЗААВАЛ — `node:sqlite` нь 22.5+), Express, `node:sqlite` (native
build хэрэггүй), zod, jsonwebtoken, bcryptjs, google-auth-library. Frontend: Vite/React/Tailwind.

---

## 2. Storage — ⚠️ ЧУХАЛ тодруулга

Repo-д **хуучин Python файлууд** (`api_server.py`, `main.py`, `sheets_writer.py`,
`categorizer.py`, `gmail_parser.py`) байгаа боловч эдгээр нь **ҮХСЭН legacy** (Google Sheets
прототип). **Ямар ч процесс тэдгээрийг ажиллуулдаггүй** (`ecosystem.config.cjs`,
`package.json`, deploy docs дотор reference алга).

**Бодит амьд backend = Node/Express + `node:sqlite`.** Гүйлгээ нь SQLite-д
(`api/data/transactions.sqlite`) хадгалагдана. Dashboard нь relative `/api/...`-аар мөнөөх
Express API-аас уншина. **Google Sheets ашигладаггүй.** Шинэ функц бичихдээ ЗӨВХӨН Node
API дээр бариарай — зэрэгцээ backend үүсгэхгүй.

---

## 3. Deploy / орчин

- **Process manager:** pm2, [`ecosystem.config.cjs`](ecosystem.config.cjs) — 3 процесс:
  `bank-listener` (`src/index.js`), `bank-api` (`api/server.js`), `bank-discord` (`discord/bot.js`).
- **Домейн:** `https://golomt-fin.duckdns.org` (DuckDNS). **Nginx** (`:80/:443`, Let's Encrypt)
  → `proxy_pass http://127.0.0.1:3000`.
- **Runbook (нууцгүй):** [`deploy/DEPLOY_RUNBOOK.md`](deploy/DEPLOY_RUNBOOK.md).
  **Бодит утга (host/user/path/SSH key/domain):** `deploy/.deploy.local.env` — **gitignored**.
- **Redeploy 2 төрөл:**
  - *Dashboard-only* (зөвхөн `dashboard/` өөрчлөгдвөл): локалд build → `scp dist` (pm2 reload хэрэггүй, API нь dist-г диск дээрээс уншина).
  - *Full* (API/listener код өөрчлөгдвөл): push → серверт `git pull` + `npm install` + dashboard build + `pm2 reload all`. **Өмнө нь DB backup хий** (API restart дээр идемпотент миграц ажиллана).
- **Server git remote нь SSH** (`git@github.com:n6nnL/Finance-Priv.git`); локал нь HTTPS.

---

## 4. Өгөгдлийн сан — schema + миграц

Бүх миграц `api/db.js`-ийн `migrate()` дотор **идемпотент** (`CREATE TABLE IF NOT EXISTS`,
`ALTER … хэрэв багана байхгүй бол`). Migrate.js нь зөвхөн standalone runner. **Multi-tenant:**
бараг бүх хүснэгт `user_id`-тэй, query бүр `req.userId`-аар шүүгдэнэ.

| Хүснэгт | Гол багана | Тайлбар |
|---|---|---|
| `transactions` | `user_id, amount, currency, txn_date (YYYY-MM-DD), type (expense/income), category, status (classified/pending_review), description, merchant_place, is_pos, manually_edited, message_id (UNIQUE)` | Гүйлгээ. `manually_edited=1` мөрийг pipeline дахин parse/categorize хийхгүй. |
| `category_overrides` | `user_id, merchant_pattern, category, friendly_name` `UNIQUE(user_id, merchant_pattern)` | Сурсан override (мерчант→ангилал). |
| `users` | `id, email UNIQUE, password_hash, role, google_sub, picture` | Хэрэглэгч. Google хэрэглэгчид `password_hash=''` sentinel. |
| `user_settings` | `user_id PK, data (JSON), updated_at` | Төсвийн тохиргоо JSON: `salaryAmount, paydayDay, usdMnt, subscriptions[], categoryAllocations[]`. |
| `personal_events` | `id, user_id, title, date, amount_mnt` | Хуанли дээрх хувийн event. |
| `google_tokens` | `user_id PK, refresh_token, scope, calendar_connected` | **НУУЦ — API хариуд ХЭЗЭЭ Ч буцаахгүй.** Calendar (readonly) token. |
| `budget_allocations` | `user_id, category, percent (REAL)` `PK(user_id, category)` | Real-time tracker-ийн **%-хуваарилалт**. |

Миграц блокууд: 001–004 (transactions/dashboard/AI/note), 005 (auth+multi-tenant),
006 (user_settings+personal_events), 007 (google_sub/picture+google_tokens),
008 (budget_allocations).

---

## 5. API endpoint-ууд (бүгд `/api` дор)

**Auth** (`routes/auth.js`):
- `GET /api/auth/google` → Google consent руу 302 (signed-JWT state = CSRF).
- `GET /api/auth/google/callback` → code солих → **allow-list шалгах** → user upsert + calendar token хадгалах → бидний JWT-г **URL fragment**-аар SPA руу.
- `POST /api/auth/refresh`, `GET /api/auth/me`.
- `POST /api/auth/login`, `/register` — **default UNTRAALTTAI** (`AUTH_LOCAL_ENABLED=false` → 404). Зөвхөн тест/яаралтай.

**Transactions** (`routes/transactions.js`): `GET /api/transactions` (шүүлттэй),
`GET /api/transactions/pending`, `PATCH /:id/category` (applyToAll → override),
`PATCH /:id/note`, `POST /api/transactions` (listener ingest, X-API-Key).

**Meta** (`routes/meta.js`): `GET /api/summary`, `/monthly`, `/analytics/by-category?month=YYYY-MM`,
`/categories`, `POST /ai-categorize`, `GET/POST /overrides`.

**Budget** (`routes/budget.js`): `GET/PUT /api/settings`, `GET/POST /api/events`,
`DELETE /api/events/:id`, `GET /api/budget-status?cycle=current`,
`GET/PUT /api/budget-allocations`.

---

## 6. Frontend бүтэц (`dashboard/src/`)

- **Entry:** `main.jsx` → `App.jsx`. Nav sections: **Бүртгэл / Шинжилгээ / Календарь / Шийдвэр**
  (desktop sidebar + mobile bottom-tabs).
- **Components:** `Login` (Google-only), `Filters`, `Summary`, `TransactionTable`,
  `PendingReview`, `Analyze`, `Insights`, `Calendar` (хуанли+event+тохиргоо+tracker+planner-г агуулна),
  `Planner` (MNT хуваарилалт), `Settings` (цалин/payday/ханш/subs/alloc форм),
  `BudgetTracker` (real-time зарцуулалт ↔ %-хуваарилалт).
- **lib:** `api.js` (JWT client, 401→refresh, `consumeAuthFragment` OAuth callback),
  `format.js` (`money()`, `catEmoji/catHex`, ангиллын өнгө), `budget.js` (цэвэр огноо/цикл логик, тестлэгдсэн).

---

## 7. Хийгдсэн боломжууд (feature түүх)

1. **Suurь:** JWT auth + multi-tenant (бүх дата `user_id`-тэй).
2. **Dashboard дизайн:** Sankhuu Platform загвар (cream/brand), responsive.
3. **Календарь/Төсөв:** хэрэглэгчийн тохиргоо (цалин/payday/ханш/захиалга/хуваарилалт) сервер
   талд хадгалагдана; хуанли (payday/захиалга/хувийн event marker); Planner (MNT хуваарилалт).
   **Цалин нь хэрэглэгчээс** — код дотор хуурамч санхүүгийн дүн БАЙХГҮЙ (default null → empty state).
4. **Google нэвтрэлт:** хүний нэвтрэлт **Google-only** (email/нууц үг UI-аас хасав), **allow-list**
   (`GOOGLE_ALLOWED_EMAILS`); consent-д Calendar (readonly) зөвшөөрөл авч token хадгална.
5. **Real-time budget tracker:** циклийн **бодит зарлага** ангиллаар (`/api/budget-status`,
   READ-ONLY), **%-хуваарилалт**тай харьцуулна (spent/allocated bar: ≥85% шар, >100% улаан;
   чөлөөт үлдэгдэл сөрөг бол улаан). Planner-ийг хөндөөгүй — тусдаа "Бодит зарцуулалт" view.

---

## 8. Гол конвенцууд (шинэ код бичихэд)

- **Per-user isolation:** query бүр `req.userId`-аар. Хэзээ ч хэрэглэгч хооронд алдагдуулахгүй.
- **Ангилал:** `config/categories.js` (`categorize.js listCategories()` — 10 ангилал). Танигдаагүй
  гүйлгээ → `category=null` + `pending_review` (AI санал асууна). **~61% зарлага ангилагдаагүй**
  BOM мерчантууд (STOREBOM г.м) — tracker-т "Тодорхойгүй" тусдаа мөр.
- **Мөнгө:** frontend `money()` (`lib/format.js`) — `Intl` mn-MN, `₮`. Дэлгэцэнд round хий.
- **Validation:** zod (`routes/`-д inline эсвэл `schema.js`).
- **Route загвар:** factory (`createXRouter({ db, ai })`), `{status:'ok', ...}` хариу, `logger`-оор алдаа.
- **Tracker READ-ONLY:** гүйлгээ/ангилалд ХЭЗЭЭ Ч бичихгүй (зөвхөн SELECT).
- **Цикл:** payday (anchor day, default `settings.paydayDay=15`; амралтын өдөр бол ажлын өдөр
  хүртэл ухарна) → дараагийн payday. Хил **[start inclusive, end exclusive)** — давхцал/алдалтгүй.
  Server: `api/budgetCycle.js`; frontend: `lib/budget.js` — ижил дүрэм.
- **Responsive (cheap audit):** дүрмийг код бичих үедээ мөрд — олон элементтэй мөр
  `flex-col`→`sm:flex-row`; atomic string (огноо/дүн/%) `whitespace-nowrap`; урт нэр
  `min-w-0`+`truncate`; inline `style`-аар layout property (`gridTemplateColumns/flexDirection/…`)
  тавихгүй (responsive class-ийг дардаг); текст ≥13px. Төгсгөлд грэп-audit + нэг удаа 360px шалгах.

---

## 9. Auth загвар (нарийвчлал)

- **Хүн:** зөвхөн **Google OAuth** (allow-list). Callback → бидний **JWT** (access 30m / refresh 30d),
  SPA руу URL **fragment**-аар (query биш → log-д орохгүй). `localStorage`-д token.
- **Machine (listener/discord):** `X-API-Key: LISTENER_API_KEY` → **owner** (хамгийн бага id) хэрэглэгчид хамаарна.
- **`AUTH_LOCAL_ENABLED`** (default false): email/нууц үг `/login`,`/register`-г нээх flag (зөвхөн тест/яаралтай).
- **Google client ХУВААЛЦАНА:** listener (Gmail IMAP, scope `https://mail.google.com/`) БА dashboard
  login (`openid/email/profile/calendar.readonly`) нэг л OAuth client (`818163…`) ашигладаг.
  Redirect URI: prod `https://golomt-fin.duckdns.org/api/auth/google/callback`, dev `http://localhost:3000/...`.

---

## 10. Одоогийн live төлөв

- Deploy commit **`c883862`** серверт амьд (bank-api/listener/discord online).
- Google login сервер талд ажиллаж байна (302 → зөв redirect_uri). Real-time tracker live.
- **Баталгаажаагүй үлдсэн:** dashboard-ийн бодит Google sign-in (prod redirect URI Google Console-д
  бүртгэгдсэн эсэх — headless шалгах боломжгүй).

---

## 11. ⚠️ Мэдэгдэж буй асуудал / gotcha

- **Google app "Testing" mode → refresh token ~7 хоног тутам хүчингүй** болно. Тиймээс **listener
  `invalid_grant`-аар унтарч болзошгүй**. Засвар: `node scripts/get-token.js` (эсвэл `--manual`)-аар
  шинэ `GMAIL_REFRESH_TOKEN` авч root `.env`-д тавиад `pm2 restart bank-listener`.
  **Байнгын шийдэл:** OAuth app-ыг Publish хийх ЭСВЭЛ listener-т тусдаа OAuth client өгөх.
- **`git pull --ff-only`** серверт commit хийгээгүй локал өөрчлөлт байвал abort болно.
- **Хоёр API key таарах ёстой:** root `.env` `WEBSITE_API_KEY` ↔ `api/.env` `LISTENER_API_KEY`.
- **Node 22.5+ ЗААВАЛ** (`node:sqlite`). Сервер дээр Node 24.

---

## 12. Тест

- Backend: `cd api && npm test` (`node --test`) — **52 тест** (dashboard, api, budget,
  budget-status, google-auth). In-memory SQLite, mock AI/Google provider.
- Frontend цэвэр функц: `node --test dashboard/src/lib/budget.test.js` (payday/cycle математик).

---

## 13. Нууцлал

Repo нь **public байсан**. Нууц утга (`.env`, `*.pem`, `credentials.json`, `*.local.env`, DB) ХЭЗЭЭ Ч
commit хийхгүй — `.gitignore`-оор хамгаалагдсан. Шинэ нууц файл нэмбэл эхлээд `git check-ignore`-оор шалга.
Секрет байрлал: `api/.env` (API/Google/AI key), root `.env` (Gmail OAuth + `GMAIL_REFRESH_TOKEN`),
`deploy/.deploy.local.env` (host/user/SSH key/path).
