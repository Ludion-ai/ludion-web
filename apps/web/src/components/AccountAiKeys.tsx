import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useCopy, useLocale } from '../hooks/useCopy';
import { localizedPath } from '../i18n';
import { postCreateAiKey, postDeleteAiKey, type AccountOverview } from '../lib/account';

const PRIMARY_BUTTON = 'inline-flex h-11 items-center justify-center rounded-control bg-site-primary px-4 text-body font-semibold text-site-bg disabled:opacity-60';
const WHITE_BUTTON = 'inline-flex h-11 items-center justify-center rounded-control border border-site-line-2 bg-site-bg px-4 text-body font-semibold text-site-fg hover:bg-site-hover disabled:opacity-60';
/** worker/aiKeys.ts の MAX_KEYS_PER_USER と MAX_KEY_NAME_CHARS と同じ。 */
const MAX_KEYS = 5;
const MAX_NAME = 40;

function useFormatDay() {
  const locale = useLocale();
  return (time: number) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(time);
}

/** 作ったばかりの鍵を1回だけ見せる。閉じたらもう見られない。 */
function NewKey({ secret }: { secret: string }) {
  const text = useCopy().account.aiKeys;
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 rounded-control border border-site-line-2 p-3">
      <p className="font-semibold">{text.newHeading}</p>
      <p className="mt-1 text-small text-site-fg-2">{text.newIntro}</p>
      <code data-ai-key className="mt-3 block select-all rounded-key bg-site-field p-3 font-mono text-body font-semibold wrap-anywhere text-site-fg">
        {secret}
      </code>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(secret);
          setCopied(true);
        }}
        className={`${WHITE_BUTTON} mt-3 w-full`}
      >
        {copied ? text.copied : text.copy}
      </button>
    </div>
  );
}

/** AI の鍵の一覧、作る、消す（docs/tasks/T037.md「1」）。作るときに、投稿の同意の3つに1回同意してもらう。 */
export function AccountAiKeys({ data, reload }: { data: AccountOverview; reload: () => Promise<void> }) {
  const copy = useCopy();
  const locale = useLocale();
  const text = copy.account.aiKeys;
  const submit = copy.post.submit;
  const day = useFormatDay();
  const id = useId();
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState({ own: false, mit: false, terms: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const keys = data.ai_keys;
  const full = keys.length >= MAX_KEYS;
  const ready = name.trim() !== '' && confirm.own && confirm.mit && confirm.terms && !busy && !full;

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setMessage(null);
    setSecret(null);
    try {
      const answer = await postCreateAiKey(name.trim(), confirm);
      if (answer === 'bad_name') setMessage(text.badName);
      else if (answer === 'too_many') setMessage(text.tooMany(MAX_KEYS));
      else {
        setSecret(answer.secret);
        setName('');
        setConfirm({ own: false, mit: false, terms: false });
      }
      await reload();
    } catch {
      setMessage(text.createFailed);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (keyId: string) => {
    setMessage(null);
    try {
      await postDeleteAiKey(keyId);
      await reload();
    } catch {
      setMessage(text.removeFailed);
    }
  };

  const check = (field: 'own' | 'mit' | 'terms', label: ReactNode) => (
    <label className="flex items-start gap-2">
      <input
        type="checkbox"
        checked={confirm[field]}
        onChange={(event) => setConfirm((current) => ({ ...current, [field]: event.target.checked }))}
        className="mt-0.5 size-[18px] shrink-0"
      />
      <span>{label}</span>
    </label>
  );

  return (
    <>
      <p className="mt-2 text-small text-site-fg-2">
        {text.intro}{' '}
        <a href="/api/v1" target="_blank" rel="noopener" className="underline">
          {text.docs}
        </a>
      </p>
      {keys.length === 0 && <p className="mt-3 text-small text-site-fg-2">{text.none}</p>}
      <ul className="mt-3 flex flex-col gap-3">
        {keys.map((key) => (
          <li key={key.id} className="flex items-center justify-between gap-3 rounded-control border border-site-line p-3">
            <div className="min-w-0 text-small text-site-fg-2">
              <p className="text-body font-semibold wrap-anywhere text-site-fg">{key.name}</p>
              <p className="mt-0.5">{text.created(day(key.created_at))}</p>
              <p>{key.last_used_at === null ? text.neverUsed : text.lastUsed(day(key.last_used_at))}</p>
            </div>
            <button type="button" aria-label={text.removeLabel(key.name)} onClick={() => onDelete(key.id)} className={`${WHITE_BUTTON} shrink-0`}>
              {text.remove}
            </button>
          </li>
        ))}
      </ul>
      {secret && <NewKey secret={secret} />}
      {full ? (
        <p className="mt-3 text-small text-site-fg-2">{text.tooMany(MAX_KEYS)}</p>
      ) : (
        <form onSubmit={onCreate} className="mt-4">
          <label htmlFor={`${id}-name`} className="block font-semibold">
            {text.nameField}
          </label>
          <input
            id={`${id}-name`}
            type="text"
            value={name}
            maxLength={MAX_NAME}
            autoComplete="off"
            aria-describedby={`${id}-name-hint`}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 h-11 w-full rounded-control border border-site-line-2 bg-site-bg px-3 text-body text-site-fg focus-visible:border-site-primary"
          />
          <p id={`${id}-name-hint`} className="mt-1 text-small text-site-fg-2">
            {text.nameHint}
          </p>
          <fieldset className="mt-3 flex flex-col gap-2">
            <legend className="mb-1 text-small text-site-fg-2">{text.confirmIntro}</legend>
            {check('own', submit.own)}
            {check('mit', submit.mit)}
            {check(
              'terms',
              <>
                {submit.termsBefore}
                <a href={localizedPath(locale, '/terms')} target="_blank" rel="noopener" className="underline">
                  {submit.termsLink}
                </a>
                {submit.termsAfter}
              </>,
            )}
          </fieldset>
          <button type="submit" disabled={!ready} className={`${PRIMARY_BUTTON} mt-3 w-full`}>
            {text.create}
          </button>
          <p className="mt-1 text-small text-site-fg-2">{text.max(MAX_KEYS)}</p>
        </form>
      )}
      <p role="status" className="mt-2 text-small font-semibold text-site-fg">
        {message}
      </p>
    </>
  );
}
