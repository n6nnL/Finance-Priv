# Finance-Priv — төслийн context (Claude/chat agent-д зориулсан handoff)

> **Зорилго:** Энэ баримтыг шинэ чатад attachment болгож өгснөөр төслийн бүтэц, архитектур,
> одоогийн (multi-tenant) төлөвийг бүрэн ойлгуулна. **Нууц утга ЭНД БАЙХГҮЙ** (`.env`, token,
> key, server IP/SSH нь gitignored файлуудад). Баримт бэлдсэн үе: deploy commit **`8052c99`**
> (`main`), серверт амьд.

---

## 1. Товч танилцуулга

Голомт банкны имэйл мэдэгдлээс гүйлгээг автоматаар татаж, ангилж, хадгалж, dashboard-д
харуулдаг систем — **хувийн хэрэгслээс олон хэрэглэгчийн (multi-tenant) бүтээгдэхүүн болж
шилжсэн**. Нэг **monorepo**, 5 хэсэг:

| Хэсэг | Зам | Үүрэг |
|---|---|---|
| **listener** | `src/` | Multi-tenant Gmail IMAP IDLE (хэрэглэгч бүрийн inbox тусад нь) → parse → ангилал → API руу POST |
| **API** | `api/` | Express REST API + `dashboard/dist`-г static serve (нэг origin `:3000`) |
| **dashboard** | `dashboard/` | Vite + React + Tailwind (cream/brand загвар) |
| **discord bot** | `discord/` | **Зөвхөн owner** — мэдэгдэл + товч/modal-аар ангилах |
| **telegram bot** | `telegram/` | **Бүх хэрэглэгч** (owner-ийг оруулаад) — мэдэгдэл + linking + товчоор ангилах |

**Тех стек:** Node **24** (ЗААВАЛ — `node:sqlite` нь 22.5+), Express, `node:sqlite` (native
build хэрэггүй), zod, jsonwebtoken, bcryptjs, google-auth-library, discord.js, telegraf.
Frontend: Vite/React/Tailwind.

---

## 2. Storage — ⚠️ ЧУХАЛ тодруулга

Repo-д **хуучин Python файлууд** (`api_server.py`, `main.py`, `sheets_writer.py`,
`categorizer.py`, `gmail_parser.py`) байгаа боловч эдгээр нь **ҮХСЭН legacy** — ямар ч процесс
ажиллуулдаггүй. **Бодит амьд backend = Node/Express + `node:sqlite`.** Гүйлгээ SQLite-д
(`api/data/transactions.sqlite`) хадгалагдана. Google Sheets ашигладаггүй.

---

## 3. Deploy / орчин

- **Process manager:** pm2, [`ecosystem.config.cjs`](ecosystem.config.cjs) — **4 процесс**:
  `bank-listener` (`src/index.js`), `bank-api` (`api/server.js`), `bank-discord`
  (`discord/bot.js`), `bank-telegram` (`telegram/bot.js`).
