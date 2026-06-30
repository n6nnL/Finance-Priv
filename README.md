# Bank Email Listener (Голомт банк → вэбсайт API)

> 🚀 **Deploy хийх:** [`deploy/DEPLOY_RUNBOOK.md`](deploy/DEPLOY_RUNBOOK.md) (process,
> placeholder-тай). Серверийн бодит утга (host/user/path/domain) нь gitignore хийсэн
> `deploy/.deploy.local.env`-д — repo-д ОРОХГҮЙ. Анхны суулгац: [`DEPLOYMENT.md`](DEPLOYMENT.md).

Gmail хайрцагт **Голомт банкнаас** (`alert@golomtbank.com`) гүйлгээний имэйл ирмэгц **бараг real-time** (IMAP IDLE) илрүүлж, агуулгыг задлан, ангилж, вэбсайтын API руу POST хийдэг, **байнга ажилладаг** Node.js service.

- ✅ IMAP IDLE — секундын дотор шинэ имэйл барина
- ✅ Exponential backoff reconnect (1с → 60с)
- ✅ Token refresh (50 мин тутамд) — 1 цагийн дараа чимээгүй унтрахгүй
- ✅ Catch-up — унтарсан хугацааны имэйлийг алдахгүй
- ✅ Идэмпотентность (Message-ID) — давхар бүртгэхгүй
- ✅ Push retry + re-push (push_failed-ийг дараа дахин илгээх)
- ✅ pm2-д бэлэн, structured log, heartbeat

> ✅ **Parser бэлэн:** [`src/parsers/golomt.js`](src/parsers/golomt.js) нь Голомт
> банкны **"Easy Info гүйлгээний мэдээлэл"** имэйлийн бодит label-value форматыг
> (Гүйлгээний дүн / огноо / Дансны дугаар / Гүйлгээний утга / Үлдэгдэл) HTML болон
> plain text хоёуланд задалдаг. Шинэ мерчантуудаар ангиллыг сайжруулахдаа зөвхөн
> [`config/categories.js`](config/categories.js)-г засна.

---

## 1. Суулгах

```bash
npm install
```

Node.js **22.5+** шаардлагатай (`fetch`, ES modules, болон суурилуулсан
`node:sqlite` модулийн дэмжлэг).

> 💡 SQLite-д Node-ийн **суурилуулсан `node:sqlite`** модулийг ашигладаг тул
> native compile (Python / Visual Studio Build Tools) **огт хэрэггүй**.
> `npm install` нь зөвхөн цэвэр-JS пакетуудыг (cheerio, imapflow г.м) татна.

---

## 2. Google Cloud дээр OAuth тохируулах

