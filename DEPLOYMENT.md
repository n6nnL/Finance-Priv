# VPS Deployment — банкны гүйлгээ бүртгэгчийг 24/7 ажиллуулах

Голомт банкны гүйлгээ бүртгэгч системийг (listener + API + dashboard, SQLite) Ubuntu
VPS дээр байршуулж, тасралтгүй ажиллуулах **алхам алхмаар** заавар.

## ⚠️ Энэ проектод хамаатай чухал зүйлс (эхлэхээс өмнө)

- **Node 22.5+ ЗААВАЛ (зөвлөмж: Node 24 LTS).** Систем DB-д Node-ийн суурилуулсан
  `node:sqlite` ашигладаг. Node 18/20 дээр **ажиллахгүй**. → NodeSource-оор `setup_24.x`.
- **Native build хэрэггүй.** `better-sqlite3` гэх native module байхгүй тул python/gcc
  суулгах шаардлагагүй — `npm install` цэвэр-JS пакет л татна.
- **3 хэсэг, 1 repo:**
  - `./` (root) = **listener** (Gmail IMAP) — `package.json`, `src/`, `scripts/`
  - `./api/` = **Express API** (өөрийн `package.json`, `.env`, DB)
  - `./dashboard/` = **React/Vite** → `npm run build` → `dist/` (API нь serve хийнэ)
- **2 .env файл:** root `./.env` (listener), `./api/.env` (API). Хоёрын
  `WEBSITE_API_KEY` ↔ `LISTENER_API_KEY` **таарах** ёстой.
- **API нь dashboard-ийг serve хийдэг** (нэг origin :3000). Тиймээс Nginx бүгдийг
  `localhost:3000` руу proxy хийхэд хангалттай.

> Доорх жишээнд: хэрэглэгч `deploy`, проект `/home/deploy/bank`, домейн
> `chini-bank.duckdns.org`. Өөрийнхөөрөө солино уу.

---

## Алхам 1: VPS анхны хамгаалалт

```bash
# root-аар SSH орсны дараа:
adduser deploy
usermod -aG sudo deploy

# SSH key-ээ шинэ хэрэглэгчид нэмэх (гэрийн машинаасаа):
#   ssh-copy-id deploy@SERVER_IP
# эсвэл гараар:
mkdir -p /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
nano /home/deploy/.ssh/authorized_keys   # public key-ээ буулгана
chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
```

**⚠️ Нууц үгийн нэвтрэлт хаахаасаа ӨМНӨ key-ээр нэвтэрч чадаж байгааг заавал тест хий**
(шинэ терминалд `ssh deploy@SERVER_IP`) — өөрийгөө түгжихгүйн тулд.

```bash
sudo nano /etc/ssh/sshd_config
#   PermitRootLogin no
#   PasswordAuthentication no
sudo systemctl restart ssh

# Firewall — зөвхөн SSH/HTTP/HTTPS. Дотоод 3000-г НЭЭХГҮЙ (Nginx-ээр л гарна).
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable

sudo apt update && sudo apt upgrade -y

# (Сонголт) SSH brute-force хамгаалалт
sudo apt install fail2ban -y
```

## Алхам 2: Node 24, pm2, Nginx, git суулгах

```bash
# Node 24 LTS (node:sqlite-д ЗААВАЛ 22.5+)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v        # v24.x байх ёстой

sudo npm install -g pm2
sudo apt install -y nginx git
```

## Алхам 3: Кодоо серверт татах

```bash
cd /home/deploy
git clone <repo-url> bank      # хувийн repo бол deploy token/key ашиглана
cd bank

# Listener (root) ба API хамаарал
npm install --omit=dev
cd api && npm install --omit=dev && cd ..

# Dashboard build (vite devDeps хэрэгтэй тул бүтэн install)
cd dashboard && npm install && npm run build && cd ..
#   → dashboard/dist/ үүснэ. API энэ dist-г static-аар serve хийнэ.

# Лог хавтас (ecosystem эндэх замыг ашиглана)
mkdir -p logs
```

> **Хувилбар:** Дашбордыг сервер дээр биш, **локалаар build хийгээд** `dashboard/dist`-ийг
> `scp`-ээр хуулж болно (сервер дээр vite суулгахгүй). Энэ нь RAM бага VPS-д хэмнэлттэй.

## Алхам 4: .env файлууд тохируулах

