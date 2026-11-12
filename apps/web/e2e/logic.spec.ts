import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Work } from '../src/data/works';
import { withoutSearchTerm } from '../src/lib/analytics';
import { formatCount } from '../src/lib/format';
import { categoryHref, parseHomeQuery, selectWorks, sortHref } from '../src/lib/homeQuery';
import { gridShape } from '../src/lib/gridShape';
import { layoutMasonry, thumbRatio } from '../src/lib/masonry';
import { isRemixSource } from '../src/lib/isRemix';
import { comparePopular } from '../src/lib/popular';
import wwwWorker from '../www-redirect/worker';
import { OUTLINE_VERSION, buildOutline } from '@ludion/outline';
import { loadOutline, outlineFromBytes, type OutlineBucket } from '../worker/outline';
import { diffLines, diffRows, splitLines, type DiffRun } from '../src/lib/lineDiff';
import { diffVersions } from '../src/lib/versionDiff';

const seed: Work[] = JSON.parse(readFileSync(new URL('../../../seed/works.json', import.meta.url), 'utf8'));
const popular = seed.toSorted(comparePopular);
const query = (search: string) => parseHomeQuery(new URLSearchParams(search));
const ids = (works: Work[]) => works.map((work) => work.id);

test.describe('リミックスの検出', () => {
  test('Remix by と Remixed by を、大文字小文字を問わず見つける', () => {
    expect(isRemixSource('<!-- Remixed by Claude -->')).toBe(true);
    expect(isRemixSource('/* Remix by Ada */')).toBe(true);
    expect(isRemixSource('remixed   BY x')).toBe(true);
    expect(isRemixSource('', 'a { }', 'export function mount(root) { return () => {} }')).toBe(false);
    expect(isRemixSource('premix by someone')).toBe(false);
    expect(isRemixSource('remix byline')).toBe(false);
  });
});

test.describe('www の転送（docs/tasks/T013.md「1」）', () => {
  test('道と URL の値はそのままで、https://ludion.ai へ 301', () => {
    const response = wwwWorker.fetch(new Request('https://www.ludion.ai/p/toggle-daylight?utm_source=x#top'));
    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe('https://ludion.ai/p/toggle-daylight?utm_source=x');
    expect(wwwWorker.fetch(new Request('http://www.ludion.ai/')).headers.get('Location')).toBe('https://ludion.ai/');
  });

  test('最低限のヘッダー：nosniff と HSTS（docs/tasks/T022.md「2」）', () => {
    const { headers } = wwwWorker.fetch(new Request('https://www.ludion.ai/'));
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Strict-Transport-Security')).toBe('max-age=604800');
  });
});

test.describe('検索の q の上限（docs/tasks/T022.md「4」）', () => {
  const q = (raw: string) => query(new URLSearchParams({ q: raw }).toString()).q;

  test('前後の空白を落とす。全角の空白も', () => {
    expect(q('  landing page \n')).toBe('landing page');
    expect(q('　日本語　')).toBe('日本語');
    expect(q('   ')).toBe('');
  });

  test('語の間の空白は、上限の中ならそのまま', () => {
    expect(q('a  b　c')).toBe('a  b　c');
  });

  test('8語までにする。超えたら切る', () => {
    expect(q('1 2 3 4 5 6 7 8')).toBe('1 2 3 4 5 6 7 8');
    expect(q('1 2 3 4 5 6 7 8 9 10')).toBe('1 2 3 4 5 6 7 8');
    expect(q('1　2　3　4　5　6　7　8　9')).toBe('1 2 3 4 5 6 7 8');
  });

  test('200文字までにする。超えたら切る', () => {
    expect(q('a'.repeat(200))).toHaveLength(200);
    expect(q('a'.repeat(201))).toHaveLength(200);
    expect(q('a'.repeat(100000))).toHaveLength(200);
  });

  test('切ったところに空白を残さず、絵文字を半分にしない', () => {
    expect(q(`${'a'.repeat(199)} bcd`)).toBe('a'.repeat(199));
    expect(q(`${'a'.repeat(199)}😀`)).toBe('a'.repeat(199));
  });

  test('チップと並びのリンクにも、切った q を入れる', () => {
    const long = new URLSearchParams({ q: 'a'.repeat(5000) });
    expect(categoryHref(long, 'web')).toBe(`/?q=${'a'.repeat(200)}&c=web`);
    expect(sortHref(long, 'new')).toBe(`/?q=${'a'.repeat(200)}&sort=new`);
  });
});

