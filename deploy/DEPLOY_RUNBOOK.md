# Deploy Runbook — golomt bank санхүү

> **Бодит утга энд БАЙХГҮЙ.** Host/user/path/domain нь gitignore хийсэн
> [`deploy/.deploy.local.env`](.deploy.local.env)-д байна. Энэ файлыг эхлээд
> `source` хийнэ. Анхны серверийн суулгацыг [`../DEPLOYMENT.md`](../DEPLOYMENT.md)-аас үз.

## Архитектур (товч)

Нэг repo, 3 pm2 процесс ([`../ecosystem.config.cjs`](../ecosystem.config.cjs)):

- **bank-listener** (`src/index.js`, cwd=repo root) — Gmail IMAP IDLE listener → parse → categorize → API руу POST.
- **bank-api** (`api/server.js`, cwd=`api/`) — Express API. **`dashboard/dist`-г static-аар serve хийдэг** тул фронт+бэк нэг origin (`:3000`).
- **bank-discord** (`discord/bot.js`, cwd=`discord/`) — Discord мэдэгдэл/ангилал bot.

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
- **OAuth refresh token** root `./.env`-ийн `GMAIL_REFRESH_TOKEN`-д. Google түүнийг
  цуцалбал listener `invalid_grant`-аар reconnect loop-д орно → `node scripts/get-token.js`-ээр
  шинэчилж `.env`-д тавиад `pm2 restart bank-listener`.
- **Discord/listener restart нь `pm2 reload all`-д багтана**, гэхдээ зөвхөн UI өөрчлөлтөд
  тэдгээрийг restart хийх шаардлагагүй.

## Анхны суулгац / гаднаас нэвтрэх

- Бүрэн setup: [`../DEPLOYMENT.md`](../DEPLOYMENT.md).
- Nginx загвар: [`nginx-bank.conf`](nginx-bank.conf). DuckDNS cron: [`duckdns-update.sh.example`](duckdns-update.sh.example).
- AWS Security Group-д 80/443 нээгдсэн байх ёстой (ufw-ээс тусдаа).
