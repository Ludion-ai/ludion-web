// 地図から、要る部分だけを読む（WS006）。AI の口（MCP、/api/v1）が使う。
// 行の番号は、置いてあるファイルの行（地図の start と end と同じ数え方）。trim も書き換えもしない。
// DOM と Node の API を使わない。作り手の文字に、後戻りする正規表現を使わない。

import { TECH_LIST } from './collect.ts';
import { LineIndex, countLines, utf8Bytes } from './text.ts';
import type { Outline, OutlineInput, Section, SectionKind } from './types.ts';

/** 1回に読める部分の大きさの上限（UTF-8 のバイト数）。超えたら断る（切って返さない） */
export const MAX_PART_READ_BYTES = 32 * 1024;

/** 版のファイル。名前は地図の files と同じ（文書の作品は index.html だけ） */
export function workFiles(input: OutlineInput): { name: string; text: string }[] {
  if (typeof input.document === 'string') return [{ name: 'index.html', text: input.document }];
  const files = [
    { name: 'part.html', text: input.html },
    { name: 'part.css', text: input.css },
  ];
  if (typeof input.js === 'string') files.push({ name: 'part.js', text: input.js });
  return files;
}

/** 行の範囲の書き方：`200-760`、`200`（1行）。`L200-L760` も受ける。だめなら null */
export function parseLineRange(value: string): { start: number; end: number } | null {
  const match = /^\s*L?(\d{1,7})\s*(?:[-–]\s*L?(\d{1,7}))?\s*$/i.exec(value);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : Number(match[2]);
  return start >= 1 && end >= start ? { start, end } : null;
}

export interface PartRead {
  /** 読んだ行（1 から。end を含む）。end はファイルの終わりで止める */
  start: number;
  end: number;
  /** ファイルの行の数 */
  total: number;
  /** 読んだ部分の UTF-8 のバイト数 */
  bytes: number;
  /** その行の文字。行の区切りは元のまま。最後の行の改行は付けない */
  text: string;
}

/** ファイルの start 行から end 行まで。start がファイルの外なら null */
export function readLines(text: string, start: number, end: number): PartRead | null {
  const total = countLines(text);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || start > total) return null;
  const last = Math.min(end, total);
  const { starts } = new LineIndex(text);
  const from = starts[start - 1];
  const to = last < starts.length ? starts[last] : text.length;
  let part = text.slice(from, to);
  if (part.endsWith('\n')) part = part.slice(0, part.endsWith('\r\n') ? -2 : -1);
  return { start, end: last, total, bytes: utf8Bytes(part), text: part };
}

/** 行の番号を付ける（`474<TAB>その行`）。行の終わりの CR は外す */
export function numberLines(text: string, start: number): string {
  const out: string[] = [];
  let line = start;
  let from = 0;
  for (;;) {
    const next = text.indexOf('\n', from);
    const end = next === -1 ? text.length : next;
    out.push(`${line}\t${text.charCodeAt(end - 1) === 13 && end > from ? text.slice(from, end - 1) : text.slice(from, end)}`);
    if (next === -1) break;
    from = next + 1;
    line++;
  }
  return out.join('\n');
}

const KINDS: ReadonlySet<string> = new Set<SectionKind>(['shader', 'settings', 'heading', 'function', 'style', 'script', 'asset']);

/** 地図の文は呼び名を JSON の文字列で出す（MCP003）。引用ごと渡されても読めるように、外す */
function unquote(value: string): string {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'string' ? parsed.trim() : value;
  } catch {
    return value;
  }
}

const keyOf = (section: Pick<Section, 'kind' | 'name'>) => `${section.kind}:${section.name}`;

/**
 * 分け目の呼び名を作る関数。`shader:WINDOW_FRAG` の形。同じ種類と名前が2つ以上あるものは、始まりの行を付ける（`function:step@2950`）。
 * 地図の文（formatMap）と、断るときの候補は、この呼び名を JSON の文字列で出す（MCP003）。引用の中身を read の section に渡す。
 */
