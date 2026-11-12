-- AI につなぐ（OAUTH002）。リフレッシュのトークンの再使用（OAuth 2.1 の 4.3.1）。
-- ひとつ前のリフレッシュのトークンのハッシュと、替えた時刻。ひとつ前のトークンがまた来たら、
-- 替えてから30秒以内なら invalid_grant だけ（同時に2本の更新を送る AI のため）、30秒より後なら、そのつながりを消す。
-- 生の値は持たない（ハッシュだけ。worker/oauth.ts）。
ALTER TABLE oauth_grants ADD COLUMN prev_refresh_hash TEXT;
ALTER TABLE oauth_grants ADD COLUMN refresh_rotated_at INTEGER;
CREATE INDEX oauth_grants_prev_refresh ON oauth_grants (prev_refresh_hash);
