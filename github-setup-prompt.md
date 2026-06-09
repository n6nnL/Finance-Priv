# Prompt: Төслийг GitHub-д аюулгүй оруулах

## Контекст

Голомт банкны гүйлгээ бүртгэгч систем (listener + API + dashboard + node:sqlite + deployment файлууд) бэлэн. Үүнийг GitHub-д **private repo**-д оруулна. Төсөл нь санхүүгийн нууц мэдээлэлтэй холбоотой тул нууц файлууд (token, key, DB) хэзээ ч GitHub-д орохгүй байх нь ХАМГИЙН чухал.

## Хэрэглэгчийн оролцоо зайлшгүй (агент хийж чадахгүй)

Эдгээрийг хэрэглэгч өөрөө хийнэ, агент зөвхөн зааварчилна:
1. **GitHub дээр private repo үүсгэх** — github.com → New repository → нэр өгөх → **Private сонгох** → README/gitignore/license НЭМЭХГҮЙ (хоосон үүсгэх) → Create.
2. **Authentication** — push хийхэд GitHub нэвтрэлт. PAT (Personal Access Token) эсвэл SSH key. Хэрэглэгч тохируулна.

Агент эдгээрийн дараа эхэлнэ. Repo-ийн URL-ийг хэрэглэгчээс авна.

## Гүйцэтгэх дүрэм (чухал)

- Нууц утга/файлыг хэзээ ч commit, log, эсвэл командын гаралтад харуулахгүй.
- **Push хийхээс ӨМНӨ** нууц файл staging-д ороогүйг заавал шалгана (доорх Алхам 3).
- Алхам бүрийг командтайгаар тодорхой бич.

## Алхам 1: .gitignore бэлдэх (хамгийн чухал)

Төслийн root-д `.gitignore` үүсгэх/шинэчлэх. Дараах зүйлс заавал багтсан байх:

```gitignore
# Нууц утга — ХЭЗЭЭ Ч оруулахгүй
.env
.env.*
!.env.example
*.pem

# Өгөгдлийн сан — бодит гүйлгээний түүх
*.sqlite
*.sqlite-shm
*.sqlite-wal
*.db

# Backup файлууд
backups/
*.sqlite.gz

# Token/нууц гаралт
**/transactions-export.json
**/descriptions-summary.csv

# Node
node_modules/
npm-debug.log*

# Build гаралт
dist/
build/

# OS/editor
.DS_Store
*.log
.vscode/
.idea/
```

- Хэрэв олон дэд хавтас (listener, api, dashboard) тус бүр `.env`, `node_modules`-той бол, root `.gitignore` бүгдийг хамрах эсэхийг шалгах.

## Алхам 2: .env.example бэлдэх (нууцгүй загвар)

- Нууц `.env`-ийг оруулахгүй ч, **бүтцийг** харуулах `.env.example` файл үүсгэ (бодит утгагүй, placeholder-той):
  ```
  GOOGLE_CLIENT_ID=
  GOOGLE_CLIENT_SECRET=
  GMAIL_REFRESH_TOKEN=
  BANK_SENDER=alert@golomtbank.com
  WEBSITE_API_URL=
  LISTENER_API_KEY=
  ANTHROPIC_API_KEY=
  ```
- Энэ нь дараа (өөр төхөөрөмж/сервер) setup хийхэд тус болно, нууц утга агуулахгүй.

## Алхам 3: Нууц файл байхгүйг ШАЛГАХ (push-ээс өмнө заавал)

git init хийсний дараа, commit хийхээс өмнө:
1. `git status`-аар staging-д юу орохыг харах.
2. **Дараах файлууд жагсаалтад БАЙХ ЁСГҮЙ:** `.env` (бүх хувилбар), `*.pem`, `*.sqlite`, backup файлууд, `transactions-export.json`, `descriptions-summary.csv`.
3. Хэрэв нэг ч нууц файл харагдвал → `.gitignore`-оо засаж, дахин шалгах. Commit ХИЙХГҮЙ.
4. Баталгаажуулах нэмэлт команд:
   ```bash
   git status --ignored   # ignore хийгдсэн файлуудыг харах (нууц файлууд энд байх ёстой)
   ```
   Нууц файлууд "ignored" жагсаалтад байвал зөв.

## Алхам 4: Git init + commit

1. `git init` (хэрэв аль хэдийн repo биш бол).
2. `git add .`
3. **Дахин шалгах:** `git status`-аар нууц файл staging-д ороогүйг баталгаажуул (Алхам 3 давтах).
4. Эхний commit: `git commit -m "Initial commit: bank transaction tracker"`.

## Алхам 5: Remote нэмэх + push

1. Хэрэглэгчээс repo URL авах (жишээ: `git@github.com:user/bank-tracker.git` эсвэл `https://github.com/user/bank-tracker.git`).
2. Remote нэмэх: `git remote add origin <URL>`.
3. Branch нэр: `git branch -M main`.
4. Push: `git push -u origin main`.
5. Хэрэв authentication алдаа гарвал (PAT/SSH) → хэрэглэгчид тохиргоог зааварчил.

## Алхам 6: Push-ийн дараа баталгаажуулах

1. Хэрэглэгчид GitHub repo хуудсаа нээж шалгахыг сануул: нууц файл (`.env`, `.pem`, `.sqlite`) **байхгүй** эсэхийг нүдээр баталгаажуул.
2. Хэрэв санамсаргүй нууц файл орсон бол → **яаралтай**: тэр файлыг устгах, git history-гээс цэвэрлэх (`git rm --cached`), мөн алдагдсан нууц утгыг (token/key) **дахин үүсгэх** (нэг удаа push болсон нууц утга найдваргүй болсон гэж үзэх).

## Дараагийн давуу тал (тэмдэглэл)

GitHub-д орсны дараа VPS deployment хялбар болно:
- Серверт `git clone <repo>` -оор код татах.
- Код шинэчлэхэд серверт `git pull` (scp шаардлагагүй).
- `.env`, DB зэрэг нь git-д үгүй тул серверт тусад нь тохируулна (аль хэдийн төлөвлөсөн).

## Чухал тэмдэглэл агентад
- `.gitignore` бүрэн, зөв эсэхийг хамгийн түрүүнд баталгаажуул — энэ нь бүх хамгаалалтын үндэс.
- Push-ээс өмнө нууц файл байхгүйг 2 удаа шалга (git add-ийн өмнө ба дараа).
- Нууц утгыг log/гаралтад харуулахгүй.
- Repo private гэдгийг хэрэглэгч баталгаажуулсан эсэхийг асуу.
- Санамсаргүй нууц файл орвол яаж цэвэрлэх, дахин үүсгэхийг тодорхой зааварчил.
