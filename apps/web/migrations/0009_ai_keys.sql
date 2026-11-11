-- AI の鍵（docs/tasks/T037.md「1」、CLAUDE.md 原則6）。AI が本人の代わりに作品を置くための鍵。
-- 鍵の生の値は持たない。持つのは SHA-256 のハッシュ、名前、持ち主、作った日時、最後に使った日（UTC の日）、消した日時だけ。
-- 消した鍵は deleted_at を入れて残す（一覧から消え、使うと 401）。退会したら行ごと消す（worker/account.ts）。
CREATE TABLE ai_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  deleted_at INTEGER
);
CREATE INDEX ai_keys_user ON ai_keys (user_id);
