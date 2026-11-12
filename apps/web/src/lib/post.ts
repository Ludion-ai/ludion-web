// 作品の投稿のブラウザ側（docs/tasks/T021.md 段階 B）。検査はサーバーでも同じものを流す（画面の検査を信じない）。

import type { ProblemText } from '@ludion/rules';
import type { Locale } from '../i18n';

export type RevisionStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'revoked' | 'private';
export type IdStatus = 'ok' | 'format' | 'reserved' | 'taken';
export type MadeWith = 'human' | 'ai-assisted';

export interface FrameUrls {
  desktop: string;
  mobile: string;
}

/** 「自分の作品」の1行。状態は、いちばん新しい版のもの。 */
export interface OwnWork {
  id: string;
  public: boolean;
  /** 自分だけの作品（docs/tasks/T036.md）。public_version はこのとき、本人だけが見る今の版 */
  private: boolean;
  public_version: string;
  /** 版の数 */
  versions: number;
  /** いちばん新しい版を最後に変えた時刻 */
  updated_at: number;
  revision_id: string;
  version: string;
  status: RevisionStatus;
  title: string;
  category: string;
  subtype: string;
  /** 画像のない下書きは null（docs/tasks/T033.md A3） */
  thumb: string | null;
  thumb_w: number;
  thumb_h: number;
  reject_code: string | null;
  reject_note: string | null;
  /** AI から置いたなら、その AI の名前（いちばん新しくそこから置いた版。MCP001「3」）。画面から置いただけなら null */
  via?: string | null;
}

/** 直すために読む、いちばん新しい版の全部。 */
export interface EditableWork {
  id: string;
  public: boolean;
  /** 自分だけの作品。新しい版は、審査なしで今の版にできる */
  private: boolean;
  public_version: string;
  html: string;
  css: string;
  js: string | null;
  /** リミックスの元の作品の ID */
  remix_of: string | null;
  revision: {
    id: string;
    version: string;
    status: RevisionStatus;
    title: string;
    category: string;
    subtype: string;
    tags: string[];
    made_with: MadeWith;
    reject_code: string | null;
    reject_note: string | null;
    frames: FrameUrls;
    thumb: string | null;
    thumb_w: number;
    thumb_h: number;
  };
}

export interface SavedRevision {
  id: string;
  version: string;
  status: RevisionStatus;
  content_hash: string;
  frames: FrameUrls;
  /** 画像のない下書きは null */
  thumb: string | null;
}

/** リミックスの元（GET /api/post/remix-source/:id）。 */
export interface RemixSource {
  id: string;
  title: string;
  handle: string;
  category: string;
  subtype: string;
  tags: string[];
}

export interface PostInput {
  /** 新しい作品の ID。今ある作品を直すときは workId を渡す */
  id: string;
  workId: string | null;
  /** 下書きは空でよい。審査に出すときに要る */
  title: string;
  category: string;
  subtype: string;
  tags: string[];
  motion: boolean;
  made_with: MadeWith;
  /** 新しい作品のときだけ送る。リミックスの元の作品の ID */
  remix_of?: string | null;
  html: string;
  css: string;
  js: string;
  /** サムネイル。直すときに選ばなければ、今の画像を引き継ぐ */
  thumb: Blob | null;
}

export type SaveAnswer =
  | { ok: true; revision: SavedRevision; optional: ProblemText[] }
  | { ok: false; error: string; problems?: ProblemText[]; limit?: string };

/** 問題の文を、ページの言語で読む。英語の文がない問題は、日本語のまま出す。 */
export function problemText(problem: ProblemText, locale: Locale): { message: string; fix: string } {
  return locale === 'en' && problem.en ? problem.en : problem;
}

