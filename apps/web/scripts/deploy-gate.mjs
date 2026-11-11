// 本番に出すときに、承認を待つかを決める（DEPLOY002）。.github/workflows/deploy.yml の「決める」の job で動く。
// - 今の本番の版：GitHub の deploy の記録（environment production と production-auto）のうち、いちばん新しい成功したものの commit。
// - その commit から出す commit までに apps/web/migrations/ の変更が「ない」なら production-auto（承認なし）。
// - 「ある」か、今の本番の版が読めない（記録がない、履歴にない、出す commit の祖先でない）なら production（CEO の承認を待つ）。
// - DEPLOY_MODE が auto でないときは、いつも production。
//
// 手で試す（dry run。何も出さない）：
//   node apps/web/scripts/deploy-gate.mjs --mode auto --base <今の本番の commit> --head <出す commit>
// --base を書かないと、GitHub の記録を読む（GITHUB_REPOSITORY と GITHUB_TOKEN が要る）。
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const MIGRATIONS = 'apps/web/migrations/';
const ENVIRONMENTS = ['production', 'production-auto'];

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: '' },
    base: { type: 'string' },
    head: { type: 'string', default: 'HEAD' },
  },
});

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (...args) => {
  try {
    return git(...args);
  } catch {
    return null;
  }
};

/** GitHub の deploy の記録から、いちばん新しい成功したものの commit。読めないときは null と、その理由。 */
async function findBaseFromGitHub() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) return { sha: null, why: 'GITHUB_REPOSITORY か GITHUB_TOKEN がない' };
  const api = async (path) => {
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    });
    if (!res.ok) throw new Error(`${path} が ${res.status}`);
    return res.json();
  };
  try {
    const deployments = [];
    for (const environment of ENVIRONMENTS) {
      deployments.push(...(await api(`/deployments?environment=${environment}&per_page=50`)));
    }
    deployments.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    for (const deployment of deployments) {
      const statuses = await api(`/deployments/${deployment.id}/statuses?per_page=100`);
      // 後から成功した版が出ると、前の版は inactive になる。一度でも success になったものを数える
      if (statuses.some((status) => status.state === 'success')) {
        return { sha: deployment.sha, why: `${deployment.environment} の記録（${deployment.created_at}）` };
      }
    }
    return { sha: null, why: '成功した deploy の記録がない' };
  } catch (error) {
    return { sha: null, why: `deploy の記録が読めない（${error.message}）` };
  }
}

const head = tryGit('rev-parse', '--verify', `${values.head}^{commit}`);
if (!head) {
  console.error(`出す commit（${values.head}）が読めない`);
  process.exit(1);
}

const found =
  values.base === undefined
    ? await findBaseFromGitHub()
    : values.base
      ? { sha: values.base, why: '--base で渡した' }
      : { sha: null, why: '--base が空' };

let base = null;
let why = found.why;
let migrations = [];
if (!found.sha) {
  why = `今の本番の版が読めない：${found.why}`;
} else if (!tryGit('rev-parse', '--verify', `${found.sha}^{commit}`)) {
  why = `今の本番の版 ${found.sha.slice(0, 7)} が履歴にない（${found.why}）`;
} else if (tryGit('merge-base', '--is-ancestor', found.sha, head) === null) {
  why = `今の本番の版 ${found.sha.slice(0, 7)} が、出す commit の祖先でない（${found.why}）`;
} else {
  base = git('rev-parse', found.sha);
  migrations = git('diff', '--name-status', '--no-renames', base, head, '--', MIGRATIONS).split('\n').filter(Boolean);
}

const auto = values.mode === 'auto';
const environment = auto && base && migrations.length === 0 ? 'production-auto' : 'production';
const reason = !auto
  ? `DEPLOY_MODE が auto でない（${values.mode || '空'}）ので、いつも承認を待つ`
  : !base
    ? `${why}。安全な側に倒して、承認を待つ`
    : migrations.length > 0
      ? `D1 の migration が ${migrations.length} 件ある。承認を待つ`
      : 'D1 の migration がない。承認なしで出す';

const short = (sha) => (sha ? sha.slice(0, 7) : '（読めない）');
const lines = [
  `## ${environment === 'production' ? '承認を待つ（production）' : '承認なしで出す（production-auto）'}`,
  '',
  `- 理由：${reason}`,
  `- 今の本番の版：\`${short(base)}\`（${found.why}）`,
  `- 出す commit：\`${short(head)}\``,
  '',
  '### 当たる migration（今の本番の版から増えた、または変わった apps/web/migrations/）',
  '',
  ...(!base
    ? ['- 今の本番の版が読めないので、比べられない。`apps/web/scripts/migrate.mjs --remote` が、本番の D1 にまだ当たっていないものを当てる']
    : migrations.length === 0
      ? ['- なし']
      : migrations.map((line) => {
          const [status, path] = line.split('\t');
          return `- \`${path}\`（${{ A: '新しい', M: '変わった', D: '消えた' }[status] ?? status}）`;
        })),
  '',
];
const text = lines.join('\n');
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `environment=${environment}\n`);
