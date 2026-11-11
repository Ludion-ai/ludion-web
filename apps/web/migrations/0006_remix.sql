-- コードに Remix by / Remixed by がある作品の印。一覧の帯に使う。
-- 既定は 0。今までの作品と、列を書かない INSERT はそのまま。
ALTER TABLE works ADD COLUMN is_remix INTEGER NOT NULL DEFAULT 0;
ALTER TABLE revisions ADD COLUMN is_remix INTEGER NOT NULL DEFAULT 0;