- **Домейн:** `https://golomt-fin.duckdns.org` (DuckDNS). **Nginx** (`:80/:443`, Let's Encrypt)
  → `proxy_pass http://127.0.0.1:3000`.
- **Runbook (нууцгүй):** [`deploy/DEPLOY_RUNBOOK.md`](deploy/DEPLOY_RUNBOOK.md).
  **Бодит утга (host/user/path/SSH key/domain):** `deploy/.deploy.local.env` — **gitignored**.
- **Redeploy 2 төрөл:**
  - *Dashboard-only*: локалд build → `scp dist` (pm2 reload хэрэггүй).
  - *Full*: push → серверт `git pull` + `npm install` (root/api/dashboard/discord/telegram) +
    dashboard build + `pm2 reload all`. **Өмнө нь DB backup хий** (idempotent миграц ажиллана).
  - **API + listener-ийг ХАМТ deploy хий** — шинэ API `userId`-гүй ingest push-ийг 400-аар reject
    хийдэг тул хуучин listener-тэй зэрэгцэн ажиллуулбал гүйлгээ алдагдана.
- **Server git remote нь SSH**; локал нь HTTPS.
- Серверийн spec бага (908Mi RAM, ~6.7G disk) — swap (2G) идэвхтэй, диск ихэвчлэн OS/snap/apt
  cache-ээр дүүрдэг (апп өөрөө ~200M).

---

## 4. Өгөгдлийн сан — schema + миграц

Бүх миграц `api/db.js`-ийн `migrate()` дотор **идемпотент**. **Multi-tenant:** бараг бүх
хүснэгт `user_id`-тэй, query бүр `req.userId`-аар шүүгдэнэ.

| Хүснэгт | Гол багана | Тайлбар |
|---|---|---|
| `transactions` | `user_id, amount, currency, txn_date, type, category, status, description, merchant_place, is_pos, manually_edited, message_id (UNIQUE)` | Гүйлгээ. `manually_edited=1` мөрийг pipeline дахин parse/categorize хийхгүй. |
| `category_overrides` | `user_id, merchant_pattern, category, friendly_name` | Сурсан override. |
| `users` | `id, email UNIQUE, password_hash, role, google_sub, picture` | Хэрэглэгч. |
| `user_settings` | `user_id PK, data (JSON)` | Төсвийн тохиргоо. |
| `personal_events` | `id, user_id, title, date, amount_mnt` | Хуанли event. |
| `google_tokens` | `user_id PK, refresh_token, scope, calendar_connected, gmail_refresh_token, gmail_scope, gmail_email, gmail_connected, gmail_status` | **НУУЦ, ШИФРЛЭГДСЭН (AES-256-GCM)** — API хариуд token утга ХЭЗЭЭ Ч буцаахгүй. Calendar БА Gmail (multi-tenant listener) token хоёул энд. |
| `budget_allocations` | `user_id, category, percent` | Real-time tracker %-хуваарилалт. |
| `telegram_links` | `user_id PK, chat_id UNIQUE` | Telegram chat ↔ dashboard хэрэглэгч (1:1). |
| `telegram_link_codes` | `code PK, user_id, expires_at, used` | Нэг удаагийн linking код (10 мин TTL). |
| `telegram_notifications` | `(transaction_id, chat_id) PK, message_id` | Мэдэгдлийн идэмпотентность. |

Миграц: 001–004 (transactions/dashboard/AI/note), 005 (auth+multi-tenant), 006
(user_settings+personal_events), 007 (google_sub/picture+google_tokens), 008
(budget_allocations), **009** (Gmail multi-tenant баганууд + token encryption backfill),
**010** (Telegram linking хүснэгтүүд).

**Listener** (`src/db.js`) `transactions`-д мөн `user_id` багана (идэмпотент ALTER); state
(`lastSeenUid`/`uidValidity`) key бүр **per-user scoped** (`lastSeenUid:<userId>`).

---

## 5. API endpoint-ууд (бүгд `/api` дор)

**Auth** (`routes/auth.js`):
- `GET/GET-callback /api/auth/google[/callback]` — Login, **минимал scope** (`openid email
  profile`), allow-list (`AUTH_OPEN_SIGNUP=false` үед) эсвэл нээлттэй бүртгэл.
- `GET /api/auth/google/calendar` (JWT) → JSON `{url}`; `GET /google/calendar/callback` (public,
  `calendar_oauth_state`) — Calendar opt-in холболт.
- `GET /api/auth/gmail/connect` (JWT) → JSON `{url}`; `GET /gmail/callback` (public,
  `gmail_oauth_state`) — Gmail multi-tenant холболт (listener-д зориулсан).
- `POST /disconnect` (calendar/gmail тус тусдаа), `POST /refresh`, `GET /me` (`gmailConnected`,
  `calendarConnected`, `telegramConnected` талбаруудтай).
- `POST /login`, `/register` — default OFF (`AUTH_LOCAL_ENABLED=false` → 404).

**Telegram** (`routes/telegram.js`, JWT-only): `POST /api/telegram/link-code`,
`POST /api/telegram/unlink`.

**Transactions** (`routes/transactions.js`): `GET /api/transactions`, `/pending`, `/:id`,
`PATCH /:id/category` (applyToAll → override), `PATCH /:id/note`, `POST /` (ingest — machine
(`X-API-Key`) auth-д **`userId` заавал**, буруу/дутуу бол 400; JWT auth-д `req.userId`
ашиглана, body-г үл тоомсорлоно).

**Meta/Budget:** өөрчлөгдөөгүй (`/summary`, `/monthly`, `/categories`, `/overrides`,
`/settings`, `/events`, `/budget-status`, `/budget-allocations`).

---

## 6. Frontend бүтэц (`dashboard/src/`)

- **Entry:** `main.jsx` → `App.jsx`. Nav: Бүртгэл / Шинжилгээ / Календарь / Шийдвэр.
- Gmail холбоогүй + гүйлгээ 0 үед Бүртгэл-д onboarding empty-state ("Банкны Gmail-аа холбоно уу").
- **Components:** `Login` (Google-only, цэвэр sign-in копи), `Settings` (цалин/payday/subs/alloc
  + **Gmail/Calendar/Telegram холболтын 3 тусдаа хэсэг**, тус бүр connect/disconnect), бусад
  (`Filters`, `Summary`, `TransactionTable`, `PendingReview`, `Analyze`, `Insights`, `Calendar`,
  `Planner`, `BudgetTracker`) өөрчлөгдөөгүй.
- **lib/api.js:** JWT client, `connectGmail/disconnectGmail`, `connectCalendar/disconnectCalendar`,
  `telegramLinkCode/disconnectTelegram`.

---

## 7. Multi-tenant Auth загвар (нарийвчлал)

3 тусдаа Google OAuth "consent" урсгал, **тус бүр өөрийн CSRF `state` namespace**
(`oauth_state` / `calendar_oauth_state` / `gmail_oauth_state`) — андуурч replay хийх боломжгүй:

1. **Login** — `LOGIN_GOOGLE_CLIENT_ID/SECRET` (шинэ "Web application" type OAuth client,
   listener-ийн Gmail client-ээс ТУСДАА). Минимал scope тул "баталгаажаагүй апп" анхааруулга
   ихэвчлэн гарахгүй.
2. **Calendar connect** (Settings-ээс opt-in) — ЯГ ижил client, calendar.readonly scope.
3. **Gmail connect** (Settings-ээс, multi-tenant listener-д зориулсан) — мөн ижил client,
   `https://mail.google.com/` scope. ⚠️ **Web application type client ЗААВАЛ** — Desktop/Installed
   type client custom HTTPS redirect_uri огт дэмждэггүй тул login/calendar/gmail-connect
   ажиллахгүй (энэ алдааг олж заслаа: `redirect_uri_mismatch` персистент байсан шалтгаан).

**Listener-ийн Gmail IMAP client** (`GOOGLE_CLIENT_ID` root `.env`, Desktop/Installed type,
`credentials.json`) ЭДГЭЭРЭЭС **бүрэн тусдаа** — зөвхөн `scripts/get-token.js`-ийн нэг удаагийн
локал token авах урсгалд.

- **Machine (listener/discord):** `X-API-Key` → owner (хамгийн бага id).
- **Machine (Telegram bot):** JWT-ээ ӨӨРӨӨ mint хийдэг (`telegram/jwtAuth.js`, `api/.env`-тэй
  ИЖИЛ `JWT_SECRET`) — chat_id→user_id resolve хийсний дараа тухайн хэрэглэгчийн нэрийн өмнөөс
  API дуудна (owner X-API-Key биш, тул isolation route-ийн одоо байгаа `req.userId` шүүлтээр
  автоматаар хамгаалагдана — шинэ auth логик API талд шаардлагагүй).

---

## 8. Multi-tenant Gmail listener (`src/`)

- `src/accounts.js` — api DB-г шууд (SELECT/UPDATE л, миграц ажиллуулахгүй) уншиж холбогдсон
  дансуудыг (`gmail_connected=1 AND gmail_status='active'`) жагсаана, token-г decrypt хийнэ.
- `src/manager.js` — reconcile loop (`ACCOUNTS_POLL_SECONDS`, default 60): дансаар `ImapListener`
  instance асаах/зогсоох/restart, **нэг хэрэглэгчийн алдаа бусдыг унагаахгүй**.
- `invalid_grant` → тухайн хэрэглэгч `gmail_status='reauth_needed'`, owner-т `OPS_WEBHOOK_URL`-аар
  мэдэгдэнэ, listener зогсоно (бусад үргэлжилнэ).
- Эхлэхдээ `seedOwnerFromEnv()` — root `.env`-ийн legacy `GMAIL_REFRESH_TOKEN`-ийг owner-ийн
  холболт болгож нэг удаа шифрлэн DB-д оруулдаг (аль хэдийн гүйцэтгэсэн, prod дээр баталгаажсан).

---

## 9. Telegram bot (`telegram/`)

- Discord-той адил polling загвар (`.bot-state.json`, `lastNotifiedId`) — **зөвхөн холбогдсон
  хэрэглэгчид** (`telegram_links` JOIN) мэдэгдэнэ.
- Linking: dashboard → `POST /api/telegram/link-code` (JWT) → 6 оронтой код (10 мин) → bot-д
  `/link <код>` → `telegram/db.js` шууд DB бичилтээр consume (chat_id UNIQUE тул давхар
  холболтыг татгалзана).
- Ангилах: inline товч → chat_id→user_id resolve → JWT mint → `PATCH /:id/category`
  (JWT-scoped, isolation route-оор автомат хамгаалагдсан).
- ⚠️ **`https.Agent({family:4})` ЗААВАЛ** Telegraf-ийн `telegram.agent`-д — зарим сервер (AWS
  EC2) `api.telegram.org`-д AAAA (IPv6) DNS буцаадаг ч бодит route байхгүй тул node-fetch
  ETIMEDOUT алддаг (bot.js-д аль хэдийн засагдсан).
- ⚠️ `bot.launch()`-ийн Promise **bot зогсох хүртэл resolve хийхгүй** (telegraf-ийн
  Polling.loop()-ийн зан төлөв) — "эхэллээ" лог-ыг `bot.polling` шинжээр богино зайнаас шалгаж
  логлоно (`.then()`-ээр биш).

---

## 10. Owner admin observability

Тусдаа Discord admin bot/сувагГҮЙ — одоо байгаа **`OPS_WEBHOOK_URL`** (Discord webhook, аль
хэдийн зөвхөн owner-т харагддаг) дахин ашигласан:
- Шинэ хэрэглэгч бүртгүүлэх → `notifyOps('new-user-registered', ...)` (`routes/auth.js`).
- Gmail `reauth_needed` → `notifyError('gmail-reauth-needed', ...)` (`src/index.js`).

---

## 11. Гол конвенцууд (шинэ код бичихэд)

- **Per-user isolation:** query бүр `req.userId`-аар. Machine push-д `userId` заавал (owner
  fallback байхгүй).
- **Ангилал:** `config/categories.js` — 10 ангилал. Танигдаагүй → `category=null` +
  `pending_review`.
- **Route загвар:** factory (`createXRouter({ db, ... })`), `{status:'ok', ...}` хариу.
- **Discord bot ЗӨВХӨН owner** — polling query-д `WHERE user_id=owner` ЗААВАЛ (эс бөгөөс
  multi-tenant дор бусад хэрэглэгчийн гүйлгээ алдагдана — энэ session-д олж заслаа).
- **Bookkeeping хүснэгт (`telegram_*`) — bot шууд DB бичих зөвшөөрөлтэй; санхүүгийн хүснэгт
  (`transactions`/`category_overrides`) ХЭЗЭЭ Ч шууд бичихгүй, зөвхөн authenticated API-аар.**
- **Token encryption:** `config/tokenCrypto.js` (AES-256-GCM, `enc:v1:` prefix) — `TOKEN_ENC_KEY`
  (root+api `.env`-д ИЖИЛ) — солиход хуучин token бүгд тайлагдахгүй болно, СОЛИХГҮЙ.
- **Responsive (cheap audit):** олон элементтэй мөр `flex-col`→`sm:flex-row`; atomic string
  `whitespace-nowrap`; текст ≥13px.

---

## 12. Шинэ env хувьсагч (энэ session-д нэмэгдсэн)

`api/.env`: `TOKEN_ENC_KEY`, `JWT_SECRET` (root-той ИЖИЛ), `LOGIN_GOOGLE_CLIENT_ID/SECRET`,
`LOGIN_OAUTH_REDIRECT_URI`, `GMAIL_GOOGLE_CLIENT_ID/SECRET`, `AUTH_OPEN_SIGNUP`.
Root `.env`: `TOKEN_ENC_KEY` (api-тай ИЖИЛ), `API_DB_PATH`, `ACCOUNTS_POLL_SECONDS`,
`TELEGRAM_BOT_TOKEN`, `JWT_SECRET` (api-тай ИЖИЛ).

---

## 13. Одоогийн live төлөв

- Deploy commit **`8052c99`** серверт амьд, 4 pm2 процесс бүгд online.
- 1 хэрэглэгч (owner) бүртгэлтэй, 1057 гүйлгээ (2022-11 → 2026-07), бүгд ангилагдсан.
- Gmail холбогдсон (owner, legacy seed-ээс), Calendar/Telegram холбогдоогүй.
- **Login яг сая (`LOGIN_GOOGLE_CLIENT_ID` шинэ Web application type client-ээр) засагдаж,
  `redirect_uri_mismatch` арилсан** — эцсийн бодит нэвтрэлтийн баталгаажуулалт хэрэглэгчийн
  гараар хийгдэх шаардлагатай (headless боломжгүй).
- Telegram bot (`@SanhuuchBot`) баталгаажсан ажиллаж байна (`/start` хариулсан).

---

## 14. ⚠️ Мэдэгдэж буй асуудал / gotcha

- **Google "Testing" mode → refresh token ~7 хоногт хүчингүй** болж болзошгүй (verification
  хийгээгүй л бол). `reauth_needed` → dashboard Settings-ээс дахин холбоно (эсвэл owner
  `scripts/get-token.js`).
- **`git pull --ff-only`** серверт commit хийгээгүй локал өөрчлөлт байвал abort болно.
- **3 өөр Google OAuth client concept:** (1) listener Gmail IMAP (Desktop type, `credentials.json`,
  root `.env` `GOOGLE_CLIENT_ID`) — ТУСДАА, ХҮРЭХГҮЙ; (2) Login/Calendar/Gmail-connect (Web
  application type, `LOGIN_GOOGLE_CLIENT_ID`) — ганц client 3 flow-д хуваалцана; андуурч
  Desktop-type client-ийг Web урсгалд ашиглавал `redirect_uri_mismatch` — засах боломжгүй,
  зөвхөн зөв type-той шинэ client үүсгэх л шийдэл.
- **Диск:** OS/snap/apt cache-ээр дүүрдэг, апп өөрөө жижиг — `sudo apt clean` аюулгүй.
- **Node 22.5+ ЗААВАЛ** (`node:sqlite`). Сервер дээр Node 24.

---

## 15. Тест

- Backend: `cd api && npm test` — **87 тест** (dashboard, api, budget, budget-status,
  google-auth, gmail-auth, telegram, token-crypto, google-provider).
- Listener: `node --test src/accounts.test.js src/manager.test.js` — **8 тест**.
- Telegram: `cd telegram && npm test` — **12 тест** (db, isolation — cross-user JWT reject
  бодит api/app.js-ээр баталгаажуулсан).
- Frontend цэвэр функц: `node --test dashboard/src/lib/budget.test.js`.

---

## 16. Нууцлал

Repo нь **public байсан**. Нууц утга (`.env`, `*.pem`, `credentials.json`, `*.local.env`, DB)
ХЭЗЭЭ Ч commit хийхгүй. Секрет байрлал: `api/.env`, root `.env`, `deploy/.deploy.local.env`,
`credentials.json` (listener-ийн Desktop OAuth client, `scripts/get-token.js`-д).
`.claude/settings.local.json` анхаарал татсан — permission log-оор дамжуулан IP/SSH зам
хуримтлагдаж болзошгүй тул тогтмол шалгаж `.gitignore`-д нэмэхийг зөвлөж байна (одоогоор push
хийгдээгүй).
