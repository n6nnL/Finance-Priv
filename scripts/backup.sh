#!/usr/bin/env bash
# ============================================================
#  scripts/backup.sh — SQLite DB-уудыг өдөр бүр backup хийх (VPS, Linux)
#
#  Хоёр DB-г backup хийнэ:
#    - data/listener.sqlite        (lastSeenUid, processed message_id)
#    - api/data/transactions.sqlite (гүйлгээ + override — ХАМГИЙН ЧУХАЛ)
#
#  WAL горимд тууштай (consistent) хувилбар авахын тулд `.backup`-ийг
#  ашиглана (sqlite3 байвал). Байхгүй бол энгийн cp (WAL checkpoint-той).
#
#  Cron жишээ (өдөр бүр 03:00, Монголын цагаар):
#    0 3 * * * /home/deploy/bank/scripts/backup.sh >> /home/deploy/bank/logs/backup.log 2>&1
# ============================================================
set -euo pipefail

# Проектын үндсэн хавтас (энэ скриптийн эцэг хавтас)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"   # хэдэн хоног хадгалах
STAMP="$(date +%F_%H%M)"

mkdir -p "$BACKUP_DIR"

backup_one() {
  local src="$1" name="$2"
  [ -f "$src" ] || { echo "[backup] алгассан (байхгүй): $src"; return 0; }
  local dest="$BACKUP_DIR/${name}-${STAMP}.sqlite"
  if command -v sqlite3 >/dev/null 2>&1; then
    # WAL-safe тууштай хувилбар
    sqlite3 "$src" ".backup '$dest'"
  else
    cp "$src" "$dest"
  fi
  gzip -f "$dest"
  echo "[backup] OK: ${dest}.gz"
}

backup_one "$ROOT/api/data/transactions.sqlite" "transactions"
backup_one "$ROOT/data/listener.sqlite" "listener"

# Хуучин backup-уудыг цэвэрлэх (KEEP_DAYS-ээс хуучин)
find "$BACKUP_DIR" -name '*.sqlite.gz' -type f -mtime +"$KEEP_DAYS" -delete
echo "[backup] $(date +%F_%T) дууслаа. $KEEP_DAYS хоногоос хуучныг устгав."

# ⚠️ ХАМГИЙН НАЙДВАРТАЙ: backup-ийг СЕРВЕРЭЭС ГАДАГШ хуул.
# Жишээ (rclone тохируулсан бол cloud руу):
#   rclone copy "$BACKUP_DIR" remote:bank-backups --max-age 25h
# Эсвэл гэрийн машинаас татах:
#   scp deploy@server:~/bank/backups/transactions-*.sqlite.gz ./local-backups/
