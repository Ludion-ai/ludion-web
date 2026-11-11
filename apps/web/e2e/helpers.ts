import type { Frame, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Work } from '../src/data/works';
import { parseHomeQuery, selectWorks } from '../src/lib/homeQuery';
import { comparePopular } from '../src/lib/popular';

export const seed: Work[] = JSON.parse(readFileSync(new URL('../../../seed/works.json', import.meta.url), 'utf8'));
export const TOTAL = seed.length;

/**
 * プレビューの枠の src（PREVIEW-DPR）。枠の URL の # に、見えている細かさ（ldpr）が付く。
 * path は # の前の全部（? も含む）。
 */
export function framedAt(path: string): RegExp {
  return new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}#ldpr=\\d+(?:\\.\\d+)?$`);
}

/** 枠の文書の URL の path（# と ? を除く） */
export const framePath = (frame: Frame) => new URL(frame.url()).pathname;

/** 見本の答え：URL の値で絞った、作品の id の並び。 */
export function popularOrder(search = ''): string[] {
  return selectWorks(seed.toSorted(comparePopular), parseHomeQuery(new URLSearchParams(search))).map((work) => work.id);
}

/** Worker の HTML から <noscript> の中を除く。 */
export function withoutNoscript(html: string): string {
  return html.replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
}

export function countWorks(predicate: (work: Work) => boolean): number {
  return seed.filter(predicate).length;
}

/** ホームを開き、React が載る（ハイドレーションが終わる）まで待つ。 */
export async function openHome(page: Page, path = '/') {
  await page.goto(path);
  await page.locator('[data-masonry][data-placed]').waitFor({ state: 'attached' });
  await page.locator('article').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
}

export type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };

export async function cardBoxes(page: Page): Promise<Box[]> {
  return page.locator('article').evaluateAll((cards) =>
    cards.map((card) => {
      const { left, top, right, bottom, width, height } = card.getBoundingClientRect();
      return { left, top, right, bottom, width, height };
    }),
  );
}

export async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

export function cardTitles(page: Page) {
  return page.locator('article h2').allTextContents();
}

export const pretendMac = () => {
  Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
  Object.defineProperty(navigator, 'userAgentData', { get: () => undefined });
};

export const pretendWindows = () => {
  Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
  Object.defineProperty(navigator, 'userAgentData', { get: () => undefined });
};
