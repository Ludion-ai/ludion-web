import { ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { AccountAiKeys } from '../components/AccountAiKeys';
import { AccountPasskeys, ReauthActions } from '../components/AccountPasskeys';
import { Avatar } from '../components/Avatar';
import { useCopy, useLocale } from '../hooks/useCopy';
import { useHandleCheck, type HandleCheck } from '../hooks/useHandleCheck';
import { useResetTitle } from '../hooks/useResetTitle';
import { localizedPath } from '../i18n';
import {
  fetchAccount,
  fetchHandleStatus,
  goToLogin,
  linkHref,
  postDeleteAccount,
  postHandle,
  postProfile,
  postRemoveIdentity,
  postRevokeOtherSessions,
  postRevokeSession,
  type AccountOverview,
  type AccountProfile,
  type AccountSession,
  type LoginProvider,
  type ProfileField,
} from '../lib/account';

const FIELD =
  'h-11 w-full rounded-control border border-site-line-2 bg-site-bg px-3 text-body text-site-fg placeholder:text-site-fg-2 focus-visible:border-site-primary';
const PRIMARY_BUTTON =
  'inline-flex h-11 items-center justify-center rounded-control bg-site-primary px-4 text-body font-semibold text-site-bg disabled:opacity-60';
const WHITE_BUTTON =
  'inline-flex h-11 items-center justify-center rounded-control border border-site-line-2 bg-site-bg px-4 text-body font-semibold text-site-fg hover:bg-site-hover disabled:opacity-60';

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: AccountOverview };

/** 本人の情報を読む。HTML は人で変えないので、読み込みの後に API から足す（SPEC.md 10）。 */
function useAccountOverview() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const reload = useCallback(async () => {
    try {
      const data = await fetchAccount();
      if (data === 'unauthorized') goToLogin();
      else setState({ status: 'ready', data });
    } catch {
      setState({ status: 'error' });
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { state, reload };
}

/** 保存された日付。セッションの日時は UTC の日の単位で持つので、UTC で読む。 */
function useFormatDay() {
  const locale = useLocale();
  return (time: number) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(time);
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="mt-8 border-t border-site-line pt-6">
      <h2 className="text-subhead font-semibold">{heading}</h2>
      {children}
    </section>
  );
}

/**
 * プロフィールの入力欄。上から、表示の名前、ユーザー名（children）、X、サイトの順（docs/tasks/T020.md「2」）。
 * ユーザー名は別のフォームで変えるので、表示の名前の入力欄は form 属性で下のフォームに結ぶ。
 */
function ProfileForm({ profile, children }: { profile: AccountProfile; children: ReactNode }) {
  const copy = useCopy();
  const text = copy.account.profile;
  const id = useId();
  const [values, setValues] = useState({
    display_name: profile.display_name ?? '',
    x_url: profile.x_url ?? '',
    site_url: profile.site_url ?? '',
  });
  const [result, setResult] = useState<'idle' | 'saving' | 'saved' | 'failed' | ProfileField>('idle');

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setResult('saving');
    try {
      const answer = await postProfile(values);
      setResult(answer === 'ok' ? 'saved' : answer);
    } catch {
      setResult('failed');
    }
  };

  const field = (name: ProfileField, label: string, hint: string, type: 'text' | 'url') => {
    const invalid = result === name;
    return (
      <div>
        <label htmlFor={`${id}-${name}`} className="block text-body font-semibold">
          {label}
        </label>
        <input
          id={`${id}-${name}`}
          form={`${id}-form`}
          type={type}
          value={values[name]}
          aria-invalid={invalid}
          aria-describedby={`${id}-${name}-hint`}
          autoComplete="off"
          onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value }))}
          className={`${FIELD} mt-1`}
        />
        <p id={`${id}-${name}-hint`} className={`mt-1 text-small ${invalid ? 'font-semibold text-site-fg' : 'text-site-fg-2'}`}>
          {invalid ? text.invalid[name] : hint}
        </p>
      </div>
    );
  };

  return (
    <>
      <div className="mt-4">{field('display_name', text.displayName, text.displayNameHint, 'text')}</div>
      {children}
      <form id={`${id}-form`} onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
        {field('x_url', text.x, text.xHint, 'url')}
        {field('site_url', text.site, text.siteHint, 'url')}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={result === 'saving'} className={PRIMARY_BUTTON}>
            {text.save}
          </button>
          <p role="status" className="text-small text-site-fg-2">
            {result === 'saved' && text.saved}
            {result === 'failed' && text.saveError}
          </p>
        </div>
      </form>
    </>
  );
}

