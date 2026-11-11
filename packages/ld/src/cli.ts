// ld：オーナーの裏方の道具（docs/tasks/T002.md「3」）。リポジトリの根から npx ld <コマンド>。

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Browser } from 'playwright';
import type { Creator, CreatorKind, MadeWith, Platform, WorkType } from '@ludion/render';
import { launch } from './browser.ts';
import { ITEM_LABELS, checkWork, formatCheck, type CheckResult } from './check.ts';
import { MAX_THUMB_BYTES, imageSize, makeAvatar, makeMonogramAvatar, makeOg, makeThumb } from './images.ts';
import { startPreview } from './preview.ts';
import { isWallpaperWork, launchForStills, makeStills, stillTime, type StillsBrowser } from './stills.ts';
import { CREATOR_KINDS, HANDLE_PATTERN, ID_PATTERN, MADE_WITH } from '@ludion/rules';
import { newCss, newHtml, newMeta, today } from './templates.ts';
import { collectFiles, describeResult, sendWork, uploadTarget, type UploadEnv } from './upload.ts';
import { describePrivate, hasKey, loginHint, loginTo, privateBase, putPrivate, stateHome } from './private.ts';
import {
  creatorDir,
  creatorExists,
  findCreatorHandle,
  findWork,
  library,
  listWorks,
  readCreator,
  readCreatorRaw,
  readWork,
  rootDir,
  shown,
  toRenderable,
  type Library,
  type WorkLocation,
} from './workspace.ts';

const USAGE = `使い方（リポジトリの根で）：
  npx ld new <id> --type screen|component [--platform web|mobile] [--made-with human|ai-assisted]
  npx ld preview <id> [--port 4300] [--no-open]
  npx ld check <id> [<id> …] | --all [--fixtures]
  npx ld add <id> [<id> …]
  npx ld upload <id> [<id> …] [--publish] [--env dev|prod] [--still-time HH:MM]
  npx ld upload <id> [<id> …] --private [--env dev|prod]   （自分だけの作品として /api/v1 に置く）
  npx ld login [--env prod|dev]   （--private の鍵。ブラウザで「許可する」を1回押す。既定は prod）
  npx ld list [--fixtures]
  npx ld creator add <handle> --name <名前> [--x <URL>] [--site <URL>] --avatar <画像> [--fixtures]
  npx ld creator add <handle> --name <名前> --label [--x <URL>] [--avatar <画像>]   （運営のレーベル）`;

class UsageError extends Error {}

function fail(message: string): never {
  throw new UsageError(message);
}

interface Config {
  creator: string;
  made_with: MadeWith;
}

function readConfig(): Config {
  const file = join(rootDir(), 'ld.config.json');
  if (!existsSync(file)) fail(`ld.config.json がない。リポジトリの根に { "creator": "<handle>", "made_with": "ai-assisted" } を置く`);
  const config = JSON.parse(readFileSync(file, 'utf8')) as Partial<Config>;
  if (typeof config.creator !== 'string' || !HANDLE_PATTERN.test(config.creator)) fail('ld.config.json の creator が handle の形ではない（@ は付けない）');
  if (!(MADE_WITH as readonly unknown[]).includes(config.made_with)) fail('ld.config.json の made_with は "human" か "ai-assisted"');
  return config as Config;
}

function locate(id: string): WorkLocation {
  const location = findWork(id);
  if (!location) fail(`作品 ${id} がない（works/${id}/ も fixtures/works/${id}/ もない）`);
  return location;
}

// ---------------------------------------------------------------- new

function cmdNew(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { type: { type: 'string' }, platform: { type: 'string' }, 'made-with': { type: 'string' } },
  });
  const [id] = positionals;
  if (!id) fail('id がない。例：npx ld new toggle-aurora --type component');
  if (!ID_PATTERN.test(id)) fail(`id "${id}" は英小文字・数字・ハイフンだけにする`);
  const type = values.type as WorkType;
  if (type !== 'screen' && type !== 'component') fail('--type screen か --type component を付ける');
  const platform = (values.platform ?? (type === 'screen' ? 'web' : null)) as Platform | null;
  if (platform !== null && platform !== 'web' && platform !== 'mobile') fail('--platform は web か mobile');
  const config = readConfig();
  const madeWith = (values['made-with'] ?? config.made_with) as MadeWith;
  if (!(MADE_WITH as readonly string[]).includes(madeWith)) fail('--made-with は human か ai-assisted');

  if (findWork(id)) fail(`作品 ${id} はもうある（${shown(findWork(id)!.dir)}）`);
  const dir = join(rootDir(), 'works', id);
  mkdirSync(dir, { recursive: true });
  const meta = newMeta({ id, type, platform, creator: config.creator, madeWith, date: today() });
  writeFileSync(join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  writeFileSync(join(dir, 'part.html'), newHtml(id, type));
  writeFileSync(join(dir, 'part.css'), newCss(id, type));
  console.log(`${shown(dir)}/ を作った（${type}${platform ? `・${platform}` : ''}、作者 @${config.creator}、${madeWith}）`);
  console.log('meta.json の title と subtype を書き、part.html と part.css を作る。動きがあれば part.js に export function mount(root) を書く。');
  console.log(`次：npx ld preview ${id}`);
}

