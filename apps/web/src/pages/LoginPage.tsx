import { useEffect, useId, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { RecoveryCode } from '../components/AccountPasskeys';
import type { Copy } from '../copy';
import { useCopy, useLocale } from '../hooks/useCopy';
import { useHandleCheck, type HandleCheck } from '../hooks/useHandleCheck';
import { usePageData } from '../hooks/usePageData';
import { useResetTitle } from '../hooks/useResetTitle';
import { localizedPath } from '../i18n';
import { fetchPendingSignup, fetchPublicHandleStatus, postSignup, providerLoginHref, type PendingSignup } from '../lib/account';
import { useInAppBrowser, type InAppBrowser } from '../lib/inAppBrowser';
import { loginWithPasskey, loginWithRecoveryCode, registerPasskey } from '../lib/passkey';

const BUTTON =
  'inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-control border border-site-line-2 bg-site-bg px-4 text-body font-semibold text-site-fg hover:bg-site-hover';
const PRIMARY_BUTTON = 'inline-flex h-11 w-full items-center justify-center rounded-control bg-site-primary px-4 font-semibold text-site-bg disabled:opacity-60';
const FIELD = 'mt-1 h-11 w-full rounded-control border border-site-line-2 bg-site-bg px-3 text-body text-site-fg focus-visible:border-site-primary';

function RecoveryForm({ next }: { next: string }) {
  const text = useCopy().login;
  const id = useId();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    const answer = await loginWithRecoveryCode(code, next).catch(() => 'invalid' as const);
    if (answer === 'invalid') setMessage(text.recoveryInvalid);
    else if (answer === 'limited') setMessage(text.recoveryLimited);
    else window.location.assign(answer.next);
  };

  return (
    <form onSubmit={onSubmit} className="mt-3">
      <label htmlFor={`${id}-code`} className="block font-semibold">
        {text.recoveryLabel}
      </label>
      <input id={`${id}-code`} type="text" value={code} spellCheck={false} autoCapitalize="characters" autoComplete="off" onChange={(event) => setCode(event.target.value)} className={FIELD} />
      <button type="submit" disabled={!code.trim()} className={`${PRIMARY_BUTTON} mt-2`}>
        {text.recoverySubmit}
      </button>
      <p role="status" className="mt-2 text-small font-semibold">
        {message}
      </p>
    </form>
  );
}

/** URL の error の名前から文を選ぶ（worker/loginFlow.ts の LoginPageError）。知らない名前には何も出さない。 */
function loginNotice(text: Copy['login'], error: string | null): string | null {
  if (error === 'signup_limited') return text.signupLimited;
  if (error === 'login_retry') return text.retry;
  if (error === 'login_failed') return text.failed;
  if (error === 'login_limited') return text.limited;
  return null;
}

/** アプリの中のブラウザの知らせ（docs/tasks/FIX-login.md「追加でやること」）。ここのリンクをほかのブラウザで開いてもらう。 */
function InAppNotice({ browser, path }: { browser: InAppBrowser; path: string }) {
  const text = useCopy().login.inApp;
  const [copied, setCopied] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const onCopy = async () => {
    const url = new URL(path, window.location.origin).href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setFailedUrl(null);
    } catch {
      // アプリの中のブラウザでは、書き込みを断られることがある。そのときは、リンクを見せて選んでもらう
      setCopied(false);
      setFailedUrl(url);
    }
  };

  return (
    <div data-in-app-notice className="rounded-control border border-site-line-2 p-3 text-small">
      <p className="font-semibold">{text.message}</p>
      {browser === 'iphone' && <p className="mt-1">{text.iPhone}</p>}
      <button type="button" onClick={onCopy} className={`${BUTTON} mt-3`}>
        {copied ? text.copied : text.copyLink}
      </button>
      <div role="status" className="mt-2 font-semibold empty:hidden">
        {failedUrl && (
          <>
            <p>{text.copyFailed}</p>
            <code className="mt-1 block select-all font-mono font-normal wrap-anywhere">{failedUrl}</code>
          </>
        )}
      </div>
    </div>
  );
}

