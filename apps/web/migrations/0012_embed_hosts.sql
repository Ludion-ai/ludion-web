-- 埋め込み先のホスト名（EMBED001「6」の [CEO]。CLAUDE.md 原則6に1行足す）。作品ごと、日ごと（UTC）、ホスト名ごとの数だけを持つ。
-- ホスト名は、埋め込んだページの参照元（document.referrer。/e/<id> の要求の Referer と同じ値）のホスト名だけ。道筋、URL の値、IP、UA は持たない。
-- 1日の行の数は、埋め込みの1日の上限（worker/quotaLimits.ts の EMBED_LIMITS）より増えない。
CREATE TABLE embed_hosts (
  work_id TEXT NOT NULL,
  day TEXT NOT NULL,
  host TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (work_id, day, host)
);
