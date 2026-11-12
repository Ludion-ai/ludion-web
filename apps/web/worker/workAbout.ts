// 作品のページの「この作品について」「版」「系譜」のデータ（WS003）。
// 地図（outline.json。packages/outline、WS002）から、画面に出す分だけを作る。作品のファイルは変えない。
// 人によって変えない：公開の作品では、承認済みの版と、承認済みのリミックスだけを数える。

import type { Outline, OutlineInput, Tech } from '@ludion/outline';
import type { AboutSpot, WorkAbout, WorkLineage, WorkVersion } from '../src/data/pages';

/** 印を押したときに見せる行：その行と、前後の行の数 */
const AROUND = 2;
/** 見せる1行の長さの上限（1行に詰めたコードで、ページが大きくならないように） */
const MAX_LINE = 160;
/** 「この作品について」に出す技術のまとまり（動きと保存は、ファイルの木の側で見せる） */
const SHOWN_GROUPS = new Set(['draw', 'sound', 'input', 'care', 'a11y', 'external']);

/**
 * ld upload が置いた版か。管理 API（worker/admin.ts）の置き場は works/<id>/<version>、投稿と AI の口の置き場は revisions/<版の id>/…。
 * ld upload は、ld check（アクセシビリティの検査 axe を含む）が通らない作品を送らない（packages/ld/src/cli.ts）。
 * 検査の結果そのものは持っていない（置き場の形から決めている）。
 */
export const isCheckedPrefix = (prefix: string) => prefix.startsWith('works/');

function fileLines(files: OutlineInput): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const add = (name: string, text: string) => map.set(name, text.split('\n'));
  if (typeof files.document === 'string') add('index.html', files.document);
  else {
    add('part.html', files.html);
    add('part.css', files.css);
    if (typeof files.js === 'string') add('part.js', files.js);
  }
  return map;
}

/**
 * 地図と版のファイルから「この作品について」を作る。checked：ld upload が ld check（形、純度、配置、アクセシビリティ、通信）を
 * 通して置いた版か（管理 API の置き場の版。worker/admin.ts）。
 */
export function buildAbout(outline: Outline, files: OutlineInput, checked: boolean): WorkAbout {
  const lines = fileLines(files);
  const spot = (file: string, line: number): AboutSpot | null => {
    const all = lines.get(file);
    if (!all || line < 1 || line > all.length) return null;
    const first = Math.max(1, line - AROUND);
    const last = Math.min(all.length, line + AROUND);
    return {
      file,
      line,
      first,
      lines: all.slice(first - 1, last).map((text) => {
        const clean = text.replace(/\r$/, '');
        return clean.length > MAX_LINE ? `${clean.slice(0, MAX_LINE)}…` : clean;
      }),
    };
  };
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
    checked,
  };
}

/**
 * 版の一覧（新しい順）と、リミックスの一覧。公開の作品は、承認済みのものだけ。
 * 自分だけの作品（持ち主にだけ描く）は、自分だけの版も数える。リミックスは、どちらでも公開のものだけ。
 */
export async function loadHistory(db: D1Database, workId: string, isPrivate: boolean): Promise<{ versions: WorkVersion[]; lineage: WorkLineage }> {
  const [versions, remixes, total] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT version, created_at FROM revisions WHERE work_id = ?1 AND status IN ('approved'${isPrivate ? ", 'private'" : ''})
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
    versions: versions.results.map((row) => ({ version: String(row.version), at: Number(row.created_at) })),
    lineage: {
      remixes: remixes.results.map((row) => ({ id: String(row.id), title: String(row.title), handle: String(row.handle) })),
      count: Number(total.results[0]?.n ?? 0),
    },
  };
}
