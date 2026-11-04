// A small card about E2EE Calendar, the hosted edition by the author of this
// app. It is only a link: this edition holds no code of the cloud and sends
// nothing anywhere; the page opens outside the app.
import { Cloud, ExternalLink } from 'lucide-react';
import { useT } from '@/i18n';
import { CLOUD_URL } from '@/lib/links';

export function CloudPromo({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  const t = useT();
  return (
    <aside
      aria-label={t('promo.cloud.title')}
      data-promo="cloud"
      className={`bg-bg text-text border-border-weak flex min-w-0 flex-col gap-3 rounded-2xl border text-pretty sm:flex-row sm:items-center ${compact ? 'p-4' : 'p-5'} ${className}`}
    >
      <span aria-hidden className="bg-primary-weak text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
        <Cloud size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.9375rem] leading-snug font-semibold">{t('promo.cloud.title')}</p>
        <p className="text-text-weak mt-1 text-[0.875rem] leading-relaxed">{t('promo.cloud.text')}</p>
      </div>
      <a
        href={CLOUD_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="border-border text-text hover:bg-bg-weak inline-flex h-[var(--field-h)] shrink-0 items-center justify-center gap-2 rounded-lg border px-4 text-[0.875rem] font-medium whitespace-nowrap transition-[color,background-color,border-color]"
      >
        {t('promo.cloud.action')}
        <ExternalLink size={16} aria-hidden />
      </a>
    </aside>
  );
}
