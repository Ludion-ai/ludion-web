-- パスキーと回復のコード（docs/tasks/T020.md「7」、SEC001 B2-2、B2-4、B2-8）。
-- 持つのは公開鍵とその情報だけ。秘密鍵と生体の情報はサーバーに来ない。
-- credential_id と public_key は base64url。transports は JSON。label は本人が付ける名前（任意）。
-- last_used_at：作っただけで使っていなければ NULL
CREATE TABLE passkeys (
  credential_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  label TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX passkeys_user ON passkeys (user_id);

-- 回復のコード。ハッシュだけを持つ。1人に1つ。使ったら消える
CREATE TABLE recovery_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
