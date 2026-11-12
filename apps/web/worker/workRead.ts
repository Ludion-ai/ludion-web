// 作品の地図と、要る部分だけを読む（WS006）。AI の口（apiV1.ts）、MCP（apiV1 を中から呼ぶ）、サイトの口（workSite.ts）が、同じものを使う。
//
// - だれが、どの版を読めるかは readableWork の1か所で決める。公開の作品の公開の版はだれでも。そのほかの版は持ち主だけ。
//   ほかの人（運営も）には null で、ない作品と同じに見せる。
// - 行の番号は、置いてあるファイルの行（地図と同じ）。コピーされるコード（/p/:id/code）は trim と export 外しをするので、行の読み方には使わない。
// - 読めるファイルは、版のファイルの名前（part.html、part.css、part.js、index.html）だけ。道の文字から R2 のキーを作らない。

import { MAX_PART_READ_BYTES, findSection, innerSections, parseLineRange, readLines, selectorNames, workFiles, type Outline, type Section } from '@ludion/outline';
import { buildCopySnippet, buildDocumentSnippet, creditText, remixCreditText, type Creator, type RemixSource, type Work } from '@ludion/render';
import { ID_PATTERN } from '@ludion/rules';
import type { Env } from './env';
import { loadOutline } from './outline';
import { approvedPrefix, loadRevisionFiles } from './revisions';

type Store = Pick<Env, 'DB' | 'PARTS'>;

/** 読んでよい版。 */
export interface ReadableWork {
  id: string;
  title: string;
  /** 読む版の番号 */
  version: string;
  /** 読む版の状態（approved、private、draft など） */
  status: string;
  /** 作品の今の状態（works.status） */
  workStatus: string;
  /** 読む人が持ち主か */
  own: boolean;
  /** 公開の作品の公開の版か（だれにでも同じ中身） */
  published: boolean;
  prefix: string;
  creator: Creator;
  remixOf: RemixSource | null;
}

/**
 * どの版を先に選ぶか。
 * - mine：持ち主には、いちばん新しい版（下書きも）。そのほかの人には、公開の版。AI の口（今までの GET /works/:id と同じ版）。
 * - published：公開の作品は、だれにでも公開の版（人によって変えない。キャッシュするため）。公開していない作品は、持ち主にだけ今の版。サイトの口。
 */
export type ReadOrder = 'mine' | 'published';

/**
 * 作品 id と読む人から、読んでよい版を決める。なければ null。
 * version を渡すと、その番号の版だけを選ぶ。読める版はあるが番号が違えば 'version_changed'（地図を取った後に、版が変わった）。
 */
export async function readableWork(db: D1Database, id: string, readerId: string | null, order: ReadOrder, version?: string): Promise<ReadableWork | 'version_changed' | null> {
  if (!ID_PATTERN.test(id) || id.length > 60) return null;
  const work = await db
    .prepare(
      `SELECT w.id, w.title, w.status, w.version, w.remix_of, c.user_id AS owner_id, c.handle, c.name, c.kind, c.x_url, c.site_url
       FROM works w JOIN creators c ON c.id = w.creator_id WHERE w.id = ?`,
    )
    .bind(id)
    .first<{ id: string; title: string; status: string; version: string; remix_of: string | null; owner_id: string | null; handle: string; name: string | null; kind: Creator['kind']; x_url: string | null; site_url: string | null }>();
  if (!work) return null;
  const own = readerId !== null && work.owner_id === readerId;

  type Candidate = Pick<ReadableWork, 'title' | 'version' | 'status' | 'prefix' | 'published'>;
  const published = async (): Promise<Candidate | null> => {
    if (work.status !== 'approved') return null;
    const prefix = await approvedPrefix(db, id, work.version);
    return prefix === null ? null : { title: work.title, version: work.version, status: 'approved', prefix, published: true };
  };
  const mine = async (): Promise<Candidate | null> => {
    if (!own) return null;
    // AI の口は、いちばん新しい版。サイトの口は、自分だけの作品の今の版（privateCurrentRevision と同じ）
    const row =
      order === 'mine'
        ? await db.prepare('SELECT title, version, status, r2_prefix FROM revisions WHERE work_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').bind(id).first<{ title: string; version: string; status: string; r2_prefix: string }>()
        : work.status === 'private'
          ? await db.prepare('SELECT title, version, status, r2_prefix FROM revisions WHERE work_id = ? AND version = ?').bind(id, work.version).first<{ title: string; version: string; status: string; r2_prefix: string }>()
          : null;
    return row ? { title: row.title, version: row.version, status: row.status, prefix: row.r2_prefix, published: work.status === 'approved' && row.status === 'approved' && row.version === work.version } : null;
  };

  const candidates: Candidate[] = [];
  for (const pick of order === 'mine' ? [mine, published] : [published, mine]) {
    const candidate = await pick();
    if (!candidate) continue;
    if (version === undefined || candidate.version === version) {
      const source = work.remix_of
        ? await db.prepare('SELECT w.id, c.handle FROM works w JOIN creators c ON c.id = w.creator_id WHERE w.id = ?').bind(work.remix_of).first<RemixSource>()
        : null;
      return {
        id,
        ...candidate,
        workStatus: work.status,
        own,
        creator: { handle: work.handle, name: work.name ?? `@${work.handle}`, kind: work.kind, x_url: work.x_url, site_url: work.site_url },
        remixOf: source,
      };
    }
    candidates.push(candidate);
  }
  return candidates.length > 0 ? 'version_changed' : null;
}

