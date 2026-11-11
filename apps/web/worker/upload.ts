// ld upload から受け取った作品を、Worker でも確かめる（docs/tasks/T004.md「3」）。
// 「形」と「トークンの純度」だけを、ld と同じ規則（packages/rules）で見る。描画が要る検査は ld 側で済んでいる前提。

import {
  checkCreator,
  checkCssShape,
  checkHtml,
  checkJs,
  checkJsPurity,
  checkMeta,
  checkPurity,
  checkReducedMotion,
  imageSize,
  type Problem,
} from '@ludion/rules';
import type { CreatorKind, MadeWith, Platform, WorkType } from '@ludion/render';

/** 受け取るファイル。part.js だけは任意。 */
export const UPLOAD_FILES = ['meta.json', 'part.html', 'part.css', 'part.js', 'thumb.webp', 'og.png', 'creator.json', 'avatar.webp'] as const;
export type UploadFileName = (typeof UPLOAD_FILES)[number];
const OPTIONAL: readonly UploadFileName[] = ['part.js'];

/** 1ファイルの大きさの上限（バイト）。サムネイルは SPEC.md「10」の 80KB。 */
const MAX_BYTES: Record<UploadFileName, number> = {
  'meta.json': 16 * 1024,
  'creator.json': 16 * 1024,
  'part.html': 256 * 1024,
  'part.css': 256 * 1024,
  'part.js': 256 * 1024,
  'thumb.webp': 80 * 1024,
  'og.png': 1024 * 1024,
  'avatar.webp': 64 * 1024,
};

export const CONTENT_TYPES: Record<UploadFileName, string> = {
  'meta.json': 'application/json; charset=utf-8',
  'creator.json': 'application/json; charset=utf-8',
  'part.html': 'text/html; charset=utf-8',
  'part.css': 'text/css; charset=utf-8',
  'part.js': 'text/javascript; charset=utf-8',
  'thumb.webp': 'image/webp',
  'og.png': 'image/png',
  'avatar.webp': 'image/webp',
};

export type ItemKey = 'shape' | 'purity';
export const ITEM_LABELS: Record<ItemKey, string> = { shape: '形', purity: 'トークンの純度' };

export interface FailedItem {
  key: ItemKey;
  label: string;
  problems: Problem[];
}

/** 確かめ終わった作品。D1 と R2 に置く値。 */
export interface UploadedWork {
  meta: {
    id: string;
    title: string;
    type: WorkType;
    platform: Platform | null;
    category: string;
    subtype: string;
    tags: string[];
    creator: string;
    license: string;
    made_with: MadeWith;
    version: string;
    published_at: string;
    pin_order: number | null;
  };
  creator: { handle: string; name: string; kind: CreatorKind; x_url: string | null; site_url: string | null };
  thumb: { width: number; height: number };
  /** R2 に置く作品のファイル（creator.json と avatar.webp を除く） */
  files: { name: UploadFileName; bytes: Uint8Array }[];
  avatar: Uint8Array;
}

export type CheckedUpload = { ok: true; work: UploadedWork; warnings: Problem[] } | { ok: false; failed: FailedItem[] };

function parseJson(name: string, text: string, shape: Problem[]): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    shape.push({ message: `${name} を JSON として読めない（${(error as Error).message}）`, fix: 'カンマや引用符を直す' });
    return undefined;
  }
}

/**
 * multipart の中身を確かめる。
 * @param files ファイル名 → 中身。知らない名前も渡す（「形」で落とす）
 */
