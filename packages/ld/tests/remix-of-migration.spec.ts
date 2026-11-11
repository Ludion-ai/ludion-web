// migration 0007 の UPDATE（docs/tasks/T033.md B3）：今あるリミックスの remix_of は、各作品のコードのクレジット行（ludion.ai/p/<id>）から読んだもの。
// works/ の作品のうち、part.html の1行目のクレジット行が別の作品を指すものと、migration に書いた ID と元が一致することを確かめる。
import { expect, test } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '../../..');
const WORKS = join(REPO, 'works');
const SQL = readFileSync(join(REPO, 'apps/web/migrations/0007_remix_of.sql'), 'utf8');
const CREDIT = /^<!-- UI by @[^ ]+ — ludion\.ai\/p\/([a-z0-9-]+) \(MIT\) -->/;

test('migration 0007 の9作品と元は、作品のクレジット行から読んだものと同じ。作品のファイルは変えない', () => {
  const fromCode = new Map<string, string>();
  for (const id of readdirSync(WORKS).filter((name: string) => existsSync(join(WORKS, name, 'part.html')))) {
    const source = CREDIT.exec(readFileSync(join(WORKS, id, 'part.html'), 'utf8'))?.[1];
    if (source && source !== id) fromCode.set(id, source);
  }
  expect(fromCode.size).toBe(9);

  for (const table of ['works', 'revisions']) {
    const match = new RegExp(`UPDATE ${table} SET remix_of = '([a-z0-9-]+)', is_remix = 1\\s+WHERE (?:id|work_id) IN \\(([^)]*)\\);`).exec(SQL);
    expect(match, table).not.toBeNull();
    const ids = [...match![2].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]).sort();
    expect(ids, table).toEqual([...fromCode.keys()].sort());
    for (const id of ids) expect(fromCode.get(id), id).toBe(match![1]);
  }
  // 文は ALTER と、remix_of と is_remix の UPDATE だけ（作品のファイルにも、ほかの列にも触らない）
  const statements = SQL.split('\n').filter((line) => !line.startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
  expect(statements).toHaveLength(4);
  for (const statement of statements) expect(statement).toMatch(/^(ALTER TABLE (works|revisions) ADD COLUMN remix_of TEXT|UPDATE (works|revisions) SET remix_of = '[a-z0-9-]+', is_remix = 1\s+WHERE)/);
});