test.describe('GA4 に検索語を送らない（SPEC 15）', () => {
  test('q だけを除く', () => {
    expect(withoutSearchTerm('https://ludion.ai/?q=abc&utm_source=x&c=web')).toBe('https://ludion.ai/?utm_source=x&c=web');
    expect(withoutSearchTerm('')).toBe('');
    // ログインの画面の next には、元のページの URL が検索語ごと入る
    expect(withoutSearchTerm('https://ludion.ai/login?next=%2F%3Fq%3Dabc')).toBe('https://ludion.ai/login');
  });
});

test.describe('数の書き方（SPEC 3）', () => {
  for (const [input, expected] of [
    [0, '0'],
    [952, '952'],
    [999, '999'],
    [1000, '1,000'],
    [1240, '1,240'],
    [9999, '9,999'],
    [10_000, '1万'],
    [12_400, '1.2万'],
    [120_000, '12万'],
    [99_994_999, '9999.5万'],
    [99_999_000, '9999.9万'],
    [99_999_500, '1億'],
    [120_000_000, '1.2億'],
  ] as const) {
    test(`${input} → ${expected}`, () => {
      expect(formatCount(input)).toBe(expected);
    });
  }
});

test.describe('Popular の順（SPEC 4）', () => {
  const base = seed[0];
  const work = (over: Partial<Work>): Work => ({ ...base, pin_order: null, copies_30d: 0, likes: 0, published_at: 0, ...over });

  test('pin_order → コピー数 → いいね数 → 公開日の順に効く', () => {
    const list = [
      work({ id: 'new', published_at: 2 }),
      work({ id: 'old', published_at: 1 }),
      work({ id: 'liked', likes: 999 }),
      work({ id: 'copied', copies_30d: 1 }),
      work({ id: 'pin2', pin_order: 2 }),
      work({ id: 'pin1', pin_order: 1 }),
    ];
    expect(ids(list.toSorted(comparePopular))).toEqual(['pin1', 'pin2', 'copied', 'liked', 'new', 'old']);
  });

  test('いいねが多くても、使われた数が多い作品より上に来ない', () => {
    const many = work({ id: 'many-likes', likes: 100_000, copies_30d: 1 });
    const used = work({ id: 'used', likes: 1, copies_30d: 2 });
    expect(ids([many, used].toSorted(comparePopular))).toEqual(['used', 'many-likes']);
  });
});

test.describe('見本データ（SPEC 11）', () => {
  test('50作品。縦横比は 0.6〜1.25 の間でばらばら。作者は seed_a〜seed_d', () => {
    expect(seed).toHaveLength(50);
    const ratios = seed.map((w) => w.thumb_h / w.thumb_w);
    expect(Math.min(...ratios)).toBe(0.6);
    expect(Math.max(...ratios)).toBe(1.25);
    expect(new Set(ratios).size).toBeGreaterThan(20);
    expect(new Set(seed.map((w) => w.creator.handle))).toEqual(new Set(['seed_a', 'seed_b', 'seed_c', 'seed_d']));
    expect(new Set(seed.map((w) => w.id)).size).toBe(50);
    // 作者の種類は混ざっている（docs/tasks/T005.md「1」）
    expect(new Set(seed.map((w) => w.creator.kind))).toEqual(new Set(['person', 'label']));
  });

  test('Popular の先頭12作品は順が変わらない（1440 の見比べの土台）', () => {
    expect(popular.slice(0, 3).map((w) => w.title)).toEqual([
      'Studio Portfolio Landing',
      'Trail Guide App',
      'Revenue Overview',
    ]);
  });
});