**`/home/deploy/bank/.env`** (listener):
```ini
GMAIL_USER=tuguldur.b307@gmail.com
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=            # Алхам 5-д авна
OAUTH_REDIRECT_URI=http://localhost:53682/oauth2callback
BANK_SENDER=alert@golomtbank.com
IMAP_MAILBOX=INBOX
WEBSITE_API_URL=http://localhost:3000/api/transactions
WEBSITE_API_KEY=<урт-санамсаргүй-түлхүүр>
DB_PATH=./data/listener.sqlite
TOKEN_REFRESH_MINUTES=50
HEARTBEAT_SECONDS=300
LOG_LEVEL=info
```

**`/home/deploy/bank/api/.env`** (API):
```ini
PORT=3000
LISTENER_API_KEY=<дээрхтэй ЯГ ИЖИЛ түлхүүр>
LISTENER_HMAC_SECRET=
DB_PATH=./data/transactions.sqlite
RATE_LIMIT_WINDOW_SECONDS=60
RATE_LIMIT_MAX=1000
BODY_LIMIT=100kb
LOG_LEVEL=info
ANTHROPIC_API_KEY=sk-ant-...     # AI ангилалд (хүчинтэй key)
ANTHROPIC_MODEL=claude-haiku-4-5
```

```bash
# Шинэ түлхүүр үүсгэх (хоёр .env-д ижлийг тавь):
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Зөвшөөрөл хязгаарлах
chmod 600 /home/deploy/bank/.env /home/deploy/bank/api/.env
```

## Алхам 5: Google refresh token авах

Сервер браузергүй тул 2 арга:

### Арга A — SSH port forwarding (зөвлөмж)
```bash
# ГЭРИЙН машинаасаа (53682-г listener-ийн redirect порт руу дамжуулна):
ssh -L 53682:localhost:53682 deploy@SERVER_IP

# Серверийн дотор:
cd /home/deploy/bank && node scripts/get-token.js
```
- Терминалд хэвлэгдсэн **Google consent URL**-г ГЭРИЙН браузертаа нээ.
- Зөвшөөрөл өг → Google `http://localhost:53682/oauth2callback?code=...` руу үсэрнэ →
  SSH туннелээр серверийн скрипт хүлээн авч **refresh_token** хэвлэнэ.

### Арга B — Manual / OOB (port forwarding ажиллахгүй бол)
```bash
cd /home/deploy/bank && node scripts/get-token.js --manual
```
- Consent URL-г гэрийн браузерт нээ. Зөвшөөрсний дараа "localhost холбогдсонгүй"
  гарна — **зүгээр**. Хаягийн мөрөн дэх БҮТЭН URL (эсвэл `code`)-г хуулж скриптэд буулга.

```bash
# Аль ч аргаар авсан token-оо .env-д тавь:
nano /home/deploy/bank/.env      # GMAIL_REFRESH_TOKEN=1//...
```

> Голомтын OAuth client нь **Desktop app** төрлийн тул loopback redirect
> (`http://localhost:53682/...`)-ийг Google автоматаар зөвшөөрнө — console-д нэмэх
> шаардлагагүй.

## Алхам 6: DuckDNS домейн

1. https://duckdns.org → Google/GitHub-аар нэвтэр → дэд домейн үүсгэ (`chini-bank`).
2. Domain-ы IP-г VPS-ийн IP болго (дашбордоос эсвэл update URL-ээр).
3. Авто-шинэчлэх cron (`crontab -e`):
```bash
*/5 * * * * curl -s "https://www.duckdns.org/update?domains=chini-bank&token=DUCKDNS_TOKEN&ip=" >/dev/null 2>&1
```

## Алхам 7: Nginx reverse proxy + HTTPS

```bash
sudo nano /etc/nginx/sites-available/bank
```
```nginx
server {
    listen 80;
    server_name chini-bank.duckdns.org;

    # API + dashboard бүгд :3000 руу (API нь dashboard/dist-г serve хийдэг)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    client_max_body_size 1m;
}
```
```bash
sudo ln -s /etc/nginx/sites-available/bank /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Let's Encrypt HTTPS (HTTP→HTTPS redirect-ийг өөрөө нэмнэ)
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d chini-bank.duckdns.org
sudo certbot renew --dry-run     # авто-шинэчлэлт ажиллаж байгааг шалга
```

> **Нэмэлт хамгаалалт (сонголт):** Dashboard нь API key-ээр хамгаалагдсан ч,
> Nginx-д `auth_basic` нэмж давхар хаалт тавьж болно.

## Алхам 8: pm2-оор асаах (listener + API)

`ecosystem.config.cjs` нь 2 процесс тодорхойлсон (listener + API), DB замыг зөв
болгохын тулд cwd-г тус бүрд тохируулсан.

