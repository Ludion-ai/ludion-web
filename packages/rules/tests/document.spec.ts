// 文書の作品（DOC001）：どちらの形で置くか（htmlForm）と、文書の検査（checkDocument）。
import { expect, test } from '@playwright/test';
import { htmlForm } from '../src/split.ts';
import { MAX_DOCUMENT_BYTES, checkDocument } from '../src/submission.ts';

const wrap = (body: string) => `<!doctype html>\n<html><head><title>t</title></head><body>\n${body}\n</body></html>\n`;
const ROOT = '<div data-ld-part="x"><button type="button">押す</button></div>\n<style>[data-ld-part="x"] button { color: red; }</style>';
const MOUNT = `<script type="module">
function mount(root) { const b = root.querySelector('button'); const f = () => {}; b.addEventListener('click', f); return () => b.removeEventListener('click', f); }
mount(document.querySelector('[data-ld-part="x"]'));
</script>`;

test.describe('どちらの形で置くか', () => {
  test('ふつうの文書は文書の作品', () => {
    expect(htmlForm(wrap('<button id="b">押す</button>\n<style>body { margin: 0 }</style>\n<script>document.getElementById("b").onclick = () => {}</script>'))).toBe('document');
    expect(htmlForm('<html><body><canvas></canvas></body></html>')).toBe('document');
  });

  test('作者が書いた契約の形（根と mount、または根だけで JS なし）を文書で包んだものは、今までどおり契約の形', () => {
    expect(htmlForm(wrap(`${ROOT}\n${MOUNT}`))).toBe('contract');
    expect(htmlForm(wrap(ROOT))).toBe('contract');
  });

  test('根はあるが mount がない、根がない、スクリプトが2つ、外のスクリプト：文書の作品', () => {
    expect(htmlForm(wrap(`${ROOT}\n<script>document.querySelector('button').onclick = () => {}</script>`))).toBe('document');
    expect(htmlForm(wrap('<div><button>押す</button></div>'))).toBe('document');
    expect(htmlForm(wrap(`${ROOT}\n<script>1</script>\n<script>2</script>`))).toBe('document');
    expect(htmlForm(wrap(`${ROOT}\n<script src="https://cdn.example/x.js"></script>`))).toBe('document');
  });

  test('断片は、いつも契約の形（今までどおり）', () => {
    expect(htmlForm(`${ROOT}\n${MOUNT}`)).toBe('contract');
    expect(htmlForm('<div><style>body{}</style></div>')).toBe('contract');
    expect(htmlForm('<head><title>x</title></head><body><p>x</p></body>')).toBe('contract');
  });
});

test.describe('文書の検査', () => {
  test('大きさと読める文字だけを見る。外への通信や document は見ない', () => {
    expect(checkDocument(wrap('<script src="https://cdn.example/x.js"></script><img src="https://x.example/a.png">'))).toEqual([]);
    expect(checkDocument('')).toHaveLength(1);
    expect(checkDocument(wrap('a\u0000b'))).toHaveLength(1);
    expect(checkDocument(wrap('\ud800'))).toHaveLength(1);
    expect(checkDocument(wrap('😀'))).toEqual([]);
    const big = wrap('x'.repeat(MAX_DOCUMENT_BYTES));
    expect(checkDocument(big).map((p) => p.en?.message)).toEqual([expect.stringContaining('over the 768KB limit')]);
    expect(checkDocument(wrap('x'.repeat(MAX_DOCUMENT_BYTES - 200)))).toEqual([]);
  });
});