/** 題名から作品の ID の案を作る。英字にならない題名（日本語など）は、乱数のものにする。 */
export function suggestId(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');
  if (base.length >= 3 && !base.includes('ludion')) return base;
  return `ui-${Array.from(crypto.getRandomValues(new Uint8Array(3)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** ブラウザで縮める幅。OG 画像（幅1200）より少し大きく、サーバーの画素数の上限に十分収まる。 */
const NORMALIZED_WIDTH = 1600;
const NORMALIZED_HEIGHT = 2000;
const NORMALIZED_QUALITY = 0.9;

/**
 * 選んだ画像を、送る前に縮める。写真の向きも直る。透けているところは白にする。
 * デザイナーの Retina のスクリーンショットは本文の上限を超えるので、そのまま送らない。サーバーではもう一度全部を読み直す。
 * 読めない画像は null。
 */
export async function normalizeThumb(file: Blob): Promise<Blob | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const scale = Math.min(1, NORMALIZED_WIDTH / bitmap.width, NORMALIZED_HEIGHT / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', NORMALIZED_QUALITY));
}

const postJson = (path: string, body?: unknown) =>
  fetch(path, { method: 'POST', ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });

export async function fetchOwnWorks(): Promise<OwnWork[] | 'unauthorized'> {
  const response = await fetch('/api/post/works');
  if (response.status === 401) return 'unauthorized';
  if (!response.ok) throw new Error(`GET /api/post/works: ${response.status}`);
  return ((await response.json()) as { works: OwnWork[] }).works;
}

export async function fetchEditableWork(id: string): Promise<EditableWork | 'unauthorized' | 'not_found'> {
  const response = await fetch(`/api/post/works/${encodeURIComponent(id)}`);
  if (response.status === 401) return 'unauthorized';
  if (response.status === 403 || response.status === 404) return 'not_found';
  if (!response.ok) throw new Error(`GET /api/post/works/:id: ${response.status}`);
  return (await response.json()) as EditableWork;
}

export async function fetchIdStatus(id: string): Promise<IdStatus> {
  const response = await fetch(`/api/post/id-check?id=${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`GET /api/post/id-check: ${response.status}`);
  return ((await response.json()) as { status: IdStatus }).status;
}

/** 下書きを保存する。文字は Blob で送る（FormData の文字列は改行を変えるため）。 */
export async function saveDraft(input: PostInput): Promise<SaveAnswer> {
  const form = new FormData();
  form.append(
    'meta',
    JSON.stringify({
      ...(input.workId ? {} : { id: input.id }),
      title: input.title,
      category: input.category,
      subtype: input.subtype,
      tags: input.tags,
      motion: input.motion,
      made_with: input.made_with,
      ...(input.workId || !input.remix_of ? {} : { remix_of: input.remix_of }),
    }),
  );
  form.append('part.html', new Blob([input.html], { type: 'text/plain' }));
  form.append('part.css', new Blob([input.css], { type: 'text/plain' }));
  if (input.js.trim()) form.append('part.js', new Blob([input.js], { type: 'text/plain' }));
  if (input.thumb) form.append('thumb', input.thumb);
  const path = input.workId ? `/api/post/works/${encodeURIComponent(input.workId)}/revisions` : '/api/post/works';
  const response = await fetch(path, { method: 'POST', body: form });
  const body = (await response.json().catch(() => null)) as { error?: string; problems?: ProblemText[]; limit?: string; revision?: SavedRevision; optional?: ProblemText[] } | null;
  if (response.ok && body?.revision) return { ok: true, revision: body.revision, optional: body.optional ?? [] };
  return { ok: false, error: body?.error ?? (response.status === 401 ? 'unauthorized' : response.status === 413 ? 'too_large' : 'failed'), problems: body?.problems, limit: body?.limit };
}

export async function submitRevision(revisionId: string): Promise<'ok' | 'not_draft' | 'title_required' | 'thumb_required' | 'failed'> {
  const response = await postJson(`/api/post/revisions/${revisionId}/submit`, { own: true, mit: true, terms: true });
  if (response.ok) return 'ok';
  if (response.status === 409) return 'not_draft';
  const error = ((await response.json().catch(() => null)) as { error?: string } | null)?.error;
  return error === 'title_required' || error === 'thumb_required' ? error : 'failed';
}

/** リミックスの元を読む。承認済みの作品でなければ null（画面は from を捨てる）。 */
export async function fetchRemixSource(id: string): Promise<RemixSource | null> {
  const response = await fetch(`/api/post/remix-source/${encodeURIComponent(id)}`);
  if (!response.ok) return null;
  return (await response.json()) as RemixSource;
}

/** 一度も審査に出していない作品を消す（作品の ID を変えるとき）。 */
export async function discardWork(id: string): Promise<boolean> {
  return (await postJson(`/api/post/works/${encodeURIComponent(id)}/discard`)).ok;
}

