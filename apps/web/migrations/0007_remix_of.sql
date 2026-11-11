-- リミックスの元（docs/tasks/T033.md B3）。元の作品の ID。リミックスでなければ NULL。
-- 作品を作るときに決まり、後から変えない。直した版は、作品の remix_of を引き継ぐ。元の作品が後で取り下げられても、リミックスは残す。
ALTER TABLE works ADD COLUMN remix_of TEXT;
ALTER TABLE revisions ADD COLUMN remix_of TEXT;

-- 今ある9つのリミックス（ld upload で上げたもの）。各作品の part.html の1行目のクレジット行
-- （<!-- UI by @Lattice_Node — ludion.ai/p/toggle-daylight (MIT) -->）から元を読んだ。9つとも toggle-daylight。作品のファイルは変えない
UPDATE works SET remix_of = 'toggle-daylight', is_remix = 1
WHERE id IN ('toggle-deep-sea', 'toggle-lighthouse', 'toggle-oasis', 'toggle-rainy-cafe', 'toggle-sakura-shrine', 'toggle-snow-cabin', 'toggle-station', 'toggle-tokyo-alley', 'toggle-volcano-island');
UPDATE revisions SET remix_of = 'toggle-daylight', is_remix = 1
WHERE work_id IN ('toggle-deep-sea', 'toggle-lighthouse', 'toggle-oasis', 'toggle-rainy-cafe', 'toggle-sakura-shrine', 'toggle-snow-cabin', 'toggle-station', 'toggle-tokyo-alley', 'toggle-volcano-island');