// ---------------------------------------------------------------- preview

async function cmdPreview(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { port: { type: 'string', default: '4300' }, 'no-open': { type: 'boolean', default: false } },
  });
  const [id] = positionals;
  if (!id) fail('id がない。例：npx ld preview toggle-aurora');
  const location = locate(id);
  const server = await startPreview(location, { port: Number(values.port), open: !values['no-open'] });
  console.log(`ld preview ${id}：${server.url}  （止めるには Ctrl+C）`);
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

// ---------------------------------------------------------------- check

function targets(positionals: string[], all: boolean, fixtures: boolean): WorkLocation[] {
  if (all) return listWorks(library(fixtures ? 'fixtures' : 'works'));
  if (positionals.length === 0) fail('id がない。例：npx ld check toggle-aurora（全部なら --all）');
  return positionals.map(locate);
}

async function runChecks(locations: WorkLocation[], browser: Browser): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const location of locations) {
    const result = await checkWork(location, browser);
    console.log(formatCheck(result));
    results.push(result);
  }
  return results;
}

async function cmdCheck(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { all: { type: 'boolean', default: false }, fixtures: { type: 'boolean', default: false } },
  });
  const locations = targets(positionals, values.all, values.fixtures);
  const browser = await launch();
  try {
    const results = await runChecks(locations, browser);
    if (results.length > 1) console.log(`\n${results.filter((r) => r.ok).length}/${results.length} が通った`);
    return results.every((r) => r.ok) ? 0 : 1;
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------- add

async function cmdAdd(args: string[]): Promise<number> {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} });
  if (positionals.length === 0) fail('id がない。例：npx ld add toggle-aurora');
  const locations = positionals.map(locate);
  const browser = await launch();
  let failed = 0;
  try {
    for (const location of locations) {
      const result = await checkWork(location, browser);
      console.log(formatCheck(result));
      if (!result.ok) {
        console.log(`  ${location.id} は check が通らないので置かない`);
        failed += 1;
        continue;
      }
      const work = toRenderable(readWork(location))!;
      const creator = readCreator(location.library, work.meta.creator);
      const thumb = await makeThumb(browser, work);
      if (thumb.webp.length > MAX_THUMB_BYTES) {
        console.log(`  thumb.webp が ${(thumb.webp.length / 1024).toFixed(1)}KB で 80KB に収まらない。色の数や細かい模様を減らす`);
        failed += 1;
        continue;
      }
      const og = await makeOg(browser, work, creator, thumb.webp);
      writeFileSync(join(location.dir, 'thumb.webp'), thumb.webp);
      writeFileSync(join(location.dir, 'og.png'), og);
      const rel = shown(location.dir);
      execFileSync('git', ['add', '--', rel], { cwd: rootDir(), stdio: 'inherit' });
      console.log(
        `  thumb.webp ${thumb.width}×${thumb.height} ${(thumb.webp.length / 1024).toFixed(1)}KB、og.png 1200×630 を作り、git add ${rel} した（コミットはしていない）`,
      );
      if (thumb.fit) {
        const { wide, scale, fill } = thumb.fit;
        const share = `サムネイルの幅の ${(fill.width * 100).toFixed(1)}%、高さの ${(fill.height * 100).toFixed(1)}%`;
        console.log(
          wide
            ? `  幅いっぱいの部品なので、幅1280で描いて枠の上に寄せ、800×480 に縮めた（${share}）`
            : `  部品は倍率 ${scale.toFixed(2)} で撮った（${share}）`,
        );
      }
    }
  } finally {
    await browser.close();
  }
  return failed === 0 ? 0 : 1;
}

// ---------------------------------------------------------------- upload

