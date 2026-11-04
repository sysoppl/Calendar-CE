// The copyright line of About: the year, the maker's
// site as a link (<home>…</home> in the text) and the reservation.
import { useT } from '@/i18n';
import { HOME_URL } from '@/lib/links';

export function Copyright({ className = '', linkClassName = '' }: { className?: string; linkClassName?: string }) {
  const t = useT();
  const [before, name, after] = t('settings.about.copyright').split(/<home>(.*?)<\/home>/);
  return (
    <p className={className}>
      {before}
      {name !== undefined && (
        <a href={HOME_URL} target="_blank" rel="noopener noreferrer" className={linkClassName}>
          {name}
        </a>
      )}
      {after}
    </p>
  );
}
