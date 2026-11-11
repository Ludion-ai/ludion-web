-- SPEC.md「7. データ」の表（D1 ludion-app）。表の形は SPEC.md の SQL をそのまま写す。
-- 時刻（*_at）は UNIX 時間のミリ秒。

CREATE TABLE users (id TEXT PRIMARY KEY, github_id INTEGER UNIQUE NOT NULL, login TEXT NOT NULL, name TEXT, avatar_url TEXT, created_at INTEGER NOT NULL);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE creators (id TEXT PRIMARY KEY, handle TEXT UNIQUE NOT NULL, name TEXT, kind TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person','label')), avatar_url TEXT, x_url TEXT, site_url TEXT, user_id TEXT, created_at INTEGER NOT NULL); -- kind：label は運営のレーベル（CLAUDE.md 原則10）。handle は大文字と小文字を区別せずに一意
CREATE TABLE works (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('screen','component')),
  platform TEXT CHECK (platform IN ('web','mobile')),
  category TEXT NOT NULL,      -- カードの2行目の左（Web、Mobile、Dashboard、Ecommerce、Components）
  subtype TEXT NOT NULL,       -- カードの2行目の右（Landing Page、Travel、Analytics、UI Kit など）
  tags TEXT NOT NULL DEFAULT '[]', -- JSON。dashboard、ecommerce、minimal、experimental
  made_with TEXT NOT NULL CHECK (made_with IN ('human','ai-assisted')), -- 作り方（CLAUDE.md 原則9）
  version TEXT NOT NULL, license TEXT NOT NULL DEFAULT 'MIT',
  status TEXT NOT NULL CHECK (status IN ('draft','submitted','approved','rejected')),
  tokens_locked TEXT NOT NULL DEFAULT '[]', pin_order INTEGER, reject_reason TEXT,
  thumb_key TEXT NOT NULL, thumb_w INTEGER NOT NULL, thumb_h INTEGER NOT NULL,
  created_at INTEGER NOT NULL, published_at INTEGER
);
CREATE TABLE counters (work_id TEXT, day TEXT, views INTEGER NOT NULL DEFAULT 0, copies INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (work_id, day));
CREATE TABLE likes (user_id TEXT, work_id TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, work_id));
CREATE TABLE bookmarks (user_id TEXT, work_id TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, work_id));
CREATE TABLE applications (id TEXT PRIMARY KEY, handle TEXT, urls TEXT, note TEXT, status TEXT, created_at INTEGER);
CREATE TABLE invites (token_hash TEXT PRIMARY KEY, creator_id TEXT, expires_at INTEGER, used_at INTEGER);

-- handle は大文字と小文字を区別せずに一意（上の creators の注のとおり。UNIQUE だけでは区別してしまうため）
CREATE UNIQUE INDEX creators_handle_nocase ON creators (handle COLLATE NOCASE);
-- ホームの一覧（承認済み）と作り手のページ（T005、T006）で引く
CREATE INDEX works_status ON works (status);
CREATE INDEX works_creator ON works (creator_id);
