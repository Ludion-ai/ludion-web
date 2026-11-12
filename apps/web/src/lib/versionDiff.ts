// 2つの版の違い（WS004「1」「2」）：ファイルごとの行の違いと、変わったまとまり（地図の分け目）。
// 版の一覧の数（増えた行、減った行、変わったファイル、変わったまとまり）と、違いの画面が、同じこの結果を使う。
// DOM の API を使わない（Web Worker で動かす。lib/versionDiff.worker.ts）。

import { buildOutline, type SectionKind } from '@ludion/outline';
import { DEFAULT_MAX_COST, diffLines, splitLines, type DiffRun } from './lineDiff';
import { namedFiles, type VersionFiles } from './versionFiles';

export type { VersionFiles };

export interface FileDiff {
  name: string;
  status: 'added' | 'removed' | 'changed' | 'same';
  added: number;
  removed: number;
  /** 違いが大きすぎて、全部を入れ替えたと見なした（lib/lineDiff.ts の replaced） */
  replaced: boolean;
  runs: DiffRun[];
}

/** 変わったまとまり。change：中が変わった、増えた（後の版だけ）、消えた（前の版だけ） */
export interface ChangedSection {
  file: string;
  kind: SectionKind;
  name: string;
  change: 'changed' | 'added' | 'removed';
}

export interface VersionDiff {
  files: FileDiff[];
  added: number;
  removed: number;
  sections: ChangedSection[];
}

type Located = { file: string; kind: SectionKind; name: string; start: number; end: number; depth: number; text: string };

/** 版の分け目を、見分ける鍵（ファイル、種類、名前、同じ名前の何番目か）と、その中身の文字にする。地図が作れなければ空 */
function sectionsOf(files: VersionFiles, lines: Map<string, string[]>): Map<string, Located> {
  const out = new Map<string, Located>();
  let sections;
  try {
    sections = buildOutline({ html: files.html ?? '', css: files.css ?? '', js: files.js, document: files.document }).sections;
  } catch {
    return out;
  }
  const seen = new Map<string, number>();
  for (const section of sections) {
    const base = `${section.file}\u0000${section.kind}\u0000${section.name}`;
    const nth = seen.get(base) ?? 0;
    seen.set(base, nth + 1);
    const text = (lines.get(section.file) ?? []).slice(section.start - 1, section.end).join('\n');
    out.set(`${base}\u0000${nth}`, { file: section.file, kind: section.kind, name: section.name, start: section.start, end: section.end, depth: section.depth, text });
  }
  return out;
}

/**
 * 変わったまとまり。同じ鍵の分け目の中身の文字を比べる（行の番号ではなく中身で比べるので、上に行が足されてずれても、変わっていなければ出さない）。
 * 入れ子は、いちばん内側だけを出す（設定の塊の中の「軽さ」が変われば、外の塊は出さない）。
 */
function changedSections(a: Map<string, Located>, b: Map<string, Located>): ChangedSection[] {
  const found: (Located & { change: ChangedSection['change']; side: 'a' | 'b' })[] = [];
  for (const [key, after] of b) {
    const before = a.get(key);
    if (!before) found.push({ ...after, change: 'added', side: 'b' });
    else if (before.text !== after.text) found.push({ ...after, change: 'changed', side: 'b' });
  }
  for (const [key, before] of a) if (!b.has(key)) found.push({ ...before, change: 'removed', side: 'a' });
  const inner = found.filter(
    (outer) =>
      !found.some(
        (other) =>
          other !== outer && other.side === outer.side && other.file === outer.file && other.depth > outer.depth && other.start >= outer.start && other.end <= outer.end,
      ),
  );
  const order = ['part.html', 'part.css', 'part.js', 'index.html'];
  inner.sort((x, y) => order.indexOf(x.file) - order.indexOf(y.file) || x.start - y.start);
  return inner.map(({ file, kind, name, change }) => ({ file, kind, name, change }));
}

/** 2つの版の違い。before が前の版、after が後の版。sections が false なら、地図を作らない（違いの画面で、行だけが要るとき） */
export function diffVersions(before: VersionFiles, after: VersionFiles, { sections = true, maxCost = DEFAULT_MAX_COST }: { sections?: boolean; maxCost?: number } = {}): VersionDiff {
  const aFiles = namedFiles(before);
  const bFiles = namedFiles(after);
  const names = [...new Set([...aFiles.map((file) => file.name), ...bFiles.map((file) => file.name)])];
  const aLines = new Map(aFiles.map((file) => [file.name, splitLines(file.text)]));
  const bLines = new Map(bFiles.map((file) => [file.name, splitLines(file.text)]));
  const files: FileDiff[] = names.map((name) => {
    const a = aLines.get(name);
    const b = bLines.get(name);
    const diff = diffLines(a ?? [], b ?? [], maxCost);
    const status = !a ? 'added' : !b ? 'removed' : diff.added + diff.removed === 0 ? 'same' : 'changed';
    return { name, status, added: diff.added, removed: diff.removed, replaced: diff.replaced, runs: diff.runs };
  });
  return {
    files,
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0),
    sections: sections ? changedSections(sectionsOf(before, aLines), sectionsOf(after, bLines)) : [],
  };
}
