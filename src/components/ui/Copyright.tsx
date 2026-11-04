// The copyright line of About: the year, the maker's site as a link
// (<home>…</home> in the text), the licence as a link to its full text
// (<license>…</license>) and that there is no warranty.
import { useT } from '@/i18n';
import { HOME_URL, LICENSE_URL } from '@/lib/links';

const LINKS: Record<string, string> = { home: HOME_URL, license: LICENSE_URL };

export function Copyright({ className = '', linkClassName = '' }: { className?: string; linkClassName?: string }) {
  const t = useT();
  // split() with groups gives text, tag, label, text, tag, label, …, text.
  const parts = t('settings.about.copyright').split(/<(home|license)>(.*?)<\/\1>/);
  return (
    <p className={className}>
      {parts.map((part, i) => {
        if (i % 3 === 0) return part;
        if (i % 3 === 2) return null;
        return (
          <a key={i} href={LINKS[part]} target="_blank" rel="noopener noreferrer" className={linkClassName}>
            {parts[i + 1]}
          </a>
        );
      })}
    </p>
  );
}
