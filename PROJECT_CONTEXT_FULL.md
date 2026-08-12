# Санхүүгийн туслах систем — БҮРЭН CONTEXT (chat bot / шинэ agent-д зориулсан)

> **Юунд зориулсан бэ:** Энэ нэг файлыг шинэ чатад өгөхөд төслийн БҮХ зүйл — юу хийдэг,
> юугаар хийсэн, файл бүр юу хариуцдаг, өгөгдөл хаанаас хаашаа урсдаг, ямар шийдвэр
> яагаад ийм байдаг — ойлгомжтой болно.
>
> **⚠️ Нууц утга ЭНД БАЙХГҮЙ.** Зөвхөн орчны хувьсагчийн НЭР бичигдсэн. Бодит утгууд
> `.env`, `api/.env`, `credentials.json`, `deploy/.deploy.local.env` (бүгд gitignored).
>
> Баримт бэлдсэн: 2026-08-03, шинэчилсэн: 2026-08-12. Repo: `D:\Claude`, branch `main`.
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
| `categories.js` | **★ Single source:** 10 ангиллын нэр, **ТОГТМОЛ id** + emoji + hex metadata (`CATEGORY_META`), keyword дүрэм, `matchByKeywords()`, `OLD_TO_NEW` mapping. **+ ТОГТМОЛ ID (019):** `CATEGORY_META[c].id` (`dining`/`grocery`/`transport`/`income`/`transfer`/`subs`/`edu`/`leisure`/`apparel`/`other`) + `byId(id)` / `idFor(category)` (Map-аар, **массив руу ХЭЗЭЭ Ч индекслэхгүй**) + `listCategoriesWithIdFor(type)` (bot-д — `{category, id}` хос). Модуль ачаалахад id дутуу/давхардсан бол шууд throw. **+ ХАМААРАЛ (applicability):** `CATEGORY_APPLICABILITY` (ангилал → `['income']`/`['expense']`/хоёул), `isCategoryAllowedFor(category, type)` (★ ганц предикат, fail-open), `categoriesFor(type)`. Backend, listener, frontend ГУРВУУЛАА эндээс импортолно |
| `transactionActions.js` | **★ Single source (үйлдлийн капабилити):** гүйлгээн дээр ЯМАР үйлдэл боломжтой, ЯМАР талбар асуухыг тодорхойлно. `availableActions(txn)`, `detailFieldFor(txn)` (POS→`merchantPlace`/"Газрын нэр", бусад→`note`/"Шалтгаан"), `isPosTxn`, `isPendingTxn`, `findAction`, `APPLY_TO_ALL_CONFIRM` (баталгаажуулалтын ижил текст). Discord/Telegram/Dashboard ГУРВУУЛАА эндээс уншина — өнгө/байрлал/API дуудлага энд ОРОХГҮЙ |
| `tokenCrypto.js` | AES-256-GCM `encryptToken/decryptToken/isEncrypted`. Формат `enc:v1:<iv>:<tag>:<ct>`. `TOKEN_ENC_KEY` (64 hex) |
| `txfields.js` | `detectIsPos(desc)` (BOM дүрэм), `isoDate(s, {anchored})`, **`isoInstant(v)`** (имэйлийн `Date:` → ISO UTC, буруу/байхгүй бол `null`), **`ubTimeLabel(iso)`** (ISO UTC → УБ `HH:mm`, Intl `Asia/Ulaanbaatar` + ICU-гүй үед UTC+8 fallback) — parser, API, Discord, dashboard бүгд ашиглана |
| `loadEnv.js` | Пакетгүй `.env` уншигч. Систем/pm2 env давамгайлна |

### 3.2 `src/` — listener (Gmail → parse → push)

| Файл | Үүрэг |
|---|---|
| `index.js` | Entry. `processEmail()` — илгээгч шүүх → идэмпотент шалгах → parse → categorize → DB insert → API push. Heartbeat, graceful shutdown, `seedOwnerFromEnv()`. **017:** `parsed.date` (имэйлийн `Date:` header) → `isoInstant()` → `emailReceivedAt` |
| `payload.js` | **017:** API push payload бүтээх **цэвэр** функц (`buildPushPayload`) — `index.js` нь import хийхэд listener асдаг тул гэрээг тусад нь тестлэх боломж өгнө |
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
| `db.js` (54KB) | Бүх SQL энд. `createDb()` → миграц (17 үе шат, идемпотент) + ~50 функц |
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
| `TransactionTable.jsx` | Жагсаалт + хуудаслалт (50/хуудас) + мөр дээр дарахад **expand панель** (`RowPanel`): ангилал chip-үүд, талбар засах (POS→Газрын нэр / бусад→Шалтгаан — `transactionActions`-оос), `applyToAll` checkbox (**default OFF**, ангилал өөрчлөгдөөгүй үед disabled), optimistic update + алдаанд rollback. **Хасалтын тэмдэглэгээ** (016): `excluded_amount>0` мөрөнд teal badge — хэсэгчилсэн бол `↩ 55,000₮ буцаагдсан` + дүнгийн доор `цэвэр 35,000₮`, бүрэн бол `↩ Төсвөөс хасагдсан`. Мөрийн дүн **ҮРГЭЛЖ БҮТЭН** (үлдэгдэлд бүтнээрээ тоологдсон); тэмдэглэгээ нь ангиллын нийлбэр яагаад бага байгааг тайлбарлана. **017:** огнооны нүдэнд `title="Банкны мэдэгдэл ирсэн: 14:32"` (hover) + expand панелийн эхэнд `🕒 … 2026-08-05 · 14:32` (touch-д tooltip гардаггүй тул); `email_received_at` NULL бол **хоёулаа огт гарахгүй**, огноо хэвээр. **018:** `RowPanel`-ийн ангиллын chip-үүд мөрийн `row.type`-аар шүүгдэнэ (`isCategoryAllowedFor`) — зарлагад "Орлого", орлогод зарлагын ангилал ГАРАХГҮЙ |
| `PendingReview.jsx` | Ангилаагүй гүйлгээний шар banner + баталгаажуулах modal. Талбарын шошго `detailFieldFor()`-оос, `applyToAll` checkbox **default OFF**. **018:** ангиллын chip-үүд мөрийн `t.type`-аар шүүгдэнэ (`isCategoryAllowedFor`) — зарлагад "Орлого" ГАРАХГҮЙ; AI санал ч мөн шүүгдэнэ (боломжгүй саналыг ★-аар онцлохгүй) |
| `Analyze.jsx` | Сараар орлого/зарлага (1/3/12 сар), ангиллын задаргаа, `BalanceHistory`-г агуулна |
| `BalanceHistory.jsx` | Өдөр тутмын **үлдэгдлийн график** (7х/30х/3с/6с/1ж preset эсвэл custom муж), цэг дээр даран тухайн өдрийн гүйлгээний задаргаа |
| `DebtLedger.jsx` | **Өр төлбөрийн дэвтэр** — `Analyze.jsx`-ийн дотор (Календарь БИШ). Хоёр харагдац: «Үлдэгдэл» (хүн × валют бүрийн цэвэр өр — "Болд танд 30,000₮ өртэй") ба «Түүх» (бүх зээл/зээлүүлэлт/хаалт). Нэмэх форм (хэн/чиглэл/дүн/валют/огноо/тэмдэглэл + **холбох гүйлгээ сонгогч** + **«Энэ гүйлгээнээс тухайн хүний хэсэг»** талбар — 016, гүйлгээ сонгосон үед л гарна: default = бичлэгийн дүн, дээд хязгаар = гүйлгээний хасагдаагүй үлдэгдэл, «Ангилалд үлдэх таны зарлага» шууд харагдана, хэтэрвэл/валют зөрвөл Хадгалах товч түгждэг), хаах/нээх/устгах. Түүхийн мөрөнд `🔗 #id · 30,000₮ хасав`. EUR-ийг эх валютаар харуулж, ханш байвал `≈ ₮` нэмнэ. **Бүх арифметик `lib/debt.js`-д** |
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
| `debt.js` | Өрийн **цэвэр логик** (React-гүй, тестлэгдсэн): `netBalances()` (хүн × валют — ⚠️ MNT ба EUR ХЭЗЭЭ Ч хооронд цэвэрших ЁСГҮЙ), `groupByCounterparty`, `totalsByCurrency`, `eurToMntDisplay` (ханшгүй бол **null**, хуурамч тоо гаргахгүй), `balancePhrase` (монгол өгүүлбэрийн бүтэц). **016:** `effectiveShare(entry)` (`exclusionShare ?? amount`), `remainingExcludable(txn)` (`amount − excluded_amount`, сөрөг болохгүй), `exclusionMarker(txn)` (`null` / `{full, excluded, net}`) |
| `format.js` | `money()`, `catLabel/catEmoji/catHex`, `displayDesc()`, **дүнг нуух горим** (`applyAmountsMasked`, localStorage), **017:** `txnTimeLabel(row)` / `txnTimeTitle(row)` (`email_received_at` → УБ `HH:mm`; NULL бол `null`/`undefined` → tooltip огт нэмэгдэхгүй) |