test.describe('絞り込み（SPEC 4、7）', () => {
  const titles = (search: string) => selectWorks(popular, query(search)).map((w) => w.title);

  test('Web と Mobile は platform で分かれる', () => {
    const web = selectWorks(popular, query('c=web'));
    const mobile = selectWorks(popular, query('c=mobile'));
    expect(web.length).toBeGreaterThan(0);
    expect(mobile.length).toBeGreaterThan(0);
    expect(web.every((w) => w.platform === 'web')).toBe(true);
    expect(mobile.every((w) => w.platform === 'mobile')).toBe(true);
  });

  for (const tag of ['dashboard', 'ecommerce', 'minimal', 'experimental']) {
    test(`${tag} は tags で絞る`, () => {
      const hits = selectWorks(popular, query(`c=${tag}`));
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((w) => w.tags.includes(tag))).toBe(true);
    });
  }

  test('motion は tags で絞る', () => {
    const moving = { ...popular[0], tags: ['motion'] };
    expect(query('c=motion').category).toBe('motion');
    expect(selectWorks([popular[1], moving, popular[2]], query('c=motion'))).toEqual([moving]);
  });

  test('type=component は部品だけ', () => {
    const hits = selectWorks(popular, query('type=component'));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((w) => w.type === 'component')).toBe(true);
    expect(hits).toHaveLength(seed.filter((w) => w.type === 'component').length);
  });

  test('知らない c と sort は、指定なしとして扱う', () => {
    expect(ids(selectWorks(popular, query('c=nope&sort=nope')))).toEqual(ids(popular));
  });

  test('検索は 題名／カテゴリ／サブ種類／作者名 に当たる。大文字小文字は問わない', () => {
    expect(titles('q=trail')).toEqual(['Trail Guide App']);
    expect(selectWorks(popular, query('q=COMPONENTS')).every((w) => w.category === 'Components')).toBe(true);
    expect(titles('q=wellness')).toEqual(['Sleep Tracker App']);
    expect(selectWorks(popular, query('q=seed_d')).every((w) => w.creator.handle === 'seed_d')).toBe(true);
  });

  test('カテゴリは、画面の日本語でも当たる', () => {
    const components = seed.filter((w) => w.category === 'Components');
    expect(ids(selectWorks(popular, query('q=部品'))).toSorted()).toEqual(ids(components).toSorted());
  });

  test('語を並べると、すべてに当たるものだけ', () => {
    expect(titles('q=generative+landing+seed_b')).toEqual(['Generative Studio Hero']);
    expect(titles('q=trail+dashboard')).toEqual([]);
  });

  test('Newest は公開日の新しい順', () => {
    const newest = selectWorks(popular, query('sort=new'));
    const dates = newest.map((w) => w.published_at);
    expect(dates).toEqual(dates.toSorted((a, b) => b - a));
    expect(newest[0].title).toBe('Weather Glance');
  });

  test('絞り込みは Popular の順を保つ', () => {
    const hits = selectWorks(popular, query('c=mobile'));
    expect(ids(hits)).toEqual(ids(hits.toSorted(comparePopular)));
  });
});

test.describe('チップと並びのリンクの行き先（SPEC 3）', () => {
  const params = (search: string) => new URLSearchParams(search);

  test('チップ：c だけを変え、ほかは保つ', () => {
    expect(categoryHref(params(''), 'web')).toBe('/?c=web');
    expect(categoryHref(params('c=web'), 'mobile')).toBe('/?c=mobile');
    expect(categoryHref(params('q=a&sort=new'), 'web')).toBe('/?q=a&sort=new&c=web');
    expect(categoryHref(params('type=component'), 'web')).toBe('/?type=component&c=web');
  });

  test('All：c を消す。何も残らなければ /', () => {
    expect(categoryHref(params('c=web'), null)).toBe('/');
    expect(categoryHref(params('q=a&c=web'), null)).toBe('/?q=a');
  });

  test('並び：Newest は sort=new、Popular は sort を消す', () => {
    expect(sortHref(params(''), 'new')).toBe('/?sort=new');
    expect(sortHref(params('sort=new'), 'popular')).toBe('/');
    expect(sortHref(params('c=web'), 'new')).toBe('/?c=web&sort=new');
    expect(sortHref(params('c=web&sort=new'), 'popular')).toBe('/?c=web');
  });

  test('検索語の記号も壊れない', () => {
    expect(parseHomeQuery(params(categoryHref(params('q=a%26b+c'), 'web').slice(2))).q).toBe('a&b c');
  });
});