export function checkUpload(files: Map<string, Uint8Array>): CheckedUpload {
  const shape: Problem[] = [];
  const purity: Problem[] = [];
  const warnings: Problem[] = [];
  const decoder = new TextDecoder();
  const text = (name: UploadFileName) => {
    const bytes = files.get(name);
    return bytes === undefined ? null : decoder.decode(bytes);
  };

  for (const name of files.keys()) {
    if (!(UPLOAD_FILES as readonly string[]).includes(name)) {
      shape.push({ message: `知らないファイル ${name} がある`, fix: `${UPLOAD_FILES.join('、')} だけを送る` });
    }
  }
  for (const name of UPLOAD_FILES) {
    const bytes = files.get(name);
    if (bytes === undefined) {
      if (!OPTIONAL.includes(name)) shape.push({ message: `${name} がない`, fix: name.endsWith('.webp') || name === 'og.png' ? 'npx ld add で作ってから送る' : `${name} を付けて送る` });
    } else if (bytes.length > MAX_BYTES[name]) {
      shape.push({ message: `${name} が ${(bytes.length / 1024).toFixed(1)}KB で、上限 ${MAX_BYTES[name] / 1024}KB を超える`, fix: '小さくする' });
    }
  }

  // ---- meta.json と creator.json
  const metaText = text('meta.json');
  const creatorText = text('creator.json');
  const meta = metaText === null ? undefined : parseJson('meta.json', metaText, shape);
  const creator = creatorText === null ? undefined : parseJson('creator.json', creatorText, shape);
  const m = (typeof meta === 'object' && meta !== null ? meta : {}) as Record<string, unknown>;
  const id = typeof m.id === 'string' ? m.id : '';
  const type = m.type === 'screen' ? 'screen' : 'component';

  if (meta !== undefined) {
    // フォルダ名の代わりに meta.json の id を使う。作者がいるかは、下で creator.json と比べる
    shape.push(...checkMeta(meta, id, () => true));
  }
  if (creator !== undefined) {
    // 一緒に送られた作者が、meta.json の creator と同じか（大文字と小文字を区別しない）。kind もここで見る（CLAUDE.md 原則10）
    const handle = typeof m.creator === 'string' ? m.creator : undefined;
    shape.push(...checkCreator(creator, handle));
  }

  // ---- part.html、part.css、part.js
  const html = text('part.html');
  const css = text('part.css');
  const js = text('part.js');
  if (html !== null && id) shape.push(...checkHtml(html, id));
  if (css !== null && id) {
    const result = checkCssShape(css, id, type);
    shape.push(...result.problems);
    warnings.push(...result.warnings);
    const pure = checkPurity(css, id);
    if (type === 'component') purity.push(...pure.problems);
    else warnings.push(...pure.problems); // 画面は警告だけ（CLAUDE.md「作品の契約」）
  }
  if (js !== null) {
    shape.push(...checkJs(js));
    const pure = checkJsPurity(js);
    if (type === 'component') purity.push(...pure.problems);
    else warnings.push(...pure.problems);
  }
  shape.push(...checkReducedMotion(m.tags, css, js));

  // ---- 画像
  const image = (name: UploadFileName, format: 'webp' | 'png', check: (size: { width: number; height: number }) => string | null) => {
    const bytes = files.get(name);
    if (bytes === undefined) return null;
    const size = imageSize(bytes);
    const isFormat = format === 'png' ? bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 : decoder.decode(bytes.subarray(8, 12)) === 'WEBP';
    if (!size || !isFormat) {
      shape.push({ message: `${name} が ${format} として読めない`, fix: 'npx ld add で作り直す' });
      return null;
    }
    const wrong = check(size);
    if (wrong) shape.push({ message: `${name} が ${size.width}×${size.height}（${wrong}）`, fix: 'npx ld add で作り直す' });
    return size;
  };
  const thumb = image('thumb.webp', 'webp', ({ width, height }) =>
    width !== 800 ? '幅は 800px' : height / width < 0.6 || height / width > 1.25 ? '高さ÷幅は 0.6〜1.25' : null,
  );
  image('og.png', 'png', ({ width, height }) => (width === 1200 && height === 630 ? null : '1200×630 にする'));
  image('avatar.webp', 'webp', ({ width, height }) => (width === 96 && height === 96 ? null : '96×96 にする'));

  const failed: FailedItem[] = [];
  if (shape.length > 0) failed.push({ key: 'shape', label: ITEM_LABELS.shape, problems: shape });
  if (purity.length > 0) failed.push({ key: 'purity', label: ITEM_LABELS.purity, problems: purity });
  if (failed.length > 0 || !thumb) return { ok: false, failed };

  const work: UploadedWork = {
    meta: meta as UploadedWork['meta'],
    creator: creator as UploadedWork['creator'],
    thumb,
    files: UPLOAD_FILES.filter((name) => name !== 'creator.json' && name !== 'avatar.webp' && files.has(name)).map((name) => ({
      name,
      bytes: files.get(name)!,
    })),
    avatar: files.get('avatar.webp')!,
  };
  return { ok: true, work, warnings };
}

/** 版を比べる（"1" < "1.1" < "2" < "10"）。 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}