### 3.5 `scripts/` — нэг удаагийн ба ops

| Скрипт | Үүрэг |
|---|---|
| `get-token.js` | Gmail refresh_token авах (localhost callback сервер + consent URL) |
| `collect-descriptions.js` | Бүх хуучин и-мэйлийг уншиж `transactions-export.json` + `descriptions-summary.csv` гаргана |
| `reparse.js` | Засагдсан parser-аар хуучин и-мэйлийг дахин задлаж NULL талбар нөхнө (`manually_edited=1` мөрийг ХӨНДӨХГҮЙ) |
| `recategorize.js`, `migrate-categories.js` | Хуучин англи ангилал → канон монгол нэр (идемпотент) |
| `repush.js` | `push_failed` гүйлгээг дахин илгээх (cron-д тавьж болно) |
| `backfill-overrides.js` | Сурсан override-ийн `friendly_name`/`default_note`/`category`-г ХУУЧИН гүйлгээнд буцаан хэрэглэнэ (ops, дахин ажиллуулж болно). Таарал нь `classify.js`-тэй ЯГ ИЖИЛ (`normalizeMerchant` + substring, `created_at DESC`-ийн эхний таарал), POS→`merchant_place` / бусад→`note` нь `config/transactionActions.js`-ээс. **Default = dry-run**, бичихэд `--apply` (BEGIN…COMMIT/ROLLBACK), `--user <id>`, `--db <зам>`. `manually_edited=1` мөрийг ХӨНДӨХГҮЙ, туг ч тавихгүй |
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
| POST | `/transactions` | **Ingest.** Machine (`X-API-Key`) үед `userId` ЗААВАЛ — дутуу бол 400 (owner fallback БАЙХГҮЙ). JWT үед `req.userId`. **017:** сонголттой `emailReceivedAt` (ISO 8601 UTC, `z.string().datetime()`) — байхгүй/`null` бол NULL (хуучин listener payload татгалзагдахгүй), ISO биш утга → 400 |
| GET | `/transactions` | Шүүлт: `q, type, category, from, to, minAmount, maxAmount, status, limit, offset`. Мөр бүр `SELECT *` — **017-оос хойш `email_received_at`** (ISO UTC эсвэл `null`) хариунд орно |
| GET | `/transactions/pending` | Ангилаагүй жагсаалт |
| GET | `/transactions/:id` | Нэг гүйлгээний одоогийн төлөв (bot-д). Мөн `email_received_at` буцна |
| PATCH | `/transactions/:id/category` | Баталгаажуулах/ангилал засах. Body `{category, applyToAll?, merchantPlace?, note?}`. **`learn = !!applyToAll` ГАГЦХҮҮ** — `merchantPlace`/`note` дангаараа override үүсгэхээ БОЛЬСОН (өмнө нь авто-эскалаци хийдэг байсан). `applyToAll=true` → тэр мерчантын бүх мөр + `category_overrides`; `false` → зөвхөн тухайн мөр. Хоёр зам ч `manually_edited=1`, талбар нь `COALESCE` (хоосноор дарж бичихгүй). **018 — ТӨРЛИЙН ШАЛГАЛТ:** гишүүнчлэлийн шалгалтын дараа мөрийн `row.type`-тай нийцлийг `isCategoryAllowedFor()`-оор шалгана; тохирохгүй бол **400** (ж: зарлаган мөрөнд `Орлого`). Клиентийн шүүлтэд НАЙДАХГҮЙ — шууд PATCH-ийг ЭНД хаана; татгалзсан хүсэлт override ч үүсгэхгүй |
| PATCH | `/transactions/:id/note` | Тэмдэглэл/газрын нэр — **ангилал хөндөхгүй, override үүсгэхгүй**. Body `{note?, merchantPlace?}`: **body-д БАЙГАА талбарыг Л шинэчилнэ**; тодорхой хоосон string → `NULL` (утга устгах боломж); хоёулаа байхгүй → 400. Хариу `{status:'ok', id, note, merchantPlace}` |
| PATCH | `/transactions/:id/exclusion` | **Төсвөөс хасах/буцаах.** Body `{excluded: boolean}` (бүхлээр нь) **ЭСВЭЛ `{excludedAmount: number}`** (016 — хэсэгчилсэн, `[0, amount]`). Хоёулаа байхгүй / буруу төрөл → 400; `excludedAmount > amount` → **400**. Хасалт байхад `manually_edited=1`. Хариу `{excluded (=БҮРЭН хасагдсан эсэх), excludedAmount, netAmount, manuallyEdited}`. ⚠️ ЗӨВХӨН төсөв/ангилал/шинжилгээнд нөлөөлнө — **үлдэгдэлд ХЭЗЭЭ Ч нөлөөлөхгүй**. Өрийн бичлэгтэй холбоотой гүйлгээний хасалтыг гараар **өөрчлөх** гэвэл **409** (эхлээд дэвтрээс салгана; утга өөрчлөгдөхгүй no-op дуудалт зөвшөөрөгдөнө) |