function HandleForm({ current, onChanged }: { current: string; onChanged: (handle: string) => void }) {
  const copy = useCopy();
  const text = copy.account.handle;
  const id = useId();
  const [value, setValue] = useState(current);
  const [override, setOverride] = useState<HandleCheck | null>(null);
  const checked = useHandleCheck(value, current, fetchHandleStatus);
  const status = override ?? checked;
  const [changed, setChanged] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const wanted = value.toLowerCase();
    try {
      const answer = await postHandle(wanted);
      if (answer === 'ok') {
        setChanged(true);
        onChanged(wanted);
      } else {
        setOverride(answer);
      }
    } catch {
      setOverride('error');
    }
  };

  const messages: Partial<Record<HandleCheck, string>> = {
    checking: text.checking,
    ok: text.ok,
    same: text.same,
    format: text.format,
    reserved: text.reserved,
    taken: text.taken,
    held: text.held,
    error: text.failed,
  };

  return (
    <form onSubmit={onSubmit} className="mt-4">
      <label htmlFor={`${id}-handle`} className="block text-body font-semibold">
        {text.label}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id={`${id}-handle`}
          type="text"
          value={value}
          maxLength={40}
          spellCheck={false}
          autoCapitalize="none"
          autoComplete="off"
          aria-describedby={`${id}-handle-status ${id}-handle-note`}
          onChange={(event) => {
            setChanged(false);
            setOverride(null);
            setValue(event.target.value);
          }}
          className={`${FIELD} min-w-0 flex-1`}
        />
        <button type="submit" disabled={status !== 'ok'} className={WHITE_BUTTON}>
          {text.change}
        </button>
      </div>
      <p id={`${id}-handle-status`} role="status" className="mt-1 min-h-4 text-small font-semibold text-site-fg">
        {changed ? text.changed : messages[status]}
      </p>
      <p id={`${id}-handle-note`} className="mt-1 text-small text-site-fg-2">
        {text.note}
      </p>
    </form>
  );
}

/** ログインの手段（docs/tasks/T020.md「2」「3」）。足す・外すは直近10分以内のログインを求める。最後の1つは外せない。 */
function Methods({ data, reload }: { data: AccountOverview; reload: () => Promise<void> }) {
  const copy = useCopy();
  const locale = useLocale();
  const text = copy.account.methods;
  const day = useFormatDay();
  const [params] = useSearchParams();
  const [failed, setFailed] = useState(false);
  const here = localizedPath(locale, '/account');
  const error = params.get('error');
  const notice = error === 'identity_taken' || error === 'already_linked' || error === 'reauth_required' || error === 'reauth_mismatch' || error === 'provider_denied' || error === 'login_failed' ? text.errors[error] : null;
  const canRemove = data.identities.length + data.passkeys.length > 1;
  const providers: LoginProvider[] = ['google', 'github'];
  const missing = providers.filter((provider) => !data.identities.some((identity) => identity.provider === provider) && (provider !== 'google' || data.available.google));

  const remove = async (provider: LoginProvider) => {
    setFailed(false);
    try {
      await postRemoveIdentity(provider);
      await reload();
    } catch {
      setFailed(true);
    }
  };

  return (
    <>
      {notice && (
        <p role="alert" className="mt-3 font-semibold">
          {notice}
        </p>
      )}
      {params.get('recovered') === '1' && (
        <p role="alert" className="mt-3 font-semibold">
          {copy.passkeys.recovered}
        </p>
      )}
      <ul className="mt-3 flex flex-col gap-3">
        {data.identities.map((identity) => (
          <li key={identity.provider} className="flex items-center justify-between gap-3 rounded-control border border-site-line p-3">
            <div className="min-w-0">
              <p className="font-semibold wrap-anywhere">
                {text.provider[identity.provider]}
                {identity.label && <span className="font-normal text-site-fg-2">（{identity.label}）</span>}
              </p>
              <p className="mt-0.5 text-small text-site-fg-2">{text.added(day(identity.created_at))}</p>
            </div>
            {canRemove && data.recent_auth && (
              <button type="button" aria-label={text.removeLabel(text.provider[identity.provider])} onClick={() => remove(identity.provider)} className={`${WHITE_BUTTON} shrink-0`}>
                {text.remove}
              </button>
            )}
          </li>
        ))}
      </ul>
      {!canRemove && <p className="mt-2 text-small text-site-fg-2">{text.lastNote}</p>}
      {data.recent_auth ? (
        missing.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {missing.map((provider) => (
              <a key={provider} href={linkHref(provider, here)} className={WHITE_BUTTON}>
                {text.add(text.provider[provider])}
              </a>
            ))}
          </div>
        )
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-small text-site-fg-2">{text.reauthNote}</p>
          <ReauthActions data={data} next={here} onDone={reload} className={WHITE_BUTTON} />
        </div>
      )}
      <p role="status" className="mt-2 text-small font-semibold text-site-fg">
        {failed && text.failed}
      </p>
      {(data.available.passkey || data.passkeys.length > 0) && <AccountPasskeys data={data} reload={reload} />}
    </>
  );
}

