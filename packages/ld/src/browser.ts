// Playwright の Chromium で作品の枠（buildFrameHtml）を開く。
// 枠は http://ld-frame.localhost/ を1枚のページとして開き、外への通信はすべてここで数える。
// 応答の CSP の sandbox で、サイトの iframe と同じ制限（FRAME_SANDBOX、オリジンなし）をかける。

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { FRAME_SANDBOX, buildFrameHtml, type Palette, type Work } from '@ludion/render';

const require = createRequire(import.meta.url);

export const FRAME_URL = 'http://ld-frame.localhost/';
export const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

export async function launch(): Promise<Browser> {
  return chromium.launch();
}

function isFontUrl(url: string): boolean {
  try {
    return FONT_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** 作品から外へ出ようとした通信（書体を除く）。CSP で止まったものも数える。 */
export interface Outgoing {
  url: string;
  how: 'request' | 'csp';
}

export interface FramePage {
  context: BrowserContext;
  page: Page;
  outgoing: Outgoing[];
  errors: string[];
  /** 作品の枠を開き、書体と描画が落ち着くまで待つ。 */
  show(work: Work, palette: Palette, width: number, height: number, options?: { placement?: 'center' | 'top' }): Promise<void>;
  close(): Promise<void>;
}

export async function openFramePage(browser: Browser, options: { deviceScaleFactor?: number } = {}): Promise<FramePage> {
  const context = await browser.newContext({ deviceScaleFactor: options.deviceScaleFactor ?? 1, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const outgoing: Outgoing[] = [];
  const errors: string[] = [];
  let html = '';

  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url === FRAME_URL) {
      return route.fulfill({
        contentType: 'text/html; charset=utf-8',
        headers: { 'Content-Security-Policy': `sandbox ${FRAME_SANDBOX}` },
        body: html,
      });
    }
    if (isFontUrl(url)) return route.continue().catch(() => undefined);
    outgoing.push({ url, how: 'request' });
    return route.abort();
  });
  // CSP で止まった通信は、リクエストにならないので、違反の知らせで数える。
  await page.exposeBinding('__ldViolation', (_source, blockedURI: string) => {
    if (/^(https?|wss?):/i.test(blockedURI) && !isFontUrl(blockedURI)) outgoing.push({ url: blockedURI, how: 'csp' });
  });
  await page.addInitScript(() => {
    document.addEventListener(
      'securitypolicyviolation',
      (event) => (window as unknown as { __ldViolation(u: string): void }).__ldViolation(event.blockedURI),
      true,
    );
  });
  page.on('pageerror', (error) => errors.push(error.message));

  return {
    context,
    page,
    outgoing,
    errors,
    async show(work, palette, width, height, options = {}) {
      html = buildFrameHtml(work, { palette, width, placement: options.placement });
      await page.setViewportSize({ width, height });
      await page.goto(FRAME_URL, { waitUntil: 'load' });
      const loadedAt = Date.now();
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      await page.waitForTimeout(150); // mount の中の通信や、最初の動きが出るまで
      // 登場の演出が終わるまで（meta.json の capture.delay_ms）。読み込みから数える。値の正しさは「形」で見る
      const delay = work.meta.capture?.delay_ms;
      const rest = typeof delay === 'number' ? delay - (Date.now() - loadedAt) : 0;
      if (rest > 0) await page.waitForTimeout(rest);
    },
    async close() {
      await context.close();
    },
  };
}

let axeSource: string | null = null;

export interface AxeSummary {
  blocking: number;
  violations: { id: string; impact: string; nodes: number; help: string; helpUrl: string; target: string }[];
}

/** 開いている枠に axe-core を回す。critical と serious の数を返す。 */
export async function runAxe(page: Page): Promise<AxeSummary> {
  axeSource ??= readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run(context: Document, options: object): Promise<{ violations: { id: string; impact: string; help: string; helpUrl: string; nodes: { target: unknown[] }[] }[] }> } }).axe;
    const result = await axe.run(document, { resultTypes: ['violations'] });
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      help: v.help,
      helpUrl: v.helpUrl,
      target: JSON.stringify(v.nodes[0]?.target ?? []),
    }));
  });
  return { blocking: violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').length, violations };
}

export interface Overflow {
  count: number;
  /** はみ出した量の最大（px） */
  max: number;
  examples: string[];
}

/**
 * 右端を1px以上はみ出す要素を数える（Shadow DOM の中も）。
 * overflow で切られている箱の中の要素は、外から見えないので数えない（その箱がはみ出していれば、箱を数える）。
 */
export async function measureOverflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const found: { label: string; over: number }[] = [];
    const describe = (el: Element) => {
      const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
      return `${el.tagName.toLowerCase()}${cls}`;
    };
    const walk = (parent: Element | ShadowRoot, clipped: boolean) => {
      for (const el of Array.from(parent.children)) {
        const style = getComputedStyle(el);
        if (style.display === 'none') continue;
        const rect = el.getBoundingClientRect();
        const over = rect.right - vw;
        if (!clipped && style.visibility !== 'hidden' && rect.width > 0 && over >= 1) found.push({ label: describe(el), over });
        const clips = clipped || (style.overflowX !== 'visible' && el !== document.body && el !== document.documentElement);
        if (el.shadowRoot) walk(el.shadowRoot, clips);
        walk(el, clips);
      }
    };
    walk(document.body, false);
    return {
      count: found.length,
      max: Math.round(Math.max(0, ...found.map((f) => f.over))),
      examples: found.slice(0, 3).map((f) => `${f.label}（+${Math.round(f.over)}px）`),
    };
  });
}

/** 作品の根の要素（`[data-ld-part]`）の外接矩形（CSS px）。 */
export async function partRect(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate(() => {
    const root = document.getElementById('ld-host')?.shadowRoot?.querySelector('[data-ld-part]');
    if (!root) return { x: 0, y: 0, width: 0, height: 0 };
    const r = root.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

/** 作品の根の --_bg（作者の地の色）。 */
export async function rootBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
}

export async function mountStatus(page: Page): Promise<string | null> {
  return page.evaluate(() => document.getElementById('ld-host')?.getAttribute('data-ld-mount') ?? null);
}