### Meta / Analytics (`routes/meta.js`)
| Method | Зам | Тайлбар |
|---|---|---|
| GET | `/summary` | Шүүлттэй нийт орлого/зарлага |
| GET | `/monthly?months=12` | Сараар |
| GET | `/analytics/by-category?month=YYYY-MM` | Сарын ангиллын задаргаа |
| GET | `/balance` | **Одоогийн үлдэгдэл** = сүүлийн `account_balance`-тай мөр. Байхгүй бол `null` |
| GET | `/balance-history?range=90d\|from=&to=` | Өдөр тутмын үлдэгдлийн сэргээлт + өдөр бүрийн гүйлгээ (drill-down) + `gaps`. Anchor байхгүй бол `available:false` (**хуурамч тоо хэзээ ч гаргахгүй**) |
| GET | `/fx-rates` | Амьд USD/EUR→MNT (провайдер унавал 502) |
| GET | `/categories` | 10 ангилал — **ШҮҮГДЭХГҮЙ** (бүтэн жагсаалт). Төрлөөр шүүх нь picker-ийн ажил (`isCategoryAllowedFor`), учир нь энэ жагсаалтыг App нэг л удаа татаж, мөр бүрд дахин ашигладаг |
| POST | `/ai-categorize` | AI санал (дотоод). **018:** prompt-ын нэр дэвшигчээс зөвхөн орлогын ангилал ХАСАГДСАН — AI салаа нь зөвхөн зарлагын мөрөнд хүрдэг тул "Орлого" санал ҮРГЭЛЖ буруу байсан |
| GET/POST | `/overrides` | Learned override жагсаах/нэмэх. **018 (ХЭСЭГЧИЛСЭН шалгалт):** override нь тодорхой гүйлгээнд БИШ, мерчантын хэв шинжид хамаардаг тул `type` тодорхойлох БОЛОМЖГҮЙ — таамаглахгүй. Зөвхөн эргэлзээгүйг хаана: **зөвхөн орлогын ангилал → 400** (орлого автоматаар ангилагддаг тул илүүц, зарлагад буруу). Зарлагын ангилал нь override-ийн ХЭВИЙН хэрэглээ — хөндөөгүй |

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
| POST | `/debt-ledger` | `{counterparty, direction:'i_lent'\|'i_borrowed', amount>0, currency:'MNT'\|'EUR', entryDate, note?, linkedTransactionId?, exclusionShare?}`. Холбоос өгвөл тэр гүйлгээнээс **ЭНЭ бичлэгийн хувь хэмжээг** (`exclusionShare ?? amount`) **атомоор** төсвөөс хасна |
| PATCH | `/debt-ledger/:id` | Засах / хаах (`{status:'settled', settledTransactionId?}`) / дахин нээх / **`exclusionShare` засах**. Холбоос солих/салгах/хувь хэмжээ өөрчлөгдөх бүрд хөндөгдсөн БҮХ гүйлгээний хасалт дахин тооцоологдоно |
| DELETE | `/debt-ledger/:id` | Устгах + хөндөгдсөн гүйлгээг дахин тооцоолно (зөвхөн энэ бичлэгийн хувь хэмжээ чөлөөлөгдөнө) |

⚠️ **Олон бичлэг = НИЙЛБЭР (016).** Нэг гүйлгээг олон өрийн бичлэг лавлаж болно
(90,000₮ хоолны данс: Болд 30к + Гана 25к). Гүйлгээний `excluded_amount` = холбогдсон
БҮХ бичлэгийн хувь хэмжээний нийлбэр. Нэг нь салахад **зөвхөн түүний хувь** хасагдаж,
үлдсэн нь **лавлагаануудаас дахин тооцоологдоно** (`recomputeTransactionExclusion()` —
тоолуур нэмэгдүүлдэггүй тул retry/давхар дуудалтад ч зөв). `isTransactionReferencedByOtherDebt()`
нь гараар хасалт өөрчлөхийг хориглох (409) шалгалтад үлдсэн.

⚠️ **Валют:** өрийн бичлэг ба холбогдох гүйлгээний валют ЗААВАЛ таарна
(20 EUR-ыг MNT гүйлгээнээс хасах боломжгүй) — таарахгүй бол **400 `CURRENCY_MISMATCH`**.
Хувь хэмжээний нийлбэр гүйлгээний дүнг давбал **400 `OVER_EXCLUSION`**. Хоёулаа
`db.js`-ийн `ExclusionError`-оор шидэгдэж, SQLite транзакц **бүхэлдээ rollback** болно
(тал дутуу төлөв үүсэхгүй). `debt_ledger` + `transactions` хоёуланд бичих үйлдэл бүр
**нэг SQLite транзакцид** ороосон.

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
| `transactions` | `user_id, amount, currency, txn_date, type, category, status, description, merchant_place, is_pos, note, ai_suggested_category, ai_confidence, manually_edited, account_balance, **email_received_at** (TEXT NULL — банкны мэдэгдэл ирсэн цаг, ISO 8601 **UTC**; имэйлийн `Date:` header, 017), **excluded_amount** (REAL NOT NULL DEFAULT 0, `CHECK ≥0`), **excluded_from_budget** (=БҮРЭН хасагдсан эсэх, `excluded_amount ≥ amount` үед 1 — бичилт бүр дээр дахин тооцоологдоно), message_id (UNIQUE)` |
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
| `debt_ledger` | `user_id, counterparty, direction ('i_lent'\|'i_borrowed'), amount (CHECK>0), currency ('MNT'\|'EUR'), entry_date, note, status ('open'\|'settled'), linked_transaction_id (→transactions, ON DELETE SET NULL), settled_transaction_id (мөн адил), **exclusion_share** (REAL NULL — холбосон гүйлгээнээс эзлэх хэсэг; NULL = `amount`), created_at, settled_at` |

**Миграцын түүх (17):** 001–004 үндсэн + dashboard/AI/note · **005** auth+multi-tenant
(`user_id` бүх хүснэгтэд, `category_overrides`-г table-rebuild хийсэн) · 006 settings+events ·
007 google_sub/picture + google_tokens · 008 budget_allocations · 009 Gmail multi-tenant
баганууд + **token encryption backfill** · 010 Telegram хүснэгтүүд · 011 `gmail_oauth_client`
marker · 012 `account_balance` · 013 `manual_ledger_entries` · 014 `currency` багана ·
**015** `debt_ledger` хүснэгт (+3 индекс) БА `transactions.excluded_from_budget`
(`INTEGER NOT NULL DEFAULT 0` — хуучин мөр бүгд 0, **backfill шаардлагагүй**) ·
**016** ХЭСЭГЧИЛСЭН ХАСАЛТ: `transactions.excluded_amount` (`REAL NOT NULL DEFAULT 0
CHECK (excluded_amount >= 0)`) + **backfill** `UPDATE … SET excluded_amount = amount
WHERE excluded_from_budget = 1` (хуучин бүрэн хасагдсан мөр зан төлөвөө ЯГ хадгална),
`debt_ledger.exclusion_share` (`REAL NULL`), БА багана хоорондын хязгаарын **2 trigger**
(`trg_txn_excluded_amount_ins/upd` — `NEW.excluded_amount > NEW.amount + 1e-6` үед
`RAISE(ABORT)`; SQLite-д cross-column CHECK бичих боломжгүй тул trigger).
`excluded_from_budget` **УСТГААГҮЙ** — "бүрэн хасагдсан" гэсэн уламжлагдсан туг болж
бичилт бүр дээр дахин тооцоологдоно (хуучин уншигч код бүр зөв хэвээр). ·
**017** МЭДЭГДЭЛ ИРСЭН ЦАГ: `transactions.email_received_at` (`TEXT`, nullable,
DEFAULT NULL, **backfill ХИЙХГҮЙ** — 012-ын `account_balance`-тай ижил философи).
Голомтын имэйлийн BODY-д зөвхөн ОГНОО (цаггүй) байдаг тул цагийн эх сурвалж нь
Gmail имэйлийн `Date:` header (`simpleParser` → `parsed.date`). ISO 8601 **UTC**-ээр
хадгална; дэлгэц/bot дээр л УБ (Asia/Ulaanbaatar) болгож хөрвүүлнэ.
⚠️ `txn_date` **ХӨНДӨГДӨӨГҮЙ** — огноо (YYYY-MM-DD) хэвээрээ (budgetCycle.js /
balanceHistory.js / `/balance-history` бүгд түүнд тулгуурладаг).

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

### 8.1 Ангиллын ХАМААРАЛ (applicability) — аль ангилал аль төрлийн гүйлгээнд

