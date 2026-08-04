# Санхүүгийн туслах систем — БҮРЭН CONTEXT (chat bot / шинэ agent-д зориулсан)

> **Юунд зориулсан бэ:** Энэ нэг файлыг шинэ чатад өгөхөд төслийн БҮХ зүйл — юу хийдэг,
> юугаар хийсэн, файл бүр юу хариуцдаг, өгөгдөл хаанаас хаашаа урсдаг, ямар шийдвэр
> яагаад ийм байдаг — ойлгомжтой болно.
>
> **⚠️ Нууц утга ЭНД БАЙХГҮЙ.** Зөвхөн орчны хувьсагчийн НЭР бичигдсэн. Бодит утгууд
> `.env`, `api/.env`, `credentials.json`, `deploy/.deploy.local.env` (бүгд gitignored).
>
> Баримт бэлдсэн: 2026-08-03, шинэчилсэн: 2026-08-04. Repo: `D:\Claude`, branch `main`.
> Богино хувилбар: [`FINANCE_PRIV_CONTEXT.md`](FINANCE_PRIV_CONTEXT.md) (архитектур+deploy төлөв).

---

## 1. Систем юу хийдэг вэ (нэг догол мөрөөр)

Голомт банк гүйлгээ бүр дээр и-мэйл мэдэгдэл илгээдэг. Энэ систем тэр и-мэйлийг
**Gmail IMAP IDLE**-ээр real-time сонсож, задлан (parse), ангилж, SQLite-д хадгалж,
вэб dashboard дээр график/тайлан болгон харуулдаг. Танигдаагүй мерчантыг хэрэглэгчээс
**Discord/Telegram bot-оор шууд асууж**, хариултыг нь "сурч" (learned override) дараагийн
удаа автоматаар ангилдаг. Хувийн хэрэглээнээс **олон хэрэглэгчийн (multi-tenant)**
бүтээгдэхүүн болж өргөжсөн.