function ListLink({ to, label, count }: { to: string; label: string; count?: number }) {
  return (
    <li>
      <Link to={to} className="flex h-11 items-center justify-between rounded-control px-1 text-body hover:bg-site-hover">
        <span>{label}</span>
        <span className="flex items-center gap-1 text-site-fg-2">
          {count !== undefined && count}
          <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
        </span>
      </Link>
    </li>
  );
}

function Sessions({ sessions, reload }: { sessions: AccountSession[]; reload: () => Promise<void> }) {
  const copy = useCopy();
  const locale = useLocale();
  const text = copy.account.sessions;
  const day = useFormatDay();
  const [failed, setFailed] = useState(false);

  const act = async (action: () => Promise<void>, leaving: boolean) => {
    setFailed(false);
    try {
      await action();
      // 今の端末をログアウトしたら、アカウントのページにはいられない
      if (leaving) window.location.assign(localizedPath(locale, '/'));
      else await reload();
    } catch {
      setFailed(true);
    }
  };

  return (
    <>
      <ul className="mt-3 flex flex-col gap-3">
        {sessions.map((session) => (
          <li key={session.id} className="flex items-center justify-between gap-3 rounded-control border border-site-line p-3">
            <div className="min-w-0 text-small text-site-fg-2">
              {session.current && <p className="mb-0.5 text-body font-semibold text-site-fg">{text.current}</p>}
              <p>{text.created(day(session.created_at))}</p>
              <p>{text.lastUsed(day(session.last_used_at))}</p>
            </div>
            <button
              type="button"
              aria-label={text.logoutLabel(day(session.created_at))}
              onClick={() => act(() => postRevokeSession(session.id), session.current)}
              className={`${WHITE_BUTTON} shrink-0`}
            >
              {text.logout}
            </button>
          </li>
        ))}
      </ul>
      {sessions.length > 1 && (
        <button type="button" onClick={() => act(postRevokeOtherSessions, false)} className={`${WHITE_BUTTON} mt-3 w-full`}>
          {text.logoutOthers}
        </button>
      )}
      <p role="status" className="mt-2 text-small font-semibold text-site-fg">
        {failed && text.failed}
      </p>
    </>
  );
}

