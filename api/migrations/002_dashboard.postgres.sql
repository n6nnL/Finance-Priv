-- ============================================================
--  002_dashboard.postgres.sql — Dashboard + AI өргөтгөл (PostgreSQL)
-- ============================================================

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'classified';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS ai_suggested_category TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS ai_confidence TEXT;

CREATE INDEX IF NOT EXISTS idx_txn_status ON transactions (status);

CREATE TABLE IF NOT EXISTS category_overrides (
  id               BIGSERIAL PRIMARY KEY,
  merchant_pattern TEXT NOT NULL UNIQUE,
  category         TEXT NOT NULL,
  friendly_name    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE category_overrides ADD COLUMN IF NOT EXISTS friendly_name TEXT;