Домейн: `https://golomt-fin.duckdns.org` (DuckDNS + Let's Encrypt + Nginx → :3000).

---

## 2. Технологийн стек — юугаар хийсэн, ЯАГААД

| Давхарга | Технологи | Яагаад ийм сонголт |
|---|---|---|
| Runtime | **Node.js 24** (≥22.5 ЗААВАЛ) | `node:sqlite` built-in ашиглахын тулд |
| Өгөгдлийн сан | **`node:sqlite` (DatabaseSync)** | `better-sqlite3` native build шаарддаг (Python/VS Build Tools) — энэ машинд байхгүй. Built-in нь compile огт шаардахгүй. WAL горим |
| API | **Express 4** | Энгийн, factory pattern-д тохиромжтой |
| Валидаци | **zod 3** | Бүх ирж буй body/query schema-гаар шалгагдана |
| Auth | **jsonwebtoken** (access+refresh), **bcryptjs** | Cookie БИШ — mobile/bot-д хялбар |
| Google OAuth | **google-auth-library** (`OAuth2Client`) | Login / Calendar / Gmail 3 урсгал |
| IMAP | **imapflow** (IDLE) + **mailparser** (`simpleParser`) | Polling биш real-time push |
| HTML parse | **cheerio** | Голомтын и-мэйл HTML хүснэгт задлахад |
| Лог | **pino** + **pino-pretty** (listener); API/bot нь өөрийн жижиг JSON logger | Prod-д JSON, dev-д уншиж болохоор |
| Frontend | **Vite 5 + React 18 + Tailwind 3** | Build → `dashboard/dist`, API нь static serve хийнэ (нэг origin → CORS хэрэггүй) |
| Bot 1 | **discord.js 14** (embed + товч + modal) | Owner-т зориулсан |
| Bot 2 | **telegraf 4** (inline keyboard) | Бүх хэрэглэгчид |
| AI (сонголттой) | **Anthropic Messages API** (`claude-haiku-4-5`), prompt caching-тэй | Танигдаагүй мерчантад САНАЛ өгнө. Default OFF |
| Ханш | **open.er-api.com** (үнэгүй, key-гүй), 1 цагийн in-memory кэш | USD/EUR → MNT амьд ханш |
| Тест | **`node --test`** (built-in) | Гадны framework огт байхгүй |
| Process manager | **pm2** (`ecosystem.config.cjs`, 4 процесс) | autorestart, reboot-д авто |
| Reverse proxy | **Nginx** + certbot | :443 → 127.0.0.1:3000 |

**Онцлог:** гуравдагч талын пакет ХАМГИЙН БАГА. Rate limit, .env parser, logger, ops-alert,
crypto бүгд гараар бичигдсэн (`express-rate-limit`, `dotenv`, `winston` г.м. байхгүй).

---

## 3. Repo бүтэц — файл бүрийн үүрэг

```
D:\Claude\
├── src/          listener  — Gmail IMAP IDLE (15 файл, ~1,720 мөр)
├── api/          API       — Express + SQLite (39 файл, ~4,860 мөр)
├── dashboard/    frontend  — Vite/React/Tailwind (24 файл, ~3,100 мөр)
├── discord/      bot       — owner-only (6 файл, ~520 мөр)
├── telegram/     bot       — multi-tenant (9 файл, ~760 мөр)
├── config/       ДУНДЫН    — categories, transactionActions, tokenCrypto, txfields, loadEnv
├── scripts/      нэг удаагийн/ops скрипт + verify скрипт
├── test/         listener-ийн parser/categorize тест
├── deploy/       runbook, nginx conf, duckdns скрипт жишээ
└── data/         SQLite файлууд (gitignored)
```

### 3.1 `config/` — хоёр талд дундын код (давхардал таслах)

| Файл | Үүрэг |
|---|---|
| `categories.js` | **★ Single source:** 10 ангиллын нэр, emoji+hex metadata, keyword дүрэм, `matchByKeywords()`, `OLD_TO_NEW` mapping. Backend, listener, frontend ГУРВУУЛАА эндээс импортолно |
| `transactionActions.js` | **★ Single source (үйлдлийн капабилити):** гүйлгээн дээр ЯМАР үйлдэл боломжтой, ЯМАР талбар асуухыг тодорхойлно. `availableActions(txn)`, `detailFieldFor(txn)` (POS→`merchantPlace`/"Газрын нэр", бусад→`note`/"Шалтгаан"), `isPosTxn`, `isPendingTxn`, `findAction`, `APPLY_TO_ALL_CONFIRM` (баталгаажуулалтын ижил текст). Discord/Telegram/Dashboard ГУРВУУЛАА эндээс уншина — өнгө/байрлал/API дуудлага энд ОРОХГҮЙ |
| `tokenCrypto.js` | AES-256-GCM `encryptToken/decryptToken/isEncrypted`. Формат `enc:v1:<iv>:<tag>:<ct>`. `TOKEN_ENC_KEY` (64 hex) |
| `txfields.js` | `detectIsPos(desc)` (BOM дүрэм), `isoDate(s, {anchored})` — parser БА API хоёул ашиглана |
| `loadEnv.js` | Пакетгүй `.env` уншигч. Систем/pm2 env давамгайлна |

### 3.2 `src/` — listener (Gmail → parse → push)

| Файл | Үүрэг |
|---|---|
| `index.js` | Entry. `processEmail()` — илгээгч шүүх → идэмпотент шалгах → parse → categorize → DB insert → API push. Heartbeat, graceful shutdown, `seedOwnerFromEnv()` |
| `imap-client.js` | `ImapListener` класс: XOAUTH2 холболт, IDLE, exponential-backoff reconnect, 50 мин тутам token refresh, catch-up (`lastSeenUid`), UIDVALIDITY өөрчлөлт зохицуулах. **Нэг instance = нэг хэрэглэгчийн inbox** |
| `accounts.js` | API-ийн DB-г **шууд** (SELECT/UPDATE л) уншиж холбогдсон Gmail дансуудыг жагсаана, token decrypt хийнэ. Миграц ХИЙХГҮЙ |
| `manager.js` | Reconcile loop: шинэ данс → асаах, салгагдсан → зогсоох, token солигдсон → restart. **Цэвэр логик** (env/config импортгүй → тестлэгдэнэ) |
| `parsers/golomt.js` | Голомтын **5 и-мэйл загварыг** задлана (EASYINFO, VERBOSE, CARD, FIRSTTXN, OTHER). Label-based extractor, HTML+plain хоёуланд |
| `categorize.js` | `config/categories.js`-ийн keyword дүрмийг дуудна |
| `push.js` | API руу POST + HMAC гарын үсэг + `Idempotency-Key` + retry (exponential backoff) |
| `db.js` | Listener-ийн ӨӨРИЙН SQLite (`data/listener.sqlite`): `state` (lastSeenUid, uidValidity — **per-user scoped**), боловсруулсан messageId, гүйлгээний статус (`parse_failed`/`push_failed`/`pushed`) |
| `balanceAlert.js` | Үлдэгдэл 5 удаа ДАРААЛЖ задрахгүй бол → и-мэйл загвар өөрчлөгдсөн байж магадгүй → ops alert |
| `ops-notify.js`, `logger.js` | Discord webhook alert (15 мин debounce, PII scrub), pino logger |
| `config.js` | Root `.env` унших + валидаци |

### 3.3 `api/` — Express API

| Файл | Үүрэг |
|---|---|
| `server.js` | Prod entry: config → db → app → listen. Seed admin, `sweepStalePending()` (12 цаг тутам), graceful shutdown |
| `app.js` | **`createApp(deps)` factory** — listen хийхгүй, тестүүд эндээс app авна. Route холболт, static serve, SPA fallback, 404/error handler |
| `db.js` (54KB) | Бүх SQL энд. `createDb()` → миграц (14 үе шат, идемпотент) + ~50 функц |
| `config.js` | `api/.env` унших, `required()`/`optional()`/`num()`/`bool()` |
| `schema.js` | zod `TransactionSchema` + `normalizeBody()` (listener-ийн alias: `direction→type`, `accountTail→accountLast4`, `subject→raw`) |
| `classify.js` | **Ангиллын шийдвэрийн дараалал:** override → income → keyword → NULL+pending(+AI санал) |
| `categorize.js` | `config/categories.js`-ийн wrapper |
| `ai.js` | Anthropic API дуудлага. System prompt `cache_control: ephemeral`. Танихгүй бол ЗААВАЛ `other/low` (буруу таамаглахаас сэргийлэх). Алдаа → throw, дуудагч catch хийж системийг зогсоохгүй |
| `fx.js` | open.er-api.com-оос USD/EUR→MNT, 1 цагийн кэш, унавал stale кэш буцаана |
| `budgetCycle.js` | Цалингийн цикл `[start, end)`. Anchor day амралтын өдөрт таарвал **ажлын өдөр рүү УХАРНА**. Frontend `budget.js`-тэй ИЖИЛ дүрэм |
| `balanceHistory.js` | Үлдэгдлийн түүх сэргээх **цэвэр функцууд**: `reconstructBalanceSeries` (anchor-оос ухрааж/урагшлуулж), `detectGaps` (>2 өдөр гүйлгээгүй = listener downtime сэжиг), `ubYmd` (**UTC+8 хатуу** — OS timezone-оос үл хамаарна) |
| `ops-notify.js` | Discord webhook + sustained-5xx илрүүлэлт (5 мин цонхонд 5 удаа) |
| `migrate.js`, `migrations/*.sql` | 001/002 SQL (sqlite + postgres хувилбар — postgres нь ирээдүйн боломж, одоо ашиглагдахгүй) |
| `auth/jwt.js` | `signAccess` (30м) / `signRefresh` (30х) / `signState` (OAuth CSRF, 10м) / `verify(token, expectedTyp)` |
| `auth/passwordHash.js` | bcryptjs wrapper |
| `auth/providers/google.js` | `LOGIN_SCOPES` / `CALENDAR_SCOPES` / `GMAIL_SCOPES`, `getAuthUrl`, `exchangeCode` |
| `auth/providers/local.js` | Email+password provider (default OFF) |
| `middleware/auth.js` | JWT **эсвэл** `X-API-Key` (machine → owner). timing-safe compare |
| `middleware/rateLimit.js` | In-memory fixed-window (key = apiKey+IP), default 120 хүсэлт/60сек |
| `routes/*.js` | 6 router — доор §5-д дэлгэрэнгүй |

### 3.4 `dashboard/` — React SPA

- **Entry:** `main.jsx` → `App.jsx`. 4 таб: **Бүртгэл / Шинжилгээ / Календарь / Шийдвэр**.
- Desktop: зүүн sidebar. Mobile: доод tab bar (`lg:hidden` / `hidden lg:flex`).
- Дизайн: cream/teal (`#F4EEE4` background, `#1F7A6B` brand), фонт Rubik (display) + Onest (body).
- Tailwind-ийн зэрэгцээ inline `style` ихээр ашигласан (App.jsx, BalanceHistory г.м).

| Component | Юу хийдэг |
|---|---|
| `Login.jsx` | Google-only sign-in. Callback-ийн `?error=` кодыг монгол мессеж болгоно |
| `Summary.jsx` | 3 карт: энэ сарын орлого / зарлага / **Үлдэгдэл** (`/api/balance` — сарын cashflow БИШ) |
| `Filters.jsx` | Хайлт, төрөл, олон ангилал, огнооны муж, дүнгийн муж |
| `TransactionTable.jsx` | Жагсаалт + хуудаслалт (50/хуудас) + мөр дээр дарахад **expand панель** (`RowPanel`): ангилал chip-үүд, талбар засах (POS→Газрын нэр / бусад→Шалтгаан — `transactionActions`-оос), `applyToAll` checkbox (**default OFF**, ангилал өөрчлөгдөөгүй үед disabled), optimistic update + алдаанд rollback |
| `PendingReview.jsx` | Ангилаагүй гүйлгээний шар banner + баталгаажуулах modal. Талбарын шошго `detailFieldFor()`-оос, `applyToAll` checkbox **default OFF** |
| `Analyze.jsx` | Сараар орлого/зарлага (1/3/12 сар), ангиллын задаргаа, `BalanceHistory`-г агуулна |
| `BalanceHistory.jsx` | Өдөр тутмын **үлдэгдлийн график** (7х/30х/3с/6с/1ж preset эсвэл custom муж), цэг дээр даран тухайн өдрийн гүйлгээний задаргаа |
| `DebtLedger.jsx` | **Өр төлбөрийн дэвтэр** — `Analyze.jsx`-ийн дотор (Календарь БИШ). Хоёр харагдац: «Үлдэгдэл» (хүн × валют бүрийн цэвэр өр — "Болд танд 30,000₮ өртэй") ба «Түүх» (бүх зээл/зээлүүлэлт/хаалт). Нэмэх форм (хэн/чиглэл/дүн/валют/огноо/тэмдэглэл + **холбох гүйлгээ сонгогч**), хаах/нээх/устгах. EUR-ийг эх валютаар харуулж, ханш байвал `≈ ₮` нэмнэ. **Бүх арифметик `lib/debt.js`-д** |
| `Calendar.jsx` | Сарын хуанли: цалингийн өдөр, захиалга, хувийн event. `Planner`, `Settings`, `BudgetTracker`, `ManualSavings`-г агуулна |
| `Planner.jsx` | Циклийн төлөвлөгөө (цалин → захиалга → хуваарилалт → үлдэх) |
| `BudgetTracker.jsx` | **Бодит зарцуулалт vs %-хуваарилалт** real-time. Bar ≥85% шар, >100% улаан. Debounced PUT |
| `ManualSavings.jsx` | Гар бүртгэлийн хөрөнгө (бэлэн мөнгө/EUR). **EUR-ийг эх валютаараа хадгална**, дэлгэц дээр амьд ханшаар хөрвүүлнэ |
| `Settings.jsx` | Цалин, payday, ханш, захиалга, хуваарилалт + **Gmail / Calendar / Telegram холболтын 3 тусдаа хэсэг** |
| `Insights.jsx` | "Удахгүй" placeholder (ухаалаг төсөв, урсгалын таамаг, хэмнэх зөвлөгөө) |

| lib | Юу хийдэг |
|---|---|
| `api.js` | JWT client. Бүх дуудалт relative `/api/...`. 401 → refresh-ээр нэг удаа автомат дахин оролдоно. `consumeAuthFragment()` (Google callback-ийн `#token`). `patchCategory` / `updateFields` (тэмдэглэл+газрын нэр) / `updateNote` (back-compat) |
| `budget.js` | Огноо/циклийн **цэвэр логик** (React-гүй, тестлэгдсэн). Санхүүгийн дүн ХАТУУ БИЧИГДЭХГҮЙ — settings-ээс дамжина |
| `debt.js` | Өрийн **цэвэр логик** (React-гүй, тестлэгдсэн): `netBalances()` (хүн × валют — ⚠️ MNT ба EUR ХЭЗЭЭ Ч хооронд цэвэрших ЁСГҮЙ), `groupByCounterparty`, `totalsByCurrency`, `eurToMntDisplay` (ханшгүй бол **null**, хуурамч тоо гаргахгүй), `balancePhrase` (монгол өгүүлбэрийн бүтэц) |
| `format.js` | `money()`, `catLabel/catEmoji/catHex`, `displayDesc()`, **дүнг нуух горим** (`applyAmountsMasked`, localStorage) |

### 3.5 `scripts/` — нэг удаагийн ба ops

| Скрипт | Үүрэг |
|---|---|
| `get-token.js` | Gmail refresh_token авах (localhost callback сервер + consent URL) |
| `collect-descriptions.js` | Бүх хуучин и-мэйлийг уншиж `transactions-export.json` + `descriptions-summary.csv` гаргана |
| `reparse.js` | Засагдсан parser-аар хуучин и-мэйлийг дахин задлаж NULL талбар нөхнө (`manually_edited=1` мөрийг ХӨНДӨХГҮЙ) |
| `recategorize.js`, `migrate-categories.js` | Хуучин англи ангилал → канон монгол нэр (идемпотент) |
| `repush.js` | `push_failed` гүйлгээг дахин илгээх (cron-д тавьж болно) |
| `backup.sh` | Хоёр SQLite-ийн өдөр тутмын backup (VPS) |
| `*.verify.mjs` (5) | Жинхэнэ `createApp` + `:memory:` DB дээр end-to-end шалгалт (Discord flow, budget, analytics, ops-notify) |

---

## 4. Өгөгдлийн урсгал (end-to-end)

```
Голомт банк  ──и-мэйл──►  Хэрэглэгчийн Gmail
                              │  IMAP IDLE (XOAUTH2, per-user)
                              ▼
                        src/imap-client.js
                              │ simpleParser
                              ▼
                     src/index.js processEmail()
        ┌──────────────┴──────────────┐
        │ 1. Илгээгч = alert@golomtbank.com мөн үү?
        │ 2. messageId аль хэдийн боловсруулсан уу? (идэмпотент)
        │ 3. parsers/golomt.js → {amount, date, desc, type, isPos, balance, last4}
        │ 4. categorize (keyword)
        │ 5. listener DB-д insert (status='push_failed' түр)
        └──────────────┬──────────────┘
                       │ POST /api/transactions
                       │ (X-API-Key + HMAC + Idempotency-Key + userId ЗААВАЛ)
                       ▼
                 api/routes/transactions.js
                       │ zod validate → normalizeBody
                       ▼
                 api/classify.js
        ┌──────────────┴──────────────┐
        │ override? → тэр ангилал
        │ income?   → 'Орлого'
        │ keyword?  → тэр ангилал
        │ үгүй      → category=NULL, status='pending_review' (+AI санал)
        └──────────────┬──────────────┘
                       ▼
              SQLite: transactions (user_id-тай)
                       │
        ┌──────────────┼───────────────────────────┐
        ▼              ▼                           ▼
  Dashboard (React)  Discord bot (owner)   Telegram bot (бүх хэрэглэгч)
        │              │ polling → embed+товч      │ polling → мессеж+товч
        └──────────────┴───────────────────────────┘
                       │ PATCH /api/transactions/:id/category
                       │ (applyToAll=true → learned override үүснэ)
                       ▼
              Дараагийн ижил мерчант АВТОМАТААР ангилагдана
```

**pending_review-ийн амьдралын мөчлөг:** 3 хоног (`PENDING_AUTO_CLASSIFY_DAYS`) дотор
хэрэглэгч хариулаагүй бол → автоматаар **"Бусад"** болно (хэрэглэгч аль хэдийн мартсан
байдаг гэсэн бодлого). Гараар зассан мөрийг ХӨНДӨХГҮЙ.

---

## 5. API endpoint-ууд (бүгд `/api` дор)

### Auth (`routes/auth.js`) — PUBLIC хэсэг rate-limit-тэй, auth шаардахгүй
| Method | Зам | Тайлбар |
|---|---|---|
| GET | `/auth/google` | Consent руу redirect (**минимал scope**: openid/email/profile) |
| GET | `/auth/google/callback` | Код солих → allow-list эсвэл open signup → JWT-г SPA руу fragment-аар |
| GET | `/auth/google/calendar/callback` | Calendar холболтын callback (`calendar_oauth_state`) |
| GET | `/auth/gmail/callback` | Gmail холболтын callback (`gmail_oauth_state`) |
| POST | `/auth/register`, `/auth/login` | Default **OFF** (`AUTH_LOCAL_ENABLED=false` → 404) |
| POST | `/auth/refresh` | Access token сэргээх |

### Auth (JWT шаардана)
| Method | Зам | Тайлбар |
|---|---|---|
| GET | `/auth/me` | `{email, picture, gmailConnected, calendarConnected, telegramConnected}` |
| GET | `/auth/google/calendar` | → `{url}` (consent эхлүүлэх) |
| POST | `/auth/google/calendar/disconnect` | |
| GET | `/auth/gmail/connect` | → `{url}` |
| POST | `/auth/gmail/disconnect` | |

### Transactions (`routes/transactions.js`)
| Method | Зам | Тайлбар |
|---|---|---|
| POST | `/transactions` | **Ingest.** Machine (`X-API-Key`) үед `userId` ЗААВАЛ — дутуу бол 400 (owner fallback БАЙХГҮЙ). JWT үед `req.userId` |
| GET | `/transactions` | Шүүлт: `q, type, category, from, to, minAmount, maxAmount, status, limit, offset` |
| GET | `/transactions/pending` | Ангилаагүй жагсаалт |
| GET | `/transactions/:id` | Нэг гүйлгээний одоогийн төлөв (bot-д) |
| PATCH | `/transactions/:id/category` | Баталгаажуулах/ангилал засах. Body `{category, applyToAll?, merchantPlace?, note?}`. **`learn = !!applyToAll` ГАГЦХҮҮ** — `merchantPlace`/`note` дангаараа override үүсгэхээ БОЛЬСОН (өмнө нь авто-эскалаци хийдэг байсан). `applyToAll=true` → тэр мерчантын бүх мөр + `category_overrides`; `false` → зөвхөн тухайн мөр. Хоёр зам ч `manually_edited=1`, талбар нь `COALESCE` (хоосноор дарж бичихгүй) |
| PATCH | `/transactions/:id/note` | Тэмдэглэл/газрын нэр — **ангилал хөндөхгүй, override үүсгэхгүй**. Body `{note?, merchantPlace?}`: **body-д БАЙГАА талбарыг Л шинэчилнэ**; тодорхой хоосон string → `NULL` (утга устгах боломж); хоёулаа байхгүй → 400. Хариу `{status:'ok', id, note, merchantPlace}` |
| PATCH | `/transactions/:id/exclusion` | **Төсвөөс хасах/буцаах.** Body `{excluded: boolean}` (boolean биш → 400). Хасахад `manually_edited=1`. ⚠️ ЗӨВХӨН төсөв/ангилал/шинжилгээнд нөлөөлнө — **үлдэгдэлд ХЭЗЭЭ Ч нөлөөлөхгүй**. Өрийн бичлэгтэй холбоотой гүйлгээний хасалтыг шууд буцаах гэвэл **409** (эхлээд дэвтрээс салгана) |

### Meta / Analytics (`routes/meta.js`)
| Method | Зам | Тайлбар |
|---|---|---|
| GET | `/summary` | Шүүлттэй нийт орлого/зарлага |
| GET | `/monthly?months=12` | Сараар |
| GET | `/analytics/by-category?month=YYYY-MM` | Сарын ангиллын задаргаа |
| GET | `/balance` | **Одоогийн үлдэгдэл** = сүүлийн `account_balance`-тай мөр. Байхгүй бол `null` |
| GET | `/balance-history?range=90d\|from=&to=` | Өдөр тутмын үлдэгдлийн сэргээлт + өдөр бүрийн гүйлгээ (drill-down) + `gaps`. Anchor байхгүй бол `available:false` (**хуурамч тоо хэзээ ч гаргахгүй**) |
| GET | `/fx-rates` | Амьд USD/EUR→MNT (провайдер унавал 502) |
| GET | `/categories` | 10 ангилал |
| POST | `/ai-categorize` | AI санал (дотоод) |
| GET/POST | `/overrides` | Learned override жагсаах/нэмэх |

### Budget (`routes/budget.js`)
`GET/PUT /settings` · `GET /budget-status?cycle=current` · `GET/PUT /budget-allocations` ·
`GET/POST /events` · `DELETE /events/:id`

`settings` бүтэц (zod `.strict()`): `salaryAmount` (null боломжтой), `budgetFloor`,
`paydayDay` (1–28), `usdMnt`, `eurMnt`, `subscriptions[]` `{name, day, amountUsd}`,
`categoryAllocations[]` `{category, amountMnt}`.

### Manual savings (`routes/manualSavings.js`)
`GET / POST /manual-savings` · `PUT/DELETE /manual-savings/:id`
`{date, type:'deposit'|'withdrawal', currency:'MNT'|'EUR', amount>0, note}`.
Balance = валют тус бүрээр тэмдэгт нийлбэр — **backend хэзээ ч хөрвүүлэхгүй**.

### Өр төлбөрийн дэвтэр (`routes/debtLedger.js`, бүгд `/api/debt-ledger` дор)
| Method | Зам | Тайлбар |
|---|---|---|
| GET | `/debt-ledger` | Жагсаалт (шинэ нь эхэнд). Шүүлт: `?counterparty=`, `?status=open\|settled` |
| GET | `/debt-ledger/balances` | **Хүн × валют** тус бүрийн цэвэр үлдэгдэл (зөвхөн `open`). `[{counterparty, currency, net, direction}]` — `net>0` = тэр хүн ХЭРЭГЛЭГЧИД өртэй. Тэг болж цэвэршсэн хосыг буцаахгүй |
| POST | `/debt-ledger` | `{counterparty, direction:'i_lent'\|'i_borrowed', amount>0, currency:'MNT'\|'EUR', entryDate, note?, linkedTransactionId?}`. Холбоос өгвөл тэр гүйлгээг **атомоор** төсвөөс хасна |
| PATCH | `/debt-ledger/:id` | Засах / хаах (`{status:'settled', settledTransactionId?}`) / дахин нээх. Холбоос солих/салгах үед хасалтыг зөв тавьж/буцаана |
| DELETE | `/debt-ledger/:id` | Устгах + энэ бичлэгээс үүдсэн хасалтыг буцаана |

⚠️ **Хасалт буцаах хамгаалалт:** гүйлгээг **ӨӨР** өрийн бичлэг лавлаж байвал хасалт буцаагдахгүй
(нэг зарлагыг хоёр хүнд хуваасан тохиолдол). `isTransactionReferencedByOtherDebt()` шалгана.
`debt_ledger` + `transactions` хоёуланд бичих үйлдэл бүр **нэг SQLite транзакцид** ороосон.

### Telegram (`routes/telegram.js`, JWT-only)
`POST /telegram/link-code` (6 оронтой, 10 мин) · `POST /telegram/unlink`

### Бусад
`GET /health` (auth-гүй). Бүх хариу `{status:'ok'|'error', ...}` хэлбэртэй.

---

## 6. Өгөгдлийн сан

**Хоёр тусдаа SQLite файл:**
1. `data/listener.sqlite` — listener-ийн state (lastSeenUid, боловсруулсан messageId, push статус)
2. `api/data/transactions.sqlite` — **бодит өгөгдөл**. Бүх миграц `api/db.js`-ийн `migrate()` дотор, идемпотент (`hasColumn()` шалгалт).

| Хүснэгт | Гол багана |
|---|---|
| `transactions` | `user_id, amount, currency, txn_date, type, category, status, description, merchant_place, is_pos, note, ai_suggested_category, ai_confidence, manually_edited, account_balance, **excluded_from_budget**, message_id (UNIQUE)` |
| `category_overrides` | `user_id, merchant_pattern, category, friendly_name, default_note` — `UNIQUE(user_id, merchant_pattern)` |
| `users` | `id, email UNIQUE, password_hash, role, google_sub, picture` |
| `user_settings` | `user_id PK, data (JSON)` |
| `personal_events` | `id, user_id, title, date, amount_mnt` |
| `google_tokens` | `user_id PK, refresh_token, scope, calendar_connected, gmail_refresh_token, gmail_scope, gmail_email, gmail_connected, gmail_status, gmail_oauth_client` — **token-ууд ШИФРЛЭГДСЭН** |
| `budget_allocations` | `(user_id, category) PK, percent` |
| `telegram_links` | `user_id PK, chat_id UNIQUE` |
| `telegram_link_codes` | `code PK, user_id, expires_at, used` |
| `telegram_notifications` | `(transaction_id, chat_id) PK, message_id` |
| `manual_ledger_entries` | `user_id, entry_date, type, amount, currency, amount_eur, exchange_rate, note` |
| `debt_ledger` | `user_id, counterparty, direction ('i_lent'\|'i_borrowed'), amount (CHECK>0), currency ('MNT'\|'EUR'), entry_date, note, status ('open'\|'settled'), linked_transaction_id (→transactions, ON DELETE SET NULL), settled_transaction_id (мөн адил), created_at, settled_at` |

**Миграцын түүх (15):** 001–004 үндсэн + dashboard/AI/note · **005** auth+multi-tenant
(`user_id` бүх хүснэгтэд, `category_overrides`-г table-rebuild хийсэн) · 006 settings+events ·
007 google_sub/picture + google_tokens · 008 budget_allocations · 009 Gmail multi-tenant
баганууд + **token encryption backfill** · 010 Telegram хүснэгтүүд · 011 `gmail_oauth_client`
marker · 012 `account_balance` · 013 `manual_ledger_entries` · 014 `currency` багана ·
**015** `debt_ledger` хүснэгт (+3 индекс) БА `transactions.excluded_from_budget`
(`INTEGER NOT NULL DEFAULT 0` — хуучин мөр бүгд 0, **backfill шаардлагагүй**).

PRAGMA: `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`.
WAL нь **олон процесс** (api + listener + 2 bot) нэг файлыг зэрэг ашиглах боломж өгдөг.

---

## 7. Аюулгүй байдал / Auth загвар

### 7.1 Гурван төрлийн дуудагч
1. **Хүн (dashboard)** — `Authorization: Bearer <JWT>` → `req.userId`
2. **Machine (listener, discord)** — `X-API-Key` → `req.userId = owner` (хамгийн бага id)
3. **Telegram bot** — JWT-ээ **өөрөө mint хийдэг** (`telegram/jwtAuth.js`, `api/auth/jwt.js`-г
   ШУУД импортолж, ижил `JWT_SECRET`-ээр). chat_id → user_id resolve хийсний дараа тухайн
   хэрэглэгчийн нэрийн өмнөөс API дуудна → одоо байгаа `req.userId` шүүлтээр автоматаар
   тусгаарлагдана (API талд шинэ auth логик шаардлагагүй).

### 7.2 ⚠️ Гурван өөр Google OAuth client (ХАМГИЙН ТӨӨРӨГДӨЛТЭЙ ХЭСЭГ)
| # | Хэрэглээ | Client type | Env |
|---|---|---|---|
| 1 | Listener-ийн Gmail IMAP (legacy owner seed) | **Desktop/Installed** | root `.env` `GOOGLE_CLIENT_ID`, `credentials.json`, `scripts/get-token.js` |
| 2 | Login + Calendar холболт | **Web application** | `LOGIN_GOOGLE_CLIENT_ID/SECRET` |
| 3 | Gmail холболт (dashboard Settings-ээс) | **Web application** | `GMAIL_GOOGLE_CLIENT_ID/SECRET` |

**Хатуу дүрэм:** Desktop-type client нь custom HTTPS `redirect_uri`-г ОГТ дэмждэггүй →
`redirect_uri_mismatch` гарна, засах арга байхгүй, зөвхөн зөв төрлийн шинэ client үүсгэх л
шийдэл. (Энэ алдаа удаан хугацаанд эрэлхийлэгдэж эцэст нь оношлогдсон.)

Мөн: Google refresh_token-ыг **олгосон ЯГ ТЭР client-ээр** л сэргээж болно (эс бөгөөс
`unauthorized_client`) → `gmail_oauth_client` багана ('desktop' | 'web') үүнийг тэмдэглэдэг,
`src/index.js` тухайн дансанд зөв clientId-г сонгоно.

### 7.3 CSRF
3 OAuth урсгал тус бүр өөрийн `state` namespace-тэй JWT ашиглана:
`oauth_state` / `calendar_oauth_state` / `gmail_oauth_state` → хооронд нь replay хийх боломжгүй.

### 7.4 Бусад хамгаалалт
- **Token encryption at rest** — AES-256-GCM. `TOKEN_ENC_KEY` нь root болон `api/.env`-д
  ИЖИЛ. **Солих ЁСГҮЙ** — солиход бүх хуучин token тайлагдахгүй болно.
- **Refresh token API хариуд ХЭЗЭЭ Ч буцахгүй** (зөвхөн `*Connected` boolean).
- Rate limit: 120/60сек (apiKey+IP). Body limit 100kb. `x-powered-by` OFF. `trust proxy` ON.
- timing-safe API key харьцуулалт.
- Ops alert payload-оос и-мэйл/token **scrub** хийгддэг.
- Per-user isolation: query бүр `req.userId`-аар шүүгдэнэ. `telegram/isolation.test.js` нь
  cross-user JWT-г жинхэнэ `api/app.js`-ээр reject хийхийг баталгаажуулдаг.

---

## 8. Ангиллын систем

**10 ангилал** (`config/categories.js`, emoji + hex-тэй):
Гадуур хооллолт 🍽️ · Хүнсний зүйл 🛒 · Тээвэр 🚗 · Орлого 💰 · Шилжүүлэг & гэр бүл 💸 ·
Захиалга & сервис 📱 · Боловсрол 📚 · Чөлөөт цаг / зугаа цэнгэл 🎬 · Хувцас / гоо сайхан 👕 · Бусад 📦

**Дүрмүүд:**
- Keyword дүрэм 7 ангилалд (Орлого/Шилжүүлэг/Бусад нь тусгай логикоор).
- ⚠️ **Голомтын мерчант код 16 тэмдэгтэд ТАСЛАГДДАГ** (`0930 STOREBOM`, `THE LBOM`) —
  тиймээс keyword-оор ТААМАГЛАХГҮЙ. Жишээ: `'store'` гэдгийг Хүнсний зүйлээс ЗОРИУДААР
  хассан (STOREBOM-той давхцахаас сэргийлэв) — зөвхөн learned override-оор ангилагдана.
- `BOM` төгсгөлтэй = POS гүйлгээ (`detectIsPos`) → bot нь "Газрын нэр" асууна, бусад
  тохиолдолд "Шалтгаан" асууна.
- **"Бусад"-ыг автоматаар оноохгүй** — зөвхөн хэрэглэгч сонгоно (эсвэл 3 хоногийн sweep).

---

## 9. Bot-ууд

### ★ Гурван клиентийн ИЖИЛ капабилити (parity)

Discord / Telegram / Website гурвуулан **ижил чадвартай**. Rendering нь клиент бүрт өөр
(Discord товч+modal, Telegram inline keyboard+дараалсан асуулт, Website expand панель),
харин **аль үйлдэл боломжтой, ямар талбар асуух вэ гэдэг ЛОГИК нь
[`config/transactionActions.js`](config/transactionActions.js) нэг эх сурвалжаас** гарна.

| Үйлдэл | Discord | Telegram | Website |
|---|---|---|---|
| Ангилал өгөх (pending) ба **дахин өөрчлөх** (classified) | ✅ | ✅ | ✅ |
| Талбар засах — POS→Газрын нэр / бусад→Шалтгаан | ✅ | ✅ | ✅ |
| Утга **устгах** | хоосон modal submit | `«-»` гэж бичих | талбарыг хоослох |
| `applyToAll` (learned override) | ✅ | ✅ | ✅ |
| `applyToAll` **default OFF + тодорхой баталгаажуулалт** | Тийм/Үгүй товч | Тийм/Үгүй товч | checkbox |

⚠️ **`applyToAll` хэзээ ч автоматаар true болохгүй.** Хэрэглэгч `APPLY_TO_ALL_CONFIRM.question`
("Дараагийн бүх ижил мерчантад хэрэглэх үү?")-д тодорхой "Тийм" гэж хариулсан үед л override
үүснэ. Дан талбарын засвар (`PATCH /note`) override-д **ХЭЗЭЭ Ч** хүрэхгүй.

### Discord (`discord/`) — ЗӨВХӨН OWNER
- DB-г polling (эхлэхдээ одоогийн max id-ээс → хуучин flood мэдэгдэхгүй), `.bot-state.json`.
- classified → embed + "✏️ Ангилал засах" + "📝 <талбар> засах"; pending → embed +
  ангиллын товч (2×5) + "📝 <талбар> засах".
- **Ангиллын урсгал:** товч/select → modal (талбар) → **applyToAll Тийм/Үгүй товч** →
  `PATCH .../category` → мессежийг edit. Утга нь customId 100 тэмдэгтэд багтахгүй тул
  `pendingConfirm` Map-д түр хадгална (restart-д алдагдвал "хугацаа дууссан" гэж эелдэг унана).
- **Талбарын урсгал:** `n` товч → modal (одоогийн утга default) → `PATCH .../note`.
- customId codec (`categories.js`): `c` pending товч · `m` pending modal · `e` ангилал засах ·
  `es` засварын select · `n` талбар засах · `nm` талбарын modal · `ay`/`an` applyToAll.
- ⚠️ Polling query-д `WHERE user_id = owner` **ЗААВАЛ** — эс бөгөөс multi-tenant дор бусад
  хэрэглэгчийн гүйлгээ owner-ийн Discord-д алдагдана.

### Telegram (`telegram/`) — БҮХ ХЭРЭГЛЭГЧ (`@SanhuuchBot`)
- Ижил polling загвар + `telegram_links` JOIN → зөвхөн холбогдсон хэрэглэгчид.
- Linking: dashboard → 6 оронтой код (10 мин) → bot-д `/link <код>`.
- `requireLinked()` бүх handler-ийн эхний шалгалт — холбоогүй chat-д ЮУ Ч илгээхгүй.
- **State машин** (`pending` Map, chat бүрд нэг): `mode:'detail'` (ангилал сонгосны дараах
  талбарын текст хүлээж буй) → `mode:'confirm'` (applyToAll Тийм/Үгүй товч хүлээж буй) →
  `PATCH .../category`. Дан талбарын засварт `mode:'field'` → `PATCH .../note`.
- callback_data codec: `c` pending товч · `ec` **засварын ангиллын товч (stale-check-гүй —
  classified дахин засах нь хэвийн)** · `e` ангилал засах · `n` талбар засах ·
  `sk` алгасах/болих · `ay`/`an` applyToAll.
- ⚠️ **`https.Agent({family:4})` ЗААВАЛ** — зарим сервер `api.telegram.org`-д IPv6 DNS
  буцаадаг ч route байхгүй → ETIMEDOUT.
- ⚠️ `bot.launch()`-ийн Promise bot зогсох хүртэл resolve хийхгүй (telegraf-ийн зан төлөв) —
  "эхэллээ" лог-ыг `bot.polling` шинжээр шалгаж бичнэ.
- **Эрхийн зааг:** bot нь `telegram_*` bookkeeping хүснэгтэд шууд бичиж БОЛНО;
  `transactions`/`category_overrides`-д **ХЭЗЭЭ Ч** шууд бичихгүй — зөвхөн JWT-тэй REST-ээр.

---

## 10. Deploy / ops

- **pm2 4 процесс:** `bank-listener` (`src/index.js`), `bank-api` (`api/server.js`),
  `bank-discord`, `bank-telegram`. autorestart, `min_uptime 30s`, `max_restarts 20`.
- **Nginx** :80/:443 (certbot) → `proxy_pass http://127.0.0.1:3000`. API нь `dashboard/dist`-г
  static serve хийдэг → **нэг origin, CORS хэрэггүй**.
- **2 төрлийн redeploy:**
  - *Dashboard-only:* локалд `npm run build` → `scp dist` (pm2 reload ХЭРЭГГҮЙ).
  - *Full:* push → серверт `git pull` + `npm install` (5 газар) + build + `pm2 reload all`.
    **Өмнө нь DB backup ЗААВАЛ.**
- ⚠️ **API + listener-ийг ХАМТ deploy хий** — шинэ API нь `userId`-гүй ingest-ийг 400-аар
  reject хийдэг тул хуучин listener-тэй зэрэгцвэл гүйлгээ АЛДАГДАНА.
- Ops мониторинг: `OPS_WEBHOOK_URL` (Discord webhook, owner-т) — шинэ хэрэглэгч бүртгэл,
  `gmail-reauth-needed`, `balance-parse-drift`, sustained 5xx, uncaughtException.
- Серверийн spec бага (908Mi RAM, ~6.7G disk, 2G swap) — диск ихэвчлэн OS/snap/apt cache-ээр
  дүүрдэг, апп өөрөө ~200M. `sudo apt clean` аюулгүй.
- Дэлгэрэнгүй: [`deploy/DEPLOY_RUNBOOK.md`](deploy/DEPLOY_RUNBOOK.md), [`DEPLOYMENT.md`](DEPLOYMENT.md).

---

## 11. Орчны хувьсагчид (зөвхөн НЭР)

**Root `.env`** (listener): `GMAIL_USER`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GMAIL_REFRESH_TOKEN`, `GMAIL_GOOGLE_CLIENT_ID`, `GMAIL_GOOGLE_CLIENT_SECRET`, `API_DB_PATH`,
`TOKEN_ENC_KEY`, `ACCOUNTS_POLL_SECONDS`, `OAUTH_REDIRECT_URI`, `BANK_SENDER`, `IMAP_MAILBOX`,
`WEBSITE_API_URL`, `WEBSITE_API_KEY`, `WEBSITE_HMAC_SECRET`, `DB_PATH`, `TOKEN_REFRESH_MINUTES`,
`HEARTBEAT_SECONDS`, `IDLE_WARN_MINUTES`, `PUSH_MAX_RETRIES`, `LOG_LEVEL`, `OPS_WEBHOOK_URL`,
`OPS_PROCESS_NAME`, `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID`, `TELEGRAM_BOT_TOKEN`,
`JWT_SECRET`, `DASHBOARD_PUBLIC_URL`

**`api/.env`:** `PORT`, `LISTENER_API_KEY`, `LISTENER_HMAC_SECRET`, `DB_PATH`,
`RATE_LIMIT_WINDOW_SECONDS`, `RATE_LIMIT_MAX`, `BODY_LIMIT`, `PENDING_AUTO_CLASSIFY_DAYS`,
`LOG_LEVEL`, `OPS_WEBHOOK_URL`, `OPS_PROCESS_NAME`, `DASHBOARD_USER`, `DASHBOARD_PASSWORD`,
`JWT_SECRET`, `TOKEN_ENC_KEY`, `GMAIL_GOOGLE_CLIENT_ID/SECRET`, `LOGIN_GOOGLE_CLIENT_ID/SECRET`,
`LOGIN_OAUTH_REDIRECT_URI`, `GOOGLE_ALLOWED_EMAILS`, `AUTH_OPEN_SIGNUP`, `DASHBOARD_BASE_URL`,
`AUTH_LOCAL_ENABLED`, `AI_CATEGORIZATION_ENABLED`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`

**ИЖИЛ байх ЁСТОЙ хосууд:** `TOKEN_ENC_KEY` (root ↔ api), `JWT_SECRET` (root ↔ api ↔ telegram).

---

## 12. Тест (нийт **235**, бүгд `node --test`)

⚠️ Root дээрх `npm test` (= `node --test`) нь **recursive** тул доорх БҮХ багцыг
(api/telegram/discord/dashboard оруулаад) нэг дор ажиллуулж **235** гэж мэдээлдэг.
Багц бүрийг тусад нь ажиллуулах командыг баруун баганад бичив.

| Багц | Тоо | Ажиллуулах |
|---|---|---|
| API | **150** (api 12, auto-classify 3, balance-history 18, balance 6, budget-status 12, budget 8, dashboard 17, **debt-ledger 19**, gmail-auth 12, google-auth 11, google-provider 3, manual-savings 16, telegram 6, token-crypto 7) | `cd api && npm test` |
| Дундын (`test/`) | **33** (golomt 12, categorize 10, shared 4, transactionActions 7) | `node --test test/` |
| Listener модуль | **12** (accounts 4, manager 4, balanceAlert 4) | `node --test src/*.test.js` |
| Telegram | **12** (db 10, isolation 2) | `cd telegram && npm test` |
| Dashboard цэвэр логик | **23** (budget 12, **debt 11**) | `node --test dashboard/src/lib/*.test.js` |
| Discord | **5** (categories) | `cd discord && npm test` |

Загвар: API тестүүд жинхэнэ `createApp()`-г `:memory:` DB дээр ачаалж, HTTP түвшинд шалгана
(mock биш). Цэвэр логик (budgetCycle, balanceHistory, budget.js, manager.js,
transactionActions.js) нь dependency-injected/цэвэр тул тусад нь тестлэгддэг.

`dashboard.test.js`-ийн ангиллын гэрээний тестүүд: `applyToAll:true` → override +
олон мөр · **`applyToAll`-гүй `merchantPlace`/`note` → override ҮҮСЭХГҮЙ, зөвхөн ганц мөр** ·
`/note`-ийн "байгаа талбарыг л шинэчилнэ, `''` → NULL, хоосон body → 400" семантик.

`debt-ledger.test.js`-ийн ★ гол баталгаанууд: **хасагдсан гүйлгээ `by-category`/`summary`/
`monthly`/`budget-status`-аас алга болох ч `/balance` БА `balance-history`-д хэвээр** ·
`transactions` жагсаалтаас алга болохгүй (буцааж асаах боломж) · холбох→хасалт,
settle+орлого холбох→орлогын хасалт, re-open→буцаалт · **"өөр бичлэг лавлаж байвал
хасалт буцаахгүй"** хамгаалалт · cross-user унших/засах/холбох бүгд татгалзагдана.

---

## 13. Код бичих конвенцууд (шинэ код нэмэхэд ЗААВАЛ дагах)

1. **Per-user isolation** — query бүр `req.userId`-аар. Machine push-д `userId` заавал.
2. **Route загвар** — `createXRouter({ db, ... })` factory, хариу `{status:'ok', ...}`.
3. **Санхүүгийн бичилтийн эрх** — bot-ууд `transactions`/`category_overrides`-д ШУУД
   бичихгүй, зөвхөн authenticated API-аар. (`manual_ledger_entries` нь ЗОРИУД үл хамаарна.)
4. **Миграцыг зөвхөн `api/db.js` удирдана** — listener/bot нь schema байхгүй бол graceful
   хоосон буцаана, ХЭЗЭЭ Ч `ALTER TABLE` хийхгүй.
5. **Хуурамч тоо гаргахгүй** — мэдээлэл байхгүй бол `null` / `available:false`. Кодод
   санхүүгийн дүн хатуу бичигдэхгүй (repo нэг үе public байсан).
6. **`manually_edited=1` мөрийг pipeline дахин parse/categorize хийхгүй.**
7. **Комментууд монголоор** — файл бүрийн толгойд зорилго + gotcha тайлбарлана.
8. **Responsive** — олон элементтэй мөр `flex-col`→`sm:flex-row`, atomic string
   `whitespace-nowrap`, текст ≥13px, 360px өргөнд хэвтээ scroll гарахгүй.
9. **Дундын логик `config/`-д** — parser болон API давхардуулж бичихгүй.
10. **Клиентийн капабилити зөвхөн `config/transactionActions.js`-ээс** — "ямар үйлдэл
    боломжтой", "POS уу, энгийн үү → ямар талбар асуух", "`applyToAll` дэмжигдэх эсэх"-ийг
    Discord/Telegram/Dashboard **өөрсдөө шийдэхгүй**. Шинэ клиент/урсгал нэмэхдээ
    `availableActions()` / `detailFieldFor()`-г дуудна; `is_pos` шалгалт, `merchantPlace`
    vs `note` сонголтыг клиент дотор хатуу бичихийг ХОРИГЛОНО. Модульд UI/browser/Node-only
    хамаарал (fs, process.env, window) оруулахгүй — цэвэр функц хэвээр.
11. **`applyToAll` = default OFF, ТОДОРХОЙ баталгаажуулалттай** — гурван клиент дээр ижил.
    Шинэ бичих урсгал нэмэхдээ `applyToAll`-ыг hardcode `true` болгохгүй; баталгаажуулалтын
    текстийг `APPLY_TO_ALL_CONFIRM`-ээс авна.

---

## 14. ⚠️ Мэдэгдэж буй gotcha

| Асуудал | Тайлбар |
|---|---|
| Google "Testing" mode | refresh token ~7 хоногт хүчингүй болж болзошгүй → `reauth_needed` → Settings-ээс дахин холбоно |
| `redirect_uri_mismatch` | Desktop-type client-ийг Web урсгалд ашигласнаас. Шийдэл: зөв төрлийн шинэ client (§7.2) |
| `unauthorized_client` refresh дээр | Token-ыг олгосон client-ээр л сэргээх ёстой → `gmail_oauth_client` |
| `git pull --ff-only` серверт | Commit хийгээгүй локал өөрчлөлт байвал abort |
| Node хувилбар | **22.5+ ЗААВАЛ** (`node:sqlite`). Сервер дээр Node 24 |
| Timezone | `balanceHistory.js` UTC+8-г ХАТУУ ашиглана; `budgetCycle.js` нь серверийн `Asia/Ulaanbaatar` тохиргоонд найддаг |
| Rate limiter | In-memory — олон instance/cluster-т Redis рүү шилжих хэрэгтэй болно |
| Root `golomt.js` | Repo-ийн үндэст байгаа `golomt.js` нь **хуучин, ашиглагдахгүй хуулбар** (зөвхөн EASYINFO загварыг мэднэ). Бодит parser бол [`src/parsers/golomt.js`](src/parsers/golomt.js) (5 загвар). Ямар ч код үүнийг импортлодоггүй — цэвэрлэх боломжтой |
| Google Sheets | Хуучин баримтад дурдагддаг ч ашиглагдахгүй. Бодит storage бол SQLite. (Python legacy файлууд одоо repo-д БАЙХГҮЙ) |
| ⚠️ **`excluded_from_budget` = ЗӨВХӨН шинжилгээ** | Найзын билетийг картаараа авахад мөнгө **бодитоор** дансаас гардаг тул `balance`/`balance-history`-д **ЗААВАЛ** тоологдоно; зөвхөн "Тээвэр 600% хэтэрсэн" гэх ангиллын гажуудлыг арилгахаар төсөв/шинжилгээнээс хасагдана. Шинэ analytics query нэмэхдээ `AND excluded_from_budget = 0` бичихээ **бүү мартаарай**; эсрэгээр **үлдэгдлийн** query-д ХЭЗЭЭ Ч бүү нэм. `buildWhere(userId, {budgetOnly:true})` нь энэ шүүлтийг өгнө — `listTransactions` түүнийг ЗОРИУД дамжуулдаггүй (хэрэглэгч хасагдсан мөрөө хараад буцааж асаах ёстой) |
| Өрийн холбоос ба хасалт | Нэг гүйлгээг **олон** өрийн бичлэг лавлаж болно (нэг зарлагыг хэд хэдэн хүнд хуваасан). Тиймээс холбоос тасрахад хасалтыг **шууд бүү буцаа** — `isTransactionReferencedByOtherDebt()`-ээр өөр лавлагаа байгаа эсэхийг эхлээд шалга |

---

## 15. Одоогийн төлөв (2026-08-04)

- Серверт 4 pm2 процесс online, домейн амьд.
- Calendar/Telegram холбогдоогүй. Telegram bot ажиллаж байна.
- AI ангилал **унтраалттай** (`AI_CATEGORIZATION_ENABLED=false`) — credit байхгүй. Асаахад
  танигдаагүй мерчантад санал өгнө; унтраалттай үед зүгээр pending_review болно.
- **Сүүлийн ажил — Өрийн дэвтэр + төсвөөс хасах туг (commit `6951061`, серверт ГАРСАН):**
  миграц 015 (`debt_ledger` + `transactions.excluded_from_budget`), `routes/debtLedger.js`,
  `PATCH /transactions/:id/exclusion`, `dashboard/src/lib/debt.js` (цэвэр netting),
  `DebtLedger.jsx` (Шинжилгээ табын дотор). Нөхөн төлбөрийн кэйс шийдэгдсэн: найзын
  билетийн зардал ангиллын төсвөөс гарч, үлдэгдэлд хэвээр үлдэнэ.
  Production-д миграц баталгаажсан (`debt_ledger` + 3 индекс + багана байна).
- **Өмнөх ажил — гүйлгээний үйлдлийн parity (§9):** `config/transactionActions.js` дундын
  капабилити модуль нэмэгдэж, Discord/Telegram/Website гурвуулан ижил чадвартай болсон
  (ангилал дахин засах, талбар засах, устгах, `applyToAll` default OFF + баталгаажуулалт).
  Backend: `PATCH /:id/category`-ийн override авто-эскалаци тасарсан (`learn = !!applyToAll`),
  `PATCH /:id/note` нь `merchantPlace`-ийг ч хүлээж авдаг болсон (шинэ route нэмээгүй).
  Энэ ажил **серверт гарсан** (commit `1f900e4`).
- **Production-ы БОДИТ тоо (live DB-ээс уншсан, 2026-08-04 deploy-ийн дараа):**
  `users` = **2** (id=1 admin, id=3 user) · `transactions` = **1,115**
  (үүнээс 1 нь parity smoke-тестийн синтетик 1₮ мөр `id=1115 / 0930 ZZSMOKE0804BOM`
  → жинхэнэ банкны гүйлгээ **1,114**, 2022-11-01 → 2026-08-02) ·
  `category_overrides` = **39** (үүнээс 1 нь smoke-ийн `ZZSMOKE0804BOM`) ·
  `debt_ledger` = **0** · `excluded_from_budget=1` мөр = **0** (бүх 1,115 мөр = 0).
  Одоогийн үлдэгдэл 90,154.58₮.
- ⚠️ Owner-ийн Gmail `reauth_needed` төлөвтэй — сүүлийн ЖИНХЭНЭ банкны гүйлгээ 2026-08-02,
  шинэ и-мэйл татагдахгүй байна (dashboard → Тохиргоо → Gmail дахин холбох).
- Өмнөх ажлууд: EUR-г эх валютаар хадгалах, амьд FX ханш, үлдэгдлийн график + муж
  сонголт, өдөр тутмын зарлагын drill-down, Бодит зарцуулалт харах/засах горим.
- Хийгдээгүй/дараагийн боломж: `Insights` (Шийдвэр) таб placeholder хэвээр; хуучин ~1057
  гүйлгээний `account_balance` backfill хийгээгүй (тусдаа ажил); postgres миграц бэлэн боловч
  ашиглагдахгүй.

---

## 16. Нууцлал (repo нэг үе PUBLIC байсан)

Нууц утга (`.env`, `*.pem`, `credentials.json`, `*.local.env`, `*.sqlite`) ХЭЗЭЭ Ч
commit хийхгүй — `.gitignore`-оор хамгаалагдсан. Шинэ нууц файл нэмэхээсээ өмнө
`git check-ignore <файл>`-оор ЗААВАЛ шалга. Кодод бодит санхүүгийн дүн, и-мэйл, серверийн
IP/SSH зам бичигдэхгүй.
