// 版のタブの、版の中身を読むことと、違いを Web Worker に頼むこと（WS004）。
//
// - 中身は、今の版の読み口（GET /p/<id>/file/<版>/<ファイル>）だけから読む。だれがどの版を読めるかは Worker（workFile.ts）が決める
//   （公開の作品は承認済みの版だけ、自分だけの作品は持ち主にだけ版のタブの版）。読めない版は、ない版と同じ。
// - 違いの計算は Web Worker（lib/versionDiff.worker.ts）。作れないブラウザでは、ここで計算する（そのときは画面が止まることがある）。

import type { VersionDiff } from './versionDiff';
import type { DiffRequest } from './versionDiff.worker';
import type { VersionFiles } from './versionFiles';

/** 覚えておく版の数（雨の窓ぎわで 1 版 約 240 KB） */
const KEEP_VERSIONS = 8;
const files = new Map<string, Promise<VersionFiles | null>>();

/** 1つのファイル。ない（404）ときは null。読めなかったときは投げる。体は必ず読み切る */
async function readFile(workId: string, version: string, name: string): Promise<string | null> {
  const response = await fetch(`/p/${encodeURIComponent(workId)}/file/${encodeURIComponent(version)}/${name}`, { credentials: 'same-origin' });
  const text = await response.text();
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`file ${response.status}`);
  return text;
}

/**
 * 版の中身。部品の作品は part.html、part.css、part.js。文書の作品は index.html。読めない版は null。
 * documentFirst：先に index.html を試す（今の版が文書の作品のとき。読み口の回数を、ないファイルの 404 で使わない）
 */
export function loadVersionFiles(workId: string, version: string, documentFirst = false): Promise<VersionFiles | null> {
  const key = `${workId}\u0000${version}`;
  const known = files.get(key);
  if (known) {
    // いちばん新しく使ったものとして、後ろへ回す
    files.delete(key);
    files.set(key, known);
    return known;
  }
  const loading = (async (): Promise<VersionFiles | null> => {
    const asDocument = async () => {
      const document = await readFile(workId, version, 'index.html');
      return document === null ? null : { html: null, css: null, js: null, document };
    };
    if (documentFirst) {
      const document = await asDocument();
      if (document) return document;
    }
    const [html, css, js] = await Promise.all(['part.html', 'part.css', 'part.js'].map((name) => readFile(workId, version, name)));
    if (html !== null) return { html, css: css ?? '', js, document: null };
    return documentFirst ? null : asDocument();
  })();
  // 読めなかったものは覚えない（次に開いたときに読み直す）
  loading.catch(() => files.delete(key));
  files.set(key, loading);
  while (files.size > KEEP_VERSIONS) files.delete(files.keys().next().value!);
  return loading;
}

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const waiting = new Map<number, { resolve: (diff: VersionDiff) => void; reject: (error: Error) => void }>();

function startWorker(): Worker | null {
  if (worker || workerBroken || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker(new URL('./versionDiff.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    workerBroken = true;
    return null;
  }
  worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; result?: VersionDiff }>) => {
    const entry = waiting.get(event.data.id);
    if (!entry) return;
    waiting.delete(event.data.id);
    if (event.data.ok && event.data.result) entry.resolve(event.data.result);
    else entry.reject(new Error('diff failed'));
  };
  worker.onerror = () => {
    // 読み込めない（古いブラウザなど）。待っているものは、ここで計算し直す
    workerBroken = true;
    worker?.terminate();
    worker = null;
    for (const entry of waiting.values()) entry.reject(new Error('worker'));
    waiting.clear();
  };
  return worker;
}

async function diffHere(before: VersionFiles, after: VersionFiles, sections: boolean): Promise<VersionDiff> {
  const { diffVersions } = await import('./versionDiff');
  return diffVersions(before, after, { sections });
}

/** 2つの版の違い（before が前の版）。sections：変わったまとまりも出す（地図を作るので、少し重い） */
export async function requestDiff(before: VersionFiles, after: VersionFiles, sections: boolean): Promise<VersionDiff> {
  const running = startWorker();
  if (!running) return diffHere(before, after, sections);
  const id = nextId++;
  try {
    return await new Promise<VersionDiff>((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      running.postMessage({ id, before, after, sections } satisfies DiffRequest);
    });
  } catch (error) {
    if (workerBroken) return diffHere(before, after, sections);
    throw error;
  }
}
