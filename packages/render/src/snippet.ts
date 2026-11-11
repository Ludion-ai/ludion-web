// コピーされるコード（CLAUDE.md「コピーされるコード」）。
// 1行目、<style> の1行目、<script> の1行目に、必ずクレジット行を入れる。

import { buildDocumentSnippet } from './document.ts';
import { stripExports } from './js.ts';
import type { Creator, Work } from './types.ts';

/** `UI by @handle — ludion.ai/p/id (MIT)` */
export function creditText(handle: string, id: string): string {
  return `UI by @${handle} — ludion.ai/p/${id} (MIT)`;
}

/** コピー用の文字列の1行目。 */
export function creditLine(handle: string, id: string): string {
  return `<!-- ${creditText(handle, id)} -->`;
}

/** リミックスの元（docs/tasks/T033.md B4）。直接の元だけ。 */
export interface RemixSource {
  handle: string;
  id: string;
}

/** `Remix of UI by @handle — ludion.ai/p/id (MIT)`。リミックスのコピー用の文字列の2行目。 */
export function remixCreditText(source: RemixSource): string {
  return `Remix of ${creditText(source.handle, source.id)}`;
}

/**
 * クレジット行の handle は、作者（creator.json）に保存した綴りのまま使う（例：@Lattice_Node）。
 * meta.json の creator とは、大文字と小文字を区別せずに比べる。
 * リミックス（remixOf）は、2行目に元の作品のクレジット行を入れる。<style> と <script> の頭も同じ2行（CLAUDE.md「コピーされるコード」）。
 */
export function buildCopySnippet(work: Work, creator: Creator, remixOf: RemixSource | null = null): string {
  const { id } = work.meta;
  if (creator.handle.toLowerCase() !== work.meta.creator.toLowerCase()) {
    throw new Error(`作者が合わない：meta.json は @${work.meta.creator}、渡されたのは @${creator.handle}`);
  }
  const handle = creator.handle;
  // 文書の作品（DOC001）は、その文書。クレジット行は <!doctype> の直後（document.ts）
  if (typeof work.document === 'string') return buildDocumentSnippet(work.document, handle, id, remixOf);
  const credit = creditText(handle, id);
  const remix = remixOf ? remixCreditText(remixOf) : null;
  const head = (open: string, close: string) => [`${open}${credit}${close}`, ...(remix ? [`${open}${remix}${close}`] : [])];
  const lines = [...head('<!-- ', ' -->'), work.html.trim(), '<style>', ...head('/* ', ' */'), work.css.trim(), '</style>'];
  if (typeof work.js === 'string' && work.js.trim() !== '') {
    lines.push(
      '<script type="module">',
      ...head('/* ', ' */'),
      stripExports(work.js).trim(),
      `mount(document.querySelector('[data-ld-part="${id}"]'));`,
      '</script>',
    );
  }
  return lines.join('\n') + '\n';
}
