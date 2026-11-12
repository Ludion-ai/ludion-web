// 1つの版のファイル（WS004）。違いの計算（lib/versionDiff.ts。Web Worker で動く）と、違いの画面が使う。
// 地図（@ludion/outline）を読み込まないので、ページの JS を重くしない。

/** 1つの版のファイル（版の読み口 /p/<id>/file/<版>/<ファイル> から読んだ文字）。null はその版にないファイル */
export interface VersionFiles {
  html: string | null;
  css: string | null;
  js: string | null;
  /** 文書の作品（DOC001）の index.html */
  document: string | null;
}

/** 版のファイルを、名前と文字の並びにする（ファイルの木と同じ順） */
export function namedFiles(files: VersionFiles): { name: string; text: string }[] {
  if (files.document !== null) return [{ name: 'index.html', text: files.document }];
  const out: { name: string; text: string }[] = [];
  if (files.html !== null) out.push({ name: 'part.html', text: files.html });
  if (files.css !== null) out.push({ name: 'part.css', text: files.css });
  if (files.js !== null) out.push({ name: 'part.js', text: files.js });
  return out;
}
