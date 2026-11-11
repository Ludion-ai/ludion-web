import { useState, type ReactNode } from 'react';
import { useCopy, useLocale } from '../hooks/useCopy';
import { postRevokeAiConnection, type AccountOverview } from '../lib/account';

const WHITE_BUTTON = 'inline-flex h-11 items-center justify-center rounded-control border border-site-line-2 bg-site-bg px-4 text-body font-semibold text-site-fg hover:bg-site-hover disabled:opacity-60';

/** Claude Code のプラグインを入れる2行と、つなぐ1行、止める2行（plugins/ludion）。コードの決まりなので、文字の表（copy.ts）には置かない。 */
const PLUGIN_INSTALL = ['/plugin marketplace add Ludion-ai/ludion-web', '/plugin install ludion@ludion'];
const PLUGIN_CONNECT = ['/ludion:connect'];
const PLUGIN_STOP = ['/ludion:auto off', '/ludion:auto off --all'];

function Code({ lines }: { lines: string[] }) {
  return (
    <code className="mt-1.5 block rounded-key bg-site-field px-3 py-2 font-mono text-small wrap-anywhere whitespace-pre-wrap text-site-fg" translate="no">
      {lines.join('\n')}
    </code>
  );
}

function Steps({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="rounded-control border border-site-line p-3">
      <p className="font-semibold">{name}</p>
      <ol className="mt-1.5 flex list-decimal flex-col gap-1.5 pl-5 text-small text-site-fg-2">{children}</ol>
    </div>
  );
}

/** AI につなぐ（MCP001「3」）。つなぐ先の URL、AI ごとの3行の手順、つないでいる AI の一覧（切る）。 */
export function AccountAiConnect({ data, reload }: { data: AccountOverview; reload: () => Promise<void> }) {
  const text = useCopy().account.aiConnect;
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const url = `${typeof window === 'undefined' ? 'https://ludion.ai' : window.location.origin}/mcp`;
  const day = (time: number) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(time);
  const connections = data.ai_connections ?? [];

  const onDisconnect = async (id: string) => {
    setMessage(null);
    try {
      await postRevokeAiConnection(id);
      await reload();
    } catch {
      setMessage(text.disconnectFailed);
    }
  };

  return (
    <>
      <p className="mt-2 text-small text-site-fg-2">{text.intro}</p>
      <div className="mt-3">
        <p className="text-small font-semibold">{text.urlLabel}</p>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <code data-mcp-url className="flex min-h-11 flex-1 items-center rounded-key bg-site-field px-3 font-mono text-body font-semibold wrap-anywhere text-site-fg" translate="no">
            {url}
          </code>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            }}
            className={`${WHITE_BUTTON} shrink-0`}
          >
            {copied ? text.copied : text.copyUrl}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <Steps name={text.claude.name}>
          {text.claude.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </Steps>
        <Steps name={text.chatgpt.name}>
          {text.chatgpt.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </Steps>
        <Steps name={text.claudeCode.name}>
          <li>
            {text.claudeCode.install}
            <Code lines={PLUGIN_INSTALL} />
          </li>
          <li>
            {text.claudeCode.connect}
            <Code lines={PLUGIN_CONNECT} />
          </li>
          <li>
            {text.claudeCode.done}
            <Code lines={PLUGIN_STOP} />
          </li>
        </Steps>
      </div>

      <h3 className="mt-5 font-semibold">{text.connectedHeading}</h3>
      {connections.length === 0 && <p className="mt-2 text-small text-site-fg-2">{text.none}</p>}
      <ul className="mt-2 flex flex-col gap-3">
        {connections.map((connection) => (
          <li key={connection.id} data-ai-connection={connection.id} className="flex items-center justify-between gap-3 rounded-control border border-site-line p-3">
            <div className="min-w-0 text-small text-site-fg-2">
              <p className="text-body font-semibold wrap-anywhere text-site-fg">{connection.name}</p>
              <p className="mt-0.5">{text.connected(day(connection.created_at))}</p>
              <p>{connection.last_used_at === null ? text.neverUsed : text.lastUsed(day(connection.last_used_at))}</p>
            </div>
            <button type="button" aria-label={text.disconnectLabel(connection.name)} onClick={() => onDisconnect(connection.id)} className={`${WHITE_BUTTON} shrink-0`}>
              {text.disconnect}
            </button>
          </li>
        ))}
      </ul>
      {connections.length > 0 && <p className="mt-2 text-small text-site-fg-2">{text.disconnectNote}</p>}
      <p role="status" className="mt-2 text-small font-semibold text-site-fg">
        {message}
      </p>
    </>
  );
}
