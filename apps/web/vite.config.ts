import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { join } from 'node:path';
import { build, defineConfig, type Plugin } from 'vite';

/**
 * Inter を先読みする。書体の差し替えでチップの幅が変わると、CLS に効く。
 * ファイル名にハッシュが付くので、ビルドの結果から探して <link> を足す。
 */
function preloadInter(): Plugin {
  return {
    name: 'ludion:preload-inter',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const file = Object.keys(ctx.bundle ?? {}).find((name) =>
          /inter-latin-wght-normal.*\.woff2$/.test(name),
        );
        if (!file) return [];
        return [
          {
            tag: 'link',
            attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `/${file}`, crossorigin: '' },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  };
}

/**
 * Worker が読むモジュール（worker/virtual.d.ts）。
 * - virtual:ludion/entry-server：React の木（src/entry-server.tsx）
 * - virtual:ludion/before-app：HTML の直後にインラインで動かすスクリプト（src/beforeApp.ts を1本にした文字列）
 * - virtual:ludion/frame-guard：作品のページの #root より前でインラインで動かすスクリプト（src/frameGuard.ts を1本にした文字列）
 * - virtual:ludion/preview-start：作品のページの #root より前でインラインで動かすスクリプト（src/previewStart.ts を1本にした文字列）
 */
function workerModules(): Plugin {
  const INLINE_SCRIPTS: Record<string, string> = {
    'virtual:ludion/before-app': 'src/beforeApp.ts',
    'virtual:ludion/frame-guard': 'src/frameGuard.ts',
    'virtual:ludion/preview-start': 'src/previewStart.ts',
  };
  const ENTRY_SERVER = 'virtual:ludion/entry-server';
  const root = import.meta.dirname;
  return {
    name: 'ludion:worker-modules',
    resolveId(id) {
      if (id === ENTRY_SERVER) return join(root, 'src/entry-server.tsx');
      if (id in INLINE_SCRIPTS) return `\0${id}`;
    },
    async load(id) {
      const file = id.startsWith('\0') ? INLINE_SCRIPTS[id.slice(1)] : undefined;
      if (!file) return;
      const entry = join(root, file);
      this.addWatchFile(entry);
      const result = await build({
        root,
        configFile: false,
        logLevel: 'warn',
        build: { write: false, minify: true, lib: { entry, formats: ['iife'], name: 'ludionInline' } },
      });
      const code = (Array.isArray(result) ? result[0] : (result as { output: { code: string }[] })).output[0].code.trim();
      if (code.includes('</script')) throw new Error(`${file} に </script が含まれる`);
      return `export default ${JSON.stringify(code)};`;
    },
  };
}

/**
 * Worker ludion-web（wrangler.jsonc）を、開発でもビルドでも Vite の中で動かす。
 * - LD_PERSIST_DIR：手元の D1 と R2 を置く場所（テストで使い捨ての場所にするため。既定は .wrangler/state）
 */
function worker(): Plugin[] {
  const persistDir = process.env.LD_PERSIST_DIR;
  return cloudflare({
    persistState: persistDir ? { path: persistDir } : true,
    // テストは2つのサーバーを同時に立てる。検査用のポートの取り合いを避ける
    ...(process.env.LD_NO_INSPECTOR ? { inspectorPort: false as const } : {}),
  });
}

export default defineConfig({
  plugins: [workerModules(), react(), tailwindcss(), preloadInter(), worker()],
});
