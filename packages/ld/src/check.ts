// ld check：作品が契約どおりの形かを確かめる（docs/tasks/T002.md「3」の表）。
// 点数は出さない（CLAUDE.md 原則3）。通ったか、落ちたかと、直し方だけを出す。

import type { Browser } from 'playwright';
import type { Palette, Work } from '@ludion/render';
import { launch, measureOverflow, mountStatus, openFramePage, runAxe, type AxeSummary } from './browser.ts';
import { HANDLE_PATTERN, checkCreator, checkCssShape, checkHtml, checkJs, checkJsPurity, checkMeta, checkPurity, checkReducedMotion, type Problem } from '@ludion/rules';
import { creatorDir, creatorExists, readCreatorRaw, readWork, shown, toRenderable, type WorkLocation } from './workspace.ts';

export type ItemKey = 'shape' | 'purity' | 'layout' | 'a11y' | 'network';

export const ITEM_LABELS: Record<ItemKey, string> = {
  shape: '形',
  purity: 'トークンの純度',
  layout: '崩れ',
  a11y: 'アクセシビリティ',
  network: '外への通信',
};

export interface ItemResult {
  key: ItemKey;
  ok: boolean;
  /** 通ったときに添える一言（数など） */
  summary: string;
  problems: Problem[];
  /** 落とさないが、知らせるもの */
  warnings: Problem[];
}

export interface CheckResult {
  id: string;
  dir: string;
  ok: boolean;
  items: ItemResult[];
  ms: number;
}

export const WIDTHS = [390, 768, 1280] as const;
const HEIGHTS: Record<number, number> = { 390: 844, 768: 1024, 1280: 800 };
const PALETTE_LABELS: Record<Palette, string> = { author: '作者', light: '明るい中立', dark: '暗い中立' };

function item(key: ItemKey, problems: Problem[], summary: string, warnings: Problem[] = []): ItemResult {
  return { key, ok: problems.length === 0, summary, problems, warnings };
}

function blocked(key: ItemKey): ItemResult {
  return item(key, [{ message: '作品を描画できないので確かめられない', fix: '先に「形」を直す（part.html と part.css が要る）' }], '');
}

