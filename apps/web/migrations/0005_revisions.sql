-- 作品の版と、公開前の審査（docs/tasks/T021.md、SEC001 A04、A07、B1-1、B1-6）。
-- 時刻（*_at）は UNIX 時間のミリ秒。

-- 版。公開した版は変えられない。直すと新しい版になり、もう一度審査する。
-- status：draft（下書き）→ submitted（審査待ち）→ approved（公開）／rejected（差し戻し）→ revoked（取り下げ）
-- version：枠とサムネイルの URL に入る数字の文字列。作品の中で一意
-- r2_prefix：この版のファイルの置き場。サーバーが作る（送られてきた値を使わない）。ld upload の版は works/<id>/<version>、投稿の版は revisions/<版の id>/<中身のハッシュの頭>
-- content_hash：中身のハッシュ。審査で見たものと承認するものを結ぶ。今までの版は空
-- tokens_ok：10個のトークンに合っているか。データだけで、今は印を出さない（docs/tasks/T021.md「2」）
-- created_by：投稿した人。ld upload の版は NULL
CREATE TABLE revisions (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'revoked')),
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
  UNIQUE (work_id, version)
);
-- 1つの作品で、直している最中の版（下書きか審査待ち）は1つまで。同時に送られても、片方だけが通る
CREATE UNIQUE INDEX revisions_one_open ON revisions (work_id) WHERE status IN ('draft', 'submitted');
-- 審査待ちの一覧を古い順に読む
CREATE INDEX revisions_queue ON revisions (status, submitted_at);

-- 今ある作品の今の版を移す。取り下げた作品（works の rejected）は revoked にする。前の版は D1 に記録がないので移さない
INSERT INTO revisions (id, work_id, version, status, r2_prefix, title, type, platform, category, subtype, tags, made_with, thumb_w, thumb_h, created_at, updated_at)
SELECT lower(hex(randomblob(16))), id, version, CASE status WHEN 'rejected' THEN 'revoked' ELSE status END,
  'works/' || id || '/' || version, title, type, platform, category, subtype, tags, made_with, thumb_w, thumb_h, created_at, created_at
FROM works;

-- 運営の印。審査の API と画面は、この印の人だけ
ALTER TABLE users ADD COLUMN is_operator INTEGER NOT NULL DEFAULT 0;
UPDATE users SET is_operator = 1 WHERE id IN (SELECT user_id FROM creators WHERE handle = 'Lattice_Node' COLLATE NOCASE AND user_id IS NOT NULL);

-- 回数の上限（worker/quota.ts）。束縛（wrangler.jsonc の ratelimits）は1分までしか数えられないので、1時間と1日はここで数える。
-- key：何を誰について数えるか。人は users.id、IP は秘密の値と日付で作った HMAC（生の IP は置かない。CLAUDE.md 原則6）
-- expires_at を過ぎた行は消す
CREATE TABLE quotas (
  key TEXT NOT NULL,
  bucket TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (key, bucket)
);
CREATE INDEX quotas_expires ON quotas (expires_at);