test.describe('列の数と間隔（SPEC 3、5）', () => {
  test('スマホは2列、間隔8。入れ物の幅は 画面の幅−16', () => {
    expect(gridShape(374, false)).toEqual({ columns: 2, gap: 8, columnWidth: 183 });
    expect(gridShape(304, false)).toEqual({ columns: 2, gap: 8, columnWidth: 148 });
  });

  test('広い画面は間隔16で、列の幅が 240px にいちばん近くなる列の数', () => {
    for (const [width, columns] of [[720, 3], [908, 4], [1164, 5], [1324, 5], [1804, 7], [2444, 10]] as const) {
      const shape = gridShape(width, true);
      expect(shape.columns, `幅${width}`).toBe(columns);
      expect(shape.gap).toBe(16);
      expect(shape.columnWidth * shape.columns + 16 * (shape.columns - 1)).toBeCloseTo(width, 5);
      expect(shape.columnWidth).toBeGreaterThan(200);
      expect(shape.columnWidth).toBeLessThan(280);
    }
  });

  test('広い画面でも、2列より少なくしない', () => {
    expect(gridShape(300, true).columns).toBe(2);
  });
});

test.describe('石組みの計算（SPEC 6）', () => {
  const options = { columns: 4, columnWidth: 316, gap: 20 };

  test('いちばん低い列へ置く。同じ高さなら左から', () => {
    const square = { thumb_w: 800, thumb_h: 800 };
    const short = { thumb_w: 800, thumb_h: 480 };
    const { positions } = layoutMasonry([square, square, short, square, square, square], options);
    expect(positions.map((p) => p.column)).toEqual([0, 1, 2, 3, 2, 0]);
  });

  test('高さ÷幅を 0.6〜1.25 に収める', () => {
    expect(thumbRatio({ thumb_w: 800, thumb_h: 100 })).toBe(0.6);
    expect(thumbRatio({ thumb_w: 800, thumb_h: 4000 })).toBe(1.25);
    expect(thumbRatio({ thumb_w: 800, thumb_h: 720 })).toBe(0.9);
  });

  test('カードの高さは、サムネイルの高さだけ', () => {
    const { positions } = layoutMasonry([{ thumb_w: 800, thumb_h: 600 }], options);
    expect(positions[0].height).toBe(316 * 0.75);
  });

  test('全体の高さは、いちばん低いカードの下端まで（最後の間隔を含まない）', () => {
    const { positions, height } = layoutMasonry([{ thumb_w: 800, thumb_h: 800 }], options);
    expect(height).toBe(positions[0].height);
    expect(layoutMasonry([], options).height).toBe(0);
  });
});