async function cmdUpload(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      publish: { type: 'boolean', default: false },
      private: { type: 'boolean', default: false },
      env: { type: 'string', default: 'dev' },
      'still-time': { type: 'string' },
    },
  });
  if (positionals.length === 0) fail('id がない。例：npx ld upload toggle-aurora --publish --env dev');
  if (values.private && values.publish) fail('--private と --publish は一緒に使えない。自分だけの作品は公開しない（公開するときは、サイトから審査に出す）');
  if (values.private) return uploadPrivate(positionals, values.env);
  const stillAt = values['still-time'];
  if (stillAt !== undefined && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(stillAt)) fail('--still-time は HH:MM（例：21:00）');
  const env = values.env as UploadEnv;
  if (env !== 'dev' && env !== 'prod') fail('--env は dev か prod');
  let target;
  try {
    target = uploadTarget(env);
  } catch (error) {
    fail((error as Error).message);
  }
  const locations = positionals.map(locate);
  console.log(`送り先：${target.url}（${env}）。${values.publish ? '--publish：approved で置く' : '--publish なし：新しい作品は draft、今ある作品は状態を変えずに版を差し替える'}`);
  const browser = await launch();
  // 壁紙の静止画を撮るブラウザ（本物の GPU を試す）。壁紙の作品があるときだけ開く
  let stillsBrowser: StillsBrowser | null = null;
  let failed = 0;
  try {
    for (const location of locations) {
      const result = await checkWork(location, browser);
      console.log(formatCheck(result));
      if (!result.ok) {
        console.log(`  ${location.id} は check が通らないので送らない`);
        failed += 1;
        continue;
      }
      const work = toRenderable(readWork(location))!;
      // サムネイルと OG 画像がなければ、ld add と同じ形で作る（git add はしない）
      if (!existsSync(join(location.dir, 'thumb.webp')) || !existsSync(join(location.dir, 'og.png'))) {
        const thumb = await makeThumb(browser, work);
        const og = await makeOg(browser, work, readCreator(location.library, work.meta.creator), thumb.webp);
        writeFileSync(join(location.dir, 'thumb.webp'), thumb.webp);
        writeFileSync(join(location.dir, 'og.png'), og);
        console.log(`  thumb.webp と og.png がなかったので作った（${shown(location.dir)}/。コミットは自分で）`);
      }
      const files = collectFiles(location, work.meta.creator);
      // 壁紙の作品は、静止画を3つの大きさで作って一緒に送る（WALL002）。ファイルには残さない
      if (isWallpaperWork(work)) {
        if (!stillsBrowser) {
          stillsBrowser = await launchForStills();
          if (stillsBrowser.software) console.log(`  ！ 静止画の描き手が GPU ではない（${stillsBrowser.renderer}）。WebGL の作品は、作品が細かさを落とすことがある`);
        }
        let stills;
        try {
          stills = await makeStills(stillsBrowser.browser, work, { time: stillAt });
        } catch (error) {
          console.log(`  ✗ ${location.id}：静止画を作れなかった（${(error as Error).message}）。送らない`);
          failed += 1;
          continue;
        }
        files.push(...stills.map((still) => ({ name: still.name, bytes: still.png })));
        const at = stillTime(work, stillAt);
        const sizes = stills.map((still) => `${still.size.width}×${still.size.height} ${(still.png.length / 1024 / 1024).toFixed(1)}MB`).join('、');
        console.log(`  静止画：${sizes}（${at.toTimeString().slice(0, 5)} の絵。描き手 ${stillsBrowser.renderer}）`);
      }
      let sent;
      try {
        sent = await sendWork(target, files, values.publish);
      } catch (error) {
        const cause = (error as { cause?: { code?: string } }).cause?.code ?? (error as Error).message;
        console.log(`  ✗ ${location.id}：${target.url} に繋がらない（${cause}）。${env === 'dev' ? 'npm run dev を動かしているか確かめる' : ''}`);
        failed += 1;
        continue;
      }
      for (const line of describeResult(location.id, sent)) console.log(line);
      if (sent.status !== 201) failed += 1;
    }
  } finally {
    await stillsBrowser?.close();
    await browser.close();
  }
  if (locations.length > 1) console.log(`\n${locations.length - failed}/${locations.length} を送った`);
  return failed === 0 ? 0 : 1;
}

