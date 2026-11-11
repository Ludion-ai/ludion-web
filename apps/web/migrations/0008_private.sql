-- 自分だけの作品（docs/tasks/T036.md）。本人だけが見られ、審査しない。公開するときに審査する（CLAUDE.md 原則5）。
-- works.status と revisions.status に 'private' を足す。SQLite は CHECK を ALTER で変えられないので、表を作り直す。
-- 列と値は変えない。今ある行の状態もそのまま。
--
-- works.status の private：本人だけ。一覧、検索、作り手のページ、sitemap、数、公開の枠と画像は、どこも status = 'approved' だけを読むので、
-- 足すだけで出なくなる（閉じる側に倒れる）。works の題、版、サムネイルは、本人に見せる今の版の値。
-- revisions.status の private：自分だけで置いた版（審査していない）。公開の道（approvedPrefix）は approved の版だけを返すので、
-- 後で作品を公開しても、この版の URL は公開されない。

CREATE TABLE works_new (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('screen','component')),
  platform TEXT CHECK (platform IN ('web','mobile')),
  category TEXT NOT NULL,
  subtype TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  made_with TEXT NOT NULL CHECK (made_with IN ('human','ai-assisted')),
  version TEXT NOT NULL, license TEXT NOT NULL DEFAULT 'MIT',
  status TEXT NOT NULL CHECK (status IN ('draft','submitted','approved','rejected','private')),
  tokens_locked TEXT NOT NULL DEFAULT '[]', pin_order INTEGER, reject_reason TEXT,
  thumb_key TEXT NOT NULL, thumb_w INTEGER NOT NULL, thumb_h INTEGER NOT NULL,
  created_at INTEGER NOT NULL, published_at INTEGER,
  is_remix INTEGER NOT NULL DEFAULT 0,
  remix_of TEXT
);
INSERT INTO works_new (id, creator_id, title, type, platform, category, subtype, tags, made_with, version, license, status, tokens_locked, pin_order, reject_reason, thumb_key, thumb_w, thumb_h, created_at, published_at, is_remix, remix_of)
SELECT id, creator_id, title, type, platform, category, subtype, tags, made_with, version, license, status, tokens_locked, pin_order, reject_reason, thumb_key, thumb_w, thumb_h, created_at, published_at, is_remix, remix_of FROM works;
DROP TABLE works;
ALTER TABLE works_new RENAME TO works;
CREATE INDEX works_status ON works (status);
CREATE INDEX works_creator ON works (creator_id);

CREATE TABLE revisions_new (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'revoked', 'private')),
  r2_prefix TEXT NOT NULL,
  content_hash TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('screen', 'component')),
  platform TEXT CHECK (platform IN ('web', 'mobile')),
  category TEXT NOT NULL,
  subtype TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  made_with TEXT NOT NULL CHECK (made_with IN ('human', 'ai-assisted')),
  thumb_w INTEGER NOT NULL,
  thumb_h INTEGER NOT NULL,
  tokens_ok INTEGER NOT NULL DEFAULT 0,
  reject_code TEXT,
  reject_note TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  submitted_at INTEGER,
  reviewed_at INTEGER,
  reviewed_by TEXT,
  is_remix INTEGER NOT NULL DEFAULT 0,
  remix_of TEXT,
  UNIQUE (work_id, version)
);
-- rowid も写す。版の並び（created_at が同じときの rowid）を変えないため
INSERT INTO revisions_new (rowid, id, work_id, version, status, r2_prefix, content_hash, title, type, platform, category, subtype, tags, made_with, thumb_w, thumb_h, tokens_ok, reject_code, reject_note, created_by, created_at, updated_at, submitted_at, reviewed_at, reviewed_by, is_remix, remix_of)
SELECT rowid, id, work_id, version, status, r2_prefix, content_hash, title, type, platform, category, subtype, tags, made_with, thumb_w, thumb_h, tokens_ok, reject_code, reject_note, created_by, created_at, updated_at, submitted_at, reviewed_at, reviewed_by, is_remix, remix_of FROM revisions;
DROP TABLE revisions;
ALTER TABLE revisions_new RENAME TO revisions;
CREATE UNIQUE INDEX revisions_one_open ON revisions (work_id) WHERE status IN ('draft', 'submitted');
CREATE INDEX revisions_queue ON revisions (status, submitted_at);
