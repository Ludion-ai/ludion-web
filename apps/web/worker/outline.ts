// 作品の中身の地図（WS002）。版を置くときに作り、R2 の版の置き場に outline.json として置く。
// 今ある版は、初めて要るときに作って置く（loadOutline）。
// 地図が作れなくても、置くことは止めない（記録だけ）。地図を返す道は worker/workRead.ts（WS006）。だれが読めるかは、そこで決める。
// R2 の型に頼らない（e2e の試験から偽の置き場で呼べるように）。R2Bucket はそのまま渡せる。

import { OUTLINE_FILE, OUTLINE_VERSION, buildOutline, type Outline, type OutlineInput } from '@ludion/outline';
import { errorType, logError } from './log';

export { OUTLINE_FILE };
export const OUTLINE_CONTENT_TYPE = 'application/json; charset=utf-8';

/** 地図を読み書きするのに要る置き場の形（R2Bucket の一部） */
export interface OutlineBucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
}

/** 版の中身から地図の JSON を作る。作れなければ null（ログに残すだけ）。 */
export function outlineJson(work: OutlineInput): string | null {
  try {
    return JSON.stringify(buildOutline(work));
  } catch (error) {
    logError('outline_failed', { step: 'build', error: errorType(error) });
    return null;
  }
}

/** バイト列のファイルから地図の JSON を作る（今の版のファイルを写すとき、ld upload のとき） */
export function outlineFromBytes(files: { html: Uint8Array | null; css: Uint8Array | null; js: Uint8Array | null; document: Uint8Array | null }): string | null {
  const decoder = new TextDecoder();
  const text = (bytes: Uint8Array | null) => (bytes === null ? null : decoder.decode(bytes));
  const document = text(files.document);
  return document !== null && files.html === null
    ? outlineJson({ html: '', css: '', js: null, document })
    : outlineJson({ html: text(files.html) ?? '', css: text(files.css) ?? '', js: text(files.js) });
}

/**
 * 版の地図。置き場にあって形の版が同じならそれを返す。なければ（または古い形なら）版のファイルから作って置く。
 * readFiles は版のファイルを読む関数（ふつうは () => loadRevisionFiles(env.PARTS, prefix)）。読めなければ null。
 */
export async function loadOutline(bucket: OutlineBucket, prefix: string, readFiles: () => Promise<OutlineInput | null>): Promise<Outline | null> {
  const key = `${prefix}/${OUTLINE_FILE}`;
  const stored = await bucket.get(key);
  if (stored) {
    try {
      const parsed = JSON.parse(await stored.text()) as Outline;
      if (parsed && parsed.version === OUTLINE_VERSION) return parsed;
    } catch {
      // 壊れていれば作り直す
    }
  }
  const work = await readFiles();
  if (!work) return null;
  const json = outlineJson(work);
  if (json === null) return null;
  try {
    await bucket.put(key, json, { httpMetadata: { contentType: OUTLINE_CONTENT_TYPE } });
  } catch (error) {
    logError('outline_failed', { step: 'put', error: errorType(error) });
  }
  return JSON.parse(json) as Outline;
}
