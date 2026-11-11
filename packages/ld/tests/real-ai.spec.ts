// 本物の確かめ（docs/tasks/T033.md「終わりの条件」）。文脈を渡していない別の AI のセッションに、指示文だけを渡して作らせた HTML を、
// 手を入れずに箱と同じ処理（分ける → 直す → 必須の検査）に通す。ファイルは fixtures/t033-real（docs/reports/T033.md に作り方）。
import { expect, test } from '@playwright/test';
import { checkSubmission, fixParts, splitSnippet } from '@ludion/rules';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '../../../fixtures/t033-real');
const box = (file: string, id: string, tags: string[]) => {
  const split = splitSnippet(readFileSync(join(DIR, file), 'utf8'));
  if (!split.ok) return { error: split.error };
  const { parts } = fixParts(split.parts, id);
  return checkSubmission({ id, type: 'component', tags, ...parts });
};

for (const n of [1, 2, 3]) {
  test(`リミックス ${n}（住人のいるスイッチ、雪の夜の山小屋に）：必須 0 件`, () => {
    // /new?from=toggle-daylight は、元の種類とタグ（experimental、motion）を先に入れる
    expect(box(`remix-${n}.html`, 'toggle-daylight-a1b2', ['experimental', 'motion'])).toMatchObject({ required: [] });
  });
  test(`直す ${n}（波紋のボタン）：直した HTML は必須 0 件。直す前の HTML は落ちる`, () => {
    expect(box(`fixed-${n}.html`, 'ripple-a1b2', [])).toMatchObject({ required: [] });
    const before = box(`naive-${n}.html`, 'ripple-a1b2', []);
    expect('required' in before && before.required.length).toBeGreaterThan(0);
  });
}
