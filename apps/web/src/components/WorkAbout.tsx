import { Check, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { Copy } from '../copy';
import type { AboutSpot, AboutTech, WorkAbout as About } from '../data/pages';
import { useCopy } from '../hooks/useCopy';
import { formatBytes } from '../lib/format';

/** 言語の名前（固有の名前なので、どの言語のページでも同じ） */
const LANGUAGE_NAMES = { js: 'JavaScript', glsl: 'GLSL', css: 'CSS', html: 'HTML' } as const;
/** 言語の帯の色（SPEC.md 2 の site-lang-*） */
const LANGUAGE_COLORS = { js: 'bg-site-lang-js', glsl: 'bg-site-lang-glsl', css: 'bg-site-lang-css', html: 'bg-site-lang-html' } as const;

/** 印の1つ。spot があれば押せて、その行を下に出す。code は等幅で出す（属性やキーの名前） */
type Item = { key: string; text: string; spot: AboutSpot | null; count: number; code?: boolean; done?: boolean };
type Row = { key: string; label: string; items: Item[] };

/** #version の値（"300 es"、"330"）を、見せる名前にする：GLSL ES 3.00、GLSL 3.30 */
function glslName(version: string): string {
  const m = /^(\d)(\d\d)( es)?$/.exec(version);
  if (!m) return `GLSL ${version}`;
  return `GLSL${m[3] || m[1] === '1' ? ' ES' : ''} ${m[1]}.${m[2]}`;
}

const techItem = (copy: Copy, tech: AboutTech, extra: Partial<Item> = {}): Item => ({
  key: tech.id,
  text: copy.work.about.tech[tech.id] ?? tech.label,
  spot: tech.spot,
  count: tech.count,
  ...extra,
});

/** 「この作品について」の行（描き方、シェーダー、動き、音、操作、気づかい、保存、外から読む物、大きさ）。見つからない行は出さない */
function aboutRows(copy: Copy, about: About): Row[] {
  const text = copy.work.about;
  const group = (name: string) => about.tech.filter((tech) => tech.group === name);
  const has = (id: string) => about.tech.some((tech) => tech.id === id);
  const rows: Row[] = [];
  const add = (key: string, label: string, items: Item[]) => {
    if (items.length > 0) rows.push({ key, label, items });
  };

  add('draw', text.draw, group('draw').map((tech) => techItem(copy, tech)));
  if (about.shaders) {
    const { shaders } = about;
    add('shader', text.shader, [
      { key: 'shaders', text: text.shaders(String(shaders.count)), spot: shaders.spot, count: shaders.count },
      ...shaders.glsl.map((version) => ({ key: `glsl-${version}`, text: glslName(version), spot: null, count: 0 })),
    ]);
  }
  add('motion', text.motion, group('motion').map((tech) => techItem(copy, tech)));
  // 音：合成だけ（録音を読まず、音のファイルも持たない）なら、そう書く
  const synthOnly = has('webaudio-synth') && !has('webaudio-decode') && !has('audio-element');
  add(
    'sound',
    text.sound,
    group('sound').flatMap((tech) => {
      if (tech.id === 'webaudio-synth') return synthOnly ? [techItem(copy, tech, { text: text.synth })] : [];
      return [techItem(copy, tech)];
    }),
  );
  add('input', text.input, group('input').map((tech) => techItem(copy, tech)));
  add('care', text.care, group('care').map((tech) => techItem(copy, tech, { done: true })));
  // 保存：枠の中の localStorage と sessionStorage はメモリだけ（CLAUDE.md「JS」、FRAME001）なので、そう添える
  const storage = group('storage');
  add('storage', text.storage, [
    ...storage.map((tech) => techItem(copy, tech)),
    ...(storage.some((tech) => tech.id === 'localstorage' || tech.id === 'sessionstorage') ? [{ key: 'storage-note', text: text.storageNote, spot: null, count: 0 }] : []),
  ]);
  const external = group('external');
  rows.push({
    key: 'external',
    label: text.external,
    items:
      external.length > 0
        ? external.map((tech) => techItem(copy, tech, tech.hosts?.length ? { text: `${copy.work.about.tech[tech.id] ?? tech.label}（${tech.hosts.join('、')}）` } : {}))
        : [{ key: 'none', text: text.none, spot: null, count: 0 }],
  });
  const js = about.files.find((file) => file.name === 'part.js' || file.name === 'index.html');
  rows.push({
    key: 'size',
    label: text.size,
    items: [
      { key: 'bytes', text: formatBytes(about.bytes), spot: null, count: 0 },
      { key: 'files', text: text.files(String(about.files.length)), spot: null, count: 0 },
      ...(js ? [{ key: 'lines', text: text.lines(js.lines.toLocaleString('en-US')), spot: null, count: 0 }] : []),
    ],
  });
  return rows;
}

/** 「キー操作と読み上げ」の行（役目、状態、名前、キー、フォーカスの枠、知らせ）。コードに書いてある値を、そのまま出す */
function a11yRows(copy: Copy, about: About): Row[] {
  const text = copy.work.about.a11y;
  const labels: Record<string, string> = {
    'aria-role': text.role,
    'aria-state': text.state,
    'aria-name': text.name,
    keys: text.keys,
    'focus-visible': text.focus,
    'aria-live': text.live,
  };
  return about.tech
    .filter((tech) => tech.group === 'a11y' && labels[tech.id])
    .map((tech) => ({
      key: tech.id,
      label: labels[tech.id],
      items: (tech.values?.length ? tech.values : [tech.label]).map((value) => ({ key: `${tech.id}:${value}`, text: value, spot: tech.spot, count: tech.count, code: true })),
    }));
}

const ITEM_CLASS = 'inline-flex min-h-8 shrink-0 items-center gap-1 rounded-chip px-2.5 text-small md:min-h-7 md:shrink md:text-left';

/**
 * 「この作品について」（WS003）。版を置いたときに機械がコードを読んで作った地図から出す。
 * 印を押すと、その行（本当のファイルの行の番号）を下に出す。幅767px以下では、印を横に流す。
 */
export function WorkAbout({ about }: { about: About }) {
  const copy = useCopy();
  const text = copy.work.about;
  const headingId = useId();
  const a11yId = useId();
  const peekId = useId();
  const [open, setOpen] = useState<{ row: string; item: Item } | null>(null);
  const peekRef = useRef<HTMLDivElement>(null);

  // 押した印の行が、画面の外にあれば見える所まで送る
  useEffect(() => {
    if (open) peekRef.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  const rows = aboutRows(copy, about);
  const a11y = a11yRows(copy, about);
  const languages = about.languages.map(({ language, percent }) => ({ language, percent, name: LANGUAGE_NAMES[language] }));

  const list = (items: Row[], labelledBy: string) => (
    <dl aria-labelledby={labelledBy} className="mt-3 flex gap-1.5 overflow-x-auto md:grid md:grid-cols-[92px_minmax(0,1fr)] md:gap-x-3 md:gap-y-2 md:overflow-visible">
      {items.map((row) => (
        <div key={row.key} className="contents">
          <dt className="sr-only md:not-sr-only md:pt-1.5 md:text-small md:text-site-fg-2">{row.label}</dt>
          <dd className="contents md:flex md:min-w-0 md:flex-wrap md:gap-1.5">
            {row.items.map((item) => {
              const body = (
                <>
                  {item.done && <Check size={14} strokeWidth={2.25} aria-hidden="true" className="shrink-0 text-site-fg-3" />}
                  <span className={item.code ? 'font-mono wrap-anywhere' : undefined}>{item.text}</span>
                </>
              );
              if (!item.spot) {
                return (
                  <span key={item.key} className={`${ITEM_CLASS} text-site-fg-2 max-md:border max-md:border-site-line md:px-0`}>
                    {body}
                  </span>
                );
              }
              const pressed = open?.row === row.key && open.item.key === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  data-about-item={item.key}
                  aria-expanded={pressed}
                  aria-controls={peekId}
                  onClick={() => setOpen(pressed ? null : { row: row.key, item })}
                  className={`${ITEM_CLASS} font-semibold ${pressed ? 'bg-site-primary text-site-bg' : 'bg-site-key text-site-fg hover:bg-site-hover'}`}
                >
                  {body}
                </button>
              );
            })}
          </dd>
        </div>
      ))}
    </dl>
  );

  return (
    <section data-work-about="" aria-labelledby={headingId} className="rounded-card border border-site-line p-4 md:p-5">
      <h2 id={headingId} className="text-body font-semibold text-site-fg">
        {text.heading}
      </h2>
      <p className="mt-1 text-small text-site-fg-2 max-md:hidden">{text.note}</p>
      {list(rows, headingId)}

      <h3 id={a11yId} className="mt-4 text-small font-semibold text-site-fg">
        {text.a11y.heading}
        <span className="ml-2 font-normal text-site-fg-2 max-md:hidden">{text.a11y.note}</span>
      </h3>
      {a11y.length > 0 ? list(a11y, a11yId) : <p className="mt-2 text-small text-site-fg-2">{text.a11y.none}</p>}

      {/* 印の行。本当のファイルの行の番号で出す（コピーされるコードの行ではない） */}
      <div id={peekId} ref={peekRef} role="region" aria-label={text.peek.region} aria-live="polite" data-about-peek="" hidden={!open?.item.spot} className="mt-3 overflow-hidden rounded-control border border-site-line bg-site-field">
        {open?.item.spot && (
          <>
            <div className="flex items-center justify-between gap-2 py-1 pr-1 pl-3">
              <p className="min-w-0 text-small text-site-fg-3 wrap-anywhere">
                {text.peek.at(open.item.spot.file, String(open.item.spot.line))}
                {open.item.count > 1 && <span className="text-site-fg-2"> · {text.peek.total(String(open.item.count))}</span>}
              </p>
              <button
                type="button"
                aria-label={text.peek.close}
                onClick={() => setOpen(null)}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-control text-site-fg-3 hover:bg-site-hover"
              >
                <X size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            <pre tabIndex={0} aria-label={text.peek.at(open.item.spot.file, String(open.item.spot.line))} className="overflow-x-auto pb-2 font-mono text-small text-site-fg">
              <code>
                {open.item.spot.lines.map((line, index) => {
                  const number = open.item.spot!.first + index;
                  const current = number === open.item.spot!.line;
                  return (
                    <span key={number} data-line={number} aria-current={current ? 'true' : undefined} className={`block w-max min-w-full pr-3 ${current ? 'bg-site-key' : ''}`}>
                      <span className="mr-3 inline-block w-12 text-right text-site-fg-2 select-none">{number}</span>
                      {line}
                      {'\n'}
                    </span>
                  );
                })}
              </code>
            </pre>
          </>
        )}
      </div>

      {languages.length > 0 && (
        <div data-about-languages="" className="mt-4">
          <h3 className="sr-only">{text.languages}</h3>
          <div aria-hidden="true" className="flex h-2 gap-0.5 overflow-hidden rounded-chip">
            {languages.map(({ language, percent }) => (
              <span key={language} className={`min-w-0.5 ${LANGUAGE_COLORS[language]}`} style={{ flex: `${percent} 1 0` }} />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-small text-site-fg-3">
            {languages.map(({ language, percent, name }) => (
              <li key={language} className="flex items-center gap-1.5">
                <span aria-hidden="true" className={`size-2 rounded-chip ${LANGUAGE_COLORS[language]}`} />
                {name} {percent.toFixed(1)}%
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
