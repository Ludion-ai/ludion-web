// T024「1」：デプロイの前の確かめ（scripts/deploy-guard.mjs）。PUB002「7」：origin が公開のリポジトリ Ludion-ai/ludion-web のときだけ。
// 使い捨ての git リポジトリと、偽の wrangler で試す。本物のデプロイは呼ばない（設定の wrangler.jsonc も置かない）。
import { expect, test } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const webDir = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const GUARD_SOURCE = join(webDir, 'scripts/deploy-guard.mjs');
/** 本番に出してよい origin（PUB002「7」）。試しでは insteadOf で手元の空のリポジトリへ向ける。 */
const PUBLIC_URL = 'https://github.com/Ludion-ai/ludion-web.git';
const REAL_SCRIPTS = (JSON.parse(readFileSync(join(webDir, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;

/** npm test の中で動くので、npm の環境変数（workspaces の指定など）を子へ渡さない。 */
const CLEAN_ENV = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_/i.test(key) && key !== 'INIT_CWD'));

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: CLEAN_ENV });

interface Repo {
  root: string;
  /** 作業するリポジトリの根 */
  work: string;
  /** apps/web。npm run deploy が動く場所 */
  web: string;
  /** ほかのセッションの手元 */
  other: string;
  /** 手元の空のリポジトリ（origin の中身） */
  origin: string;
  /** 偽のビルド、偽のマイグレーション、偽の wrangler が呼ばれた順 */
  calls: () => string[];
}

/** deploy-guard.mjs、package.json の本物の deploy の文字列、偽の道具だけを入れたリポジトリを作る。 */
function makeRepo(): Repo {
  const root = mkdtempSync(join(tmpdir(), 'ld-deploy-guard-'));
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');
  const other = join(root, 'other');
  const callLog = join(root, 'calls.log');
  const web = join(work, 'apps/web');
  mkdirSync(join(web, 'scripts'), { recursive: true });
  mkdirSync(join(web, 'node_modules/.bin'), { recursive: true });
  mkdirSync(join(work, 'works/toggle'), { recursive: true });
  mkdirSync(join(work, 'creators/a'), { recursive: true });

  // 道具の代わり。呼ばれたことだけを、リポジトリの外に書く
  const record = (name: string) => `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(callLog)}, ${JSON.stringify(`${name}\n`)});\n`;
  copyFileSync(GUARD_SOURCE, join(web, 'scripts/deploy-guard.mjs'));
  // npm run deploy の最後の一歩（wrangler deploy を流し、一時的な誤りのときだけ流し直す。DEPLOY003）
  copyFileSync(join(webDir, 'scripts/wrangler-deploy.mjs'), join(web, 'scripts/wrangler-deploy.mjs'));
  writeFileSync(join(web, 'scripts/migrate.mjs'), record('migrate'));
  // ビルドの間に、ほかのセッションが main へ push することがある
  writeFileSync(
    join(web, 'scripts/build.mjs'),
    `${record('build')}
import { execFileSync } from 'node:child_process';
if (process.env.LD_TEST_PUSH_DURING_BUILD) {
  const run = (...args) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd: ${JSON.stringify(other)}, stdio: 'ignore' });
  run('pull', '-q', 'origin', 'main');
  run('commit', '-q', '--allow-empty', '-m', 'build の間の push');
  run('push', '-q', 'origin', 'main');
}
`,
  );
  writeFileSync(join(web, 'scripts/fake-wrangler.mjs'), record('wrangler'));
  // npm run は node_modules/.bin を PATH の先頭に足す。Windows は cmd、ほかは sh で探す
  writeFileSync(join(web, 'node_modules/.bin/wrangler.cmd'), `@node "${join(web, 'scripts/fake-wrangler.mjs')}" %*\r\n`);
  writeFileSync(join(web, 'node_modules/.bin/wrangler'), `#!/bin/sh\nexec node "${join(web, 'scripts/fake-wrangler.mjs')}" "$@"\n`, { mode: 0o755 });
  writeFileSync(
    join(web, 'package.json'),
    `${JSON.stringify({ name: 'guard-test', private: true, scripts: { deploy: REAL_SCRIPTS.deploy, 'deploy:www': REAL_SCRIPTS['deploy:www'], 'build:deploy': 'node scripts/build.mjs' } }, null, 2)}\n`,
  );
  writeFileSync(join(web, 'app.ts'), 'export {};\n');
  writeFileSync(join(work, 'works/toggle/part.css'), 'a{}\n');
  writeFileSync(join(work, 'creators/a/creator.json'), '{}\n');
  writeFileSync(join(work, 'ld.config.json'), '{}\n');
  writeFileSync(join(work, '.gitignore'), 'node_modules/\n');

  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'init', '-q', '-b', 'main', work);
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'first');
  // origin の名前は公開のリポジトリ。取りに行く先と送る先は、insteadOf で手元の空のリポジトリにする
  git(work, 'remote', 'add', 'origin', PUBLIC_URL);
  git(work, 'config', `url.${pathToFileURL(origin).href}.insteadOf`, PUBLIC_URL);
  git(work, 'push', '-q', '-u', 'origin', 'main');
  git(root, 'clone', '-q', origin, other);
  return { root, work, web, other, origin, calls: () => (existsSync(callLog) ? readFileSync(callLog, 'utf8').trim().split('\n').filter(Boolean) : []) };
}

