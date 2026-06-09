-- ============================================================
--  002_dashboard.sqlite.sql — Dashboard + AI ангилалд зориулсан өргөтгөл
--  ⚠️ Одоо байгаа 1000+ мөрийг алдагдуулахгүй (ADD COLUMN + DEFAULT).
--  db.js нь эдгээрийг ИДЕМПОТЕНТ-оор хэрэгжүүлдэг (багана байвал алгасна).
-- ============================================================

-- transactions хүснэгтэд шинэ багана
ALTER TABLE transactions ADD COLUMN status TEXT NOT NULL DEFAULT 'classified';
ALTER TABLE transactions ADD COLUMN ai_suggested_category TEXT;
ALTER TABLE transactions ADD COLUMN ai_confidence TEXT;  -- 'low' | 'medium' | 'high'

CREATE INDEX IF NOT EXISTS idx_txn_status ON transactions (status);

-- Сурсан override-ууд (хэрэглэгчийн баталгаажуулсан мерчант → ангилал)
CREATE TABLE IF NOT EXISTS category_overrides (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_pattern TEXT NOT NULL UNIQUE,   -- нормчилсон мерчант хэв (UPPER, terminal-кодгүй)
  category         TEXT NOT NULL,
  friendly_name    TEXT,                   -- газрын танигдсан нэр (жишээ: "Шулуун дун")
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Хуучин category_overrides-д friendly_name идемпотент нэмэх (db.js хийдэг):
-- ALTER TABLE category_overrides ADD COLUMN friendly_name TEXT;