`CATEGORY_APPLICABILITY` (`config/categories.js`) нь ангилал бүр ЯМАР төрлийн
гүйлгээнд утгатайг заана. Boolean БИШ, **олонлог** — учир нь зарим нь хоёуланд:

| Ангилал | Хамаарал | Яагаад |
|---|---|---|
| `Орлого` | **зөвхөн `income`** | Зарлагын мөрөнд утгагүй — энэ нь засварласан гол алдаа |
| `Шилжүүлэг & гэр бүл` | **`income` + `expense`** | Гэр бүлийн шилжүүлэг ХОЁР ТИЙШ явна (ээжид өгөх / ээжээс авах) |
| `Бусад` | **`income` + `expense`** | Хэрэглэгчийн ГАРААР сонгох гарц — автоматаар хэзээ ч оногдохгүй |
| үлдсэн 7 | зөвхөн `expense` | Хоол, тээвэр, хувцас г.м зөвхөн зарлага |

**Ганц предикат:** `isCategoryAllowedFor(category, type)` — гурван клиентийн picker
БА API-ийн баталгаажуулалт бүгд ЭНЭ функцээр шийднэ (дүрэм давхардуулахгүй).

- ⚠️ **FAIL-OPEN:** metadata-гүй ангилал → хоёуланд зөвшөөрнө. Шинэ ангилал нэмээд
  applicability бичихээ мартвал picker-үүдээс ЧИМЭЭГҮЙ алга болохгүй.
- `type` тодорхойгүй (`null`/танихгүй) → хязгаарлахгүй.
- **МИГРАЦ ХИЙГЭЭГҮЙ:** өмнө нь "хууль бус" хослолтой болсон мөрүүд (ж: `income` +
  `Тээвэр`) ХЭВЭЭР үлдэнэ. `catLabel/catEmoji/catHex` нь applicability харахгүй тул
  жагсаалтад хэвийн харагдана; зөвхөн ЗАСВАРЫН panel-д тухайн утга сонголтод
  байхгүй тул идэвхтэй товч харагдахгүй (шалгасан — §12).
- Override-ийн type-predicate нь ЭНД ОРООГҮЙ (`classify.js`-ийн override lookup
  type үл харна) — тусдаа ажил, schema өөрчлөлт шаардана.

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
| **Ангилал нь гүйлгээний ТӨРЛӨӨР шүүгдэнэ (018)** | ✅ | ✅ | ✅ |

⚠️ **018 — ангиллын сонголт төрлөөр шүүгдэнэ.** Гурван клиент ЦӨМ `isCategoryAllowedFor()`
(★ `config/categories.js`)-оор шүүнэ: зарлаган мөрөнд **"Орлого" ГАРАХГҮЙ** (9 сонголт),
орлогын мөрөнд зөвхөн 3 (Орлого / Шилжүүлэг & гэр бүл / Бусад). Сервер тал ч мөн
шалгана (`PATCH /:id/category` → 400) — UI-д л байгаа хамгаалалт нь хамгаалалт БИШ.

⚠️ **`applyToAll` хэзээ ч автоматаар true болохгүй.** Хэрэглэгч `APPLY_TO_ALL_CONFIRM.question`
("Дараагийн бүх ижил мерчантад хэрэглэх үү?")-д тодорхой "Тийм" гэж хариулсан үед л override
үүснэ. Дан талбарын засвар (`PATCH /note`) override-д **ХЭЗЭЭ Ч** хүрэхгүй.

### Discord (`discord/`) — ЗӨВХӨН OWNER
- DB-г polling (эхлэхдээ одоогийн max id-ээс → хуучин flood мэдэгдэхгүй), `.bot-state.json`.
- classified → embed + "✏️ Ангилал засах" + "📝 <талбар> засах"; pending → embed +
  ангиллын товч (2×5) + "📝 <талбар> засах".
- **017: мэдэгдэлд ЦАГ.** Embed-ийн «Огноо» талбар нь `fmtDateTime(tx)` — `email_received_at`
  утгатай бол `2026-08-05 · 14:32` (ISO UTC → УБ), NULL бол **зөвхөн огноо**
  (хуурамч "00:00" ХЭЗЭЭ Ч гарахгүй). Хөрвүүлэлт нь дундын `config/txfields.js`-ийн
  `ubTimeLabel()` — Intl (`Asia/Ulaanbaatar`), ICU-гүй орчинд UTC+8 fallback.
- **Ангиллын урсгал:** товч/select → modal (талбар) → **applyToAll Тийм/Үгүй товч** →
  `PATCH .../category` → мессежийг edit. Утга нь customId 100 тэмдэгтэд багтахгүй тул
  `pendingConfirm` Map-д түр хадгална (restart-д алдагдвал "хугацаа дууссан" гэж эелдэг унана).
- **Талбарын урсгал:** `n` товч → modal (одоогийн утга default) → `PATCH .../note`.
- customId codec (`categories.js`): `c` pending товч · `m` pending modal · `e` ангилал засах ·
  `es` засварын select · `n` талбар засах · `nm` талбарын modal · `ay`/`an` applyToAll.
- **019: ангилал нь customId дотор ТОГТМОЛ id-ЭЭР** (`c|<txnId>|transport|0`) — массив дахь
  индекс БИШ. Задаргаа нь `categoryById()` → `config`-ийн `byId()` (Map). Танихгүй id
  (нислэг дунд байгаа ХУУЧИН индекс-payload) → `null` → «мэдэгдэл хуучирсан» гэж эелдэг
  унаж, мессежийг шинэ товчнуудаар сэргээнэ (**ХЭЗЭЭ Ч таамаглахгүй**).
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
- **019: ангилал нь callback_data дотор ТОГТМОЛ id-ЭЭР** (`c|<txnId>|transport|0` = 21 байт,
  64-ийн хязгаарт тайван). Discord-тэй ИЖИЛ fail-safe: танихгүй id → `null` → «хуучирсан»
  хариу. `pending` Map-ийн `mode:'detail'` төлөв нь одоо `catIdx` БИШ `catId` хадгална.
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

## 12. Тест (нийт **309**, бүгд `node --test`)

⚠️ Root дээрх `npm test` (= `node --test`) нь **recursive** тул доорх БҮХ багцыг
(api/telegram/discord/dashboard оруулаад) нэг дор ажиллуулж **309** гэж мэдээлдэг.
Багц бүрийг тусад нь ажиллуулах командыг баруун баганад бичив.
⚠️ Git Bash дээр `node --test test/` нь заримдаа "MODULE_NOT_FOUND" өгдөг —
`node --test test/*.test.js` гэж glob-оор бичвэл найдвартай.

| Багц | Тоо | Ажиллуулах |
|---|---|---|
| API | **179** (api 12, auto-classify 3, balance-history 18, balance 6, budget-status 12, budget 8, **category-applicability 11**, dashboard 17, **debt-ledger 19**, gmail-auth 12, google-auth 11, google-provider 3, manual-savings 16, **partial-exclusion 12**, **email-received-at 6**, telegram 6, token-crypto 7) | `cd api && npm test` |
| Дундын (`test/`) | **59** (golomt 12, categorize 10, shared 4, transactionActions 7, **emailReceivedAt 5**, **categoryApplicability 9**, **categoryStableId 6**, **categoryButtonId 6**) | `node --test test/*.test.js` |
| Listener модуль | **12** (accounts 4, manager 4, balanceAlert 4) | `node --test src/*.test.js` |
| Telegram | **18** (db 10, isolation 2, **category-filter 6**) | `cd telegram && npm test` |
| Dashboard цэвэр логик | **26** (budget 12, **debt 14**) | `node --test dashboard/src/lib/*.test.js` |
| Discord | **15** (categories 6, **notify 3**, **category-filter 6**) | `cd discord && npm test` |

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
ЗӨВХӨН тэр бичлэгийн хувь хэмжээ чөлөөлөгдөнө"** (016-д дүнгээр шинэчлэгдсэн) ·
cross-user унших/засах/холбох бүгд татгалзагдана.

