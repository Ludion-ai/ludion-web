// 1つの版から地図を作る（WS002）。

import { Collector } from './collect.ts';
import { analyzeCss } from './css.ts';
import { analyzeHtml } from './html.ts';
import { analyzeJs } from './js.ts';
import { LineIndex, countLines, utf8Bytes } from './text.ts';
import { OUTLINE_VERSION, type Language, type LanguageBytes, type Outline, type OutlineFile, type OutlineInput, type Section, type SectionKind } from './types.ts';

/** 同じ範囲の分け目の並び（外にある方を先に） */
const KIND_ORDER: Record<SectionKind, number> = { style: 0, script: 0, heading: 1, settings: 2, function: 3, shader: 4, asset: 5 };

/** 深さ：同じファイルの中で、その分け目を囲む分け目の数 */
function nest(sections: Section[], fileOrder: Map<string, number>): Section[] {
  const sorted = [...sections].sort(
    (a, b) => fileOrder.get(a.file)! - fileOrder.get(b.file)! || a.start - b.start || b.end - a.end || KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  );
  let stack: Section[] = [];
  let file = '';
  for (const section of sorted) {
    if (section.file !== file) {
      stack = [];
      file = section.file;
    }
    while (stack.length > 0 && stack[stack.length - 1].end < section.start) stack.pop();
    let depth = 0;
    for (const outer of stack) if (outer.end >= section.end) depth++;
    section.depth = depth;
    stack.push(section);
  }
  return sorted;
}

export function buildOutline(input: OutlineInput): Outline {
  const col = new Collector();
  const files: OutlineFile[] = [];
  const texts: { name: string; text: string; language: Language }[] = [];
  const document = typeof input.document === 'string' ? input.document : null;
  if (document !== null) {
    texts.push({ name: 'index.html', text: document, language: 'html' });
  } else {
    texts.push({ name: 'part.html', text: input.html, language: 'html' });
    texts.push({ name: 'part.css', text: input.css, language: 'css' });
    if (typeof input.js === 'string') texts.push({ name: 'part.js', text: input.js, language: 'js' });
  }

  let dom: { file: string; index: LineIndex; offset: number; match: string } | null = null;
  let hasCss = false;
  for (const { name, text, language } of texts) {
    const index = new LineIndex(text);
    const unit = { text, index, file: name, start: 0, end: text.length, language, col };
    if (language === 'html') {
      const result = analyzeHtml(unit);
      if (result.dom && !dom) dom = { file: name, index, ...result.dom };
      if (result.styleAttr || result.styleTag) hasCss = true;
    } else if (language === 'css') {
      analyzeCss(unit);
      if (text.trim().length > 0) hasCss = true;
    } else {
      analyzeJs(unit);
    }
    files.push({ name, bytes: utf8Bytes(text), lines: countLines(text), language });
  }
  // DOM と CSS：文字のある要素か操作の部品があり、CSS がある
  if (dom && hasCss) col.hit('dom-css', dom.file, dom.index, dom.offset, dom.match);

  // 言語の帯：文書の中の style は CSS、script は JS、シェーダーの文字列は GLSL として数え、もとの言語から引く
  const bytes = new Map<Language, number>();
  const add = (language: Language, value: number) => bytes.set(language, (bytes.get(language) ?? 0) + value);
  for (const file of files) {
    const glsl = col.glsl.get(file.name) ?? 0;
    const css = col.css.get(file.name) ?? 0;
    const js = col.js.get(file.name) ?? 0;
    add(file.language, file.bytes - glsl - css - js);
    add('css', css);
    add('js', js);
    add('glsl', glsl);
  }
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  const languages: LanguageBytes[] = [...bytes.entries()]
    .filter(([, value]) => value > 0)
    .map(([language, value]) => ({ language, bytes: value, percent: Math.round((value / total) * 1000) / 10 }))
    .sort((a, b) => b.bytes - a.bytes);

  const fileOrder = new Map(files.map((file, order) => [file.name, order]));
  return {
    version: OUTLINE_VERSION,
    format: document !== null ? 'document' : 'parts',
    files,
    sections: nest(col.sections, fileOrder),
    tech: col.techList(),
    languages,
  };
}
