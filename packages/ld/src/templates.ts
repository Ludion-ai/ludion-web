// ld new の雛形。根の宣言と10個の --_* を最初から入れる（CLAUDE.md「作品の契約」）。

import type { MadeWith, Platform, WorkMeta, WorkType } from '@ludion/render';

export function titleFromId(id: string): string {
  return id
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** 手元の日付（YYYY-MM-DD）。 */
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function newMeta(options: { id: string; type: WorkType; platform: Platform | null; creator: string; madeWith: MadeWith; date: string }): WorkMeta {
  const category = options.type === 'component' ? 'Components' : options.platform === 'mobile' ? 'Mobile' : 'Web';
  return {
    id: options.id,
    title: titleFromId(options.id),
    type: options.type,
    platform: options.platform,
    category,
    subtype: '',
    tags: [],
    creator: options.creator,
    license: 'MIT',
    made_with: options.madeWith,
    version: '1',
    published_at: options.date,
    pin_order: null,
  };
}

export function newHtml(id: string, type: WorkType): string {
  if (type === 'component') {
    return `<div data-ld-part="${id}">
  <button class="button" type="button">Button</button>
</div>
`;
  }
  return `<div data-ld-part="${id}">
  <main class="page">
    <h1 class="title">${titleFromId(id)}</h1>
    <p class="lead">ここに画面を作る。</p>
  </main>
</div>
`;
}

export function newCss(id: string, type: WorkType): string {
  const root = `[data-ld-part="${id}"]`;
  const tokens = `${root} {
  /* 固定しないトークン：使い手の値を受け、なければ作者の値 */
  --_bg: var(--ld-bg, #ffffff);
  --_surface: var(--ld-surface, #f4f4f5);
  --_fg: var(--ld-fg, #18181b);
  --_muted: var(--ld-muted, #6b6b76);
  --_accent: var(--ld-accent, #2563eb);
  --_radius: var(--ld-radius, 8px);
  --_font: var(--ld-font, system-ui, sans-serif);
  --_space: var(--ld-space, 8px);
  --_shadow: var(--ld-shadow, 0 1px 3px rgb(0 0 0 / .12));
  --_motion: var(--ld-motion, 150ms);
  /* 固定したいトークンは、var() を外して値だけを書く。例：--_accent: #ff6a3d; */
  /* 任意：エラーや危険な操作の色を使うときだけ、次の1行を足す。--_danger: var(--ld-danger, #c81e1e); */

  font-family: var(--_font);
  color: var(--_fg);
`;
  if (type === 'component') {
    return `${tokens}}

${root} .button {
  padding: calc(var(--_space) * 1.5) calc(var(--_space) * 3);
  border: 0;
  border-radius: var(--_radius);
  background: var(--_accent);
  color: var(--_bg);
  font: 600 14px/20px var(--_font);
  box-shadow: var(--_shadow);
  cursor: pointer;
  transition: background var(--_motion) ease;
}
${root} .button:hover {
  background: color-mix(in oklab, var(--_accent) 85%, black);
}
`;
  }
  return `${tokens}  display: block;
  min-height: 100vh;
  background: var(--_bg);
}

${root} .page {
  max-width: 960px;
  margin: 0 auto;
  padding: calc(var(--_space) * 8) calc(var(--_space) * 3);
}
${root} .title {
  margin: 0;
  font-size: 40px;
  line-height: 1.1;
}
${root} .lead {
  margin: calc(var(--_space) * 2) 0 0;
  color: var(--_muted);
}
`;
}
