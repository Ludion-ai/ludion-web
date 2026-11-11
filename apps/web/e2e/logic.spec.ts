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
