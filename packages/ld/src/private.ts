// ld upload --private と ld login（LD002）。作品を /api/v1 に送り、オーナーの人の「自分だけ」の作品として置く。
//
// 鍵の読み方、取り直し、送り方、.ludion.json（どのフォルダがどの作品か）は、プラグインの ludion.mjs と同じコードを使う。
// プラグイン、ld、デスクトップアプリが、同じフォルダで同じ対応を読み書きするため。
// 鍵：環境変数 LUDION_KEY → ~/.ludion/auth.json（ld login かプラグインの login が作る。切れていれば取り直す）。

import { stripExports, type Work } from '@ludion/render';
import { authorizationFor, connect, loadState, putHtml, stateKey } from '../../../plugins/ludion/skills/ludion/ludion.mjs';
import { DEV_DEFAULT_URL, PROD_URL, type UploadEnv } from './upload.ts';

/** 置き場に出る「どこから置いたか」の印（AI の鍵で送るときに効く）。 */
export const LD_CLIENT = 'ld';

/** --env から送り先を決める。prod は https://ludion.ai だけ。dev は LD_DEV_URL（なければ npm run dev のポート）。 */
export function privateBase(env: UploadEnv, processEnv: NodeJS.ProcessEnv = process.env): string {
  if (env === 'prod') return PROD_URL;
  return (processEnv.LD_DEV_URL || DEV_DEFAULT_URL).replace(/\/+$/, '');
}

/** 鍵がないときの案内。 */
export function loginHint(env: UploadEnv): string {
  const flag = env === 'prod' ? '' : ' --env dev';
  return `鍵がない。npx ld login${flag} を1回打ち、ブラウザで Ludion にログインして「許可する」を押す（~/.ludion/auth.json に入る）。または AI の鍵を環境変数 LUDION_KEY に入れる（ファイルに書かない）`;
}

/** 鍵（LUDION_KEY か auth.json）があるか。auth.json のトークンが切れていれば、ここで取り直す。 */
export async function hasKey(base: string): Promise<boolean> {
  return (await authorizationFor(base)) !== null;
}

/**
 * /api/v1 に送る1つの HTML。「コピーされるコード」（buildCopySnippet）と同じ並びで、クレジット行だけを入れない
 * （サーバーが分け直し、クレジット行は置くときにサーバーが作る）。
 */
export function privateHtml(work: Work): string {
  const { id } = work.meta;
  const lines = [work.html.trim(), '<style>', work.css.trim(), '</style>'];
  if (typeof work.js === 'string' && work.js.trim() !== '') {
    lines.push('<script type="module">', stripExports(work.js).trim(), `mount(document.querySelector('[data-ld-part="${id}"]'));`, '</script>');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * .ludion.json の中の名前。作品のフォルダ（例：works/toggle-aurora/）。末尾の / で、プラグインが覚える HTML のファイルとぶつからない。
 * .ludion.json は送り先を区別しないので、本番でない送り先には「@送り先」を足し、dev の作品の番号を本番に送らない。
 */
export function stateName(stateDir: string, workDir: string, base: string): string {
  const folder = `${stateKey(stateDir, workDir)}/`;
  return base === PROD_URL ? folder : `${folder}@${base}`;
}

export interface PrivateResult {
  ok: boolean;
  action?: 'created' | 'new_version' | 'unchanged';
  id?: string;
  version?: number;
  url?: string;
  visibility?: string;
  state_file?: string;
  error?: string;
  message?: string;
  extra?: { status?: number; problems?: { message: string; fix: string }[]; [key: string]: unknown };
}

/** 1つの作品を、自分だけの作品として置く。同じフォルダの2回目からは、同じ作品の新しい版。前と同じ中身なら送らない。 */
export async function putPrivate(work: Work, workDir: string, base: string, stateStart: string): Promise<PrivateResult> {
  const { dir } = loadState(stateStart);
  const key = stateName(dir, workDir, base);
  return (await putHtml(privateHtml(work), { key, stateStart, title: work.meta.title, ifChanged: true, base, client: LD_CLIENT })) as PrivateResult;
}

/** 送った結果を、人が読める行にする。 */
export function describePrivate(id: string, result: PrivateResult, env: UploadEnv): string[] {
  if (result.ok) {
    if (result.action === 'unchanged') return [`  変わっていない：${id} は、前に置いた ${result.id} 版 ${String(result.version)} と同じ中身なので送らない`];
    const what = result.action === 'created' ? '自分だけの作品として置いた' : '同じ自分だけの作品に新しい版を置いた';
    return [`  ${what}：${id} → ${result.id} 版 ${String(result.version)}（${String(result.visibility)}）`, `  住所：${String(result.url)}`];
  }
  const status = result.extra?.status;
  const head = `  ✗ ${id}：${status ? `${status}。` : ''}${String(result.message)}`;
  if (result.error === 'no_key' || status === 401) return [head, `      → ${loginHint(env)}`];
  const lines = [head];
  for (const p of result.extra?.problems ?? []) lines.push(`      ✗ ${p.message} → ${p.fix}`);
  return lines;
}

/** ld login：プラグインの login と同じ流れ（ブラウザで「許可する」、PKCE）。つないだ名前もプラグインと同じ（同じつながりを分け合う）。 */
export async function loginTo(base: string): Promise<{ ok: boolean; message?: string; error?: string }> {
  return (await connect({ base })) as { ok: boolean; message?: string; error?: string };
}
