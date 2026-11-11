import { useId, useState, type FormEvent } from 'react';
import { useCopy, useLocale } from '../hooks/useCopy';
import { localizedPath } from '../i18n';
import { postRegenerateRecoveryCode, postRemovePasskey, reauthHref, type AccountOverview } from '../lib/account';
import { loginWithPasskey, registerPasskey } from '../lib/passkey';

const PRIMARY_BUTTON = 'inline-flex h-11 items-center justify-center rounded-control bg-site-primary px-4 text-body font-semibold text-site-bg disabled:opacity-60';
const WHITE_BUTTON = 'inline-flex h-11 items-center justify-center rounded-control border border-site-line-2 bg-site-bg px-4 text-body font-semibold text-site-fg hover:bg-site-hover disabled:opacity-60';

/** 保存された日付を読む。 */
function useFormatDay() {
  const locale = useLocale();
  return (time: number) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(time);
}

/** 回復のコードを1回だけ見せる。閉じたらもう見られない。 */
export function RecoveryCode({ code }: { code: string }) {
  const text = useCopy().recovery;
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 rounded-control border border-site-line-2 p-3">
      <p className="font-semibold">{text.heading}</p>
      <p className="mt-1 text-small text-site-fg-2">{text.intro}</p>
      <code data-recovery-code className="mt-3 block select-all rounded-key bg-site-field p-3 font-mono text-body font-semibold wrap-anywhere text-site-fg">
        {code}
      </code>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(code);
          setCopied(true);
        }}
        className={`${WHITE_BUTTON} mt-3 w-full`}
      >
        {copied ? text.copied : text.copy}
      </button>
      <p className="mt-3 text-small font-semibold">{text.warning}</p>
    </div>
  );
}

/** もう一度のログインの手段。持っている手段を全部並べる。パスキーはその場で確かめる。 */
export function ReauthActions({ data, next, onDone, className }: { data: AccountOverview; next: string; onDone: () => Promise<void>; className: string }) {
  const copy = useCopy();
  const text = copy.account.methods;
  const [message, setMessage] = useState<string | null>(null);

  const withPasskey = async () => {
    setMessage(null);
    const answer = await loginWithPasskey({ next, reauth: true }).catch(() => 'failed' as const);
    if (answer === 'cancelled') return;
    if (answer === 'reauth_mismatch') setMessage(text.errors.reauth_mismatch);
    else if (answer === 'retry') setMessage(copy.login.retry);
    else if (answer === 'failed') setMessage(copy.passkeys.reauthFailed);
    else await onDone();
  };

  return (
    <>
      {data.available.passkey && data.passkeys.length > 0 && (
        <button type="button" onClick={withPasskey} className={className}>
          {copy.passkeys.reauth}
        </button>
      )}
      {data.identities.map((identity) => (
        <a key={identity.provider} href={reauthHref(identity.provider, next)} className={className}>
          {text.reauth(text.provider[identity.provider])}
        </a>
      ))}
      {message && (
        <p role="alert" className="font-semibold">
          {message}
        </p>
      )}
    </>
  );
}

/** パスキーの一覧、足す、外す、回復のコードの作り直し（docs/tasks/T020.md「7」）。 */
export function AccountPasskeys({ data, reload }: { data: AccountOverview; reload: () => Promise<void> }) {
  const copy = useCopy();
  const locale = useLocale();
  const text = copy.passkeys;
  const day = useFormatDay();
  const id = useId();
  const [label, setLabel] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);
  const here = localizedPath(locale, '/account');
  const canRemove = data.identities.length + data.passkeys.length > 1;
  const recent = data.recent_auth;

  const onAdd = async (event: FormEvent) => {
    event.preventDefault();
    setFailed(null);
    const answer = await registerPasskey({ label, next: here }).catch(() => 'failed' as const);
    if (answer === 'cancelled') return;
    if (answer === 'retry') {
      setFailed(copy.login.retry);
      return;
    }
    if (answer === 'failed' || answer === 'reauth_required' || answer === 'limited' || 'status' in answer) {
      setFailed(text.addFailed);
      if (answer === 'reauth_required') await reload();
      return;
    }
    setLabel('');
    await reload();
  };

  const onRemove = async (credentialId: string) => {
    setFailed(null);
    try {
      await postRemovePasskey(credentialId);
      await reload();
    } catch {
      setFailed(text.removeFailed);
    }
  };

  const onRegenerate = async () => {
    setFailed(null);
    try {
      setNewCode(await postRegenerateRecoveryCode());
      await reload();
    } catch {
      setFailed(text.regenerateFailed);
    }
  };

  return (
    <div className="mt-5">
      <h3 className="font-semibold">{text.heading}</h3>
      {data.passkeys.length === 0 && <p className="mt-1 text-small text-site-fg-2">{text.none}</p>}
      <ul className="mt-2 flex flex-col gap-3">
        {data.passkeys.map((key) => {
          const name = key.label ?? text.unnamed;
          return (
            <li key={key.id} className="flex items-center justify-between gap-3 rounded-control border border-site-line p-3">
              <div className="min-w-0 text-small text-site-fg-2">
                <p className="text-body font-semibold wrap-anywhere text-site-fg">{name}</p>
                <p className="mt-0.5">{text.created(day(key.created_at))}</p>
                <p>{key.last_used_at === null ? text.neverUsed : text.lastUsed(day(key.last_used_at))}</p>
              </div>
              {canRemove && recent && (
                <button type="button" aria-label={text.removeLabel(name)} onClick={() => onRemove(key.id)} className={`${WHITE_BUTTON} shrink-0`}>
                  {text.remove}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {recent && data.available.passkey && (
        <form onSubmit={onAdd} className="mt-3">
          <label htmlFor={`${id}-label`} className="block font-semibold">
            {text.labelField}
          </label>
          <input
            id={`${id}-label`}
            type="text"
            value={label}
            maxLength={40}
            autoComplete="off"
            aria-describedby={`${id}-label-hint`}
            onChange={(event) => setLabel(event.target.value)}
            className="mt-1 h-11 w-full rounded-control border border-site-line-2 bg-site-bg px-3 text-body text-site-fg focus-visible:border-site-primary"
          />
          <p id={`${id}-label-hint`} className="mt-1 text-small text-site-fg-2">
            {text.labelHint}
          </p>
          <button type="submit" className={`${PRIMARY_BUTTON} mt-2 w-full`}>
            {text.add}
          </button>
        </form>
      )}

      {data.passkeys.length > 0 && (
        <div className="mt-4">
          <h3 className="font-semibold">{text.recoveryHeading}</h3>
          <p className="mt-1 text-small text-site-fg-2">{data.has_recovery_code ? text.recoveryHas : text.recoveryNone}</p>
          {recent && (
            <>
              <button type="button" onClick={onRegenerate} className={`${WHITE_BUTTON} mt-2 w-full`}>
                {text.regenerate}
              </button>
              <p className="mt-1 text-small text-site-fg-2">{text.regenerateNote}</p>
            </>
          )}
          {newCode && <RecoveryCode code={newCode} />}
        </div>
      )}

      <p role="status" className="mt-2 text-small font-semibold text-site-fg">
        {failed}
      </p>
    </div>
  );
}
