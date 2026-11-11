-- ログインの途中の状態（docs/tasks/T020.md「6」「7」、SEC001 B2-7）。
-- ブラウザの cookie には乱数だけを渡し、中身はここに置く。1回だけ使え、短い時間で切れる。
-- token_hash：cookie の乱数のハッシュ。data：JSON（Google の state、nonce、PKCE の verifier、新しい人の Google の sub など）
CREATE TABLE auth_flows (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_flows_expires ON auth_flows (expires_at);
