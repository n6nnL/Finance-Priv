-- ============================================================
--  001_init.postgres.sql — transactions хүснэгт (PostgreSQL)
--  Production-д Postgres ашиглавал энэ файлыг psql-ээр ажиллуулна:
--    psql "$DATABASE_URL" -f migrations/001_init.postgres.sql
--  (db.js-г Postgres драйвер (pg) ашиглахаар адаптацлах хэрэгтэй —
--   README-д тэмдэглэв.)
-- ============================================================

CREATE TABLE IF NOT EXISTS transactions (
  id            BIGSERIAL PRIMARY KEY,
  message_id    TEXT NOT NULL UNIQUE,
  amount        NUMERIC(18,2) NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'MNT',
  txn_date      DATE,
  description   TEXT,
  type          TEXT CHECK (type IN ('expense','income')),
  category      TEXT,
  account_last4 TEXT,
  raw           TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions (txn_date);
CREATE INDEX IF NOT EXISTS idx_txn_category ON transactions (category);
