// Vite の plugin（vite.config.ts）が用意するモジュール。
// React の木はブラウザ向けの型（DOM）で書くので、Worker の型検査には持ち込まない（src/ は tsc -p . が検査する）。

declare module 'virtual:ludion/before-app' {
  /** HTML の直後にインラインで動かすスクリプト（src/beforeApp.ts を1本にしたもの）。 */
  const code: string;
  export default code;
}

declare module 'virtual:ludion/frame-guard' {
  /** 作品のページの #root より前でインラインで動かすスクリプト（src/frameGuard.ts を1本にしたもの）。 */
  const code: string;
  export default code;
}

declare module 'virtual:ludion/entry-server' {
  import type { PageData } from '../src/data/pages';
  import type { Work } from '../src/data/works';
  export function renderApp(options: { location: string; works: Work[] | null; page: PageData | null }): Promise<ReadableStream<Uint8Array>>;
}

declare module '*.wasm' {
  /** wasm のモジュール（Workers は wasm をその場で作れないので、ビルドの時に読み込む）。 */
  const module: WebAssembly.Module;
  export default module;
}
