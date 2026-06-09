# Prompt: VPS анхны setup (AWS EC2) — code agent гүйцэтгэх

## Контекст

AWS EC2 instance бэлэн (Ubuntu 24.04, t2.micro, 1GB RAM). Голомт банкны гүйлгээ бүртгэгч системийг (listener + API + dashboard + node:sqlite) энд байршуулна. Төслийн root-д аль хэдийн `DEPLOYMENT.md`, шинэчилсэн `ecosystem.config.cjs` (2 процесс), `scripts/get-token.js` (--manual OOB горимтой), `scripts/backup.sh` бэлэн байгаа.

**Сервер мэдээлэл:**
- Public IP: `54.253.54.63`
- SSH хэрэглэгч: `ubuntu`
- Key: `~/.ssh/bank-key.pem` (chmod 400 хийсэн байх)
- SSH команд: `ssh -i ~/.ssh/bank-key.pem ubuntu@54.253.54.63`

**Чухал онцлог:**
- `node:sqlite` ашигладаг тул **Node 24+ ЗААВАЛ** (Node 18/20 ажиллахгүй).
- 1GB RAM тул dashboard build хийхэд санах ой дүүрч магадгүй → **swap файл нэмэх** эсвэл build-ийг локалд хийж хуулах.

## Гүйцэтгэх дүрэм (чухал)

1. **Нууц утгуудыг агент ОРУУЛАХГҮЙ.** `GOOGLE_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `LISTENER_API_KEY`, `ANTHROPIC_API_KEY` зэрэг нууц утга оруулах алхамд агент `.env`-ийн БҮТЦИЙГ бэлдэж, бодит утгыг **хэрэглэгч өөрөө оруулна** гэж тодорхой зааварчил. Нууц утгыг log/командын түүхэнд хэвлэхгүй.
2. **SSH key-ээр нэвтрэлт ажиллаж байгааг баталгаажуулахаас өмнө нууц үгийн нэвтрэлтийг ХААХГҮЙ.** Энэ алхамд хэрэглэгчид анхааруулж, тестлэхийг сануул (өөрийгөө сервероос түгжихгүйн тулд).
3. Алхам бүрийг ДАРААЛЛААР, copy-paste командтайгаар гүйцэтгэ. Аль алхамд хэрэглэгчийн оролцоо/баталгаажуулалт хэрэгтэйг тодорхой хэл.
4. `DEPLOYMENT.md` дотор аль хэдийн заавар байгаа бол түүнтэй уялд, давхардуулахгүй.

## Гүйцэтгэх алхмууд

### Алхам 0: Урьдчилсан шалгалт
- `.pem` файл `~/.ssh/`-д, `chmod 400`-той эсэхийг шалгах.
- Төслийн `.gitignore`-д `*.pem`, `.env`, `*.sqlite` байгаа эсэхийг шалгах. Байхгүй бол нэмэх.
- SSH-ээр серверт холбогдож чадаж байгааг тест (`ssh -i ~/.ssh/bank-key.pem ubuntu@54.253.54.63 "echo connected"`).

### Алхам 1: Серверийн анхны хамгаалалт
- OS шинэчлэх: `sudo apt update && sudo apt upgrade -y`.
- **Swap файл нэмэх (1GB RAM тул чухал):** 2GB swap үүсгэх (build болон ажиллагаанд):
  ```bash
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```
- Firewall (ufw): SSH, 80, 443 нээх; дотоод порт (3000) НЭЭХГҮЙ.
  ```bash
  sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
  ```
- **AWS Security Group сануулга:** ufw-ээс гадна AWS Console дээр Security Group-д 80, 443 нээх шаардлагатайг хэрэглэгчид сануул (AWS-ийн firewall давхар бий). SSH (22) аль хэдийн нээлттэй байх.
- (Сонголт) `fail2ban` суулгах.
- SSH хатууруулах (`PasswordAuthentication no` гэх мэт) — гэхдээ key нэвтрэлт ажилласныг баталгаажуулсны ДАРАА. AWS EC2 нь анхнаасаа key-only тул энэ ихэвчлэн аль хэдийн тохируулагдсан; шалгаад баталгаажуул.

### Алхам 2: Node 24 + pm2 + Nginx + git
- **Node 24 суулгах (ЗААВАЛ — node:sqlite шаардана):**
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt install -y nodejs
  node -v   # v24.x баталгаажуул
  ```
