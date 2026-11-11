// 終わりの条件（docs/tasks/T033.md）：main の works/ の全作品について、「コピーされるコード」を分けたものが、checkSubmission の必須 0 件になる。
import { expect, test } from '@playwright/test';
import { buildCopySnippet, type Creator, type Work } from '@ludion/render';
import { checkSubmission, fixParts, splitSnippet } from '@ludion/rules';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '../../..');
const WORKS = join(REPO, 'works');
const read = (path: string) => readFileSync(path, 'utf8');

function loadWork(id: string): { work: Work; creator: Creator } {
  const dir = join(WORKS, id);
  const meta = JSON.parse(read(join(dir, 'meta.json'))) as Work['meta'];
  const js = existsSync(join(dir, 'part.js')) ? read(join(dir, 'part.js')) : null;
  const creator = JSON.parse(read(join(REPO, 'creators', meta.creator, 'creator.json'))) as Creator;
  return { work: { meta, html: read(join(dir, 'part.html')), css: read(join(dir, 'part.css')), js }, creator };
}

const workIds = readdirSync(WORKS).filter((name: string) => existsSync(join(WORKS, name, 'meta.json')));

test.describe('works/ の全作品', () => {
  test('作品がある', () => {
    expect(workIds.length).toBeGreaterThan(0);
  });

  for (const id of workIds) {
    for (const remix of [false, true]) {
      test(`${id}${remix ? '（リミックスの2行のクレジット）' : ''}：コピーされるコードを分けると、必須の検査が0件`, () => {
        const { work, creator } = loadWork(id);
        const snippet = buildCopySnippet(work, creator, remix ? { handle: 'someone', id: 'other-work' } : null);
        const split = splitSnippet(snippet);
        expect(split.ok).toBe(true);
        if (!split.ok) return;
        // 分けたままで（直さずに）通る。ID も変えない
        expect(fixParts(split.parts, id).notes).toEqual([]);
        const result = checkSubmission({ id, type: work.meta.type, tags: work.meta.tags, ...split.parts });
        expect(result.required).toEqual([]);
        // クレジット行は外れる
        expect(split.parts.html).not.toContain(`ludion.ai/p/${id} (MIT)`);
        expect(split.parts.html).not.toMatch(/^<!--/);
        expect(split.parts.css).not.toMatch(/^\/\*[^*]*UI by @/);
        // CSS はそのまま。JS は mount の呼び出しが外れ、mount を export している
        // 作品のコードの中にあった元のクレジット行（リミックス）も、頭にあれば外れる
        expect(work.css.trim().endsWith(split.parts.css)).toBe(true);
        expect(split.parts.js === null).toBe(!work.js || work.js.trim() === '');
        if (split.parts.js !== null) {
          expect(split.parts.js).toMatch(/^\s*export\s+(?:async\s+)?function\s+mount\b/m);
          expect(split.parts.js).not.toContain(`mount(document.querySelector('[data-ld-part="${id}"]'));`);
        }
      });
    }
  }
});

