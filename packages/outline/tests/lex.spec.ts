// 字句の分け方を、構文の木を作る acorn と突き合わせる（試験だけで使う）。
// 作品と見本の全部の JS で、コメント、文字列、テンプレート、正規表現の範囲が同じなら、技術の見分けで「コメントと文字列の中」を間違えない。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import * as acorn from 'acorn';
import { lex } from '../src/lex.ts';

const ROOT = join(import.meta.dirname, '../../..');

/** 作品と見本の JS：part.js と、文書の中の script（type なしか module） */
function scripts(): { name: string; text: string; start: number; end: number; module: boolean }[] {
  const out: { name: string; text: string; start: number; end: number; module: boolean }[] = [];
  for (const root of ['works', 'fixtures/works', 'fixtures/malicious', 'fixtures/documents', 'fixtures/t033-real']) {
    const base = join(ROOT, root);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      const path = join(base, name);
      const files = statSync(path).isDirectory() ? ['part.js', 'index.html'].map((file) => join(path, file)).filter(existsSync) : name.endsWith('.html') ? [path] : [];
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        if (file.endsWith('.js')) {
          out.push({ name: `${root}/${name}`, text, start: 0, end: text.length, module: true });
          continue;
        }
        for (const m of text.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
          const attrs = m[1] ?? '';
          if (/\bsrc=/.test(attrs) || (/\btype=/.test(attrs) && !/type=["']?module/.test(attrs))) continue;
          const start = m.index + m[0].indexOf('>') + 1;
          out.push({ name: `${root}/${name}`, text, start, end: start + m[2].length, module: /module/.test(attrs) });
        }
      }
    }
  }
  return out;
}

type Range = [number, number];

/** acorn の木から、いちばん外のテンプレート、その外の文字列と正規表現、テンプレートの外のコメント */
function oracle(text: string, start: number, end: number, module: boolean): { literals: Range[]; comments: Range[] } {
  const source = text.slice(start, end);
  const comments: Range[] = [];
  const options = { ecmaVersion: 'latest' as const, sourceType: module ? ('module' as const) : ('script' as const), allowHashBang: true, onComment: (_block: boolean, _text: string, s: number, e: number) => comments.push([s + start, e + start]) };
  const ast = acorn.parse(source, options);
  const literals: Range[] = [];
  const templates: Range[] = [];
  const walk = (node: unknown, inTemplate: boolean) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, inTemplate);
      return;
    }
    const n = node as { type?: string; start?: number; end?: number; value?: unknown; regex?: unknown };
    let inner = inTemplate;
    if (n.type === 'TemplateLiteral') {
      if (!inTemplate) templates.push([n.start! + start, n.end! + start]);
      inner = true;
    } else if (n.type === 'Literal' && !inTemplate && (typeof n.value === 'string' || n.regex)) {
      literals.push([n.start! + start, n.end! + start]);
    }
    for (const [key, value] of Object.entries(n)) if (key !== 'loc' && value && typeof value === 'object') walk(value, inner);
  };
  walk(ast, false);
  const inside = (r: Range) => templates.some(([s, e]) => r[0] > s && r[1] <= e);
  return { literals: [...literals, ...templates].sort((a, b) => a[0] - b[0]), comments: comments.filter((r) => !inside(r)) };
}

test('作品と見本の全部の JS で、コメント、文字列、テンプレート、正規表現の範囲が acorn と同じ', () => {
  const all = scripts();
  expect(all.length).toBeGreaterThan(40);
  for (const { name, text, start, end, module } of all) {
    const expected = oracle(text, start, end, module);
    const { sig, comments } = lex(text, start, end);
    const literals = sig.filter((t) => t.type === 'string' || t.type === 'template' || t.type === 'regex').map((t): Range => [t.start, t.end]);
    expect(literals, `${name}：文字列`).toEqual(expected.literals);
    expect(comments.map((t): Range => [t.start, t.end]), `${name}：コメント`).toEqual(expected.comments);
    // 括弧はすべて閉じる
    expect(sig.filter((t) => t.type === 'punct' && (t.value === '(' || t.value === '[' || t.value === '{') && t.match < 0).length, `${name}：括弧`).toBe(0);
  }
});

test('割り算と正規表現、テンプレートの入れ子、?. と数字', () => {
  const text = 'const a = b / c / d; const r = /x\\/y[/]z/g; const t = `a${`b${c}`}d`; x = y?.5:0; if (ok) /re/.test(s); z = (w) / 2;';
  const kinds = lex(text).sig.map((t) => (t.type === 'punct' ? t.value : t.type));
  expect(kinds.filter((k) => k === 'regex')).toHaveLength(2);
  expect(kinds.filter((k) => k === 'template')).toHaveLength(1);
  expect(kinds).toContain('?');
});
