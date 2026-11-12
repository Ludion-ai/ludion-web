-- リンクで見せる（SHARE001）。自分だけの作品を、リンクを知っている人だけが見られる形。一覧と検索には出さない。
-- 番号：0011 と 0012 は、まだ main に入っていない別の pull request が使っているので、ぶつからないよう 0013 にした。
--
-- share_token：/s/<合言葉> の合言葉（16 バイトの乱数の base64url、22 文字）。オフのときは NULL。オフにすると捨てる。
--   持ち主が設定のタブで何度でも住所を見てコピーできるよう、値をそのまま持つ（ログインの鍵ではない。gist の secret の住所と同じ扱い）。
-- shared_at：オンにした時刻。オフのときは NULL。
-- share_blocked_at：運営が止めた時刻。止めている間は、/s/ は 404 で、持ち主はオンにできない。
-- 表は作り直さない（列を足すだけ）。今ある行は、どれもオフで、止めていない。

ALTER TABLE works ADD COLUMN share_token TEXT;
ALTER TABLE works ADD COLUMN shared_at INTEGER;
ALTER TABLE works ADD COLUMN share_blocked_at INTEGER;
CREATE UNIQUE INDEX works_share_token ON works (share_token) WHERE share_token IS NOT NULL;