test.describe('中身の地図（WS002）：初めて要るときに作って置く', () => {
  const work = { html: '<div data-ld-part="x"><button>押す</button></div>', css: '[data-ld-part="x"] { color: red; }', js: "export function mount(root) { root.addEventListener('click', () => {}); return () => {}; }" };
  const fakeBucket = (initial: Record<string, string> = {}) => {
    const store = new Map(Object.entries(initial));
    const puts: string[] = [];
    const bucket: OutlineBucket = {
      get: async (key) => (store.has(key) ? { text: async () => store.get(key)! } : null),
      put: async (key, value) => {
        puts.push(key);
        store.set(key, value);
      },
    };
    return { bucket, store, puts };
  };

  test('置き場になければ版のファイルから作って置き、2回目は置いた物を読む', async () => {
    const { bucket, store, puts } = fakeBucket();
    let reads = 0;
    const readFiles = async () => {
      reads++;
      return work;
    };
    const first = await loadOutline(bucket, 'revisions/a/b', readFiles);
    expect(first).toEqual(buildOutline(work));
    expect(puts).toEqual(['revisions/a/b/outline.json']);
    expect(JSON.parse(store.get('revisions/a/b/outline.json')!)).toEqual(first);
    const second = await loadOutline(bucket, 'revisions/a/b', readFiles);
    expect(second).toEqual(first);
    expect([reads, puts.length]).toEqual([1, 1]);
  });

  test('形の版が古い、または壊れた地図は作り直す。版のファイルがなければ null で、何も置かない', async () => {
    for (const old of [JSON.stringify({ version: OUTLINE_VERSION - 1, files: [] }), '{"version":']) {
      const { bucket, puts } = fakeBucket({ 'works/x/1/outline.json': old });
      expect((await loadOutline(bucket, 'works/x/1', async () => work))?.version).toBe(OUTLINE_VERSION);
      expect(puts).toEqual(['works/x/1/outline.json']);
    }
    const { bucket, puts } = fakeBucket();
    expect(await loadOutline(bucket, 'works/none/1', async () => null)).toBeNull();
    expect(puts).toEqual([]);
  });

  test('置けなくても地図は返す。バイト列からも同じ地図（文書の作品も）', async () => {
    const failing: OutlineBucket = { get: async () => null, put: async () => Promise.reject(new Error('down')) };
    expect(await loadOutline(failing, 'revisions/a/b', async () => work)).toEqual(buildOutline(work));
    const bytes = (text: string) => new TextEncoder().encode(text);
    expect(JSON.parse(outlineFromBytes({ html: bytes(work.html), css: bytes(work.css), js: bytes(work.js), document: null })!)).toEqual(buildOutline(work));
    const doc = '<!doctype html><title>t</title><canvas></canvas><script>requestAnimationFrame(() => {})</script>';
    expect(JSON.parse(outlineFromBytes({ html: null, css: null, js: null, document: bytes(doc) })!)).toEqual(buildOutline({ html: '', css: '', js: null, document: doc }));
  });
});