export function selectorNames(outline: Outline): (section: Section) => string {
  const counts = new Map<string, number>();
  for (const section of outline.sections) counts.set(keyOf(section), (counts.get(keyOf(section)) ?? 0) + 1);
  return (section) => (counts.get(keyOf(section))! > 1 ? `${keyOf(section)}@${section.start}` : keyOf(section));
}

export type SectionMatch = { ok: true; section: Section } | { ok: false; reason: 'not_found' | 'ambiguous'; candidates: Section[] };

/** 断るときに返す候補の数の上限 */
export const MAX_CANDIDATES = 12;

/**
 * 呼び名から分け目を1つ決める。`種類:名前`（`shader:WINDOW_FRAG`、`function:render`、`heading:ガラス`）。種類は省ける。
 * 探す順：名前がちょうど同じ → `名前@始まりの行` → 大文字と小文字を区別しない → 名前の頭が同じ。
 * どこかで2つ以上に当たれば、選ばずに候補を返す（ambiguous）。
 */
export function findSection(outline: Outline, selector: string, file?: string): SectionMatch {
  const raw = unquote(selector.trim());
  const colon = raw.indexOf(':');
  const hasKind = colon > 0 && KINDS.has(raw.slice(0, colon));
  const kind = hasKind ? raw.slice(0, colon) : null;
  const name = (hasKind ? raw.slice(colon + 1) : raw).trim();
  if (name === '') return { ok: false, reason: 'not_found', candidates: [] };
  const pool = outline.sections.filter((section) => (file === undefined || section.file === file) && (kind === null || section.kind === kind));
  const decide = (found: Section[]): SectionMatch | null =>
    found.length === 1 ? { ok: true, section: found[0] } : found.length > 1 ? { ok: false, reason: 'ambiguous', candidates: found.slice(0, MAX_CANDIDATES) } : null;

  const exact = decide(pool.filter((section) => section.name === name));
  if (exact) return exact;
  const at = name.lastIndexOf('@');
  if (at > 0 && /^\d{1,7}$/.test(name.slice(at + 1))) {
    const line = Number(name.slice(at + 1));
    const head = name.slice(0, at);
    const pinned = decide(pool.filter((section) => section.name === head && section.start === line));
    if (pinned) return pinned;
  }
  const lower = name.toLowerCase();
  const loose = decide(pool.filter((section) => section.name.toLowerCase() === lower));
  if (loose) return loose;
  const prefixed = name.length >= 2 ? decide(pool.filter((section) => section.name.startsWith(name))) : null;
  if (prefixed) return prefixed;
  // 見つからないときは、名前を含むものを候補に出す
  return { ok: false, reason: 'not_found', candidates: pool.filter((section) => section.name.toLowerCase().includes(lower)).slice(0, MAX_CANDIDATES) };
}

/**
 * 範囲の中にある分け目のうち、いちばん外のもの（範囲が大きすぎて断るときに、狭め方として返す）。
 * 範囲とちょうど同じ分け目は除く。
 */
export function innerSections(outline: Outline, file: string, start: number, end: number, limit = 24): Section[] {
  const inside = outline.sections.filter((section) => section.file === file && section.start >= start && section.end <= end && !(section.start === start && section.end === end));
  if (inside.length === 0) return [];
  const depth = inside.reduce((min, section) => Math.min(min, section.depth), Infinity);
  return inside.filter((section) => section.depth === depth).slice(0, limit);
}

// ---------- 技術の印 ----------

const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** 絞るときの、まとめた呼び方。`webgl` は WebGL と WebGL2、`canvas` は Canvas 2D、`audio` と `sound` は音の全部 */
const TECH_ALIASES: Record<string, string[]> = {
  webgl: ['webgl', 'webgl2'],
  canvas: ['canvas2d'],
  audio: TECH_LIST.filter((tech) => tech.group === 'sound').map((tech) => tech.id),
  sound: TECH_LIST.filter((tech) => tech.group === 'sound').map((tech) => tech.id),
};

