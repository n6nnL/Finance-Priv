# Deploy Runbook — golomt bank санхүү

> **Бодит утга энд БАЙХГҮЙ.** Host/user/path/domain нь gitignore хийсэн
> [`deploy/.deploy.local.env`](.deploy.local.env)-д байна. Энэ файлыг эхлээд
> `source` хийнэ. Анхны серверийн суулгацыг [`../DEPLOYMENT.md`](../DEPLOYMENT.md)-аас үз.

## Архитектур (товч)

Нэг repo, 4 pm2 процесс ([`../ecosystem.config.cjs`](../ecosystem.config.cjs)):

- **bank-listener** (`src/index.js`, cwd=repo root) — multi-tenant Gmail IMAP IDLE listener
  (хэрэглэгч бүрийн inbox тусад нь, `src/accounts.js`+`src/manager.js`) → parse → categorize →
  API руу POST (`userId`-тэй).
- **bank-api** (`api/server.js`, cwd=`api/`) — Express API. **`dashboard/dist`-г static-аар serve хийдэг** тул фронт+бэк нэг origin (`:3000`).
- **bank-discord** (`discord/bot.js`, cwd=`discord/`) — Discord мэдэгдэл/ангилал bot, **зөвхөн owner**.
- **bank-telegram** (`telegram/bot.js`, cwd=`telegram/`) — Telegram мэдэгдэл/ангилал/linking bot,
  **бүх хэрэглэгч** (multi-tenant).