test.describe('版の違い（WS004）', () => {
  /** 塊の並びから、後の版を作り直す（前の版の同じ行と、増えた行で） */
  const rebuild = (a: string[], b: string[], runs: DiffRun[]) => runs.flatMap((run) => (run.op === 0 ? a.slice(run.a, run.a + run.n) : run.op === 2 ? b.slice(run.b, run.b + run.n) : []));
  /** 最長の共通の部分列の長さ（確かめ用の、素直な表の計算） */
  const lcs = (a: string[], b: string[]) => {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      let diagonal = 0;
      for (let j = 1; j <= b.length; j++) {
        const above = row[j];
        row[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : Math.max(row[j], row[j - 1]);
        diagonal = above;
      }
    }
    return row[b.length];
  };

  test('いちばん少ない手数の違い：後の版を作り直せて、増えた行と減った行の数は最長の共通の部分列から決まる数と同じ', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let round = 0; round < 400; round++) {
      const pick = () => Array.from({ length: Math.floor(random() * 30) }, () => 'abcde'[Math.floor(random() * 5)]);
      const a = pick();
      const b = pick();
      const diff = diffLines(a, b);
      expect(diff.replaced).toBe(false);
      expect(rebuild(a, b, diff.runs)).toEqual(b);
      expect(diff.runs.filter((run) => run.op !== 2).flatMap((run) => (run.op === 0 ? a.slice(run.a, run.a + run.n) : a.slice(run.a, run.a + run.n)))).toEqual(a);
      const common = lcs(a, b);
      expect(diff.removed).toBe(a.length - common);
      expect(diff.added).toBe(b.length - common);
    }
  });

  test('行に分ける：最後の改行の後は数えない。空は 0 行', () => {
    expect(splitLines('')).toEqual([]);
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
    expect(splitLines('\n')).toEqual(['']);
  });

  test('手間の上限を超えたら、頭と尻の同じ行を残して、間を全部入れ替えたと見なす', () => {
    const a = ['head', ...Array.from({ length: 300 }, (_, i) => `a${i}`), 'tail'];
    const b = ['head', ...Array.from({ length: 200 }, (_, i) => `b${i}`), 'tail'];
    const diff = diffLines(a, b, 1000);
    expect(diff.replaced).toBe(true);
    expect([diff.removed, diff.added]).toEqual([300, 200]);
    expect(rebuild(a, b, diff.runs)).toEqual(b);
    expect(diffLines(a, b).replaced).toBe(false);
  });

  test('全く違う 5,000 行どうしでも、上限の中で終わる', () => {
    const a = Array.from({ length: 5000 }, (_, i) => `const a${i} = ${i};`);
    const b = Array.from({ length: 5000 }, (_, i) => `let b${i} = ${i * 2};`);
    const started = performance.now();
    const diff = diffLines(a, b);
    const took = performance.now() - started;
    expect([diff.removed, diff.added]).toEqual([5000, 5000]);
    expect(rebuild(a, b, diff.runs)).toEqual(b);
    console.log(`全く違う 5,000 行どうし：${took.toFixed(0)} ms（replaced: ${diff.replaced}）`);
  });

  test('画面の行：変わった所の前後3行だけを出し、ほかの同じ行は1行にたたむ。開いたたたみは出す', () => {
    const a = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const b = a.map((line, i) => (i === 10 ? 'changed' : line));
    const { runs } = diffLines(a, b);
    const rows = diffRows(runs);
    expect(rows.map((row) => row.kind)).toEqual(['fold', 'same', 'same', 'same', 'del', 'add', 'same', 'same', 'same', 'fold']);
    expect(rows[0]).toEqual({ kind: 'fold', a: 0, b: 0, count: 7 });
    expect(rows[9]).toEqual({ kind: 'fold', a: 14, b: 14, count: 6 });
    expect(diffRows(runs, 3, new Set([0])).filter((row) => row.kind === 'fold')).toHaveLength(1);
  });

  test('2つの版：ファイルごとの数と、変わったまとまり（中身で比べる。上に行が足されてずれただけのものは出さない。入れ子はいちばん内側）', () => {
    const before = { html: '<div data-ld-part="x"></div>\n', css: '[data-ld-part="x"] { color: red; }\n', js: 'export function mount(root) {\n  const a = 1;\n  return () => {};\n}\nfunction other() {\n  return 2;\n}\n', document: null };
    const after = { ...before, js: '// head\nexport function mount(root) {\n  const a = 2;\n  return () => {};\n}\nfunction other() {\n  return 2;\n}\nfunction added() {}\n' };
    const diff = diffVersions(before, after);
    expect(diff.files.map(({ name, status, added, removed }) => ({ name, status, added, removed }))).toEqual([
      { name: 'part.html', status: 'same', added: 0, removed: 0 },
      { name: 'part.css', status: 'same', added: 0, removed: 0 },
      { name: 'part.js', status: 'changed', added: 3, removed: 1 },
    ]);
    const names = diff.sections.map((section) => `${section.kind}:${section.name}:${section.change}`);
    expect(names).toContain('function:mount:changed');
    expect(names).toContain('function:added:added');
    expect(names).not.toContain('function:other:changed');
    // 文書の作品と、ファイルが増えた版
    const doc = diffVersions({ html: null, css: null, js: null, document: '<!doctype html>\n<p>a</p>\n' }, { html: null, css: null, js: null, document: '<!doctype html>\n<p>b</p>\n' });
    expect(doc.files.map(({ name, added, removed }) => ({ name, added, removed }))).toEqual([{ name: 'index.html', added: 1, removed: 1 }]);
    const grown = diffVersions({ ...before, js: null }, before);
    expect(grown.files.find((file) => file.name === 'part.js')).toMatchObject({ status: 'added', added: 7, removed: 0 });
  });
});
