// トークンの名前と、明るい中立・暗い中立の値（docs/tasks/T002.md「2」の表、T006.md「1」）。

/** 必須の10個。部品は根で全部を宣言する。 */
export const TOKEN_NAMES = [
  'bg',
  'surface',
  'fg',
  'muted',
  'accent',
  'radius',
  'font',
  'space',
  'shadow',
  'motion',
] as const;

/** 任意のトークン。使う作品だけが根で宣言する（docs/tasks/T006.md「1」）。 */
export const OPTIONAL_TOKEN_NAMES = ['danger'] as const;

/** 全部のトークン。枠に流す値で、D1 の `tokens_locked` が受ける名前でもある。 */
export const ALL_TOKEN_NAMES = [...TOKEN_NAMES, ...OPTIONAL_TOKEN_NAMES] as const;

export type TokenName = (typeof ALL_TOKEN_NAMES)[number];
export type TokenValues = Record<TokenName, string>;

export const NEUTRAL_PALETTES: { light: TokenValues; dark: TokenValues } = {
  light: {
    bg: '#ffffff',
    surface: '#f4f4f5',
    fg: '#18181b',
    muted: '#6b6b76',
    accent: '#2563eb',
    radius: '6px',
    font: 'system-ui, sans-serif',
    space: '8px',
    shadow: '0 1px 3px rgb(0 0 0 / .12)',
    motion: '150ms',
    danger: '#c81e1e', // 白の上で 5.74:1、#f4f4f5 の上で 5.22:1
  },
  dark: {
    bg: '#0a0a0a',
    surface: '#171717',
    fg: '#fafafa',
    muted: '#a1a1aa',
    accent: '#22c55e',
    radius: '12px',
    font: 'system-ui, sans-serif',
    space: '8px',
    shadow: '0 8px 24px rgb(0 0 0 / .4)',
    motion: '200ms',
    danger: '#f87171', // #0a0a0a の上で 7.16:1、#171717 の上で 6.48:1
  },
};

/** `--ld-bg:#ffffff;--ld-surface:…` の形。style 属性にそのまま入れる。 */
export function tokenDeclarations(values: TokenValues): string {
  return ALL_TOKEN_NAMES.map((name) => `--ld-${name}:${values[name]}`).join(';');
}