Гаднаас: **Nginx** (`:80/:443`, Let's Encrypt HTTPS) → `proxy_pass http://127.0.0.1:3000`. Домейн DuckDNS. Node **24** (node:sqlite-д 22.5+ ЗААВАЛ). Нууц утга серверийн **өөрийн** `.env` (root `./.env` + `api/.env`)-д — repo-д ОРОХГҮЙ.

`source` хийх (доорх бүх блок үүнийг эхэлж дуудна гэж үзнэ):

```bash
source deploy/.deploy.local.env
# → DEPLOY_HOST, DEPLOY_USER, DEPLOY_SSH_KEY, DEPLOY_PATH, DEPLOY_DOMAIN
```

## Dashboard-only redeploy (түгээмэл тохиолдол)

Зөвхөн фронтенд (dashboard/) өөрчлөгдсөн бол — **pm2 reload хэрэггүй** (API нь
`dist`-г диск дээрээс уншдаг тул шинэ файл шууд идэвхжинэ). Локалаар build хийгээд
`dist`-г scp-ээр хуулна:

```bash
source deploy/.deploy.local.env
cd dashboard && npm run build && cd ..
scp -i "$DEPLOY_SSH_KEY" -r dashboard/dist "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH/dashboard/"
```

Шалгах: `curl -I https://$DEPLOY_DOMAIN/` (200) ба браузерт refresh.

## Full redeploy (listener/API/discord код өөрчлөгдсөн)

Сервер git-ээр кодоо татдаг тул **эхлээд GitHub руу push** (доорх git pull түүнийг татна):

```bash
git push origin main
```

Дараа нь серверт:

```bash
source deploy/.deploy.local.env
ssh -i "$DEPLOY_SSH_KEY" "$DEPLOY_USER@$DEPLOY_HOST" \
  "cd $DEPLOY_PATH && git pull --ff-only && \
   npm install --omit=dev && \
   (cd api && npm install --omit=dev) && \
   (cd dashboard && npm install && npm run build) && \
   (cd discord && npm install --omit=dev) && \
   (cd telegram && npm install --omit=dev) && \
   pm2 reload all"
```

> **API restart дээр идемпотент миграц автоматаар ажиллана** (жишээ: `manually_edited`
> багана нэмэгдэх). Тиймээс **full redeploy-ийн өмнө DB-г backup хий** (доороос үз).

## Аюулгүй deploy-ийн дэс дараалал (production өгөгдөл)

1. **DB backup (заавал, full redeploy-ийн өмнө).** WAL-тай тул `.sqlite`-аас гадна
   `-wal`/`-shm`-ийг хамт хуул (эсвэл `scripts/backup.sh` ашигла):
   ```bash
   ssh -i "$DEPLOY_SSH_KEY" "$DEPLOY_USER@$DEPLOY_HOST" '
     TS=$(date +%Y%m%d-%H%M%S); mkdir -p ~/backups
     for f in transactions.sqlite transactions.sqlite-wal transactions.sqlite-shm; do
       cp '"$DEPLOY_PATH"'/api/data/$f ~/backups/${f/.sqlite/-$TS.sqlite} 2>/dev/null; done
     cp '"$DEPLOY_PATH"'/data/listener.sqlite ~/backups/listener-$TS.sqlite 2>/dev/null
     cp '"$DEPLOY_PATH"'/.env ~/backups/env-bank-$TS.bak; cp '"$DEPLOY_PATH"'/api/.env ~/backups/env-api-$TS.bak'
   ```
   (`backups/` нь .gitignore-д — серверээс гадагш ч хуулж байх нь зүйтэй.)
2. **Deploy** (дээрх dashboard-only эсвэл full).
3. **Verify:**
   ```bash
   ssh -i "$DEPLOY_SSH_KEY" "$DEPLOY_USER@$DEPLOY_HOST" "pm2 status"
   curl -s https://$DEPLOY_DOMAIN/health           # {"status":"ok"}
   curl -s -o /dev/null -w '%{http_code}\n' https://$DEPLOY_DOMAIN/   # 200 (dashboard)
   ssh -i "$DEPLOY_SSH_KEY" "$DEPLOY_USER@$DEPLOY_HOST" "pm2 logs bank-listener --lines 20 --nostream"
   ```
   Listener log-д `✅ Gmail IMAP холбогдлоо` харагдах ёстой.

## Gotcha-ууд (өмнө тулгарсан)

- **`git pull --ff-only` abort болдог** — сервер дээр commit хийгээгүй локал өөрчлөлт
  байвал (өмнө `discord/bot.js` дээр тохиолдсон). Эхлээд тэр өөрчлөлт upstream-д орсон
  эсэхийг шалгаад (`git diff <file>`), орсон бол `git checkout -- <file>` хийж дараа нь pull.
- **Серверийн git remote нь SSH** (`git@github.com:...`, deploy key); локал нь HTTPS.
  Тиймээс full redeploy-д эхлээд локалаас GitHub руу push хийнэ.
- **Node хувилбар:** 22.5+ ЗААВАЛ (node:sqlite). Сервер дээр Node 24.
- **Хоёр API key таарах ёстой:** root `./.env`-ийн `WEBSITE_API_KEY` ↔ `api/.env`-ийн
  `LISTENER_API_KEY`. Таарахгүй бол dashboard/listener 401.
- **OAuth refresh token** root `./.env`-ийн `GMAIL_REFRESH_TOKEN`-д (legacy — зөвхөн owner-ийн
  анхны seed-д; шинэ хэрэглэгч бүр dashboard-аас өөрийн Gmail-аа холбодог). Google түүнийг
  цуцалбал listener `invalid_grant`-аар тухайн хэрэглэгчийг `reauth_needed` болгож зогсооно
  (бусад хэрэглэгчид нөлөөгүй) → dashboard-ийн Settings-ээс дахин холбоно (эсвэл owner бол
  `node scripts/get-token.js`-ээр шинэчилж `.env`-д тавиад `pm2 restart bank-listener`).
- **`TOKEN_ENC_KEY` (root `.env` БА `api/.env`, ЯГ ИЖИЛ утга) — ЗААВАЛ.** Gmail/Calendar refresh
  token-ыг DB-д шифрлэхэд ашиглана. Байхгүй бол `bank-api` асахгүй. Үүсгэх:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Дараа нь сольж
  БОЛОХГҮЙ** (хадгалагдсан token тайлагдахаа болино).
- **`JWT_SECRET` (root `.env` БА `api/.env`, ЯГ ИЖИЛ утга) — ЗААВАЛ.** `bank-telegram` энэ секретээр
  хэрэглэгчийн нэрийн өмнөөс богино хугацаат access token mint хийдэг. Таарахгүй бол Telegram
  дээрх ангиллын товч бүгд алдаатай болно (`bank-api` лог дээр 401 харагдана).
- **`TELEGRAM_BOT_TOKEN` (root `.env`)** — @BotFather-аас. `bank-telegram` эхлэхдээ шалгана,
  дутуу бол process шууд унтрана (pm2 restart loop).
- **Discord/Telegram/listener restart нь `pm2 reload all`-д багтана**, гэхдээ зөвхөн UI
  өөрчлөлтөд тэдгээрийг restart хийх шаардлагагүй.
- **API + listener-ийг ХАМТ deploy хий** — шинэ API (`userId` заавал ingest-д) хуучин listener-ийн
  (userId-гүй) push-ийг 400-аар reject хийнэ.

## Анхны суулгац / гаднаас нэвтрэх

- Бүрэн setup: [`../DEPLOYMENT.md`](../DEPLOYMENT.md).
- Nginx загвар: [`nginx-bank.conf`](nginx-bank.conf). DuckDNS cron: [`duckdns-update.sh.example`](duckdns-update.sh.example).
- AWS Security Group-д 80/443 нээгдсэн байх ёстой (ufw-ээс тусдаа).
