-- AI につなぐ（MCP001）。AI（Claude、ChatGPT、Claude Code など）が、Ludion の MCP サーバー（/mcp）を OAuth でつなぐ。
-- トークンの生の値は持たない。持つのは SHA-256 のハッシュだけ（AI の鍵と同じ考え。worker/oauth.ts）。
-- 切ったら（oauth_grants の行を消したら）、アクセスのトークンもリフレッシュのトークンも、その場で使えなくなる。

-- 動的なクライアントの登録（RFC 7591）。AI のアプリの名前と戻り先。人の情報ではない。秘密を求めたクライアントだけ、秘密のハッシュを持つ
CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  secret_hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX oauth_clients_created ON oauth_clients (created_at);

-- 「許可」を押した後の、1回だけ使える短い証（10分）。PKCE の S256 の値と戻り先に結ぶ
CREATE TABLE oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX oauth_codes_user ON oauth_codes (user_id);

-- つないでいる AI（アカウントの「AI につなぐ」の一覧）。1行が1つのつながり。トークンはハッシュだけ。
-- 持つもの：持ち主、クライアントとその名前、トークンのハッシュと切れる時刻、つないだ日時、最後に使った日（UTC の日）。退会したら消す
CREATE TABLE oauth_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  access_hash TEXT NOT NULL UNIQUE,
  access_expires_at INTEGER NOT NULL,
  refresh_hash TEXT NOT NULL UNIQUE,
  refresh_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX oauth_grants_user ON oauth_grants (user_id);

-- その版を、どの AI から置いたか（自分の置き場の小さな印）。画面から置いた版は NULL。持ち主にだけ見せ、公開の HTML と API には出さない
ALTER TABLE revisions ADD COLUMN via TEXT;
