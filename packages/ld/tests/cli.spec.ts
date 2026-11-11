import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { imageSize } from '../src/images.ts';
import { today } from '../src/templates.ts';
import { describeResult, uploadTarget } from '../src/upload.ts';
import { REPO, makeTempRoot, runLd } from './helpers.ts';

test('ld upload --env prod：送り先は https://ludion.ai、管理トークンは .prod.vars から読む', () => {
  const { root, cleanup } = makeTempRoot();
  try {
    const vars = join(root, '.prod.vars');
    writeFileSync(vars, 'ADMIN_TOKEN=prod-token-for-test\n');
    expect(uploadTarget('prod', {}, vars)).toEqual({ env: 'prod', url: 'https://ludion.ai', token: 'prod-token-for-test' });
    // 環境変数では送り先を変えられない
    expect(uploadTarget('prod', { LD_PROD_URL: 'https://evil.example', LD_PROD_TOKEN: 'x' }, vars).url).toBe('https://ludion.ai');
    // ファイルがなければ、どこに何を書くかを言って止まる
    expect(() => uploadTarget('prod', {}, join(root, 'none'))).toThrow('apps/web/.prod.vars');
  } finally {
    cleanup();
  }
});

test('ld upload の出力：キャッシュを消せなかったときだけ、一覧の反映が遅れることを出す', () => {
  const body = { version: '2', status: 'approved', previous_version: '1', creator: { handle: 'fixture', kind: 'person' }, keys: ['a'] };
  expect(describeResult('fx', { status: 201, body: { ...body, catalog_purged: true } }).join('\n')).not.toContain('一覧の反映');
  expect(describeResult('fx', { status: 201, body: { ...body, catalog_purged: false } }).join('\n')).toContain('一覧の反映に最大60秒かかる');
});

test('ld new：雛形を作り、subtype を書けば check が通る', () => {
  const { root, cleanup } = makeTempRoot();
  try {
    const made = runLd(['new', 'glass-card', '--type', 'component'], root);
    expect(made.code, made.out).toBe(0);
    const dir = join(root, 'works/glass-card');
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
    expect(meta).toEqual({
      id: 'glass-card',
      title: 'Glass Card',
      type: 'component',
      platform: null,
      category: 'Components',
      subtype: '',
      tags: [],
      creator: 'fixture',
      license: 'MIT',
      made_with: 'ai-assisted',
      version: '1',
      published_at: today(),
      pin_order: null,
    });
    const css = readFileSync(join(dir, 'part.css'), 'utf8');
    for (const name of ['bg', 'surface', 'fg', 'muted', 'accent', 'radius', 'font', 'space', 'shadow', 'motion']) {
      expect(css).toContain(`--_${name}: var(--ld-${name}, `);
    }
    expect(readFileSync(join(dir, 'part.html'), 'utf8')).toMatch(/^<div data-ld-part="glass-card">/);

    // subtype が空なので「形」だけで落ちる
    const first = runLd(['check', 'glass-card'], root);
    expect(first.code).toBe(1);
    expect(first.out).toContain('✗ subtype が空 → ');
    expect(first.out).toContain('→ 落ちた：形');

    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ ...meta, subtype: 'Card' }, null, 2));
    const second = runLd(['check', 'glass-card'], root);
    expect(second.code, second.out).toBe(0);
    expect(second.out).toContain('→ 通った');

    // 画面と、作り方の上書き
    expect(runLd(['new', 'trip-plan', '--type', 'screen', '--platform', 'mobile', '--made-with', 'human'], root).code).toBe(0);
    const screen = JSON.parse(readFileSync(join(root, 'works/trip-plan/meta.json'), 'utf8'));
    expect([screen.type, screen.platform, screen.category, screen.made_with]).toEqual(['screen', 'mobile', 'Mobile', 'human']);

    // 同じ id は作らない、間違った引数は止める
    expect(runLd(['new', 'glass-card', '--type', 'component'], root).code).toBe(1);
    expect(runLd(['new', 'Bad_Id', '--type', 'component'], root).code).toBe(1);
    expect(runLd(['new', 'x', '--type', 'page'], root).code).toBe(1);
  } finally {
    cleanup();
  }
});