- pm2 глобал: `sudo npm install -g pm2`.
- Nginx: `sudo apt install -y nginx`.
- git: `sudo apt install -y git`.

### Алхам 3: Код татах
- Кодыг Git-ээс clone (хувийн repo бол deploy token/key) эсвэл `scp`-ээр хуулах.
- listener + API хэсэгт `npm install --production`.
- **Dashboard build:** 1GB RAM тул build санах ой дүүргэж магадгүй. Swap байгаа тул оролдоод, амжилтгүй бол хэрэглэгчид "локалд build хийж `dist/`-ийг scp-ээр хуул" гэж зөвлө.

### Алхам 4: .env тохируулах (хэрэглэгчтэй)
- listener болон API-ийн `.env` файлуудын **бүтцийг** үүсгэ (хувьсагчийн нэрсээр, утгагүй эсвэл placeholder-той).
- Хэрэглэгчид аль хувьсагчид ямар утга (Google Cloud-аас, өмнө авсан key) оруулахыг тодорхой жагсаа.
- `chmod 600 .env` хийх.
- **Нууц утгыг агент оруулахгүй** — хэрэглэгч өөрөө бөглөнө.

### Алхам 5: Refresh token (хэрэглэгчтэй, SSH tunnel)
- `DEPLOYMENT.md`-ийн дагуу: SSH tunnel (`ssh -L 53682:localhost:53682 ...`) эсвэл `--manual` OOB горим.
- Хэрэглэгч Google зөвшөөрөл өгч token авах хэсгийг агент хийж чадахгүй — тодорхой зааварчил, хүлээ.
- Token-оо хэрэглэгч `.env`-д хадгална.

### Алхам 6-7: DuckDNS + Nginx + HTTPS
- DuckDNS дэд домейн (хэрэглэгч үүсгэнэ, token авна) → IP `54.253.54.63`-д заах.
- Nginx reverse proxy: домейн → localhost:3000 (API нь dashboard-ийг serve хийдэг).
- certbot HTTPS: `sudo certbot --nginx -d <domain>.duckdns.org`.
- HTTP→HTTPS redirect, certbot авто-renew тест.

### Алхам 8: pm2 асаах
- `pm2 start ecosystem.config.cjs` (2 процесс: bank-listener, bank-api).
- `pm2 save && pm2 startup` (reboot хийхэд автомат асаах).
- `pm2 logs`-оор listener Gmail-д холбогдсон, IDLE орсныг баталгаажуул.

### Алхам 9: Backup
- `scripts/backup.sh`-г cron-д нэмэх (өдөр бүр).
- Сервероос гадагш хуулах хэсгийг (rclone/scp) тохируулахыг хэрэглэгчид зөвлө.

### Алхам 10: Эцсийн шалгалт
- Цагийн бүс: `sudo timedatectl set-timezone Asia/Ulaanbaatar` (эсвэл DB UTC practice баталгаажуулах).
- End-to-end: имэйл → listener → parse → categorize → API → DB → dashboard (HTTPS-ээр).
- Reboot тест: `sudo reboot`, дараа pm2 процесс автомат сэргэсэн эсэхийг шалгах.

## Гүйцэтгэлийн дараа тайлан
- Аль алхам дууссан, аль нь хэрэглэгчийн оролцоо хүлээж байгаа.
- Сервер дээр юу ажиллаж байгаа (Node version, pm2 процессууд, Nginx, HTTPS статус).
- Дараа хийх зүйл (token оруулах, DuckDNS, backup гадагш хуулах).

## Чухал тэмдэглэл агентад
- Нууц утгыг хэзээ ч агент оруулахгүй, log-д хэвлэхгүй — хэрэглэгчид үлдээж зааварчил.
- SSH нууц үг хаахаас өмнө key нэвтрэлт тестлэхийг заавал сануул.
- AWS Security Group (80/443) -г ufw-ээс тусад нь нээх шаардлагатайг сануул.
- Node 24 заавал — суулгасны дараа `node -v`-ээр баталгаажуул.
- 1GB RAM тул swap нэмэх, build санах ойн асуудалд бэлэн бай.
- Алхам бүрийг дараалуулж, хэрэглэгчийн оролцоо хэрэгтэй цэгүүдийг тодорхой тэмдэглэ.
