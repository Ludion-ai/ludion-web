// ld upload：check が通った作品を、Worker の管理API（POST /api/admin/works）に送る（docs/tasks/T004.md「3」）。
//
// 送り先と管理トークンは、リポジトリに書かない。
// - dev：LD_DEV_URL（なければ http://localhost:5173。npm run dev のポート）と LD_DEV_TOKEN（なければ apps/web/.dev.vars の ADMIN_TOKEN）
// - prod：送り先は https://ludion.ai、管理トークンは apps/web/.prod.vars の ADMIN_TOKEN（コミットしない）

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, creatorDir, type WorkLocation } from './workspace.ts';

export type UploadEnv = 'dev' | 'prod';

export interface UploadTarget {
  env: UploadEnv;
  url: string;
  token: string;
}

export const DEV_DEFAULT_URL = 'http://localhost:5173';
export const DEV_VARS = join(REPO_ROOT, 'apps/web/.dev.vars');
export const PROD_URL = 'https://ludion.ai';
export const PROD_VARS = join(REPO_ROOT, 'apps/web/.prod.vars');

/** .dev.vars と .prod.vars（KEY=VALUE の行）を読む。引用符は外す。 */
export function readDevVars(file = DEV_VARS): Record<string, string> {
  if (!existsSync(file)) return {};
  const vars: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    vars[m[1]] = m[2].replace(/^(['"`])(.*)\1$/, '$2');
  }
  return vars;
}

/** 送り先を決める。足りなければ、何をどこに置くかを書いた Error を投げる。 */
export function uploadTarget(env: UploadEnv, processEnv: NodeJS.ProcessEnv = process.env, prodVars = PROD_VARS): UploadTarget {
  if (env === 'prod') {
    const token = readDevVars(prodVars).ADMIN_TOKEN;
    if (!token) throw new Error('--env prod の管理トークンがない。apps/web/.prod.vars に ADMIN_TOKEN=<本番の管理トークン> を1行で書く（コミットしない）');
    return { env, url: PROD_URL, token };
  }
  const url = (processEnv.LD_DEV_URL || DEV_DEFAULT_URL).replace(/\/+$/, '');
  const token = processEnv.LD_DEV_TOKEN || readDevVars().ADMIN_TOKEN;
  if (!token) throw new Error('管理トークンがない。apps/web/.dev.vars に ADMIN_TOKEN=<長いランダムな文字列> を書く（コミットしない）か、LD_DEV_TOKEN を設定する');
  return { env, url, token };
}

/** 送るファイル。作品のフォルダと、作者のフォルダから集める。 */
export interface UploadFile {
  name: string;
  /** ファイルから読むときの場所 */
  path?: string;
  /** その場で作った中身（壁紙の静止画。stills.ts） */
  bytes?: Buffer;
}

export function collectFiles(location: WorkLocation, creator: string): UploadFile[] {
  const names = ['meta.json', 'part.html', 'part.css', 'part.js', 'thumb.webp', 'og.png'];
  const files = names.map((name) => ({ name, path: join(location.dir, name) })).filter((f) => existsSync(f.path));
  const dir = creatorDir(location.library, creator);
  files.push({ name: 'creator.json', path: join(dir, 'creator.json') }, { name: 'avatar.webp', path: join(dir, 'avatar.webp') });
  return files;
}

export interface UploadResult {
  status: number;
  body: Record<string, unknown>;
}

export async function sendWork(target: UploadTarget, files: UploadFile[], publish: boolean): Promise<UploadResult> {
  const form = new FormData();
  for (const file of files) form.append(file.name, new Blob([file.bytes ? new Uint8Array(file.bytes) : readFileSync(file.path!)]), file.name);
  if (publish) form.append('publish', 'true');
  const response = await fetch(`${target.url}/api/admin/works`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${target.token}` },
    body: form,
  });
  const text = await response.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { message: text.slice(0, 200) };
  }
  return { status: response.status, body };
}

interface Failed {
  label: string;
  problems: { message: string; fix: string }[];
}

/** 送った結果を、人が読める行にする。 */
export function describeResult(id: string, result: UploadResult): string[] {
  const { status, body } = result;
  if (status === 201) {
    const prev = body.previous_version ? `、版 ${String(body.previous_version)} を差し替えた` : '';
    const creator = body.creator as { handle: string; kind: string };
    const sent = `  送った：${id} 版 ${String(body.version)}（${String(body.status)}${prev}）。作者 @${creator.handle}（${creator.kind}）。R2 の works/${id}/${String(body.version)}/ に ${(body.keys as string[]).length} ファイル`;
    return body.catalog_purged === false ? [sent, '  ！ 一覧の反映に最大60秒かかる（キャッシュを消せなかった）'] : [sent];
  }
  if (status === 401) return [`  ✗ ${id}：401。管理トークンが違う（送り先の ADMIN_TOKEN と、dev は LD_DEV_TOKEN または apps/web/.dev.vars、prod は apps/web/.prod.vars を揃える）`];
  if (status === 409) return [`  ✗ ${id}：409。${String(body.message)}`];
  if (status === 422) {
    const lines = [`  ✗ ${id}：422。Worker の検査で落ちた`];
    for (const item of (body.failed as Failed[]) ?? []) {
      lines.push(`      ✗ ${item.label}`);
      for (const p of item.problems) lines.push(`          ✗ ${p.message} → ${p.fix}`);
    }
    return lines;
  }
  return [`  ✗ ${id}：${status}。${String(body.message ?? body.error ?? '')}`];
}