`partial-exclusion.test.js` (016) ★: **файл DB дээр миграц идемпотент + backfill зөв**
(015-ын төлөвийг сэргээж шалгадаг) · **бүрэн хасалт 4 query-д БҮГДЭД нь 015-тай ЯГ ижил
үр дүн** (backward-compat, `count` хүртэл) · **хэсэгчилсэн: 90к-аас 55к → ангилал 45к,
`/balance` БА `/balance-history` `deepEqual`-ээр ЯГ ТАГ хэвээр, жагсаалтад 90к** ·
**олон бичлэг 30к+25к=55к, нэгийг салгахад 30к ҮЛДЭНЭ** · `exclusionShare` override ·
хэтрүүлэх → 400 + rollback (бичлэг ч үүсэхгүй), ангиллын дүн сөрөг болохгүй ·
DB trigger/CHECK ч хэтрэлт/сөрөг дүнг зөвшөөрөхгүй · валют зөрөх холбоос → 400 ·
isolation · **бодит "хуваасан хоол" хувилбар** (90к → Болд 30к + Гана 25к → цэвэр 35к →
Гана салахад 60к, үлдэгдэл хоёуланд нь хөндөгдөөгүй).

`emailReceivedAt.test.js` + `email-received-at.test.js` + `discord/test/notify.test.js`
(017): жинхэнэ `simpleParser`-ээр имэйл задалж `Date:` header → ISO UTC · header
**байхгүй** имэйл → `null` (одоогийн цагаар нөхөхгүй, throw ч хийхгүй) · push payload-д
`emailReceivedAt` орсон бөгөөд `date` нь ОГНОО хэвээр · миграц additive/идемпотент,
хуучин мөр NULL хэвээр · POST → GET (жагсаалт ба `/:id`) хоёуланд буцна · `emailReceivedAt`-гүй
(хуучин listener) push → 201 · ISO биш string → 400 · two-user isolation ·
Discord embed-д NULL үед цаг нэмэхгүй, утгатай үед УБ HH:mm (шөнө дунд давсан кейс).

`categoryApplicability.test.js` + `api/test/category-applicability.test.js`
+ `discord|telegram/…/category-filter.test.js` (018) ★: `isCategoryAllowedFor` — Орлого
зөвхөн income · Шилжүүлэг/Бусад хоёуланд · 7 нь зөвхөн expense · **танихгүй ангилал
fail-open** · type тодорхойгүй үед хязгаарлахгүй · `categoriesFor` дараалал хадгална
(expense 9 / income 3) · builder-ийн бодит гаралт дээр шошго =
задарсан ангилал (Discord ба Telegram, `c`/`ec` хоёул) · эгнээнд ≤5 товч, хоосон
эгнээгүй · `type`-гүй хуучин дуудлага → 10
товч (fail-open) · **сервер backstop:** зарлага+Орлого → 400 (мөр хөндөгдөхгүй,
override ч үүсэхгүй), орлого+Тээвэр → 400, хоёуланд тохирох → 200, `/overrides`-д
зөвхөн орлогын ангилал → 400 · `GET /api/categories` **10-аа буцаасан хэвээр**.

`categoryStableId.test.js` + `categoryButtonId.test.js` (019, өмнөх
`categoryButtonIndex.test.js`-ийг ОРЛОВ) ★: ангилал бүр давхардаагүй тогтмол id-тай ·
id нь **≤12 тэмдэгт, `^[a-z][a-z0-9_]*$`, ЦЭВЭР ТОО БИШ** (fail-safe-ийн үндэс) ·
id↔ангилал round-trip · `byId` нь **хуучин индекс ('0'…'99'), prototype түлхүүр
('constructor'/'__proto__'), тоон утга, том үсэг** бүхэнд `null` · **★ CATEGORIES-ийг
газар дээр нь УРВУУЛЖ, дунд нь шинэ ангилал ОРУУЛСАН ч id бүр ИЖИЛ ангилал руугаа
бууна** (энэ refactor-ийн бүх утга учир) · Discord customId ≤100 тэмдэгт / Telegram
callback_data ≤64 БАЙТ · **хуучин индекс-payload `c|123|4|1` → `categoryById()` = null**
(Discord `c`/`m`, Telegram `c`/`ec` бүгдэд) · хоёр bot ИЖИЛ id орон зайг ашиглана.