/**
 * 技術で絞る言葉（`webgl2`、`WebGL2`、`Web Audio`、`audio`）を、技術の id の集まりにする。その中のどれかがあれば当たり。
 * 知らない言葉は null。
 */
export function techQuery(term: string): string[] | null {
  const key = squash(term);
  if (key === '') return null;
  if (TECH_ALIASES[key]) return TECH_ALIASES[key];
  const found = TECH_LIST.filter((tech) => squash(tech.id) === key || squash(tech.label) === key).map((tech) => tech.id);
  return found.length > 0 ? found : null;
}

// ---------- AI が読む地図の文 ----------

const LANGUAGE_LABELS: Record<string, string> = { js: 'JavaScript', glsl: 'GLSL', css: 'CSS', html: 'HTML' };
const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

/** 地図の文に出す分け目の数の上限。超える分は、深い関数から省く（数を書く） */
export const MAX_MAP_SECTIONS = 400;

/**
 * 地図を、AI が読む短い文にする。ファイル、言語、技術（初めの行）、分け目（呼び名、行、大きさ）。
 * 分け目の呼び名と、外の住所の名前は、作者が書いた文字なので、JSON の文字列（引用した形）で出す（MCP003）。
 * 呼び名は、引用の中身を read の section に渡す（引用ごと渡しても読める。findSection）。
 */
export function formatMap(outline: Outline, { maxSections = MAX_MAP_SECTIONS }: { maxSections?: number } = {}): string {
  const out: string[] = [];
  out.push('Files:');
  for (const file of outline.files) out.push(`- ${file.name} — ${file.lines} lines, ${size(file.bytes)}`);
  if (outline.languages.length > 0) out.push(`Languages: ${outline.languages.map((item) => `${LANGUAGE_LABELS[item.language] ?? item.language} ${item.percent}%`).join(', ')}`);
  out.push(
    outline.tech.length > 0
      ? `Tech (first line found): ${outline.tech.map((tech) => `${tech.label} (${tech.hits[0] ? `${tech.hits[0].file}:${tech.hits[0].line}` : '?'}${tech.hosts ? `; ${tech.hosts.map((host) => JSON.stringify(host)).join(' ')}` : ''})`).join(', ')}`
      : 'Tech: none found',
  );

  // 出す分け目：関数のほかは全部、関数は浅いものから
  const keep = new Set<Section>();
  const others = outline.sections.filter((section) => section.kind !== 'function');
  for (const section of others.slice(0, maxSections)) keep.add(section);
  const functions = outline.sections.filter((section) => section.kind === 'function');
  const byDepth = [...functions].sort((a, b) => a.depth - b.depth);
  for (const section of byDepth) {
    if (keep.size >= maxSections) break;
    keep.add(section);
  }
  const omitted = outline.sections.length - keep.size;
  const nameOf = selectorNames(outline);

  out.push('Sections (selector — lines — size):');
  if (outline.sections.length === 0) out.push('  (none found)');
  for (const file of outline.files) {
    const sections = outline.sections.filter((section) => section.file === file.name && keep.has(section));
    if (sections.length === 0) continue;
    out.push(`${file.name}`);
    for (const section of sections) {
      const extra = [section.bytes !== undefined ? size(section.bytes) : '', section.glsl ? `GLSL ${section.glsl}` : '', section.stage ?? '', section.mime ?? ''].filter(Boolean).join(', ');
      out.push(`${'  '.repeat(section.depth + 1)}${JSON.stringify(nameOf(section))} — ${section.start}-${section.end}${extra ? ` — ${extra}` : ''}`);
    }
  }
  if (omitted > 0) out.push(`(${omitted} deeper sections are not listed; read the lines of the section around them.)`);
  return out.join('\n');
}
