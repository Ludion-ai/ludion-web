// ld outline：手元の作品の地図（WS002）を、人が読める形で出す。CTO と CEO が確かめるため。
// 地図は Worker が置くときに作る物と同じ（@ludion/outline）。

import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { buildOutline, verifyOutline, type Outline, type OutlineInput, type Section, type TechGroup } from '@ludion/outline';

/** 作品のフォルダ（part.html か index.html）か、1つの HTML 文書を読む */
export function readOutlineInput(path: string): OutlineInput | null {
  const full = resolve(path);
  if (!existsSync(full)) return null;
  if (statSync(full).isFile()) return full.endsWith('.html') ? { html: '', css: '', js: null, document: readFileSync(full, 'utf8') } : null;
  const read = (name: string) => (existsSync(join(full, name)) ? readFileSync(join(full, name), 'utf8') : null);
  const html = read('part.html');
  if (html !== null) return { html, css: read('part.css') ?? '', js: read('part.js') };
  const document = read('index.html');
  return document === null ? null : { html: '', css: '', js: null, document };
}

const LANGUAGE_LABELS: Record<string, string> = { js: 'JavaScript', glsl: 'GLSL', css: 'CSS', html: 'HTML' };
const GROUP_LABELS: Record<TechGroup, string> = { draw: '描き方', sound: '音', input: '操作', motion: '動き', care: '気づかい', a11y: 'キー操作と読み上げ', storage: '保存', external: '外から読む物' };
const KIND_LABELS: Record<Section['kind'], string> = { shader: 'シェーダー', settings: '設定', heading: '見出し', function: '関数', style: 'style', script: 'script', asset: '素材' };

const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);
const lines = (n: number) => n.toLocaleString('en-US');

/** 人が読める形。functions：関数の分け目も出す（多いので、ふだんは数だけ） */
export function formatOutline(name: string, outline: Outline, { functions = false }: { functions?: boolean } = {}): string {
  const out: string[] = [];
  const total = outline.files.reduce((sum, file) => sum + file.bytes, 0);
  out.push(`${name} — ${size(total)}、${outline.files.length} ファイル（${outline.format === 'document' ? '文書の作品' : '部品の形'}）`);
  out.push(`言語：${outline.languages.map((item) => `${LANGUAGE_LABELS[item.language] ?? item.language} ${item.percent}%`).join('、') || 'なし'}`);
  out.push('技術：');
  if (outline.tech.length === 0) out.push('  見つからない');
  const groups = [...new Set(outline.tech.map((tech) => tech.group))];
  for (const group of groups) {
    const items = outline.tech.filter((tech) => tech.group === group).map((tech) => `${tech.label}（${tech.hits[0].file}:${tech.hits[0].line}${tech.count > 1 ? ` ほか${tech.count - 1}` : ''}${tech.hosts ? `、${tech.hosts.join(' ')}` : ''}${tech.values ? `、${tech.values.join(' ')}` : ''}）`);
    out.push(`  ${GROUP_LABELS[group]}：${items.join('、')}`);
  }
  out.push('ファイル：');
  for (const file of outline.files) {
    const sections = outline.sections.filter((s) => s.file === file.name);
    const fnCount = sections.filter((s) => s.kind === 'function').length;
    const shaderCount = sections.filter((s) => s.kind === 'shader').length;
    const counts = [shaderCount ? `シェーダー ${shaderCount}` : '', fnCount ? `関数 ${fnCount}` : ''].filter(Boolean).join('、');
    out.push(`  ${file.name}  ${size(file.bytes)} · ${lines(file.lines)} 行${counts ? `（${counts}）` : ''}`);
    for (const s of sections) {
      if (s.kind === 'function' && !functions) continue;
      const extra = [s.glsl ? `GLSL ${s.glsl}` : '', s.stage ?? '', s.kind === 'asset' || s.kind === 'shader' || (functions && s.kind === 'function') ? (s.bytes !== undefined ? size(s.bytes) : '') : ''].filter(Boolean).join('、');
      out.push(`  ${'  '.repeat(s.depth + 1)}${KIND_LABELS[s.kind]} ${s.name}  L${s.start}${s.end !== s.start ? `-${s.end}` : ''}${extra ? `（${extra}）` : ''}`);
    }
  }
  return out.join('\n');
}

export interface OutlineCommandResult {
  text: string;
  problems: string[];
}

/** ld outline の中身。check：行の確かめもする */
export function outlineCommand(label: string, input: OutlineInput, { json = false, functions = false, check = false }: { json?: boolean; functions?: boolean; check?: boolean }): OutlineCommandResult {
  const outline = buildOutline(input);
  const problems = check ? verifyOutline(input, outline) : [];
  const text = json ? JSON.stringify(outline, null, 2) : formatOutline(label, outline, { functions });
  return { text, problems };
}

export const outlineLabel = (path: string) => basename(resolve(path));
