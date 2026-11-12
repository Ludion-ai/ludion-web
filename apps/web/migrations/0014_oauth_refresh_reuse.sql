-- AI につなぐ（OAUTH002）。OAuth 2.1 の細部。
-- 1. 許可の求めに redirect_uri があったか。あったなら、トークンの口で同じ値を必ず求める（無いときは invalid_grant）。
--    この列ができる前に出た証（10分で切れる）は 0 で、今までどおり省いてよい。
-- 2. ひとつ前のリフレッシュのトークンのハッシュと、替えた時刻。ひとつ前のトークンがまた来たら、
--    替えてから30秒以内なら invalid_grant だけ（同時に2本の更新を送る AI のため）、30秒より後なら、そのつながりを消す。
--    生の値は持たない（ハッシュだけ。worker/oauth.ts）。
ALTER TABLE oauth_codes ADD COLUMN redirect_uri_sent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE oauth_grants ADD COLUMN prev_refresh_hash TEXT;
ALTER TABLE oauth_grants ADD COLUMN refresh_rotated_at INTEGER;
CREATE INDEX oauth_grants_prev_refresh ON oauth_grants (prev_refresh_hash);