/** ld upload --private：check が通った作品を /api/v1 に送り、自分だけの作品として置く（LD002）。 */
async function uploadPrivate(ids: string[], envValue: string | undefined): Promise<number> {
  const env = envValue as UploadEnv;
  if (env !== 'dev' && env !== 'prod') fail('--env は dev か prod');
  const base = privateBase(env);
  const locations = ids.map(locate);
  // 対応（.ludion.json）は元の clone の根に置く。worktree の中でも同じ1つ
  const stateDir = stateHome(rootDir());
  // 鍵がなければ、ブラウザも開かずに止める
  if (!(await hasKey(base))) fail(loginHint(env));
  console.log(`送り先：${base}（${env}）の /api/v1。--private：自分だけの作品として置く（公開しない。審査にも出さない）`);
  const browser = await launch();
  let failed = 0;
  try {
    for (const location of locations) {
      const result = await checkWork(location, browser);
      console.log(formatCheck(result));
      if (!result.ok) {
        console.log(`  ${location.id} は check が通らないので送らない`);
        failed += 1;
        continue;
      }
      const work = toRenderable(readWork(location))!;
      const sent = await putPrivate(work, base, stateDir);
      for (const line of describePrivate(location.id, sent, env)) console.log(line);
      if (!sent.ok) failed += 1;
    }
  } finally {
    await browser.close();
  }
  if (locations.length > 1) console.log(`
${locations.length - failed}/${locations.length} を置いた`);
  return failed === 0 ? 0 : 1;
}

// ---------------------------------------------------------------- login

async function cmdLogin(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { env: { type: 'string', default: 'prod' } } });
  const env = values.env as UploadEnv;
  if (env !== 'dev' && env !== 'prod') fail('--env は prod か dev');
  const base = privateBase(env);
  console.log(`${base} につなぐ。ブラウザで Ludion にログインし、「許可する」を押す`);
  const result = await loginTo(base);
  if (!result.ok) {
    console.log(`  ✗ つながらなかった（${String(result.error)}）：${String(result.message)}`);
    return 1;
  }
  console.log(`  つながった（~/.ludion/auth.json。プラグインと同じつながり）。npx ld upload <id> --private${env === 'prod' ? ' --env prod' : ''} で置ける`);
  return 0;
}

// ---------------------------------------------------------------- list

/** 端末での文字の幅（全角は2）。 */
function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1;
  return width;
}

function pad(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
}

function fileSummary(path: string): string {
  if (!existsSync(path)) return 'なし';
  const buffer = readFileSync(path);
  const size = imageSize(buffer);
  return `${size ? `${size.width}×${size.height}` : '?'} ${(buffer.length / 1024).toFixed(1)}KB`;
}

/** ld list の1行目：ld.config.json の既定の作者と作り方。ないときや、作者がいないときも止めずに知らせる。 */
function configLine(): string {
  const file = join(rootDir(), 'ld.config.json');
  if (!existsSync(file)) return '既定の作者：なし（ld.config.json がない。ld new の前に根に置く）';
  let config: Config;
  try {
    config = readConfig();
  } catch (error) {
    return `既定の作者：読めない（${(error as Error).message}）`;
  }
  const lib = library('works');
  const registered = creatorExists(lib, config.creator)
    ? `${creatorKind(lib, config.creator)}、creators/${findCreatorHandle(lib, config.creator)}/ あり`
    : `creators/ にいない。npx ld creator add ${config.creator} --name <名前> --avatar <画像> で作る`;
  return `既定の作者：@${config.creator}（${config.made_with}、${registered}）`;
}

/** 作者の種類の表示：person、label。読めない・違うときはその旨（ld check の「形」で落ちる）。 */
function creatorKind(lib: Library, handle: string): string {
  if (!creatorExists(lib, handle)) return 'いない';
  const { raw } = readCreatorRaw(lib, handle);
  const kind = (raw as { kind?: unknown } | undefined)?.kind;
  return (CREATOR_KINDS as readonly unknown[]).includes(kind) ? (kind as string) : kind === undefined ? 'kind なし' : `kind "${String(kind)}"`;
}