/** ログインの画面（docs/tasks/T020.md「6」「7」、FIX-login「2」）。使える手段を並べる。人によって変えない。 */
export function LoginPage() {
  const copy = useCopy();
  const locale = useLocale();
  const page = usePageData();
  const [params] = useSearchParams();
  const next = params.get('next') ?? localizedPath(locale, '/');
  const [message, setMessage] = useState<string | null>(loginNotice(copy.login, params.get('error')));
  const [showRecovery, setShowRecovery] = useState(false);
  const methods = page?.kind === 'login' ? page.methods : { google: false, passkey: false };
  const inApp = useInAppBrowser();
  // 別のブラウザで戻ってきたときも、同じ文を出す。どのブラウザにいるかは、UA では分からないことがある
  const showInAppNotice = params.get('error') === 'login_open_browser' || (inApp !== null && methods.google);
  useResetTitle();

  const onPasskey = async () => {
    setMessage(null);
    const answer = await loginWithPasskey({ next }).catch(() => 'failed' as const);
    // アプリの中のブラウザでは、パスキーの画面が出ないまま断られることがある（取り消しと同じ答えになる）
    if (inApp !== null && (answer === 'cancelled' || answer === 'failed')) {
      setMessage(copy.login.inApp.message);
      return;
    }
    if (answer === 'cancelled') return;
    if (answer === 'retry') setMessage(copy.login.retry);
    else if (answer === 'failed' || answer === 'reauth_mismatch') setMessage(copy.login.passkeyFailed);
    else window.location.assign(answer.next);
  };

  return (
    <div className="mx-auto max-w-[360px] pb-8 text-body text-site-fg md:pt-[27px]">
      <h1 className="text-title font-bold">{copy.login.heading}</h1>
      <div className="mt-6 flex flex-col gap-3">
        {showInAppNotice && <InAppNotice browser={inApp} path={`${localizedPath(locale, '/login')}?next=${encodeURIComponent(next)}`} />}
        {methods.passkey && (
          <button type="button" onClick={onPasskey} className={BUTTON}>
            {copy.login.passkey}
          </button>
        )}
        {methods.google && (
          <a href={providerLoginHref('google', next)} className={BUTTON}>
            {/* Google の決まりのロゴ（色を変えない）。色を tsx に書かないよう、ファイルで置く */}
            <img src="/google-g.svg" alt="" width={18} height={18} className="size-[18px]" />
            {copy.login.google}
          </a>
        )}
        <a href={providerLoginHref('github', next)} className={BUTTON}>
          {copy.login.github}
        </a>
      </div>
      <p role="status" className="mt-2 text-small font-semibold">
        {message}
      </p>
      <p className="mt-2 text-small text-site-fg-2">{copy.login.privacyNote}</p>
      {methods.passkey && (
        <div className="mt-6 border-t border-site-line pt-5">
          <a href={`${localizedPath(locale, '/signup')}?next=${encodeURIComponent(next)}`} className={BUTTON}>
            {copy.login.createPasskey}
          </a>
          <button type="button" aria-expanded={showRecovery} onClick={() => setShowRecovery((value) => !value)} className="mt-2 inline-flex h-11 w-full items-center justify-center text-small text-site-fg-2 underline hover:text-site-fg">
            {copy.login.recoveryToggle}
          </button>
          {showRecovery && <RecoveryForm next={next} />}
        </div>
      )}
    </div>
  );
}

type PendingState = { status: 'loading' } | { status: 'none' } | { status: 'ready'; pending: PendingSignup };

