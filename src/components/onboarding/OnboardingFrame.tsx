import { useId, type ReactNode } from 'react';
import { ArrowLeft, Languages } from 'lucide-react';
import { LANGS, LANGUAGE_NAMES, languageChoice, useLang, useT, type Lang } from '@/i18n';
import { useSettings } from '@/store/settings';
import { LogoMark } from '@/components/layout/Logo';
import { LegalLinks } from '@/components/ui/LegalLinks';
import { TOUCH_AREA, TOUCH_MIN_H } from '@/components/ui/touch';
import { useTypeset } from './typeset';

export function LanguageSwitch() {
  const t = useT();
  const choice = useSettings((s) => s.deviceLanguage || s.language);
  const lang = useLang();
  // 'auto' shows as the language it found, which is what the person sees.
  const value = choice === 'auto' ? lang : choice;
  return (
    <label className="border-frame-border focus-within:ring-primary relative flex items-center rounded-lg border focus-within:ring-2">
      <Languages size={16} className="text-frame-weak pointer-events-none absolute left-2.5 shrink-0" aria-hidden />
      <span className="sr-only">{t('welcome.language')}</span>
      <select
        value={value}
        lang={value}
        onChange={(e) => void languageChoice(e.target.value as Lang).then((patch) => useSettings.getState().update(patch))}
        className="text-frame-text min-h-[max(2rem,var(--touch,0px))] cursor-pointer appearance-none rounded-lg bg-transparent py-1 pr-3 pl-8 text-[0.8125rem] font-medium outline-none"
      >
        {LANGS.map((l) => (
          <option key={l} value={l} lang={l} className="bg-bg text-text">
            {LANGUAGE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The page the first start happens on: the app's frame colour edge to edge,
 * a top bar with a way back (on the steps after the first) and the language,
 * and room for the content. It scrolls on its own, as the body does not.
 * The operator's legal links, when the build names them, close the page.
 */
export function OnboardingFrame({
  onBack,
  backLabel,
  backDisabled = false,
  brand = true,
  actions,
  legal = true,
  wide = false,
  bare = false,
  children,
}: {
  onBack?: () => void;
  backLabel?: string;
  /** While something runs that cannot be left half-way. */
  backDisabled?: boolean;
  /** The app's name in the corner, where there is no way back; left out when the page shows it larger. */
  brand?: boolean;
  /** Buttons in the top bar, before the language. */
  actions?: ReactNode;
  /** Left out where the page has a footer of its own with the same links. */
  legal?: boolean;
  /** More room on large screens, for three cards side by side. */
  wide?: boolean;
  /** Only the scrolling page: the content brings its own bar, widths and foot. */
  bare?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  // Pretty wrapping is inherited: no word is left alone on the last line of a paragraph.
  const page = `bg-frame text-frame-text pt-safe h-full overflow-y-auto text-pretty ${TOUCH_AREA}`;
  if (bare) return <div className={page}>{children}</div>;
  return (
    <div className={page}>
      <div className={`mx-auto flex min-h-full w-full flex-col px-4 pb-[calc(2.5rem+var(--safe-bottom))] sm:px-8 ${wide ? 'max-w-7xl' : 'max-w-6xl'}`}>
        <header className="flex h-16 shrink-0 items-center justify-between gap-3">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              disabled={backDisabled}
              className={`text-frame-text hover:bg-frame-hover -ml-2 inline-flex h-9 min-w-0 items-center gap-1.5 rounded-lg px-2 text-[0.8125rem] font-medium transition-colors disabled:opacity-50 disabled:hover:bg-transparent ${TOUCH_MIN_H}`}
            >
              <ArrowLeft size={18} className="shrink-0" aria-hidden />
              <span className="truncate">{backLabel ?? t('welcome.back')}</span>
            </button>
          ) : brand ? (
            <span className="flex min-w-0 items-center gap-2 text-[0.9375rem] font-semibold tracking-tight">
              <LogoMark size={24} />
              <span className="truncate">{t('app.name')}</span>
            </span>
          ) : (
            <span />
          )}
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            {actions}
            <LanguageSwitch />
          </div>
        </header>
        {/* Whatever is shorter than the screen sits in the middle of it. */}
        <main className="flex flex-1 flex-col sm:py-4">{children}</main>
        {legal && (
          <LegalLinks
            className="text-frame-weak mt-6 flex justify-center text-[0.8125rem]"
            linkClassName={`hover:text-frame-text inline-flex items-center underline-offset-2 hover:underline ${TOUCH_MIN_H}`}
          />
        )}
      </div>
    </div>
  );
}

interface StepCardProps {
  icon: ReactNode;
  title: ReactNode;
  intro?: ReactNode;
  children?: ReactNode;
  /** Buttons; the primary one last. Shown full width, primary on top. */
  actions?: ReactNode;
  links?: ReactNode;
  wide?: boolean;
}

/** One step after the welcome screen: a single card in the middle of the page. */
export function StepCard({ icon, title, intro, children, actions, links, wide = false }: StepCardProps) {
  const titleId = useId();
  const ts = useTypeset();
  return (
    <section
      aria-labelledby={titleId}
      className={`bg-bg text-text border-border-weak mx-auto mt-1 mb-6 w-full rounded-2xl border p-5 sm:my-auto sm:p-8 ${wide ? 'max-w-[36rem]' : 'max-w-[28rem]'}`}
    >
      <span aria-hidden className="bg-primary-weak text-primary flex h-11 w-11 items-center justify-center rounded-full">
        {icon}
      </span>
      <h1 id={titleId} className="mt-4 text-xl leading-snug font-semibold tracking-tight">
        {title}
      </h1>
      {intro && <p className="text-text-weak mt-1.5 text-pretty">{typeof intro === 'string' ? ts(intro) : intro}</p>}
      {children && <div className="mt-6">{children}</div>}
      {actions && <div className="mt-6 flex flex-col-reverse gap-2 [&>button]:w-full">{actions}</div>}
      {links && <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">{links}</div>}
    </section>
  );
}
