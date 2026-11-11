// 作品と作者のファイルを探して読む。
//
// 置き場は2つ：リポジトリの根（works/ と creators/）と、検査器の見本（fixtures/works/ と fixtures/creators/）。
// id は根の works/ から先に探す。LD_ROOT を設定すると、根の代わりにそこを使う（テスト用）。

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Creator, Work, WorkMeta } from '@ludion/render';
import { sameHandle } from '@ludion/rules';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export function rootDir(): string {
  return process.env.LD_ROOT ? resolve(process.env.LD_ROOT) : REPO_ROOT;
}

export interface Library {
  name: 'works' | 'fixtures';
  /** works/ と creators/ を持つフォルダ */
  base: string;
}

export function libraries(): Library[] {
  const root = rootDir();
  return [
    { name: 'works', base: root },
    { name: 'fixtures', base: join(root, 'fixtures') },
  ];
}

export function library(name: Library['name']): Library {
  return libraries().find((l) => l.name === name)!;
}

export interface WorkLocation {
  id: string;
  dir: string;
  library: Library;
}

export function findWork(id: string): WorkLocation | null {
  for (const lib of libraries()) {
    const dir = join(lib.base, 'works', id);
    if (existsSync(join(dir, 'meta.json')) || existsSync(join(dir, 'part.html'))) return { id, dir, library: lib };
  }
  return null;
}

export function listWorks(lib: Library): WorkLocation[] {
  const worksDir = join(lib.base, 'works');
  if (!existsSync(worksDir)) return [];
  return readdirSync(worksDir)
    .filter((name) => statSync(join(worksDir, name)).isDirectory())
    .sort()
    .map((id) => ({ id, dir: join(worksDir, id), library: lib }));
}

/** 表示用：根からの相対パス（区切りは /）。 */
export function shown(path: string): string {
  return relative(rootDir(), path).split('\\').join('/') || '.';
}

/**
 * 作者のフォルダ。同じ handle かは大文字と小文字を区別せずに比べ、あればそのフォルダ（保存した綴りのまま）を返す。
 * なければ、渡された綴りで作る場所を返す。
 */
export function creatorDir(lib: Library, handle: string): string {
  return join(lib.base, 'creators', findCreatorHandle(lib, handle) ?? handle);
}

/** 置いてある作者のうち、大文字と小文字を区別せずに同じ handle のもの（フォルダ名の綴り）。 */
export function findCreatorHandle(lib: Library, handle: string): string | null {
  const dir = join(lib.base, 'creators');
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory());
  return names.find((name) => name === handle) ?? names.find((name) => sameHandle(name, handle)) ?? null;
}

export function creatorExists(lib: Library, handle: string): boolean {
  const dir = creatorDir(lib, handle);
  return existsSync(join(dir, 'creator.json')) && existsSync(join(dir, 'avatar.webp'));
}

export function readCreator(lib: Library, handle: string): Creator {
  return JSON.parse(readFileSync(join(creatorDir(lib, handle), 'creator.json'), 'utf8')) as Creator;
}

/** creator.json を、形を確かめる前の値として読む。JSON として読めなければ error。 */
export function readCreatorRaw(lib: Library, handle: string): { raw: unknown; error: string | null } {
  try {
    return { raw: JSON.parse(readFileSync(join(creatorDir(lib, handle), 'creator.json'), 'utf8')), error: null };
  } catch (error) {
    return { raw: undefined, error: (error as Error).message };
  }
}

function readText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** 作品のファイルを、読めたものだけ読む。足りないものの判定は検査（形）がする。 */
export interface RawWork {
  location: WorkLocation;
  metaText: string | null;
  /** JSON として読めたもの。読めなければ undefined */
  meta: unknown;
  metaError: string | null;
  html: string | null;
  css: string | null;
  js: string | null;
}

export function readWork(location: WorkLocation): RawWork {
  const metaText = readText(join(location.dir, 'meta.json'));
  let meta: unknown;
  let metaError: string | null = null;
  if (metaText !== null) {
    try {
      meta = JSON.parse(metaText);
    } catch (error) {
      metaError = (error as Error).message;
    }
  }
  return {
    location,
    metaText,
    meta,
    metaError,
    html: readText(join(location.dir, 'part.html')),
    css: readText(join(location.dir, 'part.css')),
    js: readText(join(location.dir, 'part.js')),
  };
}

/**
 * 描画できる形にする。meta.json が少し違っていても、描画に要る id・title・type があれば描く
 * （ld preview で、直している途中でも見えるように）。
 */
export function toRenderable(raw: RawWork): Work | null {
  if (raw.html === null || raw.css === null) return null;
  const m = (typeof raw.meta === 'object' && raw.meta !== null ? raw.meta : {}) as Partial<WorkMeta>;
  const meta = {
    ...m,
    id: raw.location.id,
    title: typeof m.title === 'string' ? m.title : raw.location.id,
    type: m.type === 'screen' ? 'screen' : 'component',
    platform: m.platform === 'web' || m.platform === 'mobile' ? m.platform : null,
  } as WorkMeta;
  return { meta, html: raw.html, css: raw.css, js: raw.js };
}