/** アカウントのページ（docs/tasks/T020.md「2」）。スマホを先に作る。項目は上から順。 */
export function AccountPage() {
  const copy = useCopy();
  const text = copy.account;
  const { state, reload } = useAccountOverview();
  useResetTitle();
  useEffect(() => {
    document.title = text.pageTitle;
  }, [text.pageTitle]);

  return (
    <div className="max-w-[640px] pb-8 text-body text-site-fg md:pt-[27px]">
      <h1 className="text-title font-bold">{text.heading}</h1>
      {state.status === 'error' && <p className="py-20 text-center text-site-fg-2">{text.loadError}</p>}
      {state.status === 'ready' && (
        <>
          <section className="mt-6">
            <h2 className="sr-only">{text.profile.heading}</h2>
            <div className="flex items-center gap-4">
              <Avatar url={state.data.profile.avatar_url} handle={state.data.profile.handle} size={64} />
              <div className="min-w-0">
                <p className="text-subhead font-semibold wrap-anywhere">{state.data.profile.display_name ?? `@${state.data.profile.handle}`}</p>
                <p className="text-site-fg-2">@{state.data.profile.handle}</p>
              </div>
            </div>
            <ProfileForm profile={state.data.profile}>
              <HandleForm current={state.data.profile.handle} onChanged={() => void reload()} />
            </ProfileForm>
          </section>

          <Section heading={text.lists.heading}>
            <ul className="mt-2 flex flex-col">
              <ListLink to="/account/works" label={text.lists.works} count={state.data.works_count} />
              <ListLink to="/account/saved" label={text.lists.saved} />
              <ListLink to="/account/likes" label={text.lists.likes} />
            </ul>
          </Section>

          <Section heading={text.methods.heading}>
            <Methods data={state.data} reload={reload} />
          </Section>

          <Section heading={text.aiKeys.heading}>
            <AccountAiKeys data={state.data} reload={reload} />
          </Section>

          <Section heading={text.sessions.heading}>
            <Sessions sessions={state.data.sessions} reload={reload} />
          </Section>

          <Section heading={text.remove.heading}>
            <Link to="/account/delete" className="mt-2 flex h-11 items-center justify-between rounded-control px-1 hover:bg-site-hover">
              <span>{text.remove.link}</span>
              <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" className="text-site-fg-2" />
            </Link>
          </Section>
        </>
      )}
    </div>
  );
}

/** 退会の確認（docs/tasks/T020.md「2」）。何が消えるかを出し、直近10分以内のログインがあるときだけ消せる。 */
export function AccountDeletePage() {
  const copy = useCopy();
  const locale = useLocale();
  const text = copy.account.remove;
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { state, reload } = useAccountOverview();
  const [failed, setFailed] = useState(false);
  useResetTitle();
  useEffect(() => {
    document.title = text.pageTitle;
  }, [text.pageTitle]);

  const onDelete = async () => {
    setFailed(false);
    try {
      const answer = await postDeleteAccount();
      if (answer === 'ok') window.location.assign(localizedPath(locale, '/'));
      else await reload();
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="max-w-[640px] pb-8 text-body text-site-fg md:pt-[27px]">
      <h1 className="text-title font-bold">{text.heading}</h1>
      {state.status === 'error' && <p className="py-20 text-center text-site-fg-2">{copy.account.loadError}</p>}
      {state.status === 'ready' && (
        <>
          <p className="mt-4">{text.intro(state.data.profile.handle)}</p>
          <h2 className="mt-6 text-subhead font-semibold">{text.goneHeading}</h2>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5">
            {text.gone.map((item) => (
              <li key={item}>{item}</li>
            ))}
            {state.data.works_count > 0 && <li className="font-semibold">{text.goneWorks(state.data.works_count)}</li>}
          </ul>
          <h2 className="mt-6 text-subhead font-semibold">{text.staysHeading}</h2>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5">
            {text.stays.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="mt-8 flex flex-col gap-3">
            {params.get('error') === 'reauth_mismatch' && (
              <p role="alert" className="font-semibold">
                {text.reauthMismatch}
              </p>
            )}
            {state.data.recent_auth ? (
              <button type="button" onClick={onDelete} className={PRIMARY_BUTTON}>
                {text.confirm}
              </button>
            ) : (
              <>
                <p>{text.reauthNote}</p>
                <ReauthActions data={state.data} next={localizedPath(locale, pathname)} onDone={reload} className={PRIMARY_BUTTON} />
              </>
            )}
            <Link to="/account" className={WHITE_BUTTON}>
              {text.cancel}
            </Link>
            <p role="status" className="text-small font-semibold">
              {failed && text.failed}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