1. [Google Cloud Console](https://console.cloud.google.com/) → шинэ **project** үүсгэ.
2. **APIs & Services → Library** → **Gmail API**-г хайж **Enable** хий.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** (хувийн Gmail бол).
   - App name, support email бөглө.
   - **Scopes** алхамд `https://mail.google.com/`-г нэм (IMAP-д шаардлагатай).
   - **Test users**-д өөрийн Gmail хаягийг нэм (Publishing хийгээгүй бол).
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized redirect URIs**-д `http://localhost:53682/oauth2callback` нэм
     (`.env`-ийн `OAUTH_REDIRECT_URI`-тэй тааруулна).
   - Үүсгээд **Client ID**, **Client secret**-г хуул.

> **Scope тэмдэглэл:** Google IMAP/SMTP-д зөвхөн `https://mail.google.com/` scope
> ажилладаг (read-only нарийн scope IMAP-д ажиллахгүй). Энэ нь full mail хандалт
> өгдөг тул `GMAIL_REFRESH_TOKEN`-г маш найдвартай хадгал. Бид код дотроо
> зөвхөн имэйл уншиж байгаа (устгах/илгээх үйлдэл хийдэггүй).

---

## 3. `.env` бөглөх

```bash
cp .env.example .env
```

`.env`-д дараахыг бөглө:

| Хувьсагч | Тайлбар |
|---|---|
| `GMAIL_USER` | Сонсох Gmail хаяг |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud-оос |
| `GMAIL_REFRESH_TOKEN` | Дараагийн алхамд авна |
| `BANK_SENDER` | Default `alert@golomtbank.com` |
| `WEBSITE_API_URL` / `WEBSITE_API_KEY` | Гүйлгээ POST хийх endpoint |
| `WEBSITE_HMAC_SECRET` | (Сонголт) HMAC гарын үсэг |

---

## 4. refresh_token авах

```bash
npm run get-token
```

- Терминалд хэвлэгдсэн **URL**-г browser-т нээ.
- Gmail аккаунтаараа нэвтэрч зөвшөөрөл өг.
- Терминалд `GMAIL_REFRESH_TOKEN=...` хэвлэгдэнэ → `.env`-д хуулж тавь.

> `refresh_token` буцаагүй бол [Google permissions](https://myaccount.google.com/permissions)-оос
> аппын хандалтыг устгаад дахин ажиллуул (`prompt=consent` дахин refresh_token өгнө).

---

## 5. Тест ажиллуулах

```bash
npm test
```

`parseGolomt` болон `categorize`-ийн unit test. (Жишээ fixture-ууд таамагласан
формат дээр суурилсан — бодит имэйлд тааруулна.)

---

## 6. Ажиллуулах

### Хөгжүүлэлтэд (шууд):

```bash
npm start
```

### Production (pm2):

```bash
npm i -g pm2
pm2 start ecosystem.config.cjs
pm2 logs bank-email-listener     # лог үзэх
pm2 save                          # дахин асахад сэргээх
pm2 startup                       # системд autostart суулгах
```

---

## 7. push_failed гүйлгээг дахин илгээх

```bash
npm run repush
```

Cron-д тавьж тогтмол ажиллуулж болно (жишээ 10 минут тутам).

---

## Бүтэц

```
src/
  config.js          # env унших + валидаци
  logger.js          # pino logger + notifyError() hook
  db.js              # SQLite: lastSeenUid, Message-ID, гүйлгээ
  imap-client.js     # IMAP IDLE, reconnect, token refresh, catch-up
  parsers/golomt.js  # ⚠️ Голомт parser (бодит форматад тааруулна)
  categorize.js      # keyword ангилагч (AI fallback бэлэн)
  push.js            # API руу POST + retry
  index.js           # бүгдийг холбосон entry point
config/
  categories.js      # keyword → category mapping
scripts/
  get-token.js       # OAuth refresh_token авах
  repush.js          # push_failed re-push
test/
  golomt.test.js
  categorize.test.js
ecosystem.config.cjs # pm2
```

## Урсгал

```
Голомт банк → Gmail → IMAP IDLE listener
  → шинэ имэйл → BANK_SENDER-ээр шүүх
  → Message-ID идэмпотентность шалгах
  → parseGolomt (дүн/огноо/тайлбар/чиглэл/данс)
  → categorize → DB-д insert → API руу POST (retry)
  → статус: pushed / push_failed / parse_failed
```

## Edge case-ууд (хэрэгжсэн)

- **Хоосон / parse алдсан имэйл** → `parse_failed`, Message-ID бүртгэгдэж дахин оролдохгүй.
- **API унтарсан** → retry → бүгд амжилтгүй бол `push_failed` → `repush`-аар сэргээнэ.
- **Token дууссан** → 50 мин тутам автоматаар refresh.
- **UIDVALIDITY өөрчлөгдсөн** → lastSeenUid reset (Message-ID давхар хамгаална).
- **Сервис дунд унтарсан** → дахин асахад catch-up хийж алдсан имэйлийг гүйцнэ.
- **Нэг имэйлийн алдаа** → бусдыг зогсоохгүй (try/catch тус бүрд).

## Дараа хийх (сонголтоор)

1. ~~`src/parsers/golomt.js` тааруулах~~ — ✅ хийгдсэн ("Easy Info" формат).
   Голомт өөр төрлийн (жишээ нь өөр гарчигтай) имэйл нэмбэл label-уудыг
   шалгаж өргөтгөнө.
2. `config/categories.js` — бодит мерчантуудаар keyword баяжуул
   (одоогоор танихгүй мерчант `other` болно).
3. `logger.js` доторх `notifyError()`-д Telegram/имэйл мэдэгдэл залга.
4. AI ангилал — `categorize.js`-ийн fallback цэгт залгах боломжтой.