`scripts/category-id.verify.mjs` (019, ops verify — `npm test`-д ОРООГҮЙ): жинхэнэ
`createApp()` + `:memory:` DB дээр **pending → БОДИТ товч → payload задаргаа →
`PATCH /:id/category` → DB-д бичигдсэн утга** гэсэн бүтэн гинжийг шалгана. Гол баталгаа:
**товчны ШОШГО = DB-д бичигдсэн ангилал** (9 зарлагын ангилал бүрд), modal дамжсаны
дараа ч ижил, орлогын мөрд шүүсэн жагсаалтын байрлал ≠ id, ба **хуучин payload дээр
PATCH огт дуудагдахгүй → мөр `pending_review` хэвээр, override ч үүсэхгүй**.

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
12. **★ Ангиллыг ХЭЗЭЭ Ч БАЙРЛАЛААР бүү дамжуул (019).** Client ↔ client хооронд явах
    ямар ч payload (Discord `customId`, Telegram `callback_data`, ирээдүйн deep-link,
    кэш, түр төлөв) ангиллыг **ТОГТМОЛ id-ЭЭР** кодлоно — `CATEGORIES` дахь индексээр
    БИШ. Задлахдаа **зөвхөн `byId()`** (эсвэл bot-ын `categoryById()`) — массив руу
    индекслэх fallback бичихийг **ХОРИГЛОНО**. Танихгүй id → **эелдэг унана**
    ("мэдэгдэл хуучирсан"), ХЭЗЭЭ Ч таамаглахгүй: буруу таамаг нь `applyToAll`-аар
    мерчантын БҮХ түүхэнд тарна. Шинэ ангилал нэмэхдээ `CATEGORY_META`-д **шинэ**
    id өгнө (хуучныг дахин ашиглахгүй), id нь богино ASCII ба **цэвэр тоо БИШ**
    (энэ нь хуучин индекс-payload-ыг ялгах чадварын үндэс). DB-д хадгалагдах утга нь
    ӨМНӨХ ЧИГЭЭР ангиллын **НЭР** — id нь зөвхөн payload-ын кодлол.

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
| ⚠️ **Хасалт = ЗӨВХӨН шинжилгээ** | Найзын билетийг картаараа авахад мөнгө **бодитоор** дансаас гардаг тул `balance`/`balance-history`-д **ЗААВАЛ** тоологдоно; зөвхөн "Тээвэр 600% хэтэрсэн" гэх ангиллын гажуудлыг арилгахаар төсөв/шинжилгээнээс хасагдана. Шинэ analytics query нэмэхдээ **`NET_AMOUNT` (`amount - COALESCE(excluded_amount,0)`) + `AND excluded_from_budget = 0`** хоёуланг бичихээ бүү мартаарай; эсрэгээр **үлдэгдлийн** query-д ХЭЗЭЭ Ч бүү нэм (тэнд ҮРГЭЛЖ бүтэн `amount`). `buildWhere(userId, {budgetOnly:true})` нь шүүлтийг өгнө — `listTransactions` түүнийг ЗОРИУД дамжуулдаггүй, **бас net хийдэггүй** (хэрэглэгч бүтэн гүйлгээгээ хараад удирдах ёстой) |
| ⚠️ **016: шүүлт БИШ, ЦЭВЭР НИЙЛБЭР** | 4 query (`getSummary`/`getMonthly`/`getByCategory`/`getCycleSpend`) нь одоо мөрийг хаядаггүй, **`amount − excluded_amount`-ыг нийлбэрлэдэг**. `excluded_from_budget = 0` шүүлт нь ҮЛДСЭН — БҮРЭН хасагдсан мөр (цэвэр дүн нь аль хэдийн 0) `count`/бүлэгт орж 015-ын зан төлөвийг эвдэхээс сэргийлнэ. Хэсэгчилсэн мөр шүүгдэхгүй, зөвхөн дүн нь багасна. Хоёрын **аль нэгийг** орхивол тоо чимээгүй гажина |
| ⚠️ **016: олон бичлэг — ДАХИН ТООЦООЛ** | Гүйлгээний `excluded_amount` = холбогдсон БҮХ өрийн бичлэгийн `exclusionShare ?? amount`-ын нийлбэр. Холбоос/дүн өөрчлөгдөх бүрд `recomputeTransactionExclusion()` нь лавлагаануудаас **шинээр** тооцоолно (тоолуур нэмэгдүүлэх/хасах БИШ → retry, давхар дуудалт, хэсэгчилсэн бүтэлгүйтэлд ч зөв). Нэг бичлэг салахад бусдын хувь хэмжээг **ХЭЗЭЭ Ч 0 болгож бүү цэвэрлэ**. Хэтрэлт/валют зөрөлт → `ExclusionError` → транзакц бүхэлдээ rollback → route 400 |
| ⚠️ **018: ангиллын picker нь ТӨРЛӨӨР шүүгддэг** | Ангиллын сонголт бүр (Dashboard `RowPanel` + `ConfirmModal`, Discord товч/select, Telegram keyboard) `isCategoryAllowedFor(category, row.type)`-оор шүүгдэнэ. Шинэ picker/клиент нэмэхдээ **бүтэн `CATEGORIES`-г шууд рендерлэхийг ХОРИГЛОНО** — `categoriesFor(type)` (нэрээр кодлодог UI) эсвэл `listCategoriesWithIdFor(type)` (payload-д id кодлодог bot) ашиглана. Сервер тал ч шалгана (`PATCH /:id/category` → 400) |
| ✅ **018: BOT-ЫН ИНДЕКСИЙН УРХИ — ШИЙДЭГДСЭН (019)** | **Байхаа больсон.** Өмнө нь Discord/Telegram ангиллыг customId/`callback_data` дотор **массив дахь ИНДЕКСЭЭР** дамжуулдаг байсан тул `CATEGORIES`-ийн дараалал өөрчлөгдөх/дунд нь ангилал нэмэх бүрд товч бүр чимээгүй **БУРУУ ангилал** илгээх эрсдэлтэй байв. 019-д индекс кодлол **бүрмөсөн устгагдаж**, ТОГТМОЛ id (`transport`, `dining` …) болов; `listCategoriesWithIndexFor()`/`categoryByIndex()`/`indexOfCategory()` устсан. Одоо дараалал өөрчлөх нь **аюулгүй** (§13.12 нь дүрмийг тогтоов, `test/categoryStableId.test.js` нь массивыг урвуулж/дунд нь ангилал нэмж түгжсэн). Үлдсэн ганц анхаарах зүйл: эгнээ таслах давталтыг **шүүсэн** жагсаалтын уртаар бич (`CATEGORIES.length` БИШ) — энэ нь зөвхөн харагдацын алдаа |
| ⚠️ **019: ТОГТМОЛ id нь ГЭРЭЭ — бүү сольж/дахин ашигла** | `CATEGORY_META[c].id` нь client-д ИЛГЭЭГДСЭН мэдэгдлүүд дотор амьдардаг. Id-г **өөрчлөх** → тэр ангиллын хуучин товчнууд "хуучирсан" болно (аюулгүй ч эвгүй); id-г **дахин ашиглах** (өөр ангилалд өгөх) → нислэг дунд байгаа товч **БУРУУ ангилал** бичих цорын ганц зам — тиймээс ХЭЗЭЭ Ч бүү хий. Id нь **цэвэр тоо байж болохгүй**: хуучин индекс-payload-ыг ялгах чадвар яг үүн дээр тогтдог. Дутуу/давхардсан id → модуль ачаалахад throw (тестээр баригдана) |
| ⚠️ **018: хуучин "хууль бус" мөрүүд** | Applicability нэмэгдэхээс ӨМНӨ үүссэн зөрчилтэй мөр (ж: `income` + `Тээвэр`) **ХЭВЭЭР үлдэнэ — миграц хийгээгүй** (зориуд). `catLabel/catEmoji/catHex` нь applicability үл харах тул жагсаалтад хэвийн харагдана. Ганц ялгаа: засварын panel-д тухайн утга сонголтын жагсаалтад байхгүй тул **идэвхтэй товч харагдахгүй** — хэрэглэгч зөвшөөрөгдсөн утга сонгож л засна |
| ⚠️ **Override нь ЗӨВХӨН ingest дээр, тэр ч дутуу** | `classify.js` нь таарсан override-оос **ЗӨВХӨН `category`**-г авдаг — `friendly_name` (газрын нэр) ба `default_note` (шалтгаан) нь гүйлгээний мөрөнд **ХЭЗЭЭ Ч бичигддэггүй**. Тэдгээр нь зөвхөн УНШИХ үед `attachOverrideInfo()`-оор virtual-аар хавсрагдана (`friendly_name`/`override_note` талбар), эсвэл `applyToAll` баталгаажуулалтын АГШИНД `updateCategoryByPattern()` тухайн үед байсан мөрүүдэд бичнэ (мөн `manually_edited=1` тавина). Тиймээс override үүсэхээс ӨМНӨХ ч, ХОЙНОХ ч автомат мөрүүд газрын нэр/шалтгаангүй хоцордог → түүхэн мөрийг [`scripts/backfill-overrides.js`](scripts/backfill-overrides.js)-ээр эвлэрүүлнэ (§3.5). Backfill-ийн таарал нь ingest-тэйгээ ЯГ ИЖИЛ байх ЁСТОЙ, эс бөгөөс дараагийн ingest backfill-ийн тавьсныг эргүүлж дарна |
| Хасалтын хязгаар хаана хэрэгжсэн бэ | `excluded_amount ≥ 0` — **баганын CHECK**. `excluded_amount ≤ amount` — SQLite-д cross-column CHECK бичих боломжгүй тул **API давхарга (`setTransactionExcludedAmount`) + 2 trigger** (INSERT/UPDATE, `1e-6` хүлцэлтэй). Float нийлбэрийн бөөрөнхийлөлт "бүрэн хасагдсан"-ыг эвдэхээс сэргийлж `EXCLUSION_EPS = 1e-6` хэрэглэдэг |

---

## 15. Одоогийн төлөв (2026-08-12)

