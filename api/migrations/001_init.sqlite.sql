-- ============================================================
--  001_init.sqlite.sql — transactions хүснэгт (SQLite / node:sqlite)
-- ============================================================

CREATE TABLE IF NOT EXISTS transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id    TEXT NOT NULL UNIQUE,                 -- идэмпотентность түлхүүр
  amount        REAL NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'MNT',
  txn_date      TEXT,                                 -- ISO огноо (YYYY-MM-DD)
  description   TEXT,
  type          TEXT CHECK (type IN ('expense','income')),
  category      TEXT,
  account_last4 TEXT,
  raw           TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions (txn_date);
CREATE INDEX IF NOT EXISTS idx_txn_category ON transactions (category);