function guard(repo: Repo, env: Record<string, string> = {}, args: string[] = []) {
  const result = spawnSync(process.execPath, ['scripts/deploy-guard.mjs', ...args], { cwd: repo.web, encoding: 'utf8', env: { ...CLEAN_ENV, ...env } });
  return { status: result.status, out: result.stdout, err: result.stderr };
}

function npmRun(repo: Repo, script: string, env: Record<string, string> = {}) {
  // Windows では npm は npm.cmd なので、シェルを通す
  return spawnSync(`npm run ${script}`, { cwd: repo.web, encoding: 'utf8', shell: true, env: { ...CLEAN_ENV, ...env } });
}

/** 止まった：exit 1、何をすればよいかを1行で出す。 */
function expectStopped(result: { status: number | null; err: string }, hint: RegExp) {
  expect(result.status).toBe(1);
  const lines = result.err.trim().split('\n');
  expect(lines, '1行で出す').toHaveLength(1);
  expect(lines[0]).toMatch(/^デプロイを止めた：/);
  expect(lines[0]).toMatch(hint);
}

function pushFromOther(repo: Repo) {
  git(repo.other, 'commit', '-q', '--allow-empty', '-m', 'ほかのセッションの push');
  git(repo.other, 'push', '-q', 'origin', 'main');
}