- Серверт 4 pm2 процесс online, домейн амьд.
- **★ СҮҮЛИЙН АЖИЛ — BOT-ЫН PAYLOAD ТОГТМОЛ ID БОЛОВ (019, ✅ СЕРВЕРТ ГАРСАН
  2026-08-12, commit `a2c6c46` — ⏳ АМЬД ТАПЫН ШАЛГАЛТ ХҮЛЭЭГДЭЖ БАЙНА, доороос үз).
  МИГРАЦ БАЙХГҮЙ — schema огт хөндөөгүй, DB-д бичигдэх утга ӨӨРЧЛӨГДӨӨГҮЙ:** Discord/Telegram нь ангиллыг товчны payload
  дотор `CATEGORIES` массив дахь **ИНДЕКСЭЭР** дамжуулдаг байсныг **ТОГТМОЛ
  string id**-ээр солив (`dining`/`grocery`/`transport`/`income`/`transfer`/`subs`/
  `edu`/`leisure`/`apparel`/`other`). Энэ бол **зан төлөв ИЖИЛ, цэвэр refactor** —
  ангилал нэмээгүй/хасаагүй/нэр-emoji-өнгө өөрчлөөгүй, дараалал хэвээр, DB бичилт
  байт бүрээрээ ижил (`scripts/category-id.verify.mjs` нь 9 ангилал бүрд «товчны
  шошго = DB-д бичигдсэн ангилал»-ыг жинхэнэ API дээр баталсан). Зорилго: дараагийн
  **дэд ангиллын (subcategory)** ажил `CATEGORIES`-д шинэ мөр нэмэхэд нислэг дунд
  байгаа товчнууд буруу ангилал руу шилжихээс сэргийлэх (§14-ийн индексийн урхи
  **ШИЙДЭГДЛЭЭ**).
  `config/categories.js`: `CATEGORY_META`-д `id`, `byId()`/`idFor()` (Map — массив руу
  индекслэхгүй), `listCategoriesWithIdFor()`; `listCategoriesWithIndexFor()` УСТСАН.
  Хоёр bot-ын codec (`categoryById`, `encodeButtonId`, `encodeModalId`, `parseId` →
  `catId`), builder (`notify.js` ×2), handler (`bot.js` ×2, Telegram-ийн `pending`
  төлөв `catIdx`→`catId`).
  ⚠️ **НИСЛЭГ ДУНДЫН АЮУЛГҮЙ БАЙДАЛ:** deploy-ийн ӨМНӨ илгээгдсэн мэдэгдлийн товч
  индексээр кодлогдсон (`c|123|4|1`). Шинэ парсер массив руу индекслэх fallback
  **ОГТ ХИЙХГҮЙ** — бүх id үсгэн тул `"4"` нь Map-д олдохгүй → `null` → «⚠️ Энэ
  мэдэгдэл хуучирсан байна. Дахин ачаална уу» гэсэн эелдэг хариу (Discord нь
  мессежийг шинэ товчнуудаар нь сэргээнэ). **PATCH огт дуудагдахгүй** тул мөр
  `pending_review` хэвээр, override ч үүсэхгүй — тестээр түгжсэн.
  **Ingest зам (`api/`, `src/`) ХӨНДӨӨГҮЙ** — `api/` дор нэг ч файл өөрчлөгдөөгүй тул
  API+listener-ийг хамт гаргах шаардлагагүй; deploy нь **зөвхөн хоёр bot** (§10).
  Шинэ тест 13 (дундын `categoryStableId` 6 + `categoryButtonId` 6, Discord +1);
  `categoryButtonIndex.test.js` (4) устсан — нийт **309** ногоон.
  Дашрамд: `scripts/discord-edit.verify.mjs` нь multi-tenant ingest гарснаас хойш
  `userId`-гүй POST-оор [B]-ээс цааш **унадаг байсныг** (энэ refactor-той хамааралгүй,
  өмнөх ажлын хоцрогдол) зассан.
  **DEPLOY (2026-08-12):** `git pull --ff-only` (a55c94a→a2c6c46) + `pm2 reload
  bank-discord` ба `bank-telegram` **тус тусад нь** (§10-ийн gotcha). `bank-api` /
  `bank-listener` ХӨНДӨӨГҮЙ (5D uptime хэвээр), DB backup хийгээгүй (миграцгүй),
  dashboard `dist` дахин build хийгээгүй. Хоёр bot `online`, restart тоолуур
  9→10 / 11→12 (нэг л удаа, өсөөгүй), лог цэвэр (`Discord bot нэвтэрлээ`,
  `Telegram bot эхэллээ (long polling)`).
  Серверийн БОДИТ кодон дээр `node --test` = **309/309 ногоон** ба
  `scripts/category-id.verify.mjs` = **9/9 PASS** (`:memory:` DB, production
  өгөгдөл хөндөөгүй) — товчны шошго = DB-д бичигдэх ангилал, хуучин payload → null.
  ⏳ **ҮЛДСЭН ШАЛГАЛТ (хүн таплах шаардлагатай):** deploy-ийн үед production-д
  `pending_review` мөр **0** байсан тул (а) шинэ pending гүйлгээн дээр
  pending→confirm тап, (б) deploy-ийн ӨМНӨ илгээгдсэн хуучин мэдэгдэл дээрх тап
  («хуучирсан» хариу + мөр хөндөгдөхгүй) хоёр хараахан хийгдээгүй.
  Эдгээр батлагдсаны дараа энэ мөрийг «бүрэн баталгаажсан» болгож шинэчилнэ.
- Calendar/Telegram холбогдоогүй. Telegram bot ажиллаж байна.
- AI ангилал **унтраалттай** (`AI_CATEGORIZATION_ENABLED=false`) — credit байхгүй. Асаахад
  танигдаагүй мерчантад санал өгнө; унтраалттай үед зүгээр pending_review болно.
- **★ Шинэ ops хэрэгсэл — OVERRIDE BACKFILL (`scripts/backfill-overrides.js`,
  ✅ PRODUCTION-Д АЖИЛЛУУЛСАН 2026-08-07, commit `0b8747a`):** Override-ийн
  `friendly_name`/`default_note`-г ingest ХЭЗЭЭ Ч мөрөнд бичдэггүй байсныг (§14)
  түүхэн мөрүүд дээр нөхөв. Схем хөндөөгүй, миграц БАЙХГҮЙ, ingest pipeline
  (`api/classify.js`) хөндөөгүй, `pm2 reload` хийгээгүй (шаардлагагүй).
  Бодит DB дээрх үр дүн: `transactions` = **1,126** · `category_overrides` = **42**
  (бүгд `user_id=1`; `user_id=3`-д гүйлгээ алга) · override-т таарсан **217** мөр ·
  `manually_edited=1` тул алгассан **74** мөр · **бичигдсэн 11 мөр**
  (`merchant_place` **4** · `note` **7** · `category` **0** — ангилал аль хэдийн зөв
  байсан, зөвхөн газрын нэр/шалтгаан дутуу). 11 мөр бүгд `NULL → утга` —
  **дарж бичсэн утга 0**. `manually_edited=1` тоо **77 → 77** (өөрчлөгдөөгүй).
  Дараа нь дахин dry-run → **0 мөр** (идемпотент, бодит DB дээр батлагдсан).
  Өмнө нь `scripts/backup.sh` (`transactions-2026-08-07_1208.sqlite.gz`,
  `integrity_check: ok`). Хожим override нэмэгдэх бүрд дахин ажиллуулж болно.
