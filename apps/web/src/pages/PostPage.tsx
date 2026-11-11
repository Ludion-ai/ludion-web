import type { Category, FixNote, Parts, ProblemText, SplitError, SplitNote } from '@ludion/rules';
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type DragEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { RevisionFrame } from '../components/RevisionFrame';
import { useCopy, useLocale } from '../hooks/useCopy';
import { useResetTitle } from '../hooks/useResetTitle';
import { localizedPath } from '../i18n';
import { goToLogin } from '../lib/account';
import {
  discardWork,
  fetchEditableWork,
  fetchIdStatus,
  fetchRemixSource,
  normalizeThumb,
  pickWorkId,
  problemText,
  saveDraft,
  submitRevision,
  type EditableWork,
  type IdStatus,
  type MadeWith,
  type RemixSource,
  type SavedRevision,
} from '../lib/post';

type Rules = typeof import('@ludion/rules');

const FIELD = 'mt-1 h-11 w-full rounded-control border border-site-line-2 bg-site-bg px-3 text-body text-site-fg focus-visible:border-site-primary disabled:bg-site-field';
const CODE_FIELD = 'mt-1 block h-48 w-full resize-y rounded-control border border-site-line-2 bg-site-bg p-3 font-mono text-small text-site-fg focus-visible:border-site-primary disabled:bg-site-field';
const PRIMARY_BUTTON = 'inline-flex h-11 items-center justify-center rounded-control bg-site-primary px-4 text-body font-semibold text-site-bg disabled:opacity-60';
const WHITE_BUTTON = 'inline-flex h-11 items-center justify-center rounded-control border border-site-line-2 bg-site-bg px-4 text-body font-semibold text-site-fg hover:bg-site-hover disabled:opacity-60';
const FILE_BUTTON = `${WHITE_BUTTON} cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-site-primary`;
/** 貼ってから分けるまで待つ時間（打っている間は分けない）。 */
const SPLIT_DELAY_MS = 300;
/** 分けて通ってから保存するまで待つ時間。続けて貼り直したときに、1回だけ保存する。 */
const AUTO_SAVE_DELAY_MS = 500;
const ID_CHECK_DELAY_MS = 300;
const COPIED_MS = 1500;
const CATEGORY_ORDER: Category[] = ['Components', 'Web', 'Mobile', 'Dashboard', 'Ecommerce'];
/** 落とせるファイル。HTML 1つ、または HTML、CSS、JS をそれぞれ1つまで。 */
const FILE_KINDS = [
  { kind: 'html', pattern: /\.html?$/i },
  { kind: 'css', pattern: /\.css$/i },
  { kind: 'js', pattern: /\.m?js$/i },
] as const;

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'not_found' } | { status: 'ready'; work: EditableWork | null };
type IdCheck = IdStatus | 'checking' | 'error';
type BoxError = SplitError | 'files' | 'no_html' | 'id';
type Pipe = { status: 'idle' } | { status: 'working' } | { status: 'error'; error: BoxError } | { status: 'done'; notes: (SplitNote | FixNote)[] };

/** 保存した中身の印。同じ中身は保存し直さない（回数の上限をすぐ使い切らないように。docs/tasks/T033.md A3）。 */
const codeKey = (id: string, parts: Parts) => JSON.stringify([id, parts.html, parts.css, parts.js ?? '']);

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="mt-8 border-t border-site-line pt-6">
      <h2 className="text-subhead font-semibold">{heading}</h2>
      {children}
    </section>
  );
}

