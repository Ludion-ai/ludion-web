import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const LD_BIN = join(REPO, 'packages/ld/bin/ld.mjs');

/**
 * 使い捨ての置き場（LD_ROOT）を作る。見本の作者 @fixture と、指定した見本の作品を写し、git init する。
 * リポジトリの中の見本は書き換えない。
 */
export function makeTempRoot(works: string[] = []): { root: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), 'ld-test-'));
  cpSync(join(REPO, 'fixtures/creators/fixture'), join(root, 'creators/fixture'), { recursive: true });
  for (const id of works) {
    cpSync(join(REPO, 'fixtures/works', id), join(root, 'works', id), {
      recursive: true,
      filter: (src) => !/(thumb\.webp|og\.png)$/.test(src),
    });
  }
  writeFileSync(join(root, 'ld.config.json'), `${JSON.stringify({ creator: 'fixture', made_with: 'ai-assisted' })}\n`);
  spawnSync('git', ['init', '-q'], { cwd: root });
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export function runLd(args: string[], root?: string) {
  const env = { ...process.env };
  if (root) env.LD_ROOT = root;
  else delete env.LD_ROOT;
  const result = spawnSync(process.execPath, [LD_BIN, ...args], { env, encoding: 'utf8', timeout: 120_000 });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}
