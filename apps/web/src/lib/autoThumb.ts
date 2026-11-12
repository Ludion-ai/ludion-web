// サムネイルを自動で撮る（THUMB001）。「自分の作品」で、画像のない自分だけの作品を、持ち主のブラウザが枠から撮って付ける。
//
// - 撮るのは持ち主の下書きの枠（/draft-frame/...?capture=1）。守りは今の枠と同じ（sandbox、親の CSP）。サーバーでは作品を描画しない。
// - 人が絵を見ないので、枠には strict（canvas が写っていない絵を出さない）と fit（部品のまわりを切り出す）を付けて頼む。
// - 送るのは今の「画像だけを足す口」に ?only_missing=1（今の版に画像がないときだけ足す）。絵はサーバーがもう一度全部を読み直す。
// - 撮れなかった版は、このブラウザが覚えて、もう試さない（localStorage。版が変われば、また試す）。
// - 同時に動かす枠は1つ。順番はここで決める。
// - WebKit（Safari と、iPhone・iPad の全部のブラウザ）では撮らない（canAutoCapture）。

import { FRAME_SIZES } from './frame';
import { captureToBlob, normalizeThumb } from './post';

/** 撮れなかった版（revision の id）を覚える鍵。e2e も同じ鍵を使う。 */
export const AUTO_THUMB_SKIP_KEY = 'ld-auto-thumb-skip';
const SKIP_LIMIT = 300;

/** 枠の load の後、撮る仕掛けの「ある」の知らせを待つ時間。 */
export const AUTO_READY_WAIT_MS = 2500;
/** 枠を置いてから、load と「ある」の知らせの両方を待つ時間（回線が遅いとき。覚えずに、次に開いたときにまた試す）。 */
export const AUTO_LOAD_WAIT_MS = 20_000;
/** 「ある」の知らせの後、作品が最初の絵を描き終えるまで待つ時間（入りの動きなど）。 */
export const AUTO_SETTLE_MS = 2000;
/** 頼んでから、絵が届くまで待つ時間。 */
export const AUTO_RESULT_WAIT_MS = 20_000;

/** fit で切り出した絵の大きさ（packages/render/src/capture.ts の CAPTURE_FIT_SIZE と同じ値。e2e が同じことを確かめる）。 */
export const AUTO_FIT_SIZE = { width: 800, height: 600 } as const;
const SIZE_SLACK = 2;

/**
 * 自動で撮れるブラウザか。WebKit（Safari と、iPhone・iPad の全部のブラウザ）では撮らない。枠の絵に canvas が写らないことがあり、
 * 影の形も崩れることがある（THUMB001 で、手元の WebKit で確かめた）。人が絵を見て付ける道（「画像を付ける」）は、そのまま使える。
 * Chromium の系統（Chrome、Edge など）は AppleWebKit と Chrome の両方を名乗る。iPhone の Chrome（CriOS）は WebKit。
 */
export function canAutoCapture(userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  return userAgent !== '' && (!userAgent.includes('AppleWebKit/') || userAgent.includes('Chrome/') || userAgent.includes('Chromium/'));
}

function readSkips(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(AUTO_THUMB_SKIP_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** この版は、前に撮れなかった。 */
export function isSkipped(revisionId: string): boolean {
  return readSkips().includes(revisionId);
}

/** この版は撮れなかった、と覚える。保存できないブラウザでは、開くたびに1回試すだけになる。 */
export function rememberSkip(revisionId: string): void {
  try {
    const list = readSkips().filter((item) => item !== revisionId);
    list.push(revisionId);
    localStorage.setItem(AUTO_THUMB_SKIP_KEY, JSON.stringify(list.slice(-SKIP_LIMIT)));
  } catch {
    // 保存できない（プライベートな窓など）
  }
}

interface Waiter {
  grant: () => void;
}

let current: Waiter | null = null;
let halted = false;
const waiting: Waiter[] = [];

function pump(): void {
  if (current || halted) return;
  const next = waiting.shift();
  if (!next) return;
  current = next;
  next.grant();
}

/**
 * 撮る順番を待つ。番が来たら grant が呼ばれる（呼ぶのは、この関数が返った後）。
 * 返す関数は、待つのをやめるとき、または撮り終えたときに呼ぶ（次の人に番が回る）。
 */
export function requestTurn(grant: () => void): () => void {
  const waiter: Waiter = { grant };
  waiting.push(waiter);
  queueMicrotask(pump);
  return () => {
    const at = waiting.indexOf(waiter);
    if (at !== -1) waiting.splice(at, 1);
    if (current === waiter) {
      current = null;
      queueMicrotask(pump);
    }
  };
}

/** このページでは、もう撮らない（回数の上限、ログインが切れた）。読み込み直すと、また試す。 */
export function haltTurns(): void {
  halted = true;
  waiting.length = 0;
}

/**
 * 枠から届いた絵を確かめて、送る形（JPEG）にする。形、大きさ（枠の 1280×800 か、切り出しの 800×600）が合わなければ null。
 * 知らせは作品の JS も作れるので、ここで確かめ、サーバーももう一度全部を読み直す。
 */
export async function autoShot(url: unknown): Promise<Blob | null> {
  const blob = captureToBlob(url);
  if (!blob) return null;
  const bitmap = await createImageBitmap(blob).catch(() => null);
  if (!bitmap) return null;
  const { width, height } = bitmap;
  bitmap.close();
  const fits = (size: { width: number; height: number }) => Math.abs(width - size.width) <= SIZE_SLACK && Math.abs(height - size.height) <= SIZE_SLACK;
  if (!fits(FRAME_SIZES.desktop) && !fits(AUTO_FIT_SIZE)) return null;
  return normalizeThumb(blob);
}

/**
 * ok：付いた。skip：この版には付けられない（もう試さない）。later：今は付けられない（次に開いたときにまた試す）。
 * halt：このページでは、もう撮らない（回数の上限、ログインが切れた）。
 */
export type AutoThumbAnswer = 'ok' | 'skip' | 'later' | 'halt';

/** 自動で撮った絵を送る。今の版に画像がないときだけ足される。 */
export async function sendAutoThumb(workId: string, thumb: Blob): Promise<AutoThumbAnswer> {
  const form = new FormData();
  form.append('thumb', thumb);
  let response: Response;
  try {
    response = await fetch(`/api/post/works/${encodeURIComponent(workId)}/thumb?only_missing=1`, { method: 'POST', body: form });
  } catch {
    return 'later';
  }
  if (response.ok) return 'ok';
  if (response.status === 401 || response.status === 403 || response.status === 429) return 'halt';
  if (response.status >= 500) return 'later';
  // 409（直している途中の版がある、もう画像がある、ぶつかった）、422（画像を読めない）、413、404
  return 'skip';
}
