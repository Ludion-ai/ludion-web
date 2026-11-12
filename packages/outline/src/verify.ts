// 地図の行が、そのファイルのその行を指しているかを確かめる（WS002 の合否）。地図を作る仕組みとは別に、ファイルの行の文字だけを見る。

import { countLines, utf8Bytes } from './text.ts';
import type { Outline, OutlineInput } from './types.ts';

function fileTexts(input: OutlineInput): Map<string, string> {
  const map = new Map<string, string>();
  if (typeof input.document === 'string') map.set('index.html', input.document);
  else {
    map.set('part.html', input.html);
    map.set('part.css', input.css);
    if (typeof input.js === 'string') map.set('part.js', input.js);
  }
  return map;
}

/** 問題の一覧。空なら、すべての行が合っている。 */
export function verifyOutline(input: OutlineInput, outline: Outline): string[] {
  const problems: string[] = [];
  const texts = fileTexts(input);
  const lines = new Map([...texts].map(([name, text]) => [name, text.split('\n').map((line) => line.replace(/\r$/, ''))]));
  const lineOf = (file: string, line: number): string | null => {
    const all = lines.get(file);
    return all && line >= 1 && line <= all.length ? all[line - 1] : null;
  };

  for (const file of outline.files) {
    const text = texts.get(file.name);
    if (text === undefined) {
      problems.push(`${file.name}：ない`);
      continue;
    }
    if (utf8Bytes(text) !== file.bytes) problems.push(`${file.name}：バイト数 ${file.bytes} が ${utf8Bytes(text)} と違う`);
    if (countLines(text) !== file.lines) problems.push(`${file.name}：行の数 ${file.lines} が ${countLines(text)} と違う`);
  }
  for (const name of texts.keys()) if (!outline.files.some((file) => file.name === name)) problems.push(`${name}：files にない`);

  for (const s of outline.sections) {
    const where = `${s.file}:${s.start}-${s.end} ${s.kind} ${s.name}`;
    const first = lineOf(s.file, s.start);
    const last = lineOf(s.file, s.end);
    if (first === null || last === null || s.end < s.start) {
      problems.push(`${where}：行がファイルの外`);
      continue;
    }
    const lower = first.toLowerCase();
    switch (s.kind) {
      case 'function':
      case 'settings':
        if (!first.includes(s.name)) problems.push(`${where}：始まりの行に名前がない`);
        break;
      case 'heading':
        if (!first.includes(s.name)) problems.push(`${where}：始まりの行に見出しがない`);
        break;
      case 'shader':
        if (/^shader-\d+$/.test(s.name) ? !/[`'"]|<script/i.test(first) : !first.includes(s.name)) problems.push(`${where}：始まりの行にシェーダーの名前がない`);
        if (s.file === 'index.html' && /<script/i.test(first) ? !/<\/script/i.test(last) : !/[`'"\]]/.test(last)) problems.push(`${where}：終わりの行で文字列が閉じない`);
        break;
      case 'style':
        if (!lower.includes('<style')) problems.push(`${where}：始まりの行に <style がない`);
        if (!last.toLowerCase().includes('</style')) problems.push(`${where}：終わりの行に </style がない`);
        break;
      case 'script':
        if (!lower.includes('<script')) problems.push(`${where}：始まりの行に <script がない`);
        if (!last.toLowerCase().includes('</script')) problems.push(`${where}：終わりの行に </script がない`);
        break;
      case 'asset':
        if (s.name === 'svg' ? !lower.includes('<svg') : !lower.includes('data:')) problems.push(`${where}：始まりの行に素材がない`);
        if (s.name === 'svg' && !last.toLowerCase().includes('</svg') && !last.includes('/>')) problems.push(`${where}：終わりの行に </svg がない`);
        break;
    }
  }

  for (const tech of outline.tech) {
    if (tech.count < tech.hits.length || tech.hits.length === 0) problems.push(`${tech.id}：数が合わない`);
    for (const hit of tech.hits) {
      const text = lineOf(hit.file, hit.line);
      if (text === null || !text.includes(hit.match)) problems.push(`${tech.id}：${hit.file}:${hit.line} に「${hit.match}」がない`);
    }
    if (tech.values && (tech.values.length === 0 || tech.values.some((value) => typeof value !== 'string' || value === '' || value.length > 40))) problems.push(`${tech.id}：値の形が違う`);
  }

  const total = outline.files.reduce((sum, file) => sum + file.bytes, 0);
  const sum = outline.languages.reduce((acc, item) => acc + item.bytes, 0);
  if (sum !== total) problems.push(`言語のバイト数の合計 ${sum} が、ファイルの合計 ${total} と違う`);
  if (outline.languages.some((item) => item.bytes <= 0)) problems.push('言語のバイト数に 0 以下がある');
  return problems;
}
