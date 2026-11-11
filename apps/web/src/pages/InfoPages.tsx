import type { ReactNode } from 'react';
import { useCopy, useLocale } from '../hooks/useCopy';
import { localizedPath } from '../i18n';
import { SUPPORT_EMAIL } from '../lib/support';

const X_URL = 'https://x.com/Lattice_Node';
/** GA の規約（7. Privacy）が、データの扱いを知らせる方法として挙げているページ。 */
const googlePartnersUrl = (locale: string) => `https://policies.google.com/technologies/partner-sites?hl=${locale}`;
const GA_OPT_OUT_URL = 'https://tools.google.com/dlpage/gaoptout';

const LINK = 'underline hover:text-site-fg-2';

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={LINK}>
      {children}
    </a>
  );
}

function ContactLink() {
  const copy = useCopy();
  return <ExternalLink href={X_URL}>{copy.contact}</ExternalLink>;
}

function EmailLink() {
  return (
    <a href={`mailto:${SUPPORT_EMAIL}`} className={`${LINK} break-all`}>
      {SUPPORT_EMAIL}
    </a>
  );
}

function InfoPage({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="max-w-[640px] pb-8 text-body text-site-fg md:pt-[27px]">
      <h1 className="text-title font-bold">{heading}</h1>
      {children}
    </div>
  );
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-subhead font-semibold">{heading}</h2>
      {children}
    </section>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 flex list-disc flex-col gap-2 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function Rows({ rows }: { rows: { term: string; detail: ReactNode }[] }) {
  return (
    <dl className="mt-3 flex flex-col gap-3">
      {rows.map(({ term, detail }) => (
        <div key={term}>
          <dt className="font-semibold">{term}</dt>
          <dd className="mt-0.5">{detail}</dd>
        </div>
      ))}
    </dl>
  );
}

/** プライバシー（SPEC.md 16）。文は copy.ts。Worker が描き、人によって変えない。 */
export function PrivacyPage() {
  const copy = useCopy();
  const locale = useLocale();
  const { updated, translationNote, intro, stored, notStored, external, thirdParty, requests, changes } = copy.privacy;
  const { analytics, cloudflare, github, googleLogin } = external;
  return (
    <InfoPage heading={copy.privacy.heading}>
      <p className="mt-1 text-small text-site-fg-2">{updated}</p>
      {translationNote && <p className="mt-2 text-meta text-site-fg-2">{translationNote}</p>}
      <p className="mt-4">{intro}</p>

      <Section heading={stored.heading}>
        <List items={stored.items} />
      </Section>

      <Section heading={notStored.heading}>
        <List items={notStored.items} />
        <p className="mt-3">{notStored.note}</p>
      </Section>

      <Section heading={external.heading}>
        <h3 className="mt-4 font-semibold">{analytics.heading}</h3>
        <Rows
          rows={[
            ...Object.values(analytics.rows),
            { term: analytics.how.term, detail: <ExternalLink href={googlePartnersUrl(locale)}>{analytics.how.link}</ExternalLink> },
            { term: analytics.stop.term, detail: <ExternalLink href={GA_OPT_OUT_URL}>{analytics.stop.link}</ExternalLink> },
          ]}
        />
        <h3 className="mt-6 font-semibold">{cloudflare.heading}</h3>
        <p className="mt-1">{cloudflare.detail}</p>
        <h3 className="mt-6 font-semibold">{github.heading}</h3>
        <p className="mt-1">{github.detail}</p>
        <h3 className="mt-6 font-semibold">{googleLogin.heading}</h3>
        <p className="mt-1">{googleLogin.detail}</p>
      </Section>

      <Section heading={thirdParty.heading}>
        <p className="mt-3">{thirdParty.detail}</p>
      </Section>

      <Section heading={requests.heading}>
        <p className="mt-3">{requests.detail}</p>
        <p className="mt-2"><EmailLink /></p>
        <p className="mt-2"><ContactLink /></p>
      </Section>

      <Section heading={changes.heading}>
        <p className="mt-3">{changes.detail}</p>
      </Section>
    </InfoPage>
  );
}

/** 利用規約（docs/tasks/T027.md）。日本語を正文とし、英語は同じ内容の翻訳。 */
export function TermsPage() {
  const copy = useCopy();
  const { updated, translationNote, intro, posting, review, prohibited, use, leaving, contact } = copy.terms;
  return (
    <InfoPage heading={copy.terms.heading}>
      <p className="mt-1 text-small text-site-fg-2">{updated}</p>
      {translationNote && <p className="mt-2 text-meta text-site-fg-2">{translationNote}</p>}
      <p className="mt-4">{intro}</p>

      <Section heading={posting.heading}>
        <List items={posting.items} />
      </Section>

      <Section heading={review.heading}>
        <List items={review.items} />
      </Section>

      <Section heading={prohibited.heading}>
        <List items={prohibited.items} />
      </Section>

      <Section heading={use.heading}>
        <p className="mt-3">{use.detail}</p>
      </Section>

      <Section heading={leaving.heading}>
        <p className="mt-3">{leaving.detail}</p>
      </Section>

      <Section heading={contact.heading}>
        <p className="mt-3">{contact.detail}</p>
        <p className="mt-2"><EmailLink /></p>
      </Section>
    </InfoPage>
  );
}

/** 運営者（SPEC.md 16）。 */
export function AboutPage() {
  const copy = useCopy();
  const locale = useLocale();
  const { intro, operator, license, contact, privacy } = copy.about;
  return (
    <InfoPage heading={copy.about.heading}>
      <p className="mt-4">{intro}</p>
      <Rows rows={[operator, license, { term: contact.term, detail: <ContactLink /> }]} />
      <p className="mt-6">
        <a href={localizedPath(locale, '/privacy')} className={LINK}>
          {privacy}
        </a>
      </p>
    </InfoPage>
  );
}