/** 作品の ID の案を、取れるものになるまで作る。貼ったコードの data-ld-part の値を先に試し、取れなければ後ろに乱数を足す。 */
export async function pickWorkId(preferred: string | null, check: (id: string) => Promise<IdStatus> = fetchIdStatus): Promise<string> {
  const random = () => Array.from(crypto.getRandomValues(new Uint8Array(2)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const base = preferred && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(preferred) && !preferred.includes('ludion') ? preferred.slice(0, 50).replace(/-+$/, '') : null;
  const candidates = [...(base && base.length >= 3 ? [base] : []), ...Array.from({ length: 4 }, () => (base && base.length >= 3 ? `${base}-${random()}` : `ui-${random()}${random().slice(0, 2)}`))];
  for (const candidate of candidates) {
    if ((await check(candidate)) === 'ok') return candidate;
  }
  throw new Error('no free id');
}

export type PlaceAnswer = 'ok' | 'not_draft' | 'title_required' | 'private_limit' | 'public' | 'failed';

/** 自分だけで置く（docs/tasks/T036.md「1」）。審査に出さず、すぐ今の版になる。 */
export async function placeRevision(revisionId: string): Promise<PlaceAnswer> {
  const response = await postJson(`/api/post/revisions/${revisionId}/place`, { own: true, mit: true, terms: true });
  if (response.ok) return 'ok';
  const error = ((await response.json().catch(() => null)) as { error?: string } | null)?.error;
  return error === 'not_draft' || error === 'title_required' || error === 'private_limit' || error === 'public' ? error : 'failed';
}

export type PublishAnswer = 'ok' | 'thumb_required' | 'title_required' | 'has_draft' | 'not_placed' | 'failed';

/** 自分だけ → 公開する。今の版を審査に出す（docs/tasks/T036.md「4」）。 */
export async function publishWork(id: string): Promise<PublishAnswer> {
  const response = await postJson(`/api/post/works/${encodeURIComponent(id)}/publish`, { own: true, mit: true, terms: true });
  if (response.ok) return 'ok';
  const error = ((await response.json().catch(() => null)) as { error?: string } | null)?.error;
  return error === 'thumb_required' || error === 'title_required' || error === 'has_draft' || error === 'not_placed' ? error : 'failed';
}

/** 公開 → 自分だけにする。すぐ（docs/tasks/T036.md「4」）。 */
export async function makeWorkPrivate(id: string): Promise<'ok' | 'private_limit' | 'failed'> {
  const response = await postJson(`/api/post/works/${encodeURIComponent(id)}/make-private`);
  if (response.ok) return 'ok';
  const error = ((await response.json().catch(() => null)) as { error?: string } | null)?.error;
  return error === 'private_limit' ? error : 'failed';
}

export type ThumbAnswer = { ok: true } | { ok: false; error: string; limit?: string };

/** 自分だけの作品に、画像だけを足す（DOC002「1」）。画像を足した新しい版が、今の版になる。 */
export async function uploadThumb(id: string, thumb: Blob): Promise<ThumbAnswer> {
  const form = new FormData();
  form.append('thumb', thumb);
  const response = await fetch(`/api/post/works/${encodeURIComponent(id)}/thumb`, { method: 'POST', body: form });
  if (response.ok) return { ok: true };
  const body = (await response.json().catch(() => null)) as { error?: string; limit?: string } | null;
  return { ok: false, error: body?.error ?? (response.status === 413 ? 'too_large' : 'failed'), limit: body?.limit };
}

/**
 * 撮る仕掛けとのやりとりの形（packages/render/src/capture.ts と同じ値。e2e/thumb-capture.spec.ts が同じことを確かめる）。
 * ブラウザの組み立てに packages/render を入れない（撮る仕掛けの文字列がサイトの JS に入るため）。
 */
export const CAPTURE_REQUEST = 'ld-thumb-capture';
export const CAPTURE_RESULT = 'ld-thumb-captured';
export const CAPTURE_READY = 'ld-thumb-ready';

/** 枠から撮った絵（PNG の data URL）の上限。1280×800 の PNG は、細かい絵でも数 MB。これより大きいものは受けない。 */
export const MAX_CAPTURE_URL_CHARS = 12 * 1024 * 1024;
const CAPTURE_PREFIX = 'data:image/png;base64,';

/**
 * 枠から届いた絵を確かめて、PNG の Blob にする（DOC002「4」）。形が `data:image/png;base64,` で、上限の中で、読める base64 のときだけ。
 * 絵の大きさ（幅と高さ）は、呼ぶ側が画像として読んで確かめる。
 */
export function captureToBlob(url: unknown): Blob | null {
  if (typeof url !== 'string' || !url.startsWith(CAPTURE_PREFIX) || url.length > MAX_CAPTURE_URL_CHARS) return null;
  const base64 = url.slice(CAPTURE_PREFIX.length);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return null;
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  // PNG の印で始まること
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (signature.some((value, index) => bytes[index] !== value)) return null;
  return new Blob([bytes], { type: 'image/png' });
}