export async function checkWork(location: WorkLocation, shared?: Browser): Promise<CheckResult> {
  const started = Date.now();
  const raw = readWork(location);
  const id = location.id;
  const meta = (typeof raw.meta === 'object' && raw.meta !== null ? raw.meta : {}) as Record<string, unknown>;
  const type = typeof meta.type === 'string' ? meta.type : 'component';
  const platform = meta.platform;

  // ---- 形（描画しない部分）
  const shape: Problem[] = [];
  const shapeWarnings: Problem[] = [];
  if (raw.metaText === null) shape.push({ message: 'meta.json がない', fix: `ld new ${id} で作るか、docs/tasks/T002.md「1」の形で置く` });
  else if (raw.metaError) shape.push({ message: `meta.json を JSON として読めない（${raw.metaError}）`, fix: 'カンマや引用符を直す' });
  else {
    shape.push(...checkMeta(raw.meta, id, (handle) => creatorExists(location.library, handle)));
    // 作者の creator.json（kind を含む。CLAUDE.md 原則10）
    const handle = meta.creator;
    if (typeof handle === 'string' && HANDLE_PATTERN.test(handle) && creatorExists(location.library, handle)) {
      const where = `${shown(creatorDir(location.library, handle))}/creator.json`;
      const creator = readCreatorRaw(location.library, handle);
      if (creator.error) shape.push({ message: `${where} を JSON として読めない（${creator.error}）`, fix: 'カンマや引用符を直すか、ld creator add で作り直す' });
      else shape.push(...checkCreator(creator.raw, handle).map((p) => ({ message: `作者 @${handle}：${p.message}（${where}）`, fix: p.fix })));
    }
  }
  if (raw.html === null) shape.push({ message: 'part.html がない', fix: `<div data-ld-part="${id}">…</div> を置く` });
  else shape.push(...checkHtml(raw.html, id));
  if (raw.css === null) shape.push({ message: 'part.css がない', fix: `[data-ld-part="${id}"] { … } を置く` });
  else {
    const css = checkCssShape(raw.css, id, type);
    shape.push(...css.problems);
    shapeWarnings.push(...css.warnings);
  }
  if (raw.js !== null) shape.push(...checkJs(raw.js));
  shape.push(...checkReducedMotion(meta.tags, raw.css, raw.js));

  // ---- トークンの純度（part.css と part.js）
  let purity: ItemResult;
  if (raw.css === null) purity = blocked('purity');
  else {
    const css = checkPurity(raw.css, id);
    const js = raw.js === null ? { literals: 0, problems: [] } : checkJsPurity(raw.js);
    const literals = css.literals + js.literals;
    const problems = [...css.problems, ...js.problems];
    purity =
      type === 'component'
        ? item('purity', problems, `色のリテラル ${literals}`)
        : item('purity', [], `色のリテラル ${literals}（画面なので警告だけ）`, problems);
  }

  // ---- 描画が要るもの
  const work: Work | null = toRenderable(raw);
  let layout: ItemResult;
  let a11y: ItemResult;
  let network: ItemResult;

  if (!work) {
    layout = blocked('layout');
    a11y = blocked('a11y');
    network = blocked('network');
  } else {
    const browser = shared ?? (await launch());
    const frame = await openFramePage(browser);
    try {
      // 崩れ：作者の配色で、3つの幅
      const overflowProblems: Problem[] = [];
      let mount: string | null = null;
      for (const width of WIDTHS) {
        await frame.show(work, 'author', width, HEIGHTS[width]);
        if (width === WIDTHS[0]) mount = await mountStatus(frame.page);
        const overflow = await measureOverflow(frame.page);
        if (overflow.count > 0) {
          overflowProblems.push({
            message: `幅${width}で ${overflow.count} 個の要素が右端をはみ出す（最大 ${overflow.max}px。${overflow.examples.join('、')}）`,
            fix: '固定の幅をやめ、max-width: 100% や flex-wrap、@media で狭い幅の形を足す',
          });
        }
      }
      layout = item('layout', overflowProblems, `${WIDTHS.join('・')} ではみ出し 0`);

      // part.js が動いて、片付けの関数を返したか（形）
      if (raw.js !== null) {
        if (mount === 'no-cleanup') shape.push({ message: 'mount が片付けの関数を返さない', fix: 'mount の最後で return () => { /* イベントを外す */ }; を返す' });
        else if (mount !== 'ok') {
          const why = frame.errors[0] ? `：${frame.errors[0]}` : '';
          shape.push({ message: `part.js の mount が動かない${why}`, fix: 'ブラウザで ld preview を開き、コンソールのエラーを直す' });
        }
      }

      // アクセシビリティ：3つの配色。落とすのは作者の配色だけ
      const mainWidth = platform === 'mobile' ? 390 : 1280;
      const results: Partial<Record<Palette, AxeSummary>> = {};
      for (const palette of ['author', 'light', 'dark'] as const) {
        await frame.show(work, palette, mainWidth, HEIGHTS[mainWidth]);
        results[palette] = await runAxe(frame.page);
      }
      const describe = (s: AxeSummary) =>
        s.violations
          .filter((v) => v.impact === 'critical' || v.impact === 'serious')
          .map((v) => `${v.impact} ${v.id} ×${v.nodes}`)
          .join('、');
      const author = results.author!;
      const a11yProblems = author.violations
        .filter((v) => v.impact === 'critical' || v.impact === 'serious')
        .map((v) => ({
          message: `作者の配色で ${v.impact} ${v.id}（${v.help}）×${v.nodes}。例：${v.target}`,
          fix: v.id === 'color-contrast' ? '文字と地の色の差を広げる（ふつうの文字は 4.5:1 以上）' : `${v.helpUrl} を見て直す`,
        }));
      const others = (['light', 'dark'] as const).map((p) => {
        const s = results[p]!;
        return `${PALETTE_LABELS[p]} ${s.blocking}${s.blocking > 0 ? `（${describe(s)}）` : ''}`;
      });
      a11y = item('a11y', a11yProblems, `critical+serious：作者 ${author.blocking}／${others.join('／')}（作者の配色だけで判定）`);

      // 外への通信：ここまでのすべての描画で数える
      const seen = new Set<string>();
      const outgoing = frame.outgoing.filter((o) => (seen.has(o.url) ? false : (seen.add(o.url), true)));
      network = item(
        'network',
        outgoing.map((o) => ({
          message: `${o.how === 'csp' ? 'CSP で止めた通信' : '通信'}：${o.url}`,
          fix: '画像は data: にするか CSS で描く。書体（Google Fonts）のほかは外から読まない',
        })),
        `${outgoing.length}（書体を除く）`,
      );
    } finally {
      await frame.close();
      if (!shared) await browser.close();
    }
  }

  const items = [item('shape', shape, '', shapeWarnings), purity, layout, a11y, network];
  return { id, dir: shown(location.dir), ok: items.every((i) => i.ok), items, ms: Date.now() - started };
}

export function formatCheck(result: CheckResult): string {
  const lines = [`${result.id}  （${result.dir}）`];
  for (const i of result.items) {
    const label = ITEM_LABELS[i.key];
    lines.push(`  ${i.ok ? '✓' : '✗'} ${label}${i.ok && i.summary ? `：${i.summary}` : ''}`);
    for (const p of i.problems) lines.push(`      ✗ ${p.message} → ${p.fix}`);
    for (const w of i.warnings) lines.push(`      ! ${w.message} → ${w.fix}`);
  }
  const failed = result.items.filter((i) => !i.ok).map((i) => ITEM_LABELS[i.key]);
  const seconds = (result.ms / 1000).toFixed(1);
  lines.push(failed.length === 0 ? `  → 通った（${seconds}秒）` : `  → 落ちた：${failed.join('、')}（${seconds}秒）`);
  return lines.join('\n');
}
