-- アカウントの土台（docs/tasks/T020.md「1」、SEC001 B2）。
-- users.id を変わらない本人の鍵にし、ログインの手段を identities に分ける。GitHub の id と login は人の鍵にしない。
-- 名前やメールの一致で、別の手段を同じ人にしない。
-- 時刻（*_at）は UNIX 時間のミリ秒。sessions の created_at と last_used_at は日の単位に丸める（UTC の0時）。

-- ログインの手段。1人につき、同じ手段は1つまで
-- subject：その手段の中の変わらない番号（GitHub は数字の id）
-- label：手段の一覧に出す名前（GitHub は login）
-- avatar_url：その手段から来たアバター。users.avatar_url の元
CREATE TABLE identities (
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'google')),
  subject TEXT NOT NULL,
  label TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE UNIQUE INDEX identities_user_provider ON identities (user_id, provider);

INSERT INTO identities (user_id, provider, subject, label, avatar_url, created_at, last_used_at)
SELECT u.id, 'github', CAST(u.github_id AS TEXT), u.login, u.avatar_url, u.created_at,
  COALESCE((SELECT MAX(s.expires_at) - 2592000000 FROM sessions s WHERE s.user_id = u.id), u.created_at)
FROM users u;

-- handle は英小文字、数字、_ で3〜20文字。小文字だけを入れるので、ふつうの UNIQUE で大文字と小文字を区別せずに一意になる
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE CHECK (length(handle) BETWEEN 3 AND 20 AND handle NOT GLOB '*[^a-z0-9_]*'),
  display_name TEXT,
  avatar_url TEXT,
  x_url TEXT,
  site_url TEXT,
  created_at INTEGER NOT NULL
);

-- 今の人の handle は GitHub の login を小文字にしたもの。GitHub の login に使える「-」は「_」に替え、長いものは切る。
-- 取れない言葉と、ほかの人の作者の handle には「_user」を付ける。
-- CEO（GitHub の Ludion-ai）だけは、login によらず作者の handle を取る（下の creators の UPDATE）。人と作者の handle が同じときだけ、
-- プロフィールと handle の変更が作者に写るため（worker/account.ts）。
-- 重なったら番号を付ける。それでも形に合わなければ CHECK で止まり、この migration は丸ごと入らない
INSERT INTO users_new (id, handle, display_name, avatar_url, created_at)
WITH wanted AS (
  SELECT id, github_id, name, avatar_url, created_at,
    CASE WHEN github_id = 292738933 THEN 'lattice_node' ELSE substr(replace(lower(login), '-', '_'), 1, 20) END AS base
  FROM users
),
cleared AS (
  SELECT id, name, avatar_url, created_at,
    CASE
      WHEN length(base) < 3
        OR base IN ('admin', 'api', 'auth', 'account', 'apply', 'ludion', 'saved', 'search', 'about', 'privacy', 'settings', 'frame', 'login', 'logout', 'signup', 'files', 'assets')
        OR base LIKE '%ludion%'
        OR (github_id <> 292738933 AND EXISTS (SELECT 1 FROM creators c WHERE lower(c.handle) = base))
      THEN substr(base, 1, 15) || '_user'
      ELSE base
    END AS handle
  FROM wanted
),
ranked AS (
  SELECT id, name, avatar_url, created_at, handle, ROW_NUMBER() OVER (PARTITION BY handle ORDER BY created_at, id) AS n FROM cleared
)
SELECT id, CASE WHEN n = 1 THEN handle ELSE substr(handle, 1, 17) || '_' || n END, name, avatar_url, created_at FROM ranked;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- 作者と人を結ぶ。CEO を作者 Lattice_Node に。結ぶ鍵は GitHub の数字の id（login は変えられて、後から別の人が取れる）。
-- 292738933 は GitHub の Ludion-ai（11/9 に CEO が決定）。
UPDATE creators
SET user_id = (SELECT i.user_id FROM identities i WHERE i.provider = 'github' AND i.subject = '292738933')
WHERE handle = 'Lattice_Node' COLLATE NOCASE AND user_id IS NULL;
CREATE INDEX creators_user ON creators (user_id);

-- 結ばれた人のアカウントのページには、公開している作者の名前とリンクを出す（GitHub の名前を作り手のページへ出さないため）
UPDATE users SET
  display_name = (SELECT c.name FROM creators c WHERE c.user_id = users.id AND c.handle = users.handle COLLATE NOCASE),
  x_url = (SELECT c.x_url FROM creators c WHERE c.user_id = users.id AND c.handle = users.handle COLLATE NOCASE),
  site_url = (SELECT c.site_url FROM creators c WHERE c.user_id = users.id AND c.handle = users.handle COLLATE NOCASE)
WHERE EXISTS (SELECT 1 FROM creators c WHERE c.user_id = users.id AND c.handle = users.handle COLLATE NOCASE);

-- 前の handle。released_at を過ぎるまで、ほかの人が取れない。/c/前の handle は新しい方へ転送する
CREATE TABLE handle_history (
  handle TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  released_at INTEGER NOT NULL
);
CREATE INDEX handle_history_user ON handle_history (user_id);

-- セッション。IP と UA は持たない（CLAUDE.md 原則6）。
-- auth_at：ログインした時刻。直近10分以内のログインを確かめるためだけに使う。今のセッションは 0（もう一度ログインを求める）
ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN last_used_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN auth_at INTEGER NOT NULL DEFAULT 0;
UPDATE sessions SET created_at = ((expires_at - 2592000000) / 86400000) * 86400000;
UPDATE sessions SET last_used_at = created_at;
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);
