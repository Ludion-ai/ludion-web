// デプロイの前の確かめ（docs/tasks/T024.md「1」）。npm run deploy と npm run deploy:www の中で動く。
// 本番に出すのは、main に入れて push したものだけ。枝から出すと、ほかのセッションが出したものを消す（T022 の事故）。
// 飛ばす道（環境変数、引数）は作らない。止まったら、言われたとおりに揃えてから流し直す。
import { execFileSync } from 'node:child_process';

/** CEO が作業中の作品（CLAUDE.md「タスクと報告」）。ビルドに入らないので、コミットしていなくても本番は変わらない。道はリポジトリの根から。 */
const isCeoWork = (path) => path.startsWith('works/') || path.startsWith('creators/') || path === 'ld.config.json';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function stop(message) {
  console.error(`デプロイを止めた：${message}`);
  process.exit(1);
}

/** コミットしていない道の全部。名前を変えたものは新旧の両方。未追跡も入れる（ビルドに入ることがあるため）。 */
function uncommittedPaths() {
  const entries = git('status', '--porcelain=v1', '-z', '--untracked-files=all').split('\0').filter(Boolean);
  const paths = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    paths.push(entry.slice(3));
    // -z のとき、名前を変えた行の次の項目が元の道
    if (/[RC]/.test(entry.slice(0, 2))) paths.push(entries[(index += 1)]);
  }
  return paths;
}

// 本番に出すのは、公開のリポジトリ Ludion-ai/ludion-web の main と同じ中身だけ（PUB002「7」）。
// 内部の置き場 Ludion-ai/ludion-app の作業ツリーから流すと、ludion-app の古いコードが本番に出るため、origin の名前で止める。
const PUBLIC_REPO = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)Ludion-ai\/ludion-web(?:\.git)?\/?$/i;
let originUrl = '';
try {
  // 書いたままの URL を見る（get-url は insteadOf で書き換えた先を返す）
  originUrl = git('config', '--get', 'remote.origin.url').trim();
} catch {
  stop('origin が読めない。Ludion-ai/ludion-web を clone した作業ツリーから流す。');
}
if (!PUBLIC_REPO.test(originUrl)) {
  stop(`origin が Ludion-ai/ludion-web ではない（${originUrl.replace(/\/\/[^@/]*@/, '//')}）。本番に出すのは ludion-web の main と同じ中身だけ。ludion-web を clone した作業ツリーから流す。`);
}

try {
  git('fetch', 'origin');
} catch {
  stop('git fetch origin が失敗した。ネットワークと GitHub の認証を確かめて、流し直す。');
}

let head;
let main;
try {
  head = git('rev-parse', '--verify', 'HEAD').trim();
  main = git('rev-parse', '--verify', 'refs/remotes/origin/main').trim();
} catch {
  stop('HEAD か origin/main が読めない。origin を確かめて、main に入れて push したコミットから流す。');
}
if (head !== main) {
  stop(`HEAD（${head.slice(0, 7)}）が origin/main（${main.slice(0, 7)}）と違う。origin/main を取り込んで main に push し、それと同じコミットから流す。`);
}

const dirty = uncommittedPaths().filter((path) => !isCeoWork(path));
if (dirty.length > 0) {
  stop(`コミットしていない変更が ${dirty.length} 件ある（${dirty.slice(0, 3).join('、')}${dirty.length > 3 ? ' ほか' : ''}）。main に入れて push するか、片付けてから流す。`);
}

console.log(`デプロイの確かめ：HEAD は origin/main と同じ（${head.slice(0, 7)}）。コミットしていない変更なし。`);