test('ld add：check が通ったものだけ thumb.webp と og.png を作り、git add する（コミットはしない）', () => {
  const { root, cleanup } = makeTempRoot(['fx-toggle', 'fx-landing', 'fx-habits', 'fx-bad-color']);
  try {
    const result = runLd(['add', 'fx-toggle', 'fx-landing', 'fx-habits', 'fx-bad-color'], root);
    expect(result.code, result.out).toBe(1); // 壊した見本が1つ混ざっている
    expect(result.out).toContain('fx-bad-color は check が通らないので置かない');

    const expected: Record<string, [number, number]> = { 'fx-toggle': [800, 600], 'fx-landing': [800, 600], 'fx-habits': [800, 1000] };
    for (const [id, [w, h]] of Object.entries(expected)) {
      const thumb = readFileSync(join(root, 'works', id, 'thumb.webp'));
      expect(thumb.toString('ascii', 8, 12)).toBe('WEBP');
      expect(imageSize(thumb)).toEqual({ width: w, height: h });
      expect(thumb.length).toBeLessThanOrEqual(80 * 1024);
      expect(imageSize(readFileSync(join(root, 'works', id, 'og.png')))).toEqual({ width: 1200, height: 630 });
    }
    expect(existsSync(join(root, 'works/fx-bad-color/thumb.webp'))).toBe(false);

    const staged = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' }).stdout.trim().split('\n');
    expect(staged).toContain('works/fx-toggle/thumb.webp');
    expect(staged).toContain('works/fx-toggle/part.js');
    expect(staged).toContain('works/fx-habits/og.png');
    expect(staged.some((f) => f.startsWith('works/fx-bad-color/'))).toBe(false);
    // コミットはしていない
    expect(spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root }).status).not.toBe(0);
  } finally {
    cleanup();
  }
});

test('ld list：id、題名、check の結果、サムネイルの有無を表で出す', () => {
  const { root, cleanup } = makeTempRoot(['fx-button', 'fx-bad-overflow']);
  try {
    const result = runLd(['list'], root);
    expect(result.code, result.out).toBe(0);
    const lines = result.out.trim().split('\n');
    expect(lines[1]).toMatch(/^id\s+題名\s+作者\s+check\s+thumb\.webp\s+og\.png$/);
    expect(result.out).toMatch(/fx-bad-overflow\s+Broken: Overflow at 390\s+@fixture（person）\s+落ちた（崩れ）\s+なし\s+なし/);
    expect(result.out).toMatch(/fx-button\s+Ember Buttons\s+@fixture（person）\s+通った\s+なし\s+なし/);
  } finally {
    cleanup();
  }
});