test.describe('デプロイの前の確かめ', () => {
  let repo: Repo;
  test.beforeEach(() => {
    repo = makeRepo();
  });
  test.afterEach(() => {
    rmSync(repo.root, { recursive: true, force: true });
  });

  test('揃っていれば進む（origin/main と同じコミットで、変更なし）', () => {
    const result = guard(repo);
    expect(result.status).toBe(0);
    expect(result.err).toBe('');
  });

  test('切り離した HEAD でも、同じコミットなら進む', () => {
    git(repo.work, 'switch', '-q', '--detach');
    expect(guard(repo).status).toBe(0);
  });

  test('枝の名前が違っても、同じコミットなら進む', () => {
    git(repo.work, 'switch', '-q', '-c', 't999-branch');
    expect(guard(repo).status).toBe(0);
  });

  test('HEAD が origin/main より古い（作業中にほかのセッションが push した。T022 の事故）→ 止まる', () => {
    pushFromOther(repo);
    expectStopped(guard(repo), /origin\/main.*違う.*同じコミットから流す/);
  });

  test('手元の origin/main が古いままでも、取りに行って止まる（fetch を飛ばしていない）', () => {
    const before = git(repo.work, 'rev-parse', 'refs/remotes/origin/main');
    pushFromOther(repo);
    expect(git(repo.work, 'rev-parse', 'refs/remotes/origin/main')).toBe(before);
    expect(guard(repo).status).toBe(1);
    expect(git(repo.work, 'rev-parse', 'refs/remotes/origin/main')).not.toBe(before);
  });

  test('枝で進めて、まだ main に入れていない → 止まる', () => {
    git(repo.work, 'switch', '-q', '-c', 't999-branch');
    git(repo.work, 'commit', '-q', '--allow-empty', '-m', '枝のコミット');
    expectStopped(guard(repo), /origin\/main.*違う/);
  });

  test('main で進めて、まだ push していない → 止まる', () => {
    git(repo.work, 'commit', '-q', '--allow-empty', '-m', 'push していない');
    expectStopped(guard(repo), /origin\/main.*違う/);
  });

  test('origin に届かない → 止まる', () => {
    git(repo.work, 'config', '--unset-all', `url.${pathToFileURL(repo.origin).href}.insteadOf`);
    git(repo.work, 'config', `url.${pathToFileURL(join(repo.root, 'nothing.git')).href}.insteadOf`, PUBLIC_URL);
    expectStopped(guard(repo), /git fetch origin が失敗した/);
  });

  test('origin/main がない → 止まる', () => {
    git(repo.work, 'remote', 'remove', 'origin');
    git(repo.work, 'remote', 'add', 'origin', PUBLIC_URL);
    git(repo.root, '--git-dir', join(repo.root, 'origin.git'), 'branch', '-q', '-m', 'main', 'trunk');
    expectStopped(guard(repo), /HEAD か origin\/main が読めない/);
  });

  for (const url of ['https://github.com/Ludion-ai/ludion-web', 'git@github.com:Ludion-ai/ludion-web.git', 'ssh://git@github.com/Ludion-ai/ludion-web.git']) {
    test(`origin が公開のリポジトリなら、書き方が違っても進む（${url}）`, () => {
      git(repo.work, 'remote', 'set-url', 'origin', url);
      git(repo.work, 'config', `url.${pathToFileURL(repo.origin).href}.insteadOf`, url);
      expect(guard(repo).status).toBe(0);
    });
  }

  for (const url of ['https://github.com/Ludion-ai/ludion-app.git', 'git@github.com:Ludion-ai/ludion-app.git', 'https://github.com/Ludion-ai/ludion-web-fork.git', 'https://github.com/someone/ludion-web.git']) {
    test(`origin が公開のリポジトリではない → 止まる（${url}）`, () => {
      // 中身は同じでも、名前で止める。内部の置き場の古いコードを本番に出さないため（PUB002「7」）
      git(repo.work, 'remote', 'set-url', 'origin', url);
      git(repo.work, 'config', `url.${pathToFileURL(repo.origin).href}.insteadOf`, url);
      expectStopped(guard(repo), /origin が Ludion-ai\/ludion-web ではない.*ludion-web を clone した作業ツリーから流す/);
    });
  }

  test('origin の URL に入った名前は、止めた知らせに出さない（名前の後に秘密の値が続くことがあるため）', () => {
    git(repo.work, 'remote', 'set-url', 'origin', 'https://someone-name@github.com/Ludion-ai/ludion-app.git');
    const result = guard(repo);
    expectStopped(result, /origin が Ludion-ai\/ludion-web ではない（https:\/\/github\.com\/Ludion-ai\/ludion-app\.git）/);
    expect(result.err).not.toContain('someone-name');
  });

  test('origin がない → 止まる', () => {
    git(repo.work, 'remote', 'remove', 'origin');
    expectStopped(guard(repo), /origin が読めない/);
  });

  test('追跡しているファイルの変更 → 止まる', () => {
    appendFileSync(join(repo.web, 'app.ts'), '// 変更\n');
    expectStopped(guard(repo), /コミットしていない変更が 1 件ある（apps\/web\/app\.ts）/);
  });

  test('add しただけの変更 → 止まる', () => {
    appendFileSync(join(repo.web, 'app.ts'), '// 変更\n');
    git(repo.work, 'add', '-A');
    expectStopped(guard(repo), /コミットしていない変更が 1 件ある/);
  });

  test('未追跡のファイル → 止まる', () => {
    writeFileSync(join(repo.web, 'new.ts'), 'export {};\n');
    expectStopped(guard(repo), /コミットしていない変更が 1 件ある（apps\/web\/new\.ts）/);
  });

  test('消したファイル → 止まる', () => {
    rmSync(join(repo.web, 'app.ts'));
    expectStopped(guard(repo), /コミットしていない変更が 1 件ある/);
  });

  test('CEO の作業中のもの（works/、creators/、ld.config.json）だけなら進む', () => {
    appendFileSync(join(repo.work, 'works/toggle/part.css'), 'b{}\n');
    writeFileSync(join(repo.work, 'works/new-work.html'), '<div></div>\n');
    writeFileSync(join(repo.work, 'creators/a/avatar.webp'), 'x');
    appendFileSync(join(repo.work, 'ld.config.json'), '\n');
    expect(guard(repo).status).toBe(0);
  });

  test('同じ名前でも、根のほかの場所は除かない（apps/web/works/、ld.config.json.bak）', () => {
    const inApp = join(repo.web, 'works/x.ts');
    mkdirSync(dirname(inApp), { recursive: true });
    writeFileSync(inApp, 'export {};\n');
    writeFileSync(join(repo.work, 'ld.config.json.bak'), '{}\n');
    expectStopped(guard(repo), /コミットしていない変更が 2 件ある/);
  });

  test('CEO の作業中のものと、ほかの変更が混ざる → 止まる', () => {
    appendFileSync(join(repo.work, 'works/toggle/part.css'), 'b{}\n');
    appendFileSync(join(repo.web, 'app.ts'), '// 変更\n');
    expectStopped(guard(repo), /コミットしていない変更が 1 件ある（apps\/web\/app\.ts）/);
  });

  test('works/ からほかの場所へ名前を変えた → 止まる（新旧の両方を見る）', () => {
    renameSync(join(repo.work, 'works/toggle/part.css'), join(repo.web, 'part.css'));
    git(repo.work, 'add', '-A');
    expectStopped(guard(repo), /apps\/web\/part\.css/);
  });

  test('飛ばす道がない：環境変数と引数では進まない', () => {
    pushFromOther(repo);
    const tries: Record<string, string> = { FORCE: '1', SKIP_DEPLOY_GUARD: '1', LD_SKIP_DEPLOY_GUARD: '1', DEPLOY_GUARD: '0', NO_VERIFY: '1', CI: '1' };
    expect(guard(repo, tries, ['--force', '--skip', '--no-verify']).status).toBe(1);
    // 新しい名前を足されても分かるように、読むこと自体を禁じる
    expect(readFileSync(GUARD_SOURCE, 'utf8')).not.toMatch(/process\.(env|argv)/);
  });

  test('npm run deploy：揃っていれば、ビルド → マイグレーション → wrangler の順に進む', () => {
    const result = npmRun(repo, 'deploy');
    expect(result.status, result.stderr).toBe(0);
    expect(repo.calls()).toEqual(['build', 'migrate', 'wrangler']);
  });

  test('npm run deploy:www：揃っていれば wrangler まで進む', () => {
    const result = npmRun(repo, 'deploy:www');
    expect(result.status, result.stderr).toBe(0);
    expect(repo.calls()).toEqual(['wrangler']);
  });

  test('npm run deploy：外れていれば、ビルドも本番の D1 も wrangler も動かない', () => {
    pushFromOther(repo);
    const result = npmRun(repo, 'deploy');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('デプロイを止めた：');
    expect(repo.calls()).toEqual([]);
  });

  test('npm run deploy:www：外れていれば wrangler は動かない', () => {
    appendFileSync(join(repo.web, 'app.ts'), '// 変更\n');
    const result = npmRun(repo, 'deploy:www');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('デプロイを止めた：');
    expect(repo.calls()).toEqual([]);
  });

  test('npm run deploy：ビルドの間にほかのセッションが push したら、本番の D1 と wrangler の前で止まる', () => {
    const result = npmRun(repo, 'deploy', { LD_TEST_PUSH_DURING_BUILD: '1' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('デプロイを止めた：');
    expect(repo.calls()).toEqual(['build']);
  });
});
