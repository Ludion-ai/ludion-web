// 文書の作品（DOC001）：文書をそのまま動かす枠と、コピーされるコード。
import { expect, test } from '@playwright/test';
import { DPR_SCRIPT, FRAME_CSP, LOADED_SCRIPT, STORAGE_SCRIPT, ALLOW_MOTION_SCRIPT, buildCopySnippet, buildDocumentFrameHtml, buildDocumentSnippet, doctypeEnd, isHtmlDocument, stripDocumentCredits } from '../src/index.ts';
import type { Creator, Work } from '../src/index.ts';

const DOC = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>Ripple</title>
<style>body { margin: 0; background: #123; }</style>
</head>
<body>
<button id="b">Press</button>
<script>
document.getElementById('b').addEventListener('click', () => document.body.dataset.pressed = '1');
</script>
</body>
</html>
`;

const INSERT = `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}"><script>${STORAGE_SCRIPT}</script><script>${DPR_SCRIPT}${LOADED_SCRIPT}</script>`;

test.describe('文書の形か', () => {
  test('<!doctype と <html で始まるものだけ。頭の空白、BOM、コメントは飛ばす', () => {
    expect(isHtmlDocument(DOC)).toBe(true);
    expect(isHtmlDocument('<html><body>x</body></html>')).toBe(true);
    expect(isHtmlDocument('﻿  <!-- a -->\n<!DOCTYPE html><p>x')).toBe(true);
    expect(isHtmlDocument('<div data-ld-part="x"></div>')).toBe(false);
    expect(isHtmlDocument('<head></head>')).toBe(false);
    expect(isHtmlDocument('<htmlx>')).toBe(false);
    expect(isHtmlDocument('')).toBe(false);
  });

  test('doctype の終わり', () => {
    expect(doctypeEnd(DOC)).toBe('<!doctype html>'.length);
    expect(doctypeEnd('<!-- c --><!DOCTYPE html >\n<p>')).toBe('<!-- c --><!DOCTYPE html >'.length);
    expect(doctypeEnd('<html></html>')).toBeNull();
    expect(doctypeEnd('<!-- 閉じない <!doctype html>')).toBeNull();
  });
});

test.describe('枠', () => {
  test('文書は1文字も変えず、doctype の直後にサイトのスクリプトだけを差し込む', () => {
    const frame = buildDocumentFrameHtml(DOC);
    expect(frame).toBe(`<!doctype html>${INSERT}${DOC.slice('<!doctype html>'.length)}`);
    expect(frame.replace(INSERT, '')).toBe(DOC);
  });

  test('doctype がなければ頭に。「動きを見る」はスクリプトだけを足す（文書の CSS は書き換えない）', () => {
    const doc = '<html><head><style>@media (prefers-reduced-motion: reduce) { * { animation: none } }</style></head><body></body></html>';
    expect(buildDocumentFrameHtml(doc)).toBe(`${INSERT}${doc}`);
    expect(buildDocumentFrameHtml(doc, { motion: true })).toBe(`${INSERT}<script>${ALLOW_MOTION_SCRIPT}</script>${doc}`);
  });

  test('ブラウザで、差し込んだスクリプトが文書のどのスクリプトよりも先に動き、標準モードのまま', async ({ page }) => {
    const doc = `<!doctype html><html><head><script>window.__order = [typeof window.__ldFirst, document.compatMode]</script></head><body></body></html>`;
    // 差し込んだものの頭に印を足す（試しのためだけ）
    const frame = buildDocumentFrameHtml(doc).replace('<script>', '<script>window.__ldFirst=1;</script><script>');
    await page.setContent(frame);
    expect(await page.evaluate(() => (window as unknown as { __order: unknown[] }).__order)).toEqual(['number', 'CSS1Compat']);
  });
});

test.describe('コピーされるコード', () => {
  const creator: Creator = { handle: 'Maker', name: 'Maker', kind: 'person', x_url: null, site_url: null };
  const work: Work = { meta: { id: 'ripple-ab12', creator: 'maker' } as Work['meta'], html: '', css: '', js: null, document: DOC };

  test('クレジット行は doctype の直後。リミックスは次の行に元の作品', () => {
    const credit = '<!-- UI by @Maker — ludion.ai/p/ripple-ab12 (MIT) -->';
    expect(buildCopySnippet(work, creator)).toBe(`<!doctype html>\n${credit}${DOC.slice('<!doctype html>'.length)}`);
    const remix = buildCopySnippet(work, creator, { handle: 'orig', id: 'first-one' });
    expect(remix.split('\n').slice(0, 3)).toEqual(['<!doctype html>', credit, '<!-- Remix of UI by @orig — ludion.ai/p/first-one (MIT) -->']);
  });

  test('doctype がなければ1行目', () => {
    expect(buildDocumentSnippet('<html></html>', 'a', 'b-c')).toBe('<!-- UI by @a — ludion.ai/p/b-c (MIT) -->\n<html></html>');
  });

  test('取ったコードを送り直しても、クレジット行は重ならない（外すと元に戻る）', () => {
    const once = buildCopySnippet(work, creator, { handle: 'orig', id: 'first-one' });
    expect(stripDocumentCredits(once)).toBe(DOC);
    expect(stripDocumentCredits(buildCopySnippet({ ...work, document: stripDocumentCredits(once) }, creator))).toBe(DOC);
    expect(stripDocumentCredits(buildDocumentSnippet('<html></html>', 'a', 'b-c'))).toBe('<html></html>');
    // クレジット行のない文書は変えない。途中のコメントも変えない
    const plain = '<!doctype html><!-- my note --><html></html>';
    expect(stripDocumentCredits(plain)).toBe(plain);
    expect(stripDocumentCredits(DOC)).toBe(DOC);
  });
});
