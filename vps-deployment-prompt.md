# Prompt: VPS Deployment — банкны гүйлгээ бүртгэгч системийг 24/7 ажиллуулах

## Зорилго

Голомт банкны гүйлгээ бүртгэгч системийг (listener + API + dashboard + SQLite) шинэ VPS дээр байршуулж, тасралтгүй 24/7 ажиллуулах. Алхам алхмаар, командуудтайгаар заавар гарга. Хэрэглэгч SSH/Линукс мэддэг.

## Орчны таамаглал
- **VPS:** Ubuntu 24.04 LTS, 1GB+ RAM (Vultr/DigitalOcean Сингапур санал болгосон)
- **Домейн:** DuckDNS үнэгүй дэд домейн (жишээ: `chini-bank.duckdns.org`)
- **DB:** SQLite (файл-суурьтай)
- **Процесс:** listener (байнгын) + API (Express) + dashboard (статик build эсвэл API-аас serve)

---

## Алхам 1: VPS анхны хамгаалалт

1. Root-аар SSH холбогдох, шинэ sudo хэрэглэгч үүсгэх (root-оор шууд ажиллахгүй):
   ```bash
   adduser deploy
   usermod -aG sudo deploy
   ```
2. SSH key-ийг шинэ хэрэглэгчид нэмэх (нууц үгийн нэвтрэлт хаахаас өмнө заавал тест хий).
3. SSH хатууруулах (`/etc/ssh/sshd_config`):
   - `PermitRootLogin no`
   - `PasswordAuthentication no` (зөвхөн key)
   - SSH service restart.
4. Firewall (ufw):
   ```bash
   ufw allow OpenSSH
   ufw allow 80
   ufw allow 443
   ufw enable
   ```
   (API/dashboard-ийн дотоод портыг (3000 г.м) ufw-д НЭЭХГҮЙ — Nginx-ээр л гадагшаа гаргана.)
5. OS шинэчлэх: `apt update && apt upgrade -y`.
6. (Сонголт) `fail2ban` суулгаж SSH brute-force-оос хамгаалах.

## Алхам 2: Node.js, pm2, Nginx суулгах

1. Node.js LTS суулгах (nvm эсвэл NodeSource).
2. pm2 глобал суулгах: `npm install -g pm2`.
3. Nginx суулгах: `apt install nginx -y`.
4. Git суулгах (кодоо татах): `apt install git -y`.

## Алхам 3: Кодоо серверт татах

1. Кодоо Git repo-оос clone хийх (эсвэл `scp`-ээр хуулах). Хувийн repo бол deploy key/token ашиглах.
2. listener болон API хавтсуудад `npm install --production`.
3. Dashboard (React/Vite) -ийг build хийх: `npm run build` → статик файл гарна.

## Алхам 4: Орчны хувьсагч (.env) тохируулах

1. listener болон API-ийн `.env` файлуудыг серверт үүсгэх (git-д ОРОХГҮЙ).
2. Бүх нууц утга:
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `GMAIL_REFRESH_TOKEN` — Алхам 5-д авна
   - `BANK_SENDER=alert@golomtbank.com`
   - `WEBSITE_API_URL` (одоо серверийн дотоод хаяг, жишээ: `http://localhost:3000/api/transactions`)
   - `LISTENER_API_KEY` / `WEBSITE_API_KEY` (хоёр тал таарсан)
   - `ANTHROPIC_API_KEY` (AI ангилалд)
3. `.env` файлын зөвшөөрлийг хязгаарлах: `chmod 600 .env`.

## Алхам 5: Google refresh token авах (SSH port forwarding)

Сервер браузергүй тул `get-token.js`-ийн localhost redirect-ийг SSH-ээр гэрийн браузерт дамжуулна:

1. Гэрийн компьютероос SSH-ээр холбогдохдоо порт дамжуулах:
   ```bash
   ssh -L 3000:localhost:3000 deploy@server-ip
   ```
2. Серверт `node scripts/get-token.js` ажиллуул (3000 порт сонсоно).
3. **Гэрийн компьютерынхаа браузераас** `http://localhost:3000` нээх — энэ нь SSH туннелээр серверийн скрипт рүү холбогдоно.
4. Google зөвшөөрөл өгөх → серверийн терминалд `refresh_token` хэвлэгдэнэ.
5. Token-оо серверийн `.env`-д `GMAIL_REFRESH_TOKEN=...` болгож хадгал.

> Хэрэв port forwarding-д асуудал гарвал: get-token.js-ийг "out-of-band" (manual copy-paste code) хувилбар руу өөрчлөх асуудлыг тайлбарла.

## Алхам 6: DuckDNS домейн + DNS