- **★ Өмнөх ажил — АНГИЛЛЫН ХАМААРАЛ / applicability (018, ✅ DEPLOY ХИЙГДСЭН
  2026-08-06, commit `03b8ab8`). МИГРАЦ БАЙХГҮЙ — schema хөндөөгүй, зөвхөн одоо байгаа
  `type` баганыг УНШИНА:** Зарлаган гүйлгээн дээр ангилал сонгохдоо "Орлого" гарч,
  хадгаламж татах зэрэг мөрийг утгагүй ангилах боломжтой байсныг хаав.
  `config/categories.js`-д `CATEGORY_APPLICABILITY` + `isCategoryAllowedFor()` (★ ганц
  предикат, **fail-open**) + `categoriesFor()` + `listCategoriesWithIndexFor()` нэмэгдэв
  (§8.1). Зургаан цэг шүүдэг болов: Dashboard `RowPanel` ба `ConfirmModal`
  (мөрийн `type` аль хэдийн scope-д — plumbing хэрэггүй), Discord товчны эгнээ ба
  засварын select, Telegram keyboard (builder бүр НЭГ параметр авав), сервер тал
  `PATCH /:id/category` → 400. `POST /overrides`-д **хэсэгчилсэн** шалгалт (type
  тодорхойлох боломжгүй — §5). `api/ai.js`-ийн prompt-оос орлогын ангилал хасагдав
  (AI салаа зөвхөн зарлагад хүрдэг тул "Орлого" санал ҮРГЭЛЖ буруу байсан).
  ⚠️ Bot-ын **индексийн урхи** (§14) — шүүсэн ч ЖИНХЭНЭ индекс кодлогдоно, тестээр түгжсэн.
  → **019-д энэ урхи бүрмөсөн арилсан** (индекс кодлол өөрөө устаж, тогтмол id болсон).
  Шинэ тест **36** (дундын 13, API 11, Discord 6, Telegram 6) — нийт **300** ногоон.
  Хуучин "хууль бус" мөрүүдэд **миграц хийгээгүй** (зориуд) — харагдац эвдрээгүйг
  бодит апп дээр шалгасан. Deploy: dashboard `dist` + API + хоёр bot.
  ⚠️ Энэ нь **Phase 1** — override-ийн type-predicate (`classify.js`-ийн lookup нь
  type үл харна) нь ТУСДАА ажил, schema өөрчлөлт шаардана.
- **Өмнөх ажил — МЭДЭГДЭЛ ИРСЭН ЦАГ (миграц 017, ✅ DEPLOY ХИЙГДСЭН 2026-08-06,
  commit `03b8ab8`):** Голомтын имэйлийн BODY-д зөвхөн ОГНОО байдгийг тогтоож, гүйлгээний
  цагийг Gmail имэйлийн `Date:` header-ээс авдаг болов. `transactions.email_received_at`
  (TEXT NULL, ISO 8601 **UTC**, backfill байхгүй) · дундын `config/txfields.js`-д
  `isoInstant()` (Date → ISO UTC эсвэл null) + `ubTimeLabel()` (ISO → УБ `HH:mm`) ·
  listener-ийн push payload бүтээлт `src/payload.js` болж салсан (тестлэгдэх боломжтой) ·
  `emailReceivedAt` нь `api/schema.js`-д сонголттой `z.string().datetime()` ·
  Discord embed-ийн «Огноо» = `2026-08-05 · 14:32` · dashboard-д огнооны нүдэн дээр
  tooltip (`Банкны мэдэгдэл ирсэн: 14:32`) + expand панелд `🕒` мөр.
  ⚠️ `txn_date` ХӨНДӨГДӨӨГҮЙ; цаггүй мөрд юу ч харуулахгүй (хуурамч "00:00" байхгүй).
  Шинэ тест 14 (listener 5, API 6, Discord 3) — тухайн үед нийт **264** ногоон.
  ⚠️ API + listener-ийг **ХАМТ** deploy хийнэ (§10). Талбар нь сонголттой тул аль нэг нь
  түрүүлсэн ч 400 гарахгүй (зөвхөн цаг нь түр бүртгэгдэхгүй) — гэхдээ хамт гаргах нь зөв.
- **Өмнөх ажил — ХЭСЭГЧИЛСЭН ХАСАЛТ / хуваасан зардал (миграц 016, ✅ DEPLOY ХИЙГДСЭН
  2026-08-06, commit `03b8ab8`):** хасалт нь туг биш **ДҮН** болсон
  (`transactions.excluded_amount` + `debt_ledger.exclusion_share`), 4 analytics query нь
  мөр шүүхийн оронд **цэвэр дүн нийлбэрлэдэг**, нэг гүйлгээнд олон бичлэг холбогдож
  тус бүр хувь хэмжээгээ нэмдэг. Шийдэгдсэн кэйс: 90,000₮ хоолны данснаас Болдын 30к,
  Ганагийн 25к нь гарч, **өөрийн 35к «Гадуур хооллолт»-д ҮЛДЭНЭ**. Үлдэгдэл/balance-history
  **байт бүрээрээ хэвээр** (тест `deepEqual`-ээр түгжсэн). UI: DebtLedger-ийн «хүний хэсэг»
  талбар (үлдэгдлээр хязгаарлагдсан) + гүйлгээний мөрийн `↩ … буцаагдсан` / `цэвэр …` тэмдэглэгээ.
  Шинэ тест `api/test/partial-exclusion.test.js` (12) + `debt.test.js`-д 3 (тухайн үед нийт 250).
  Хуучин 2 тест **зориудаар** шинэчлэгдсэн (015-д хуваасан зардал бүхлээрээ хасагддаг байсан
  нь энэ ажлын засаж буй ЯГ ТЭР алдаа) — дэлгэрэнгүйг §12/§14-өөс.
- **Өмнөх ажил — Өрийн дэвтэр + төсвөөс хасах туг (commit `6951061`, серверт ГАРСАН):**
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
- **Production-ы БОДИТ тоо (live DB-ээс уншсан, 2026-08-06 016/017/018 deploy-ийн ДАРАА):**
  `users` = **2** (id=1 admin, id=3 user) · `transactions` = **1,123**
  (2022-11-01 → 2026-08-05; үүнд parity smoke-ийн синтетик 1₮ мөр `id=1115` багтана) ·
  `category_overrides` = **39** · `debt_ledger` = **3** ·
  `excluded_from_budget=1` мөр = **3**. Одоогийн үлдэгдэл **988,369.73₮**.
  → **016-ын backfill баталгаажсан:** 3 хасагдсан мөр бүрд `excluded_amount = amount`
  (бүгд FULL: id 1084/85,000₮ · 1087/51,400₮ · 1090/10,000₮), туг ↔ дүнгийн зөрүү
  **0 мөр** (хоёр чиглэлд ч), хэтэрсэн/сөрөг **0**. `debt_ledger`-ийн 3 бичлэгийн
  `exclusion_share` бүгд NULL = "бүтэн дүн" (016-ын `exclusionShare ?? amount` загвар).
  → **017:** `email_received_at` = **0 мөрд** бөглөгдсөн — backfill ЗОРИУДААР байхгүй,
  зөвхөн ЦААШИД ирэх и-мэйл цагтай болно.
  → **Үлдэгдэл хөндөгдөөгүй нь батлагдсан:** deploy-ийн ӨМНӨХ backup vs live DB-г
  бүтнээр нь харьцуулахад `category`/`status`/`manually_edited`/`amount`/
  `excluded_from_budget` талбаруудад **зөрүүтэй мөр 0**, anchor үлдэгдэл ба мөрийн
  тоо ижил (988,369.73₮ / 1,123).
- Owner-ийн Gmail холболт **`active`** (өмнөх `reauth_needed` арилсан); deploy-ийн дараа
  listener `✅ Gmail IMAP холбогдлоо`, catch-up 0 (reload-ийн ~3 секундэд алдагдсан
  и-мэйл алга).
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
