# CLAUDE.md — project notes for Claude Code sessions

Golomt bank санхүүгийн систем: **listener (`src/`) + API (`api/`) + dashboard (`dashboard/`) + Discord bot (`discord/`)**, нэг repo, SQLite (`node:sqlite`, Node 24 ЗААВАЛ). API нь `dashboard/dist`-г static serve хийдэг (нэг origin `:3000`, Nginx-ийн ард).

## Deploy / server state

Серверийн мэдээлэл болон redeploy алхмууд нь repo-д баримтжсан (шинэ чат алдахгүй):

- **Runbook (process, нууцгүй):** [`deploy/DEPLOY_RUNBOOK.md`](deploy/DEPLOY_RUNBOOK.md)
- **Бодит утга (gitignored):** `deploy/.deploy.local.env` — host/user/SSH key/path/domain. `source` хийж ашиглана.
- **Анхны суулгац:** [`DEPLOYMENT.md`](DEPLOYMENT.md). PM2 процессууд: [`ecosystem.config.cjs`](ecosystem.config.cjs).

Богино: dashboard өөрчлөгдвөл `dist`-г build+scp (pm2 reload хэрэггүй); listener/API код өөрчлөгдвөл push → серверт `git pull` + `pm2 reload all` (өмнө DB backup хий — API restart дээр идемпотент миграц ажиллана).

## Нууцлал

Repo нь **public байсан**. Нууц утга (`.env`, `*.pem`, `credentials.json`, `*.local.env`, DB) ХЭЗЭЭ Ч commit хийхгүй — `.gitignore`-оор хамгаалагдсан. Шинэ нууц файл нэмбэл эхлээд `git check-ignore`-оор шалга.
