// The operator's privacy policy, terms of service and contact page, wherever
// the app names them. Their addresses are set when the app is built
// (`src/lib/links.ts`); until they are, nothing here renders anything.
import { useT } from '@/i18n';
import { APP_LINKS, legalLinks, type AppLinks } from '@/lib/links';

/** Opens outside the app, without handing it a way back into the page or the address it came from. */
function external(href: string): { href: string; target?: string; rel?: string } {
  return href.startsWith('mailto:') ? { href } : { href, target: '_blank', rel: 'noopener noreferrer' };
}

/** The legal links that are set, as one row; nothing when none is. */
export function LegalLinks({ className = '', linkClassName = '', links = APP_LINKS }: { className?: string; linkClassName?: string; links?: AppLinks }) {
  const t = useT();
  const set = legalLinks(links);
  if (!set.length) return null;
  return (
    <nav aria-label={t('legal.links')} className={className}>
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {set.map(({ key, href }) => (
          <li key={key}>
            <a {...external(href)} className={linkClassName}>
              {t(`legal.${key}`)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
