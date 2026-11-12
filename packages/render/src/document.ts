// 文書の作品（DOC001）。AI がふつうに書いた1つの HTML 文書を、そのまま置き、そのまま動かす。
//
// - 作品の契約（根、mount、セレクタを根の下に）の形にしない。置いた文書は1文字も変えずに枠で返す。
// - 守りは今の枠と同じ：応答の頭の CSP（sandbox、frame-ancestors）、Sec-Fetch-Dest の確かめ、親の sandbox と frame-src。
//   Shadow DOM には入れない（Shadow DOM は CSS を分けるだけで、守りではない。CLAUDE.md「描画」）。
// - サイトの小さなスクリプト（storage の代わり、DPR、「読み込めた」の知らせ、「動きを見る」）は、文書の頭に差し込む。
//   差し込む場所は <!doctype> の直後（なければ文書の頭）。パーサーはそこを <head> の最初に入れるので、文書のどのスクリプトよりも先に動く。
// - コピーされるコードは、その文書。クレジット行は <!doctype> の直後に入れる（前に入れると互換モードになるため）。

import { CAPTURE_SCRIPT } from './capture.ts';
import { ALLOW_MOTION_SCRIPT } from './motion.ts';
import { DPR_SCRIPT, FRAME_CSP, LOADED_SCRIPT } from './frame.ts';
import { creditText, remixCreditText, type RemixSource } from './snippet.ts';
import { STORAGE_SCRIPT } from './storage.ts';

/** 文書の作品を R2 に置くときのファイルの名前。part.html がなく、これがある版が文書の作品。 */
export const DOCUMENT_FILE = 'index.html';

/** 頭の空白とコメントを飛ばした位置。閉じていないコメントは、最後まで飛ばす。 */
function skipBlankAndComments(text: string, from: number): number {
  let at = from;
  for (;;) {
    while (at < text.length && /\s/.test(text[at])) at += 1;
    if (!text.startsWith('<!--', at)) return at;
    const end = text.indexOf('-->', at + 4);
    if (end === -1) return text.length;
    at = end + 3;
  }
}

/** 頭の BOM、空白、コメントの後にある <!doctype …> の終わり（> の次）。なければ null。 */
export function doctypeEnd(text: string): number | null {
  const start = skipBlankAndComments(text, text.charCodeAt(0) === 0xfeff ? 1 : 0);
  if (!/^<!doctype\b/i.test(text.slice(start, start + 10))) return null;
  const end = text.indexOf('>', start);
  return end === -1 ? null : end + 1;
}

/** 1つの HTML が文書の形（頭の空白とコメントの後が <!doctype か <html）か。 */
export function isHtmlDocument(text: string): boolean {
  const start = skipBlankAndComments(text, text.charCodeAt(0) === 0xfeff ? 1 : 0);
  return /^<(?:!doctype|html)(?=[\s>/])/i.test(text.slice(start, start + 10));
}

export interface DocumentFrameOptions {
  /** 端末の「動きを減らす」設定を「減らさない」として見せる（motion.ts の JS の道だけ。文書の CSS は書き換えない） */
  motion?: boolean;
  /**
   * 撮る仕掛け（capture.ts）を足す。持ち主だけが見る下書きの枠で、持ち主が「画像を付ける」を開いたときだけ（DOC002「2」）。
   * 既定は足さない（公開の枠と、今ある作品の枠の HTML は変わらない）。
   */
  capture?: boolean;
}

/** 文書の頭に差し込むもの。順は、今の枠と同じ（storage の代わりが最初、次に DPR と「読み込めた」、次に「動きを見る」）。撮る仕掛けは最後。 */
function headInsert(options: DocumentFrameOptions): string {
  return (
    `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">` +
    `<script>${STORAGE_SCRIPT}</script>` +
    `<script>${DPR_SCRIPT}${LOADED_SCRIPT}</script>` +
    (options.motion ? `<script>${ALLOW_MOTION_SCRIPT}</script>` : '') +
    (options.capture ? `<script>${CAPTURE_SCRIPT}</script>` : '')
  );
}

/** 文書の作品の枠の HTML。文書は1文字も変えず、<!doctype> の直後（なければ頭）に、サイトの小さなスクリプトだけを差し込む。 */
export function buildDocumentFrameHtml(document: string, options: DocumentFrameOptions = {}): string {
  const at = doctypeEnd(document) ?? 0;
  return `${document.slice(0, at)}${headInsert(options)}${document.slice(at)}`;
}

/** クレジットの注釈（UI by @…、Remix of UI by @…）。 */
const CREDIT_COMMENT = /^<!--\s*(?:Remix of )?UI by @[^\n]*?-->[ \t]*\r?\n?/;

/**
 * 文書の頭（<!doctype> の直後、なければ頭）にあるクレジット行を外す。置くときに使う（載せるときにサーバーが作り直す）。
 * get_work で取ったコードをそのまま送り直しても、クレジット行が重ならないように。ほかは1文字も変えない。
 */
export function stripDocumentCredits(document: string): string {
  const doctype = doctypeEnd(document);
  const at = doctype ?? (document.charCodeAt(0) === 0xfeff ? 1 : 0);
  let rest = document.slice(at);
  const lead = doctype === null ? '' : (/^[ \t]*\r?\n/.exec(rest)?.[0] ?? '');
  rest = rest.slice(lead.length);
  let removed = false;
  for (let match = CREDIT_COMMENT.exec(rest); match; match = CREDIT_COMMENT.exec(rest)) {
    rest = rest.slice(match[0].length);
    removed = true;
  }
  return removed ? `${document.slice(0, at)}${lead}${rest}` : document;
}

/**
 * 文書の作品の「コピーされるコード」。その文書に、クレジット行を <!doctype> の直後（なければ1行目）に入れたもの。
 * リミックスは、その次の行に元の作品のクレジット行。文書の中身は変えない。
 */
export function buildDocumentSnippet(document: string, handle: string, id: string, remixOf: RemixSource | null = null): string {
  const lines = [`<!-- ${creditText(handle, id)} -->`, ...(remixOf ? [`<!-- ${remixCreditText(remixOf)} -->`] : [])].join('\n');
  const at = doctypeEnd(document);
  if (at === null) return `${lines}\n${document}`;
  const newline = document.slice(at).startsWith('\n') || document.slice(at).startsWith('\r\n') ? '' : '\n';
  return `${document.slice(0, at)}\n${lines}${newline}${document.slice(at)}`;
}