async function cmdList(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { fixtures: { type: 'boolean', default: false } } });
  const lib = library(values.fixtures ? 'fixtures' : 'works');
  const locations = listWorks(lib);
  if (locations.length === 0) {
    console.log(`${shown(join(lib.base, 'works'))}/ に作品がない（0件）。npx ld new <id> --type component で作り始める`);
    if (!values.fixtures) console.log(configLine());
    return 0;
  }
  const browser = await launch();
  const rows: string[][] = [['id', '題名', '作者', 'check', 'thumb.webp', 'og.png']];
  try {
    for (const location of locations) {
      const result = await checkWork(location, browser);
      const raw = readWork(location);
      const title = typeof (raw.meta as { title?: unknown })?.title === 'string' ? (raw.meta as { title: string }).title : '?';
      const handle = (raw.meta as { creator?: unknown } | undefined)?.creator;
      const creator = typeof handle === 'string' ? `@${handle}（${creatorKind(lib, handle)}）` : '?';
      const failed = result.items.filter((i) => !i.ok).map((i) => ITEM_LABELS[i.key]);
      rows.push([
        location.id,
        title,
        creator,
        failed.length === 0 ? '通った' : `落ちた（${failed.join('、')}）`,
        fileSummary(join(location.dir, 'thumb.webp')),
        fileSummary(join(location.dir, 'og.png')),
      ]);
    }
  } finally {
    await browser.close();
  }
  const widths = rows[0].map((_, col) => Math.max(...rows.map((row) => displayWidth(row[col]))));
  console.log(`${shown(join(lib.base, 'works'))}/`);
  for (const [index, row] of rows.entries()) {
    console.log(row.map((cell, col) => pad(cell, widths[col])).join('  ').trimEnd());
    if (index === 0) console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  }
  if (!values.fixtures) console.log(`\n${configLine()}`);
  return 0;
}

// ---------------------------------------------------------------- creator add

async function cmdCreator(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub !== 'add') fail('npx ld creator add <handle> --name <名前> --avatar <画像>');
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      x: { type: 'string' },
      site: { type: 'string' },
      avatar: { type: 'string' },
      label: { type: 'boolean', default: false },
      fixtures: { type: 'boolean', default: false },
    },
  });
  const [rawHandle] = positionals;
  const handle = rawHandle?.replace(/^@/, '');
  if (!handle || !HANDLE_PATTERN.test(handle)) {
    fail('handle は X のハンドルと同じ形（英数字と _、15文字まで）。例：npx ld creator add Lattice_Node --name Lattice --avatar a.png');
  }
  if (!values.name) fail('--name <名前> を付ける');
  // 実在の人は本人の画像が要る。運営のレーベルは、画像がなければ名前の頭文字で作る
  const kind: CreatorKind = values.label ? 'label' : 'person';
  if (!values.avatar && kind === 'person') fail('--avatar <画像> を付ける（運営のレーベルなら --label。画像は省ける）');
  for (const [flag, url] of [['--x', values.x], ['--site', values.site]] as const) {
    if (url !== undefined && !/^https:\/\/\S+$/.test(url)) fail(`${flag} は https:// で始まる URL`);
  }
  const avatarFile = values.avatar ? resolve(process.cwd(), values.avatar) : null;
  if (avatarFile && !existsSync(avatarFile)) fail(`アバターの画像がない：${values.avatar}`);

  const lib = library(values.fixtures ? 'fixtures' : 'works');
  const existing = findCreatorHandle(lib, handle);
  if (existing !== null && existing !== handle) {
    fail(`同じ作者 @${existing} がもういる（handle は大文字と小文字を区別せずに比べる）。綴りを変えるなら creators/${existing}/ の名前を手で変える`);
  }
  const dir = creatorDir(lib, handle);
  const browser = await launch();
  try {
    const avatar = avatarFile ? await makeAvatar(browser, avatarFile) : await makeMonogramAvatar(browser, values.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'avatar.webp'), avatar);
    const creator: Creator = { handle, name: values.name, kind, x_url: values.x ?? null, site_url: values.site ?? null };
    writeFileSync(join(dir, 'creator.json'), `${JSON.stringify(creator, null, 2)}\n`);
  } finally {
    await browser.close();
  }
  const what = kind === 'label' ? '運営のレーベル（kind: label）' : '実在の作者（kind: person）';
  console.log(`${shown(dir)}/ を作った：${what}。creator.json、avatar.webp 96×96${avatarFile ? '' : '（名前の頭文字）'}`);
  return 0;
}

// ---------------------------------------------------------------- main

export async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  try {
    switch (command) {
      case 'new':
        cmdNew(args);
        return 0;
      case 'preview':
        await cmdPreview(args);
        return -1; // 動き続ける
      case 'check':
        return await cmdCheck(args);
      case 'add':
        return await cmdAdd(args);
      case 'upload':
        return await cmdUpload(args);
      case 'login':
        return await cmdLogin(args);
      case 'list':
        return await cmdList(args);
      case 'creator':
        return await cmdCreator(args);
      default:
        console.log(USAGE);
        return command === undefined || command === 'help' || command === '--help' ? 0 : 1;
    }
  } catch (error) {
    if (error instanceof UsageError || (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      console.error(`ld ${command}：${(error as Error).message}`);
      return 1;
    }
    throw error;
  }
}

const code = await main(process.argv.slice(2));
if (code >= 0) process.exitCode = code;
