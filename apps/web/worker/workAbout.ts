// 作品のページの「この作品について」「版」「系譜」のデータ（WS003）。
// 地図（outline.json。packages/outline、WS002）から、画面に出す分だけを作る。作品のファイルは変えない。
// 人によって変えない：公開の作品では、承認済みの版と、承認済みのリミックスだけを数える。

import type { Outline, Section, Tech } from '@ludion/outline';
import type { AboutSpot, WorkAbout, WorkLineage, WorkTree, WorkVersion } from '../src/data/pages';
import { historyStatusSql } from './revisions';

/** 「この作品について」に出す技術のまとまり */
const SHOWN_GROUPS = new Set(['draw', 'motion', 'sound', 'input', 'care', 'a11y', 'storage', 'external']);

/** ページに入れる分け目の上限（作り手の入れた文字で、ページが大きくならないように）。関数のほかを先に入れ、残りに関数を入れる */
export const MAX_TREE_SECTIONS = 1500;
const MAX_TREE_NAME = 80;

/** 地図から「この作品について」を作る。コードから読んだ事実だけ。印の行は、本当のファイルの行（本文のその行へ飛ぶ）。 */
export function buildAbout(outline: Outline): WorkAbout {
  const lineCount = new Map(outline.files.map((file) => [file.name, file.lines]));
  const spot = (file: string, line: number): AboutSpot | null => (line >= 1 && line <= (lineCount.get(file) ?? 0) ? { file, line } : null);
  const techSpot = (tech: Tech) => (tech.hits[0] ? spot(tech.hits[0].file, tech.hits[0].line) : null);

  const shaders = outline.sections.filter((section) => section.kind === 'shader');
  const functions = outline.sections.filter((section) => section.kind === 'function').length;
  return {
    files: outline.files.map(({ name, bytes, lines: count }) => ({ name, bytes, lines: count })),
    bytes: outline.files.reduce((sum, file) => sum + file.bytes, 0),
    languages: outline.languages.map(({ language, percent }) => ({ language, percent })),
    shaders:
      shaders.length > 0
        ? {
            count: shaders.length,
            bytes: shaders.reduce((sum, section) => sum + (section.bytes ?? 0), 0),
            glsl: [...new Set(shaders.map((section) => section.glsl).filter((version): version is string => typeof version === 'string'))].slice(0, 3),
            spot: spot(shaders[0].file, shaders[0].start),
          }
        : null,
    functions,
    tech: outline.tech
      .filter((tech) => SHOWN_GROUPS.has(tech.group))
      .map((tech) => ({
        id: tech.id,
        group: tech.group,
        label: tech.label,
        count: tech.count,
        ...(tech.values ? { values: tech.values } : {}),
        ...(tech.hosts ? { hosts: tech.hosts } : {}),
        spot: techSpot(tech),
      })),
  };
}

/**
 * ファイルの木と目次のデータ（WS003）：本当のファイルと、地図の分け目（設定の塊、シェーダー、見出し、関数、文書の style と script、素材）。
 * 並びは地図のまま（ファイルの順、行の順）。上限を超えた分は入れず、数だけ返す。
 */
export function buildTree(outline: Outline): WorkTree {
  const keep = new Set<Section>();
  const others = outline.sections.filter((section) => section.kind !== 'function');
  for (const section of others.slice(0, MAX_TREE_SECTIONS)) keep.add(section);
  for (const section of outline.sections) {
    if (keep.size >= MAX_TREE_SECTIONS) break;
    if (section.kind === 'function') keep.add(section);
  }
  return {
    files: outline.files.map(({ name, bytes, lines, language }) => ({ name, bytes, lines, language })),
    sections: outline.sections
      .filter((section) => keep.has(section))
      .map(({ file, kind, name, start, end, depth, language, bytes, glsl, stage, mime }) => ({
        file,
        kind,
        name: name.length > MAX_TREE_NAME ? `${name.slice(0, MAX_TREE_NAME)}…` : name,
        start,
        end,
        depth,
        language,
        ...(bytes !== undefined ? { bytes } : {}),
        ...(glsl !== undefined ? { glsl } : {}),
        ...(stage !== undefined ? { stage } : {}),
        ...(mime !== undefined ? { mime } : {}),
      })),
    dropped: outline.sections.length - keep.size,
  };
}

/**
 * 版の一覧（新しい順）と、リミックスの一覧。公開の作品は、承認済みのものだけ。
 * 自分だけの作品（持ち主にだけ描く）は、自分だけの版も数える。リミックスは、どちらでも公開のものだけ。
 */
export async function loadHistory(db: D1Database, workId: string, isPrivate: boolean): Promise<{ versions: WorkVersion[]; lineage: WorkLineage }> {
  // どの版を出してよいかは revisions.ts の historyStatuses の1か所で決める（版の中身の読み口と同じ。WS004）
  const [versions, remixes, total] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT id, version, created_at FROM revisions WHERE work_id = ?1 AND status IN (${historyStatusSql(isPrivate)})
         ORDER BY created_at DESC, version DESC LIMIT 100`,
      )
      .bind(workId),
    db
      .prepare(
        `SELECT w.id, w.title, c.handle FROM works w JOIN creators c ON c.id = w.creator_id
         WHERE w.remix_of = ?1 AND w.status = 'approved' ORDER BY w.published_at DESC, w.id LIMIT 50`,
      )
      .bind(workId),
    db.prepare(`SELECT COUNT(*) AS n FROM works WHERE remix_of = ?1 AND status = 'approved'`).bind(workId),
  ]);
  return {
    // 版の id は、自分だけの作品（持ち主にだけ描き、残さないページ）でだけ渡す。下書きの枠（/draft-frame/<id>/…）で動かすため。
    // 公開の作品のページは人によって変えないので、版の番号と日時だけ（枠は /frame/<作品>/<版>/…）
    versions: versions.results.map((row) => ({ version: String(row.version), at: Number(row.created_at), ...(isPrivate ? { rid: String(row.id) } : {}) })),
    lineage: {
      remixes: remixes.results.map((row) => ({ id: String(row.id), title: String(row.title), handle: String(row.handle) })),
      count: Number(total.results[0]?.n ?? 0),
    },
  };
}
