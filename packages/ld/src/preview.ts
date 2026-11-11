// ld preview：3つの配色 × 3つの幅を、手元のページで同時に出す。
// 各枠は buildFrameHtml を sandbox の iframe（FRAME_SANDBOX）で出す。ファイルを保存すると、すぐに描き直す。

import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { FRAME_SANDBOX, buildFrameHtml, type Palette } from '@ludion/render';
import { readWork, shown, toRenderable, type WorkLocation } from './workspace.ts';

export const PREVIEW_WIDTHS = [390, 768, 1280] as const;
export const PREVIEW_HEIGHTS: Record<number, number> = { 390: 844, 768: 1024, 1280: 800 };
export const PREVIEW_PALETTES: { palette: Palette; label: string }[] = [
  { palette: 'author', label: '作者' },
  { palette: 'light', label: '明るい中立' },
  { palette: 'dark', label: '暗い中立' },
];

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pageHtml(location: WorkLocation): string {
  const total = PREVIEW_WIDTHS.reduce((sum, w) => sum + w, 0);
  const rows = PREVIEW_PALETTES.map(
    ({ palette, label }) => `<section class="row">${PREVIEW_WIDTHS.map((width) => {
      const height = PREVIEW_HEIGHTS[width];
      const src = `/frame?palette=${palette}&width=${width}`;
      return `<figure style="--w:${width};--h:${height}"><figcaption>${label} · ${width}</figcaption><div class="box"><iframe sandbox="${FRAME_SANDBOX}" title="${label} ${width}px" width="${width}" height="${height}" data-src="${src}" src="${src}&v=0"></iframe></div></figure>`;
    }).join('')}</section>`,
  ).join('\n');
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>ld preview · ${escapeHtml(location.id)}</title>
<style>
:root{--s:.3;color-scheme:light}
body{margin:0;padding:16px 24px 32px;background:#F4F4F6;color:#111114;font:14px/20px system-ui,sans-serif}
header{display:flex;gap:16px;align-items:baseline;margin-bottom:12px}
header h1{margin:0;font-size:16px}
header p{margin:0;color:#4A4A55;font-size:12px}
.row{display:flex;gap:16px;align-items:flex-start;margin-bottom:16px}
figure{margin:0}
figcaption{font-size:12px;color:#4A4A55;margin-bottom:4px}
.box{width:calc(var(--w) * var(--s) * 1px);height:calc(var(--h) * var(--s) * 1px);overflow:hidden;border:1px solid #E4E4EA;border-radius:6px;background:#fff}
iframe{display:block;border:0;transform:scale(var(--s));transform-origin:0 0}
</style></head>
<body>
<header><h1>${escapeHtml(location.id)}</h1><p>${escapeHtml(shown(location.dir))} · 保存すると描き直す</p><p id="status"></p></header>
${rows}
<script>
const total = ${total};
const fit = () => document.documentElement.style.setProperty('--s', String(Math.min(1, (innerWidth - 48 - 32 - 8) / total)));
fit();
addEventListener('resize', fit);
const events = new EventSource('/events');
events.onmessage = (event) => {
  for (const frame of document.querySelectorAll('iframe')) frame.src = frame.dataset.src + '&v=' + event.data;
  document.getElementById('status').textContent = '更新 ' + new Date().toLocaleTimeString();
};
</script>
</body></html>`;
}

function send(res: ServerResponse, status: number, type: string, body: string) {
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
  res.end(body);
}

export interface PreviewServer {
  url: string;
  close(): Promise<void>;
}

export async function startPreview(location: WorkLocation, options: { port: number; open: boolean }): Promise<PreviewServer> {
  const clients = new Set<ServerResponse>();
  let version = 0;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/') return send(res, 200, 'text/html', pageHtml(location));
    if (url.pathname === '/frame') {
      const palette = url.searchParams.get('palette') as Palette;
      const width = Number(url.searchParams.get('width'));
      if (!PREVIEW_PALETTES.some((p) => p.palette === palette)) return send(res, 400, 'text/plain', 'palette は author、light、dark');
      const work = toRenderable(readWork(location));
      if (!work) return send(res, 200, 'text/html', '<!doctype html><p>part.html と part.css がそろっていない</p>');
      return send(res, 200, 'text/html', buildFrameHtml(work, { palette, width }));
    }
    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': ld preview\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    send(res, 404, 'text/plain', 'not found');
  });

  // 保存は1回で何度も知らせが来るので、少しまとめてから描き直す。
  let timer: NodeJS.Timeout | null = null;
  const watcher = watch(location.dir, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      version += 1;
      for (const client of clients) client.write(`data: ${version}\n\n`);
    }, 40);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/`;

  if (options.open) {
    const [command, args] =
      process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    spawn(command, args as string[], { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
  }

  return {
    url,
    async close() {
      watcher.close();
      if (timer) clearTimeout(timer);
      for (const client of clients) client.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