/** 新しい人が handle を選ぶ画面（docs/tasks/T020.md「6」「7」）。選ぶまで人を作らない。 */
export function SignupPage() {
  const copy = useCopy();
  const locale = useLocale();
  const page = usePageData();
  const [params] = useSearchParams();
  const text = copy.signup;
  const handleText = copy.account.handle;
  const id = useId();
  const [state, setState] = useState<PendingState>({ status: 'loading' });
  const [value, setValue] = useState('');
  const [override, setOverride] = useState<HandleCheck | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [created, setCreated] = useState<{ next: string; code: string | null } | null>(null);
  const checked = useHandleCheck(value, '', fetchPublicHandleStatus);
  const status = override ?? checked;
  const passkeyAvailable = page?.kind === 'signup' && page.methods.passkey;
  const next = params.get('next') ?? localizedPath(locale, '/');
  useResetTitle();

  useEffect(() => {
    document.title = text.pageTitle;
    let current = true;
    fetchPendingSignup().then(
      (pending) => {
        if (!current) return;
        if (!pending) {
          setState({ status: 'none' });
          return;
        }
        setState({ status: 'ready', pending });
        setValue(pending.suggestions[0] ?? '');
      },
      () => {
        if (current) setState({ status: 'none' });
      },
    );
    return () => {
      current = false;
    };
  }, [text.pageTitle]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFailed(null);
    try {
      const answer = await postSignup(value.toLowerCase());
      if (answer === 'expired') setState({ status: 'none' });
      else if (answer === 'limited') setFailed(text.limited);
      else if ('next' in answer) window.location.assign(answer.next);
      else setOverride(answer.status);
    } catch {
      setFailed(text.failed);
    }
  };

  const onCreatePasskey = async (event: FormEvent) => {
    event.preventDefault();
    setFailed(null);
    const answer = await registerPasskey({ handle: value.toLowerCase(), next }).catch(() => 'failed' as const);
    if (answer === 'cancelled') return;
    if (answer === 'retry') window.location.assign(`${localizedPath(locale, '/login')}?next=${encodeURIComponent(next)}&error=login_retry`);
    else if (answer === 'failed' || answer === 'reauth_required') setFailed(text.failed);
    else if (answer === 'limited') setFailed(text.limited);
    else if ('status' in answer) setOverride(answer.status);
    else setCreated({ next: answer.next, code: answer.recoveryCode });
  };

  const messages: Partial<Record<HandleCheck, string>> = {
    checking: handleText.checking,
    ok: handleText.ok,
    format: handleText.format,
    reserved: handleText.reserved,
    taken: handleText.taken,
    held: handleText.held,
    error: handleText.failed,
  };

  const handleField = (
    <>
      <label htmlFor={`${id}-handle`} className="mt-4 block font-semibold">
        {text.label}
      </label>
      <input
        id={`${id}-handle`}
        type="text"
        value={value}
        maxLength={40}
        spellCheck={false}
        autoCapitalize="none"
        autoComplete="off"
        aria-describedby={`${id}-status`}
        onChange={(event) => {
          setOverride(null);
          setValue(event.target.value);
        }}
        className={FIELD}
      />
      <p id={`${id}-status`} role="status" className="mt-1 min-h-4 text-small font-semibold">
        {value ? messages[status] : null}
      </p>
    </>
  );

  if (created) {
    return (
      <div className="mx-auto max-w-[360px] pb-8 text-body text-site-fg md:pt-[27px]">
        <h1 className="text-title font-bold">{text.createdHeading}</h1>
        {created.code && <RecoveryCode code={created.code} />}
        <a href={created.next} className={`${PRIMARY_BUTTON} mt-4`}>
          {text.continue}
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[360px] pb-8 text-body text-site-fg md:pt-[27px]">
      <h1 className="text-title font-bold">{text.heading}</h1>
      {state.status === 'none' && passkeyAvailable && (
        <form onSubmit={onCreatePasskey} className="mt-4">
          <p>{text.intro}</p>
          {handleField}
          <p className="mt-3 text-small font-semibold">{text.passkeyWarning}</p>
          <button type="submit" disabled={status !== 'ok'} className={`${PRIMARY_BUTTON} mt-3`}>
            {text.createPasskey}
          </button>
          <p role="status" className="mt-2 text-small font-semibold">
            {failed}
          </p>
          <a href={`${localizedPath(locale, '/login')}?next=${encodeURIComponent(next)}`} className={`${BUTTON} mt-3`}>
            {text.toLogin}
          </a>
        </form>
      )}
      {state.status === 'none' && !passkeyAvailable && (
        <>
          <p className="mt-4">{text.expired}</p>
          <a href={localizedPath(locale, '/login')} className={`${BUTTON} mt-4`}>
            {text.toLogin}
          </a>
        </>
      )}
      {state.status === 'ready' && (
        <form onSubmit={onSubmit} className="mt-4">
          <p>{text.intro}</p>
          {handleField}
          {state.pending.suggestions.length > 1 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-small text-site-fg-2">
              <span>{text.suggestions}</span>
              {state.pending.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setOverride(null);
                    setValue(suggestion);
                  }}
                  className="inline-flex h-11 items-center rounded-chip border border-site-line-2 px-3 text-site-fg hover:bg-site-hover"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          <button type="submit" disabled={status !== 'ok'} className={`${PRIMARY_BUTTON} mt-4`}>
            {text.submit}
          </button>
          <p role="status" className="mt-2 text-small font-semibold">
            {failed}
          </p>
        </form>
      )}
    </div>
  );
}