1. DuckDNS (duckdns.org) дээр Google/GitHub-аар нэвтэрч, дэд домейн үүсгэх (жишээ: `chini-bank`).
2. Домейний IP-г VPS-ийн IP-д тохируулах (DuckDNS дашбордоос эсвэл update URL-ээр).
3. DuckDNS-ийн авто-шинэчлэх cron job нэмэх (IP өөрчлөгдвөл шинэчлэх — VPS-д IP тогтмол ч найдвартай байх):
   ```bash
   # crontab -e
   */5 * * * * curl "https://www.duckdns.org/update?domains=chini-bank&token=DUCKDNS_TOKEN&ip="
   ```

## Алхам 7: Nginx reverse proxy + HTTPS

1. Nginx тохиргоо: `chini-bank.duckdns.org` → дотоод API (localhost:3000) руу proxy.
   - API маршрут (`/api/...`) → Express backend.
   - Dashboard статик файл → Nginx шууд serve (эсвэл API-аас).
2. Let's Encrypt HTTPS (certbot):
   ```bash
   apt install certbot python3-certbot-nginx -y
   certbot --nginx -d chini-bank.duckdns.org
   ```
3. Certbot авто-шинэчлэлт ажиллаж байгааг шалгах (`certbot renew --dry-run`).
4. HTTP → HTTPS автомат redirect тохируулах.

## Алхам 8: pm2-оор процесс асаах

1. `ecosystem.config.cjs`-д хоёр процесс тодорхойлох: listener, API.
2. Асаах:
   ```bash
   pm2 start ecosystem.config.cjs
   pm2 save
   pm2 startup   # сервер reboot хийхэд автомат асаах
   ```
3. Log шалгах: `pm2 logs`. Listener Gmail-д холбогдож, IDLE горимд орсныг баталгаажуул.
4. API HTTPS-ээр ажиллаж байгааг шалгах (`curl https://chini-bank.duckdns.org/api/...`).

## Алхам 9: Backup (заавал — санхүүгийн өгөгдөл)

1. SQLite DB-г өдөр бүр backup хийх cron job:
   ```bash
   # өдөр бүр 03:00-д DB-г хувилах
   0 3 * * * cp /path/to/db.sqlite /path/to/backups/db-$(date +\%F).sqlite
   ```
2. Хуучин backup-уудыг автоматаар цэвэрлэх (жишээ: 30 хоногоос хуучныг устгах).
3. (Хүчтэй санал) Backup-ийг сервероос гадагш хуулах (өөр газар: rclone-оор cloud руу, эсвэл гэрийн компьютерт `scp`). Сервер бүхэлдээ эвдэрвэл өгөгдөл алдахгүй.

## Алхам 10: Цагийн бүс ба эцсийн шалгалт

1. Серверийн цагийн бүсийг шалгах. Огноо/цагийн логик (Монголын цаг, +08) зөв ажиллахыг баталгаажуул:
   ```bash
   timedatectl set-timezone Asia/Ulaanbaatar
   ```
   (эсвэл аппликейшн дотор цагийн бүсийг тооцох — DB-д UTC хадгалах нь зөв practice.)
2. End-to-end шалгалт: жижиг гүйлгээ хийж (эсвэл хүлээж), имэйл → listener → parse → categorize → API → DB → dashboard бүрэн ажиллаж байгааг баталгаажуул.
3. Reboot тест: серверийг reboot хийж, pm2 процессууд автоматаар сэргэж байгааг шалгах.

---

## Хяналт (нэмэлт, чухал)

- pm2-д процесс унтарвал автомат restart (ecosystem-д `autorestart: true`, `max_memory_restart`).
- (Сонголт) pm2 log-ийг тогтмол эргүүлэх (`pm2-logrotate`) — диск дүүргэхээс сэргийлэх.
- (Дараагийн алхам) Listener чимээгүй унтарсныг мэдэх heartbeat/мэдэгдэл — энэ нь тусдаа ажил, дараа хийж болно.

## Чухал тэмдэглэл агентад
- Алхам бүрийг ДАРААЛЛААР, командуудтайгаар тодорхой бич.
- Аюулгүй байдлын алхмыг (SSH key, firewall, HTTPS, .env chmod) алгасахгүй — санхүүгийн өгөгдөл тул чухал.
- Нууц утга (token, key) -г log/командын түүхэнд үлдээхээс болгоомжлох.
- SSH нууц үгийн нэвтрэлт хаахаас ӨМНӨ key-ээр нэвтрэлт ажиллаж байгааг заавал тест хийхийг сануул (өөрийгөө түгжихгүйн тулд).
- Backup-ийг сервероос гадагш хуулах нь хамгийн найдвартай гэдгийг онцол.
- DB-д цагийг UTC хадгалж, харуулахдаа Монголын цаг руу хөрвүүлэх нь зөв practice.