function ProblemList({ problems }: { problems: ProblemText[] }) {
  const locale = useLocale();
  const copy = useCopy();
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {problems.map((problem, index) => {
        const { message, fix } = problemText(problem, locale);
        return (
          <li key={`${index}-${message}`} className="rounded-control bg-site-field px-3 py-2.5">
            <p className="font-semibold wrap-anywhere">{message}</p>
            <p className="mt-0.5 text-small text-site-fg-2 wrap-anywhere">
              {copy.post.check.fix}
              {fix}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/** 「AI で Ludion の形に直す」。Ludion は AI を動かさない。指示文を渡すだけ（docs/tasks/T021.md 段階 B、T033.md A2）。 */
function AiPrompt({ id }: { id: string }) {
  const text = useCopy().post.ai;
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const prompt = text.prompt(id || 'my-ui');

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), COPIED_MS);
  };

  return (
    <div className="mt-3">
      <p className="text-site-fg-2">{text.intro}</p>
      <button type="button" onClick={onCopy} className={`${WHITE_BUTTON} mt-3`}>
        {state === 'copied' ? text.copied : state === 'failed' ? text.failed : text.copy}
      </button>
      <details className="mt-3">
        <summary className="cursor-pointer text-small text-site-fg-2">{text.show}</summary>
        <pre tabIndex={0} className="mt-2 max-h-80 overflow-auto rounded-control border border-site-line bg-site-field p-3 font-mono text-small whitespace-pre-wrap wrap-anywhere">
          {prompt}
        </pre>
      </details>
    </div>
  );
}

function CodeField({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: string; onChange: (value: string) => void; disabled: boolean }) {
  const id = useId();
  return (
    <div className="mt-4">
      <label htmlFor={id} className="block font-semibold">
        {label}
      </label>
      {hint && <p className="mt-0.5 text-small text-site-fg-2">{hint}</p>}
      <textarea id={id} value={value} disabled={disabled} spellCheck={false} autoCapitalize="none" autoCorrect="off" onChange={(event) => onChange(event.target.value)} className={CODE_FIELD} />
    </div>
  );
}

/** 落としたファイルを1つの箱の中身にする。HTML の後ろに <style> と <script> を足すと、分けるときに同じ形で拾える。 */
async function readDropped(files: File[]): Promise<{ text: string } | { error: BoxError }> {
  const found: Partial<Record<'html' | 'css' | 'js', File>> = {};
  if (files.length === 0 || files.length > 3) return { error: 'files' };
  for (const file of files) {
    const kind = FILE_KINDS.find(({ pattern }) => pattern.test(file.name))?.kind;
    if (!kind || found[kind]) return { error: 'files' };
    found[kind] = file;
  }
  if (!found.html) return { error: 'no_html' };
  const [html, css, js] = await Promise.all([found.html.text(), found.css?.text(), found.js?.text()]);
  return { text: [html, ...(css ? [`<style>\n${css}\n</style>`] : []), ...(js ? [`<script type="module">\n${js}\n</script>`] : [])].join('\n') };
}

/** 作品を置く画面（docs/tasks/T021.md 段階 B、T033.md 段階 A と B2）。/new は新しい作品、/new?work=<id> は直す、/new?from=<id> はリミックスを載せる。 */
export function PostPage() {
  const copy = useCopy();
  const locale = useLocale();
  const text = copy.post;
  const [params] = useSearchParams();
  const workParam = params.get('work');
  const fromParam = workParam ? null : params.get('from');
  const baseId = useId();
  useResetTitle();

  const [load, setLoad] = useState<LoadState>(workParam ? { status: 'loading' } : { status: 'ready', work: null });
  const [rules, setRules] = useState<Rules | null>(null);
  const [remix, setRemix] = useState<RemixSource | null>(null);

  // 1つの箱と、分けた結果
  const [box, setBox] = useState('');
  const [parts, setParts] = useState<Parts | null>(null);
  const [pipe, setPipe] = useState<Pipe>({ status: 'idle' });
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const [dragging, setDragging] = useState(false);

  // 作品の ID。作り手が打たなくてよい（貼ったときに決める）。idRef は分ける処理が読む
  const [id, setId] = useState('');
  const idRef = useRef('');
  const [idDraft, setIdDraft] = useState('');
  const [idCheck, setIdCheck] = useState<IdCheck | null>(null);
  const [idChange, setIdChange] = useState<'idle' | 'changing' | 'done' | 'failed'>('idle');

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<Category>('Components');
  const [subtype, setSubtype] = useState('');
  const [tags, setTags] = useState<ReadonlySet<string>>(new Set());
  const [motion, setMotion] = useState(false);
  // 作り方は選んだ状態から始める（変えられる。docs/tasks/T033.md A3。報告の「決めてほしいこと」）
  const [madeWith, setMadeWith] = useState<MadeWith>('ai-assisted');
  const [thumb, setThumb] = useState<Blob | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [thumbError, setThumbError] = useState(false);
  /** 画像を続けて選んだとき、古い読み込みが新しい結果を消さないように数える。 */
  const thumbRequest = useRef(0);
  const appliedThumb = useRef(0);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [serverProblems, setServerProblems] = useState<ProblemText[]>([]);
  const [saved, setSaved] = useState<SavedRevision | null>(null);
  /** この画面で作った作品の ID（一度保存した後は、その作品に保存する） */
  const [createdId, setCreatedId] = useState<string | null>(null);
  /** 最後に保存したコードの印 */
  const lastSavedKey = useRef<string | null>(null);
  /** 直す作品を読んだ直後は、分けた結果を「保存した中身」として覚える（開いただけで新しい版を作らない） */
  const baselinePending = useRef(false);
  /** 題、種類、タグ、画像を変えた回数。保存した後に変わっていれば、審査に出す前に保存し直す */
  const metaVersion = useRef(0);
  const savedMetaVersion = useRef(0);
  const [metaDirty, setMetaDirty] = useState(false);
  const [confirm, setConfirm] = useState({ own: false, mit: false, terms: false });
  const [submitState, setSubmitState] = useState<'idle' | 'sending' | 'done' | 'failed' | 'title_required' | 'thumb_required'>('idle');

  // フォームは React が載ってから出す。Worker の HTML の入力欄に先に打つと、載ったときに打った文字が消えるため
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);

  const editing = load.status === 'ready' ? load.work : null;
  const workId = editing ? editing.id : createdId;
  const inReview = editing?.revision.status === 'submitted';
  const locked = inReview || submitState === 'done';

  useEffect(() => {
    document.title = text.pageTitle;
  }, [text.pageTitle]);

  // 検査と分ける道具はここで読む（ホームの JS を増やさない）
  useEffect(() => {
    let current = true;
    void import('@ludion/rules').then((module) => {
      if (current) setRules(module);
    });
    return () => {
      current = false;
    };
  }, []);

  const chooseId = (next: string) => {
    idRef.current = next;
    setId(next);
    setIdDraft(next);
  };

  // 直す作品を読む
  useEffect(() => {
    if (!workParam) return;
    let current = true;
    fetchEditableWork(workParam).then(
      (work) => {
        if (!current) return;
        if (work === 'unauthorized') goToLogin();
        else if (work === 'not_found') setLoad({ status: 'not_found' });
        else {
          setLoad({ status: 'ready', work });
          chooseId(work.id);
          setTitle(work.revision.title);
          setCategory(work.revision.category as Category);
          setSubtype(work.revision.subtype);
          setTags(new Set(work.revision.tags.filter((tag) => tag !== 'motion')));
          setMotion(work.revision.tags.includes('motion'));
          setMadeWith(work.revision.made_with);
          baselinePending.current = true;
          void import('@ludion/rules').then(({ joinParts }) => {
            if (current) setBox(joinParts({ html: work.html, css: work.css, js: work.js }, work.id));
          });
          // 下書きなら、保存しなくても枠で見られる
          if (work.revision.status === 'draft') setSaved({ id: work.revision.id, version: work.revision.version, status: 'draft', content_hash: work.revision.id, frames: work.revision.frames, thumb: work.revision.thumb });
        }
      },
      () => {
        if (current) setLoad({ status: 'error' });
      },
    );
    return () => {
      current = false;
    };
  }, [workParam]);

  // リミックスの元を読む。承認済みの作品でなければ from を捨てて、ふつうの /new と同じにする（docs/tasks/T033.md B2）
  useEffect(() => {
    if (!fromParam) return;
    let current = true;
    fetchRemixSource(fromParam).then(
      (source) => {
        if (!current || !source) return;
        setRemix(source);
        // 元の作品から先に入れておく：種類、タグ、「動きがある」。作り方は ai-assisted（変えられる）
        setCategory(source.category as Category);
        setSubtype(source.subtype);
        setTags(new Set(source.tags.filter((tag) => tag !== 'motion' && tag !== 'dashboard' && tag !== 'ecommerce')));
        setMotion(source.tags.includes('motion'));
        setMadeWith('ai-assisted');
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [fromParam]);

  // 種類の選択肢
  const subtypes = rules?.SUBTYPES[category] ?? [];
  useEffect(() => {
    if (!rules) return;
    const options = rules.SUBTYPES[category];
    setSubtype((value) => (options.includes(value) ? value : options[0]));
  }, [rules, category]);

  // 箱を分ける → ID を決める → 機械で直せるものを直す（docs/tasks/T033.md A2）
  useEffect(() => {
    if (!rules || locked) return;
    if (box.trim() === '') {
      setPipe({ status: 'idle' });
      setParts(null);
      return;
    }
    let current = true;
    setPipe({ status: 'working' });
    const timer = setTimeout(async () => {
      const split = rules.splitSnippet(box);
      if (!split.ok) {
        setPipe({ status: 'error', error: split.error });
        setParts(null);
        return;
      }
      let partId = idRef.current;
      if (!partId) {
        try {
          partId = await pickWorkId(rules.partIdOf(split.parts));
        } catch {
          if (current) setPipe({ status: 'error', error: 'id' });
          return;
        }
        if (!current) return;
        chooseId(partId);
      }
      const fixed = rules.fixParts(split.parts, partId);
      if (baselinePending.current) {
        baselinePending.current = false;
        lastSavedKey.current = codeKey(partId, fixed.parts);
      }
      setParts(fixed.parts);
      setPipe({ status: 'done', notes: [...split.notes, ...fixed.notes] });
    }, SPLIT_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [box, rules, locked]);

  // 必須の検査。種類と「動きがある」でも変わる
  const check = useMemo(
    () => (rules && parts && id ? rules.checkSubmission({ id, type: rules.workShape(category).type, tags: motion ? ['motion'] : [], html: parts.html, css: parts.css, js: parts.js }) : null),
    [rules, parts, id, category, motion],
  );
  const required = check?.required ?? [];
  const codeOk = check !== null && required.length === 0 && pipe.status === 'done';

  const save = async (override?: { id: string; parts: Parts; workId: string | null }): Promise<SavedRevision | null> => {
    const saveId = override?.id ?? id;
    const saveParts = override?.parts ?? parts;
    if (!saveParts || !subtype) return null;
    setSaving(true);
    setSaveError(null);
    setServerProblems([]);
    const sentKey = codeKey(saveId, saveParts);
    const sentMeta = metaVersion.current;
    const sentThumb = thumb;
    try {
      const answer = await saveDraft({
        id: saveId,
        workId: override ? override.workId : workId,
        title: title.trim(),
        category,
        subtype,
        tags: [...tags],
        motion,
        made_with: madeWith,
        remix_of: remix?.id ?? null,
        html: saveParts.html,
        css: saveParts.css,
        js: saveParts.js ?? '',
        thumb: sentThumb,
      });
      if (answer.ok) {
        setSaved(answer.revision);
        if (!editing) setCreatedId(saveId);
        lastSavedKey.current = sentKey;
        savedMetaVersion.current = sentMeta;
        if (metaVersion.current === sentMeta) setMetaDirty(false);
        // 送った画像は保存した。後から別の画像を選んでいれば、そちらを残す
        setThumb((current) => (current === sentThumb ? null : current));
        return answer.revision;
      }
      if (answer.error === 'unauthorized') goToLogin();
      else {
        const errors = text.save.errors as Record<string, string | undefined>;
        setSaveError(errors[answer.limit ? `limit_${answer.limit}` : answer.error] ?? text.save.errors.failed);
        setServerProblems(answer.problems ?? []);
      }
    } catch {
      setSaveError(text.save.errors.failed);
    } finally {
      setSaving(false);
    }
    return null;
  };

  // ログインした人が貼って、必須の検査が0件なら、自動で下書きを保存する（docs/tasks/T033.md A3）。同じ中身は保存しない
  useEffect(() => {
    if (!parts || !id || !codeOk || locked || saving || !subtype || idChange === 'changing') return;
    if (codeKey(id, parts) === lastSavedKey.current) return;
    const timer = setTimeout(() => void save(), AUTO_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // save は毎回作り直すので、deps に入れない（中身が変わったときだけ動かす）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, id, codeOk, locked, saving, subtype, idChange]);

  // ページのどこで貼っても箱に入る。ほかの入力欄にいるときは奪わない（docs/tasks/T033.md A1）
  useEffect(() => {
    if (locked || !interactive) return;
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
      const pasted = event.clipboardData?.getData('text/plain') ?? '';
      if (pasted.trim() === '') return;
      event.preventDefault();
      setBox(pasted);
      boxRef.current?.focus();
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [locked, interactive]);

  // 「細かく直す」の ID が取れるか
  useEffect(() => {
    if (!idDraft || idDraft === id) {
      setIdCheck(null);
      return;
    }
    let current = true;
    setIdCheck('checking');
    const timer = setTimeout(() => {
      fetchIdStatus(idDraft).then(
        (status) => {
          if (current) setIdCheck(status);
        },
        () => {
          if (current) setIdCheck('error');
        },
      );
    }, ID_CHECK_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [idDraft, id]);

  useEffect(
    () => () => {
      if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    },
    [thumbUrl],
  );

  const changeMeta =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      metaVersion.current += 1;
      setMetaDirty(true);
      setSaveError(null);
      setSubmitState((state) => (state === 'title_required' || state === 'thumb_required' || state === 'failed' ? 'idle' : state));
    };

  /** 箱に入れる。前の失敗の知らせは消す。 */
  const putInBox = (value: string) => {
    setBox(value);
    setSaveError(null);
    setServerProblems([]);
  };

  const onBoxPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    // 箱に貼るときは、中身を入れ替える（貼り直しで前の HTML と混ざらないように）
    const pasted = event.clipboardData.getData('text/plain');
    if (pasted.trim() === '') return;
    event.preventDefault();
    putInBox(pasted);
  };

  const onFiles = async (list: FileList | null) => {
    const read = await readDropped([...(list ?? [])]);
    if ('error' in read) setPipe({ status: 'error', error: read.error });
    else putInBox(read.text);
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!locked) void onFiles(event.dataTransfer.files);
  };

  /** 「細かく直す」の3つの欄。直すと箱にも戻る（箱を分け直すと、同じ3つになる）。 */
  const changePart = (name: keyof Parts) => (value: string) => {
    if (!parts || !rules) return;
    const next = { ...parts, [name]: name === 'js' ? (value.trim() ? value : null) : value };
    setParts(next);
    putInBox(rules.joinParts(next, id));
  };

  /** ID を変える。保存する前なら、そのまま。一度保存した作品は、新しい ID で保存し直してから、前の下書きを消す。 */
  const onChangeId = async () => {
    if (!rules || !parts || idCheck !== 'ok') return;
    const next = idDraft;
    const nextParts = rules.fixParts(parts, next).parts;
    if (!createdId) {
      chooseId(next);
      setParts(nextParts);
      putInBox(rules.joinParts(nextParts, next));
      return;
    }
    setIdChange('changing');
    const previous = createdId;
    const revision = await save({ id: next, parts: nextParts, workId: null });
    if (!revision) {
      setIdChange('failed');
      return;
    }
    await discardWork(previous).catch(() => false);
    chooseId(next);
    setCreatedId(next);
    setParts(nextParts);
    putInBox(rules.joinParts(nextParts, next));
    setIdChange('done');
  };

  const onThumb = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const request = ++thumbRequest.current;
    const normalized = await normalizeThumb(file);
    if (!normalized) {
      if (request === thumbRequest.current) setThumbError(true);
      return;
    }
    // より新しい画像が既に読めていれば、古い成功では置き換えない。
    if (request < appliedThumb.current) return;
    appliedThumb.current = request;
    changeMeta(setThumb)(normalized);
    setThumbUrl(URL.createObjectURL(normalized));
    // 後から選んだ画像が読めないあいだは、先の成功でエラーを消さない。
    if (request === thumbRequest.current) setThumbError(false);
  };

  const toggleTag = (tag: string) => {
    const next = new Set(tags);
    if (!next.delete(tag)) next.add(tag);
    changeMeta(setTags)(next);
  };

  const hasThumb = Boolean(thumb || saved?.thumb || (editing && editing.revision.thumb && !saved));
  const confirmed = confirm.own && confirm.mit && confirm.terms;
  const canSubmit = !locked && !saving && codeOk && title.trim() !== '' && hasThumb && confirmed && submitState !== 'sending';

  /** 審査に出す。題や画像を変えていれば、先に保存し直す。 */
  const onSubmit = async () => {
    if (!canSubmit || !parts) return;
    setSubmitState('sending');
    let revision = saved;
    if (!revision || metaDirty || codeKey(id, parts) !== lastSavedKey.current || savedMetaVersion.current !== metaVersion.current) revision = await save();
    if (!revision) {
      setSubmitState('failed');
      return;
    }
    const answer = await submitRevision(revision.id).catch(() => 'failed' as const);
    setSubmitState(answer === 'ok' ? 'done' : answer === 'title_required' || answer === 'thumb_required' ? answer : 'failed');
  };

  const idMessages: Record<IdCheck, string> = {
    checking: text.idStatus.checking,
    ok: text.idStatus.ok,
    format: text.idStatus.format,
    reserved: text.idStatus.reserved,
    taken: text.idStatus.taken,
    error: text.idStatus.failed,
  };

  const noteText = (note: SplitNote | FixNote) => {
    const notes = text.box.notes;
    if (typeof note === 'string') return notes[note];
    return note.kind === 'added_root' ? notes.added_root(note.id) : notes.renamed(note.from, note.id);
  };

  const worksHref = localizedPath(locale, '/account/works');
  const filled = box.trim() !== '';
  const boxError = pipe.status === 'error' ? pipe.error : null;
  const needsAi = boxError !== null || required.length > 0;
  const showDetails = Boolean(saved || editing);
  const boxStatus =
    pipe.status === 'working'
      ? text.box.working
      : boxError
        ? text.box.errors[boxError]
        : required.length > 0
          ? text.box.problems(required.length)
          : saving
            ? text.box.saving
            : saved && codeOk && parts && codeKey(id, parts) === lastSavedKey.current
              ? text.box.saved
              : saveError;

  return (
    <div className="max-w-[760px] pb-8 text-body text-site-fg md:pt-[27px]">
      <h1 className="text-title font-bold wrap-anywhere">{editing ? text.editHeading(editing.revision.title || text.untitled) : text.heading}</h1>
      {load.status === 'error' && <p className="py-20 text-center text-site-fg-2">{text.loadError}</p>}
      {load.status === 'not_found' && <p className="py-20 text-center text-site-fg-2">{text.notFound}</p>}
      {load.status === 'ready' && interactive && (
        <>
          <p className="mt-2 text-site-fg-2">{text.intro}</p>
          {remix && (
            <div data-remix-of={remix.id} className="mt-4 rounded-control bg-site-field px-3 py-2.5">
              <p className="font-semibold wrap-anywhere">{text.remixOf.heading(remix.title, remix.handle)}</p>
              <a href={localizedPath(locale, `/p/${encodeURIComponent(remix.id)}`)} className="mt-0.5 inline-block text-small underline">
                {text.remixOf.link}
              </a>
            </div>
          )}
          {editing?.revision.status === 'rejected' && (
            <div role="status" className="mt-4 rounded-control bg-site-field px-3 py-2.5">
              <p className="font-semibold">{copy.account.works.reasonHeading}</p>
              <p className="mt-0.5">{copy.post.reject[editing.revision.reject_code as keyof typeof copy.post.reject] ?? copy.post.reject.other}</p>
              {editing.revision.reject_note && <p className="mt-0.5 wrap-anywhere">{editing.revision.reject_note}</p>}
            </div>
          )}
          {inReview ? (
            <p role="status" className="mt-4 rounded-control bg-site-field px-3 py-2.5 font-semibold">
              {text.submit.inReview}
            </p>
          ) : (
            editing &&
            editing.revision.status !== 'draft' && (
              <p className="mt-4 rounded-control bg-site-field px-3 py-2.5">{editing.public ? text.submit.newVersionPublic : text.submit.newVersion}</p>
            )
          )}

          {/* 1つの箱（docs/tasks/T033.md A1）。最初に見えるのは箱だけ */}
          <section
            className={`mt-6 rounded-card border-2 border-dashed p-4 ${dragging ? 'border-site-primary bg-site-hover' : 'border-site-line-2'}`}
            onDragOver={(event) => {
              event.preventDefault();
              if (!locked) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <label htmlFor={`${baseId}-box`} className="block text-subhead font-semibold">
              {text.box.label}
            </label>
            <p id={`${baseId}-box-hint`} className="mt-0.5 text-small text-site-fg-2">
              {text.box.hint}
            </p>
            <textarea
              id={`${baseId}-box`}
              ref={boxRef}
              value={box}
              disabled={locked}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              aria-describedby={`${baseId}-box-hint ${baseId}-box-status`}
              onPaste={onBoxPaste}
              onChange={(event) => putInBox(event.target.value)}
              className={`mt-3 block w-full resize-y rounded-control border border-site-line-2 bg-site-bg p-3 font-mono text-small text-site-fg focus-visible:border-site-primary disabled:bg-site-field ${filled ? 'h-40' : 'h-64'}`}
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {!locked && (
                <label className={FILE_BUTTON}>
                  {text.box.choose}
                  <input
                    type="file"
                    multiple
                    accept=".html,.htm,.css,.js,.mjs,text/html,text/css,text/javascript"
                    onChange={(event) => {
                      void onFiles(event.target.files);
                      event.target.value = '';
                    }}
                    className="sr-only"
                  />
                </label>
              )}
              <p id={`${baseId}-box-status`} role="status" data-box-status="" className="min-w-0 flex-1 text-small font-semibold">
                {boxStatus}
              </p>
            </div>
            {pipe.status === 'done' && pipe.notes.length > 0 && (
              <p data-box-fixed="" className="mt-2 text-small text-site-fg-2 wrap-anywhere">
                {text.box.fixedPrefix}
                {pipe.notes.map(noteText).join(text.box.joiner)}
              </p>
            )}
          </section>

          {filled && (
            <div className="mt-4" data-post-check="">
              {required.length > 0 && (
                <>
                  <h2 className="font-semibold">{text.check.required(required.length)}</h2>
                  <ProblemList problems={required} />
                </>
              )}
              {serverProblems.length > 0 && <ProblemList problems={serverProblems} />}
              {needsAi && <p className="mt-3 font-semibold">{text.box.aiHint}</p>}
              {check !== null && required.length === 0 && (
                <p className="text-small text-site-fg-2">
                  {text.check.ok}
                  {check.optional.length === 0 && <span className="ml-2">{text.check.optionalOk}</span>}
                </p>
              )}
              {check !== null && check.optional.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-small text-site-fg-2">{text.check.optional(check.optional.length)}</summary>
                  <ProblemList problems={check.optional} />
                </details>
              )}
            </div>
          )}

          {needsAi && (
            <Section heading={text.ai.heading}>
              <AiPrompt id={id} />
            </Section>
          )}

          {filled && parts && (
            <details className="mt-6 rounded-control border border-site-line px-3 py-2">
              <summary className="flex min-h-11 cursor-pointer items-center font-semibold">{text.fine.summary}</summary>
              <p className="text-small text-site-fg-2">{text.fine.note}</p>
              <div className="mt-4">
                <label htmlFor={`${baseId}-id`} className="block font-semibold">
                  {text.fields.id}
                </label>
                <div className="flex flex-wrap gap-2">
                  <input
                    id={`${baseId}-id`}
                    type="text"
                    value={idDraft}
                    maxLength={60}
                    disabled={locked || Boolean(editing) || idChange === 'changing'}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoComplete="off"
                    aria-describedby={`${baseId}-id-hint ${baseId}-id-status`}
                    onChange={(event) => {
                      setIdDraft(event.target.value.toLowerCase());
                      setIdChange('idle');
                    }}
                    className={`${FIELD} min-w-0 flex-1`}
                  />
                  {!editing && idDraft !== id && (
                    <button type="button" onClick={onChangeId} disabled={idCheck !== 'ok' || idChange === 'changing' || saving} className={`${WHITE_BUTTON} mt-1`}>
                      {idChange === 'changing' ? text.fine.changingId : text.fine.changeId}
                    </button>
                  )}
                </div>
                <p id={`${baseId}-id-hint`} className="mt-1 text-small text-site-fg-2 wrap-anywhere">
                  {text.fields.idHint(id || 'your-work-id')}
                </p>
                <p id={`${baseId}-id-status`} role="status" className="mt-1 min-h-4 text-small font-semibold">
                  {idChange === 'done' ? text.fine.idChanged : idCheck && idMessages[idCheck]}
                </p>
              </div>
              <CodeField label={text.fields.html} value={parts.html} onChange={changePart('html')} disabled={locked} />
              <CodeField label={text.fields.css} value={parts.css} onChange={changePart('css')} disabled={locked} />
              <CodeField label={text.fields.js} hint={text.fields.jsHint} value={parts.js ?? ''} onChange={changePart('js')} disabled={locked} />
            </details>
          )}

          {saved && (
            <Section heading={text.preview.heading}>
              <p className="mt-1 mb-3 text-small text-site-fg-2">{text.preview.note}</p>
              <RevisionFrame frames={saved.frames} title={title || text.untitled} stamp={saved.content_hash} />
            </Section>
          )}

          {showDetails && (
            <Section heading={text.sections.about}>
              <div className="mt-3">
                <label htmlFor={`${baseId}-title`} className="block font-semibold">
                  {text.fields.title}
                </label>
                <input id={`${baseId}-title`} type="text" value={title} maxLength={120} disabled={locked} autoComplete="off" aria-describedby={`${baseId}-title-hint`} onChange={(event) => changeMeta(setTitle)(event.target.value)} className={FIELD} />
                <p id={`${baseId}-title-hint`} className="mt-1 text-small text-site-fg-2">
                  {text.fields.titleHint}
                </p>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor={`${baseId}-category`} className="block font-semibold">
                    {text.fields.category}
                  </label>
                  <select id={`${baseId}-category`} value={category} disabled={locked} onChange={(event) => changeMeta(setCategory)(event.target.value as Category)} className={FIELD}>
                    {CATEGORY_ORDER.map((value) => (
                      <option key={value} value={value}>
                        {copy.categories[value] ?? value}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`${baseId}-subtype`} className="block font-semibold">
                    {text.fields.subtype}
                  </label>
                  <select id={`${baseId}-subtype`} value={subtype} disabled={locked} onChange={(event) => changeMeta(setSubtype)(event.target.value)} className={FIELD}>
                    {subtypes.map((value) => (
                      <option key={value} value={value}>
                        {copy.subtypes[value] ?? value}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-4">
                <p className="font-semibold">{text.fields.thumb}</p>
                <p className="mt-1 text-small text-site-fg-2">{hasThumb && !thumb ? text.fields.thumbKeep : text.fields.thumbHint}</p>
                {(thumbUrl || saved?.thumb || editing?.revision.thumb) && (
                  <img
                    src={thumbUrl ?? saved?.thumb ?? editing?.revision.thumb ?? undefined}
                    alt=""
                    width={editing?.revision.thumb_w || 800}
                    height={editing?.revision.thumb_h || 500}
                    className="mt-3 h-auto max-h-60 w-auto max-w-full rounded-control border border-site-line"
                  />
                )}
                {!locked && (
                  <label className={`${FILE_BUTTON} mt-3`}>
                    {text.fields.thumbChoose}
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onThumb} className="sr-only" />
                  </label>
                )}
                <p role="status" className="mt-1 min-h-4 text-small font-semibold">
                  {thumbError && text.fields.thumbUnreadable}
                </p>
              </div>

              {/* タグと作り方は、選んだ状態から始める（変えられる） */}
              <details className="mt-2">
                <summary className="flex min-h-11 cursor-pointer items-center font-semibold">{text.more}</summary>
                <fieldset className="mt-2">
                  <legend className="font-semibold">{text.fields.tags}</legend>
                  <div className="mt-1 flex flex-wrap gap-x-5">
                    {(['minimal', 'experimental'] as const).map((tag) => (
                      <label key={tag} className="flex h-11 items-center gap-2">
                        <input type="checkbox" checked={tags.has(tag)} disabled={locked} onChange={() => toggleTag(tag)} className="size-[18px]" />
                        {text.fields[tag]}
                      </label>
                    ))}
                    <label className="flex h-11 items-center gap-2">
                      <input type="checkbox" checked={motion} disabled={locked} onChange={(event) => changeMeta(setMotion)(event.target.checked)} className="size-[18px]" />
                      {text.fields.motion}
                    </label>
                  </div>
                </fieldset>
                <fieldset className="mt-4">
                  <legend className="font-semibold">{text.fields.madeWith}</legend>
                  <p className="text-small text-site-fg-2">{text.fields.madeWithNote}</p>
                  <div className="mt-1 flex flex-col">
                    {(['human', 'ai-assisted'] as const).map((value) => (
                      <label key={value} className="flex min-h-11 items-center gap-2">
                        <input type="radio" name={`${baseId}-made-with`} checked={madeWith === value} disabled={locked} onChange={() => changeMeta(setMadeWith)(value)} className="size-[18px]" />
                        {value === 'human' ? text.fields.human : text.fields.aiAssisted}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </details>
            </Section>
          )}

          {showDetails && !locked && (
            <Section heading={text.submit.heading}>
              <p className="mt-1 text-site-fg-2">{text.submit.intro}</p>
              <div className="mt-3 flex flex-col">
                <label className="flex min-h-11 items-center gap-2 py-1">
                  <input type="checkbox" checked={confirm.own} onChange={(event) => setConfirm({ ...confirm, own: event.target.checked })} className="size-[18px] shrink-0" />
                  {text.submit.own}
                </label>
                <label className="flex min-h-11 items-center gap-2 py-1">
                  <input type="checkbox" checked={confirm.mit} onChange={(event) => setConfirm({ ...confirm, mit: event.target.checked })} className="size-[18px] shrink-0" />
                  {text.submit.mit}
                </label>
                <label className="flex min-h-11 items-center gap-2 py-1">
                  <input type="checkbox" checked={confirm.terms} onChange={(event) => setConfirm({ ...confirm, terms: event.target.checked })} className="size-[18px] shrink-0" />
                  <span>
                    {text.submit.termsBefore}
                    <a href={localizedPath(locale, '/terms')} target="_blank" rel="noopener" className="underline">
                      {text.submit.termsLink}
                    </a>
                    {text.submit.termsAfter}
                  </span>
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" onClick={onSubmit} disabled={!canSubmit} className={PRIMARY_BUTTON}>
                  {text.submit.button}
                </button>
                <p role="status" data-submit-status="" className="text-small font-semibold">
                  {submitState === 'failed'
                    ? (saveError ?? text.submit.failed)
                    : submitState === 'title_required' || (confirmed && title.trim() === '')
                      ? text.save.errors.title_required
                      : submitState === 'thumb_required' || (confirmed && !hasThumb)
                        ? text.save.errors.thumb_required
                        : null}
                </p>
              </div>
            </Section>
          )}
          {submitState === 'done' && (
            <div role="status" className="mt-8 rounded-control bg-site-field px-3 py-2.5">
              <p className="font-semibold">{text.submit.done}</p>
              <a href={worksHref} className="mt-1 inline-block underline">
                {text.submit.toWorks}
              </a>
            </div>
          )}
          {inReview && (
            <Link to="/account/works" className={`${WHITE_BUTTON} mt-6`}>
              {text.submit.toWorks}
            </Link>
          )}
        </>
      )}
    </div>
  );
}