```bash
cd /home/deploy/bank
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup        # хэвлэгдсэн командыг sudo-гоор ажиллуул (reboot-д авто)

pm2 status
pm2 logs bank-listener   # "✅ Gmail IMAP холбогдлоо" → IDLE-д орсныг шалга
pm2 logs bank-api        # "🚀 Bank Transactions API эхэллээ"

# HTTPS-ээр шалгах:
curl https://chini-bank.duckdns.org/health
curl -H "X-API-Key: <түлхүүр>" "https://chini-bank.duckdns.org/api/summary"
```

> Эхний удаа listener **catch-up** хийж бүх хуучин имэйлийг боловсруулна (хэдэн мянга
> бол хэдэн минут). API-ийн rate limit 1000/мин тул асуудалгүй.

## Алхам 9: Backup (заавал — санхүүгийн өгөгдөл)

```bash
chmod +x /home/deploy/bank/scripts/backup.sh
/home/deploy/bank/scripts/backup.sh    # гар аргаар нэг тест
# (sqlite3 CLI байвал WAL-safe; үгүй бол суулга: sudo apt install -y sqlite3)

crontab -e
```
```bash
# Өдөр бүр 03:00-д (хоёр DB-г backup, 30 хоногоос хуучныг устгана)
0 3 * * * /home/deploy/bank/scripts/backup.sh >> /home/deploy/bank/logs/backup.log 2>&1
```

**⚠️ Хамгийн найдвартай: backup-ийг СЕРВЕРЭЭС ГАДАГШ хуул** (сервер бүхэлдээ эвдэрвэл
өгөгдөл алдахгүй). [`scripts/backup.sh`](scripts/backup.sh)-ийн доор `rclone` (cloud)
эсвэл гэрийн машин руу `scp` хийх жишээ бий. Жишээ (гэрийн машинаас):
```bash
scp deploy@SERVER_IP:~/bank/backups/transactions-*.sqlite.gz ./local-backups/
```

## Алхам 10: Цагийн бүс + эцсийн шалгалт

```bash
sudo timedatectl set-timezone Asia/Ulaanbaatar
```
- **Огнооны practice:** Гүйлгээний `txn_date` нь имэйлээс задарсан Голомтын огноо
  (YYYY-MM-DD) шууд хадгалагдана. `created_at` нь `datetime('now')` = **UTC**.
  Энэ нь зөв practice (харуулахдаа л Монголын цаг руу хөрвүүлнэ).
- **End-to-end:** жижиг гүйлгээ хийж (эсвэл хүлээж) имэйл → listener → parse →
  categorize → API → DB → dashboard бүрэн ажиллаж байгааг шалга (`pm2 logs`, dashboard).
- **Reboot тест:**
  ```bash
  sudo reboot
  # дахин ороод:
  pm2 status        # хоёр процесс автоматаар асаж, online байх ёстой
  ```

---

## Хяналт ба засвар үйлчилгээ

```bash
# Лог эргүүлэх (диск дүүргэхээс сэргийлэх)
pm2 install pm2-logrotate

# Код шинэчлэх (deploy):
cd /home/deploy/bank && git pull
npm install --omit=dev && (cd api && npm install --omit=dev)
(cd dashboard && npm install && npm run build)   # UI өөрчлөгдсөн бол
pm2 reload all
```

- `autorestart: true` + `max_memory_restart` (ecosystem-д) — процесс унтарвал/санах ой
  ихсвэл автомат сэргэнэ.
- **Дараагийн алхам (тусдаа ажил):** listener чимээгүй унтарсныг мэдэх heartbeat
  мэдэгдэл (Telegram/имэйл) — `src/logger.js`-ийн `notifyError()`-д залгаж болно.

## Түгээмэл асуудал

| Шинж тэмдэг | Шалтгаан / шийдэл |
|---|---|
| `SqliteError` / `node:sqlite` not found | Node 22.5-аас доош → Node 24 суулга (Алхам 2) |
| Listener 1 цагийн дараа чимээгүй болов | OAuth access token дууссан — `TOKEN_REFRESH_MINUTES=50` эсэхийг шалга |
| Dashboard 401 | API key буруу — `.env` хоёрын түлхүүр таарч байгаа эсэх |
| AI санал "тодорхойгүй" | `ANTHROPIC_API_KEY` буруу/хоосон — хүчинтэй key тавь |
| Catch-up үед олон push_failed | API унтраалттай байсан — `pm2 logs bank-api`, дараа `node scripts/repush.js` |
