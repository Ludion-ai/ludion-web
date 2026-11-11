// 「リミックス」の指示文（docs/tasks/T030.md、T031.md）。入力はブラウザの中で指示文に入れるだけで、どこへも送らない（CLAUDE.md 原則6）。
import type { Copy } from '../copy';
import { localizedPath, type Locale } from '../i18n';

export const REMIX_BRIEF_MAX = 2000;

/** 指示文の形。url：元のコードの代わりに URL を書く（既定）。full：コードを全部入れる。 */
export type RemixMode = 'url' | 'full';
export const REMIX_MODES: RemixMode[] = ['url', 'full'];

/** 作品のコードを文字で返す口（worker/pages.ts の renderWorkCode）。手元や workers.dev で開いていても本番の URL。 */
export const remixCodeUrl = (workId: string) => `https://ludion.ai/p/${encodeURIComponent(workId)}/code`;

/** コードの大きさ（KB）。UTF-8 のバイト数から。 */
export const snippetKilobytes = (snippet: string) => Math.max(1, Math.round(new TextEncoder().encode(snippet).length / 1024));

/** リミックスを載せる入口（docs/tasks/T033.md B2）。サイトの中のリンク。 */
export const remixPostPath = (locale: Locale, workId: string) => `${localizedPath(locale, '/new')}?from=${encodeURIComponent(workId)}`;

/** 指示文に書く入口。手元や workers.dev で開いていても本番の URL。 */
export const remixPostUrl = (locale: Locale, workId: string) => `https://ludion.ai${remixPostPath(locale, workId)}`;

/** 作品ごとに型を埋める。クレジット行は、コピーされるコードの1行目そのもの。守ることは、どちらの形でも同じ。 */
export function buildRemixPrompt(copy: Copy, brief: string, snippet: string, mode: RemixMode, workId: string, locale: Locale): string {
  const text = copy.work.remix;
  const credit = snippet.slice(0, snippet.indexOf('\n'));
  const original = mode === 'full' ? text.promptFull(snippet.trimEnd()) : text.promptUrl(remixCodeUrl(workId));
  return text.prompt(brief.trim().slice(0, REMIX_BRIEF_MAX), credit, original, remixPostUrl(locale, workId));
}

const MODE_KEY = 'ld-remix-mode';
/** localStorage が使えない端末でも、開いている間は選んだとおりにする。 */
let chosen: RemixMode | null = null;

/** 選んだ形をその端末から読む。覚えていなければ url。 */
export function readRemixMode(): RemixMode {
  if (chosen === null) {
    try {
      chosen = window.localStorage.getItem(MODE_KEY) === 'full' ? 'full' : 'url';
    } catch {
      chosen = 'url';
    }
  }
  return chosen;
}

export function saveRemixMode(mode: RemixMode) {
  chosen = mode;
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // 覚えられないだけで、今の画面では効く
  }
}

/** チップの語を入力に足す。同じ語がもうあるとき、上限を超えるときは、そのまま返す。 */
export function addToBrief(brief: string, phrase: string, joiner: string): string {
  if (brief.includes(phrase)) return brief;
  const base = brief.trimEnd();
  const next = base ? `${base}${joiner}${phrase}` : phrase;
  return next.length <= REMIX_BRIEF_MAX ? next : brief;
}