test('作者の種類（T004）：--label でレーベルを作り、ld list に出す。kind のない作者の作品は「形」で落ちる', () => {
  const { root, cleanup } = makeTempRoot(['fx-button']);
  try {
    // 画像なしのレーベル：名前の頭文字でアバターを作る。X は任意
    const label = runLd(['creator', 'add', 'studio_kiln', '--name', 'Studio Kiln', '--label'], root);
    expect(label.code, label.out).toBe(0);
    expect(label.out).toContain('運営のレーベル（kind: label）');
    expect(JSON.parse(readFileSync(join(root, 'creators/studio_kiln/creator.json'), 'utf8'))).toEqual({
      handle: 'studio_kiln',
      name: 'Studio Kiln',
      kind: 'label',
      x_url: null,
      site_url: null,
    });
    expect(imageSize(readFileSync(join(root, 'creators/studio_kiln/avatar.webp')))).toEqual({ width: 96, height: 96 });
    // 実在の人は、画像を省けない
    const person = runLd(['creator', 'add', 'someone', '--name', 'Someone'], root);
    expect(person.code).toBe(1);
    expect(person.out).toContain('--avatar <画像> を付ける');

    // 作品をレーベルの作者にすると、ld list に label と出て、check も通る
    const metaPath = join(root, 'works/fx-button/meta.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    writeFileSync(metaPath, JSON.stringify({ ...meta, creator: 'studio_kiln' }, null, 2));
    const list = runLd(['list'], root);
    expect(list.out).toMatch(/fx-button\s+Ember Buttons\s+@studio_kiln（label）\s+通った/);
    expect(runLd(['check', 'fx-button'], root).code).toBe(0);

    // kind を消すと「形」で落ちる
    const creatorPath = join(root, 'creators/studio_kiln/creator.json');
    const { kind: _, ...withoutKind } = JSON.parse(readFileSync(creatorPath, 'utf8'));
    writeFileSync(creatorPath, JSON.stringify(withoutKind, null, 2));
    const missing = runLd(['check', 'fx-button'], root);
    expect(missing.code).toBe(1);
    expect(missing.out).toContain('✗ 作者 @studio_kiln：creator.json に "kind" がない（creators/studio_kiln/creator.json）');
    expect(missing.out).toContain('→ 落ちた：形');
    expect(runLd(['list'], root).out).toMatch(/@studio_kiln（kind なし）\s+落ちた（形）/);

    // 値が違っても落ちる
    writeFileSync(creatorPath, JSON.stringify({ ...withoutKind, kind: 'studio' }, null, 2));
    expect(runLd(['check', 'fx-button'], root).out).toContain('creator.json の kind "studio" は使えない');
  } finally {
    cleanup();
  }
});

test('ld new の雛形：作者の --_muted の既定値は #6b6b76（T003 報告の [CTO]、案A）', () => {
  const { root, cleanup } = makeTempRoot();
  try {
    expect(runLd(['new', 'muted-card', '--type', 'component'], root).code).toBe(0);
    expect(runLd(['new', 'muted-page', '--type', 'screen'], root).code).toBe(0);
    for (const id of ['muted-card', 'muted-page']) {
      expect(readFileSync(join(root, 'works', id, 'part.css'), 'utf8')).toContain('--_muted: var(--ld-muted, #6b6b76);');
    }
  } finally {
    cleanup();
  }
});

test('ld new の雛形：--_danger は書き方をコメントで示すだけで、宣言しない（T006）', () => {
  const { root, cleanup } = makeTempRoot();
  try {
    expect(runLd(['new', 'plain-card', '--type', 'component'], root).code).toBe(0);
    const css = readFileSync(join(root, 'works/plain-card/part.css'), 'utf8');
    expect(css).toContain('--_danger: var(--ld-danger, #c81e1e);');
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(withoutComments).not.toContain('--_danger');
  } finally {
    cleanup();
  }
});

test('ld creator add：creators/<handle>/ を作り、アバターを 96×96 の webp にする', () => {
  const { root, cleanup } = makeTempRoot();
  try {
    const avatar = join(root, 'me.svg');
    writeFileSync(avatar, '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#f60"/></svg>');
    const result = runLd(['creator', 'add', '@kaito', '--name', 'Kaito', '--x', 'https://x.com/kaito', '--avatar', avatar], root);
    expect(result.code, result.out).toBe(0);
    expect(JSON.parse(readFileSync(join(root, 'creators/kaito/creator.json'), 'utf8'))).toEqual({
      handle: 'kaito',
      name: 'Kaito',
      kind: 'person',
      x_url: 'https://x.com/kaito',
      site_url: null,
    });
    const webp = readFileSync(join(root, 'creators/kaito/avatar.webp'));
    expect(imageSize(webp)).toEqual({ width: 96, height: 96 });

    expect(runLd(['creator', 'add', 'kaito', '--name', 'K', '--avatar', avatar, '--x', 'x.com/k'], root).code).toBe(1);
  } finally {
    cleanup();
  }
});

test('作者 Lattice_Node：大文字と _ の handle で登録し、ld list が作品0件で ld.config.json の作者を読み、ld new が作者を聞かずに雛形を作る（T003）', () => {
  const { root, cleanup } = makeTempRoot();
  try {
    const avatar = join(root, 'l.svg');
    writeFileSync(avatar, '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#16161d"/></svg>');
    const added = runLd(['creator', 'add', 'Lattice_Node', '--name', 'Lattice', '--x', 'https://x.com/Lattice_Node', '--avatar', avatar], root);
    expect(added.code, added.out).toBe(0);
    expect(JSON.parse(readFileSync(join(root, 'creators/Lattice_Node/creator.json'), 'utf8')).handle).toBe('Lattice_Node');

    // 大文字と小文字だけが違う handle は、同じ作者なので別には作らない
    const dup = runLd(['creator', 'add', 'lattice_node', '--name', 'L', '--avatar', avatar], root);
    expect(dup.code).toBe(1);
    expect(dup.out).toContain('同じ作者 @Lattice_Node がもういる');
    // X のハンドルの形でないものは止める
    expect(runLd(['creator', 'add', 'has-hyphen', '--name', 'H', '--avatar', avatar], root).code).toBe(1);
    expect(runLd(['creator', 'add', 'a234567890123456', '--name', 'H', '--avatar', avatar], root).code).toBe(1);

    writeFileSync(join(root, 'ld.config.json'), `${JSON.stringify({ creator: 'Lattice_Node', made_with: 'ai-assisted' })}\n`);
    const list = runLd(['list'], root);
    expect(list.code, list.out).toBe(0);
    expect(list.out).toContain('works/ に作品がない（0件）');
    expect(list.out).toContain('既定の作者：@Lattice_Node（ai-assisted、person、creators/Lattice_Node/ あり）');

    const made = runLd(['new', 'quiet-card', '--type', 'component'], root);
    expect(made.code, made.out).toBe(0);
    expect(made.out).toContain('作者 @Lattice_Node');
    const meta = JSON.parse(readFileSync(join(root, 'works/quiet-card/meta.json'), 'utf8'));
    expect([meta.creator, meta.made_with]).toEqual(['Lattice_Node', 'ai-assisted']);

    // meta.json の creator が小文字でも、同じ作者として「形」を通す
    writeFileSync(join(root, 'works/quiet-card/meta.json'), JSON.stringify({ ...meta, creator: 'lattice_node', subtype: 'Card' }, null, 2));
    const checked = runLd(['check', 'quiet-card'], root);
    expect(checked.code, checked.out).toBe(0);
  } finally {
    cleanup();
  }
});

test('リポジトリの見本：良い4つに thumb.webp（幅800px、80KB以下）と og.png（1200×630）がある', () => {
  for (const id of ['fx-toggle', 'fx-button', 'fx-landing', 'fx-habits']) {
    const thumb = readFileSync(join(REPO, 'fixtures/works', id, 'thumb.webp'));
    expect(imageSize(thumb)?.width).toBe(800);
    expect(thumb.length).toBeLessThanOrEqual(80 * 1024);
    expect(imageSize(readFileSync(join(REPO, 'fixtures/works', id, 'og.png')))).toEqual({ width: 1200, height: 630 });
  }
});