/** 版のファイル。 */
export const loadFiles = (env: Store, target: ReadableWork): Promise<Work | null> => loadRevisionFiles(env.PARTS, target.prefix);

/** 版の地図。置き場にあればそれを、なければ版のファイルから作って置く（worker/outline.ts）。 */
export const loadMap = (env: Store, target: ReadableWork, files?: Work | null): Promise<Outline | null> =>
  loadOutline(env.PARTS, target.prefix, async () => files ?? (await loadFiles(env, target)));

/** コピーされるコード（/p/:id/code と同じ文字列）。 */
export const fullCode = (target: ReadableWork, files: Work): string =>
  buildCopySnippet({ ...files, meta: { ...files.meta, creator: target.creator.handle } }, target.creator, target.remixOf);

/** クレジット行の文字（1行目は作者、リミックスは2行目に元の作品）。 */
export const creditTexts = (target: ReadableWork): string[] => [creditText(target.creator.handle, target.id), ...(target.remixOf ? [remixCreditText(target.remixOf)] : [])];

/**
 * 1つのファイルの生の文字。頭にクレジット行を入れる（/p/:id/code と同じ決まり：1行目は作者、リミックスは次の行に元の作品）。
 * HTML は <!-- -->、CSS と JS は コメント。文書の作品は <!doctype> の直後（/p/:id/code と同じ文字列）。ファイルの中身は1文字も変えない。
 * 版にないファイルの名前は null。
 */
export function rawFile(target: ReadableWork, files: Work, name: string): string | null {
  const file = workFiles(files).find((item) => item.name === name);
  if (!file) return null;
  if (typeof files.document === 'string') return buildDocumentSnippet(files.document, target.creator.handle, target.id, target.remixOf);
  const [open, close] = name.endsWith('.html') ? ['<!-- ', ' -->'] : ['/* ', ' */'];
  return `${creditTexts(target)
    .map((line) => `${open}${line}${close}\n`)
    .join('')}${file.text}`;
}

export interface PartQuery {
  file?: string;
  lines?: string;
  section?: string;
}

export interface SectionRef {
  section: string;
  file: string;
  start: number;
  end: number;
  bytes?: number;
}

export type PartResult =
  | { ok: true; file: string; start: number; end: number; total: number; bytes: number; code: string; section: string | null }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'bad_part' }
  | { ok: false; error: 'file_required' | 'file_not_found'; files: string[] }
  | { ok: false; error: 'section_not_found' | 'ambiguous_section'; candidates: SectionRef[] }
  | { ok: false; error: 'out_of_range'; file: string; total: number }
  | { ok: false; error: 'part_too_large'; file: string; start: number; end: number; bytes: number; limit: number; inside: SectionRef[] };

const refs = (outline: Outline, sections: Section[]): SectionRef[] => {
  const nameOf = selectorNames(outline);
  return sections.map((section) => ({ section: nameOf(section), file: section.file, start: section.start, end: section.end, ...(section.bytes === undefined ? {} : { bytes: section.bytes }) }));
};

/**
 * 作品の一部を読む。section（分け目の呼び名）か lines（行の範囲。file と一緒に）のどちらか。file だけなら、そのファイルの全部。
 * 上限（MAX_PART_READ_BYTES）を超える部分は、切らずに断り、その中の分け目を返す（狭めて読み直せるように）。
 */
export async function readPart(env: Store, target: ReadableWork, query: PartQuery): Promise<PartResult> {
  const files = await loadFiles(env, target);
  if (!files) return { ok: false, error: 'not_found' };
  const texts = workFiles(files);
  const names = texts.map((item) => item.name);
  if (query.file !== undefined && !names.includes(query.file)) return { ok: false, error: 'file_not_found', files: names };
  if (query.section !== undefined && query.lines !== undefined) return { ok: false, error: 'bad_part' };

  let outline: Outline | null = null;
  const map = async () => (outline ??= await loadMap(env, target, files));
  let file: string;
  let range: { start: number; end: number };
  let section: string | null = null;
  if (query.section !== undefined) {
    const loaded = await map();
    if (!loaded) return { ok: false, error: 'not_found' };
    const match = findSection(loaded, query.section, query.file);
    if (!match.ok) return { ok: false, error: match.reason === 'ambiguous' ? 'ambiguous_section' : 'section_not_found', candidates: refs(loaded, match.candidates) };
    file = match.section.file;
    range = { start: match.section.start, end: match.section.end };
    section = selectorNames(loaded)(match.section);
  } else {
    if (query.file === undefined && names.length !== 1) return { ok: false, error: 'file_required', files: names };
    file = query.file ?? names[0];
    const parsed = query.lines === undefined ? { start: 1, end: Number.MAX_SAFE_INTEGER } : parseLineRange(query.lines);
    if (!parsed) return { ok: false, error: 'bad_part' };
    range = parsed;
  }

  const text = texts.find((item) => item.name === file)!.text;
  const read = readLines(text, range.start, range.end);
  if (!read) return { ok: false, error: 'out_of_range', file, total: readLines(text, 1, 1)?.total ?? 0 };
  if (read.bytes > MAX_PART_READ_BYTES) {
    const loaded = await map();
    return { ok: false, error: 'part_too_large', file, start: read.start, end: read.end, bytes: read.bytes, limit: MAX_PART_READ_BYTES, inside: loaded ? refs(loaded, innerSections(loaded, file, read.start, read.end)) : [] };
  }
  return { ok: true, file, start: read.start, end: read.end, total: read.total, bytes: read.bytes, code: read.text, section };
}
