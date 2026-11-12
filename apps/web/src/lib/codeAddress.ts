// 行の住所（WS003）：/p/<id>/code/<file>#L204-L760。人にも AI にも「ここ」と渡せる形。
// 道（どのファイルか）は Worker も読む。# の後ろ（どの行か）はブラウザだけが読む。

/** 選んだ行の範囲。1 から数え、end を含む */
export interface LineRange {
  start: number;
  end: number;
}

/** 版のファイルの名前（worker/workFile.ts の WORK_FILE_NAMES と同じ） */
export const CODE_FILE_NAMES = ['part.html', 'part.css', 'part.js', 'index.html'];

/** 道の残り（React Router の *）から、開いているファイルの名前。code/<file> の形でなければ null */
export function fileOfSplat(splat: string | undefined): string | null {
  const match = /^code\/([^/]+)\/?$/.exec(splat ?? '');
  return match && CODE_FILE_NAMES.includes(match[1]) ? match[1] : null;
}

/** #L204、#L204-L760（#L204-760 も受ける）。だめなら null */
export function parseLineHash(hash: string): LineRange | null {
  const match = /^#L(\d{1,7})(?:-L?(\d{1,7}))?$/.exec(hash);
  if (!match) return null;
  const a = Number(match[1]);
  const b = match[2] === undefined ? a : Number(match[2]);
  if (a < 1 || b < 1) return null;
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

export function formatLineHash(range: LineRange | null): string {
  if (!range) return '';
  return range.end > range.start ? `#L${range.start}-L${range.end}` : `#L${range.start}`;
}

/** 作品のページの言語のない道（/p/<id>）。行の住所と本文の読み口は、この下（リンクで見せるページは /s/<合言葉>。SHARE001） */
export const workBase = (id: string): string => `/p/${encodeURIComponent(id)}`;

/** 言語のない道（/p/<id>/code/<file>#L…）。base は workBase か /s/<合言葉>。リンクにするときは localizedPath を通す */
export function codePath(base: string, file: string, range: LineRange | null = null): string {
  return `${base}/code/${file}${formatLineHash(range)}`;
}

/** 本文のための読み口（worker/workFile.ts、/s/ は worker/pages.ts の renderSharedFile）。クレジット行なしで、行の番号は本物のファイルと同じ */
export function fileTextUrl(base: string, version: string, file: string): string {
  return `${base}/file/${encodeURIComponent(version)}/${file}`;
}

/**
 * 「ファイルをコピー」で書く文字：頭にクレジット行（CLAUDE.md 原則4）。/p/<id>/raw/<file> と同じ文字（worker/workRead.ts の rawFile）。
 * HTML は <!-- -->、CSS と JS はコメント。文書の作品（index.html）は「全部をコピー」と同じ文字なので、ここでは作らない。
 */
export function fileCopyText(file: string, text: string, credit: string[]): string {
  const [open, close] = file.endsWith('.html') ? ['<!-- ', ' -->'] : ['/* ', ' */'];
  return `${credit.map((line) => `${open}${line}${close}\n`).join('')}${text}`;
}
