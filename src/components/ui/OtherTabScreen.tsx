import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AlertCircle, AppWindow, RotateCw } from 'lucide-react';
import { en, type MessageKey } from '@/i18n/en';
import { pl } from '@/i18n/pl';
import { pickLang, type Lang } from '@/i18n/languages';
import { loadLocale } from '@/i18n/locales/load';
import { DEFAULT_LIGHT_THEME, applyTheme, themeById } from '@/theme/themes';
import { Button } from './Button';
import { TOUCH_AREA } from './touch';

const SETTINGS_KEY = 'calendar.settings';

/** What the settings store keeps, read without loading it: that is the running copy's to do (see `@/lib/instance`). */
function storedSettings(): Record<string, unknown> {
  try {
    const state: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null')?.state;
    return state && typeof state === 'object' ? (state as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The interface language as `resolveLang` in `@/i18n` finds it, which would load the store. */
function language(settings: Record<string, unknown>): Lang {
  return pickLang(settings.language, settings.deviceLanguage);
}

/** The texts of `lang`: English until the dictionary of an extra language has loaded. */
function useTexts(lang: Lang): Partial<Record<MessageKey, string>> {
  const [extra, setExtra] = useState<Partial<Record<MessageKey, string>>>();
  useEffect(() => {
    if (lang === 'en' || lang === 'pl') return;
    let alive = true;
    void loadLocale(lang).then((module) => {
      if (alive && module) setExtra(module.messages);
    });
    return () => {
      alive = false;
    };
  }, [lang]);
  return lang === 'pl' ? pl : lang === 'en' ? en : (extra ?? en);
}

/**
 * The theme chosen in the settings, so that the page looks like the app: the
 * one theme, light by default, unless "Sync with system" was chosen.
 */
function useStoredTheme(settings: Record<string, unknown>) {
  useEffect(() => {
    try {
      const text = (key: string) => (typeof settings[key] === 'string' ? (settings[key] as string) : '');
      const system = text('themeMode') === 'system';
      const dark = system && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
      const id = system ? text(dark ? 'darkTheme' : 'lightTheme') : text('theme') || DEFAULT_LIGHT_THEME;
      if (id) applyTheme(themeById(id), text('accentColor'));
    } catch {
      // The default look, then.
    }
  }, [settings]);
}

/** The texts of the page in the language of the settings, its theme, the document's language and title. */
function useStartPage() {
  const [settings] = useState(storedSettings);
  const lang = language(settings);
  const texts = useTexts(lang);
  const t = (key: MessageKey) => texts[key] ?? en[key];
  const heading = useRef<HTMLHeadingElement>(null);
  useStoredTheme(settings);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = texts['app.name'] ?? en['app.name'];
    heading.current?.focus();
  }, [lang, texts]);
  return { t, heading };
}

function StartCard({ icon, title, body, heading, children }: { icon: ReactNode; title: string; body: string; heading: RefObject<HTMLHeadingElement | null>; children: ReactNode }) {
  return (
    <div className={`bg-frame text-frame-text pt-safe flex h-full overflow-y-auto text-pretty ${TOUCH_AREA}`}>
      <main className="m-auto w-full max-w-[28rem] px-4 py-10">
        <section aria-labelledby="start-card-title" className="bg-bg text-text border-border-weak rounded-2xl border p-5 sm:p-8">
          <span aria-hidden className="bg-primary-weak text-primary flex h-11 w-11 items-center justify-center rounded-full">
            {icon}
          </span>
          <h1 ref={heading} id="start-card-title" tabIndex={-1} className="mt-4 text-xl leading-snug font-semibold tracking-tight outline-none">
            {title}
          </h1>
          <p className="text-text-weak mt-1.5">{body}</p>
          {children}
        </section>
      </main>
    </div>
  );
}

/**
 * The page shown while the app runs in another tab or window of this
 * browser: why it does not run here too, and a button that moves it here.
 * Depends on nothing that loads the app's stores.
 */
export function OtherTabScreen({ onUseHere }: { onUseHere: () => void }) {
  const { t, heading } = useStartPage();
  const [asked, setAsked] = useState(false);
  return (
    <StartCard icon={<AppWindow size={22} />} title={t('app.otherTab.title')} body={t('app.otherTab.body')} heading={heading}>
      <Button
        variant="primary"
        className="mt-6 w-full"
        loading={asked}
        onClick={() => {
          if (asked) return;
          setAsked(true);
          onUseHere();
        }}
      >
        {asked ? t('app.otherTab.switching') : t('app.otherTab.useHere')}
      </Button>
    </StartCard>
  );
}

/** The page shown when the app itself could not be loaded (`main.tsx`): the failure page has not loaded either. */
export function LoadFailedScreen() {
  const { t, heading } = useStartPage();
  return (
    <StartCard icon={<AlertCircle size={22} />} title={t('app.failure.title')} body={t('app.failure.render')} heading={heading}>
      <Button variant="primary" className="mt-6 w-full" icon={<RotateCw size={16} />} onClick={() => window.location.reload()}>
        {t('app.failure.reload')}
      </Button>
    </StartCard>
  );
}
