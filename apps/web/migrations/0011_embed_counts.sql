-- 埋め込みの数（EMBED001「6」）。閲覧数とコピー数とは別の数で、足さない。作品ごと、日ごと（UTC）の数だけを持つ。
-- embed_views：埋め込みの枠（/frame/<id>/<version>/embed.html）を返した回数。embed_copies：作品のページの「埋め込みのコードをコピー」を押してコピーした回数。
-- 人の情報は持たない（IP、UA、埋め込み先を持たない。CLAUDE.md 原則6）。
ALTER TABLE counters ADD COLUMN embed_views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE counters ADD COLUMN embed_copies INTEGER NOT NULL DEFAULT 0;
