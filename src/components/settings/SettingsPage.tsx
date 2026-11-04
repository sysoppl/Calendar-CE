import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowLeft, Settings as SettingsIcon, Palette, CalendarDays, ListTodo, Bell, FileUp, Keyboard, Info, UserRound } from 'lucide-react';
import { useUi, errorMessage, type SettingsSection } from '@/store/ui';
import { useSettings } from '@/store/settings';
import { useData } from '@/store/data';
import { useT, type MessageKey } from '@/i18n';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useKeyboardUi } from '@/hooks/useKeyboardUi';
import { downloadText, mergeObjects, splitIcsFile } from '@/lib/importExport';
import { NotificationsSection } from './NotificationsSection';
import { LicensesDialog } from './LicensesDialog';
import { GeneralSection } from './GeneralSection';
import { AppearanceSection } from './AppearanceSection';
import { CalendarsSection } from './CalendarsSection';
import { TasksSection } from './TasksSection';
import { SELECT } from './styles';
import { LegalLinks } from '@/components/ui/LegalLinks';
import { AccountSection } from '@/components/account/AccountSection';
import { Button, IconButton } from '@/components/ui/Button';
import { SettingRow } from '@/components/ui/Controls';
import { isModalOpen } from '@/components/ui/Modal';
import { TOUCH_AREA, TOUCH_MIN_H } from '@/components/ui/touch';
import { LogoMark } from '@/components/layout/Logo';
import { Copyright } from '@/components/ui/Copyright';
import { CloudPromo } from '@/components/ui/CloudPromo';
import { SOURCE_URL } from '@/lib/links';
import { ShortcutList } from '@/components/ShortcutsDialog';

const SECTIONS: { id: SettingsSection; icon: ReactNode; key: MessageKey }[] = [
  { id: 'account', icon: <UserRound size={18} />, key: 'storage.section' },
  { id: 'general', icon: <SettingsIcon size={18} />, key: 'settings.section.general' },
  { id: 'appearance', icon: <Palette size={18} />, key: 'settings.section.appearance' },
  { id: 'calendars', icon: <CalendarDays size={18} />, key: 'settings.section.calendars' },
  { id: 'tasks', icon: <ListTodo size={18} />, key: 'settings.section.tasks' },
  { id: 'notifications', icon: <Bell size={18} />, key: 'settings.section.notifications' },
  { id: 'import', icon: <FileUp size={18} />, key: 'settings.section.import' },
  { id: 'shortcuts', icon: <Keyboard size={18} />, key: 'settings.section.shortcuts' },
  { id: 'about', icon: <Info size={18} />, key: 'settings.section.about' },
];

/** The sections on offer: the list of shortcuts only where there is a keyboard to use them with. */
export function settingsSections(keyboard: boolean): typeof SECTIONS {
  return keyboard ? SECTIONS : SECTIONS.filter((s) => s.id !== 'shortcuts');
}

export function SettingsPage() {
  const asked = useUi((s) => s.settings);
  const keyboard = useKeyboardUi();
  // Asked for a section that is not offered here (the shortcuts, on a phone): General instead.
  const section = asked && settingsSections(keyboard).some((s) => s.id === asked) ? asked : asked && 'general';
  // Mounted per opening, so each one captures the focus afresh.
  return section ? <SettingsOverlay section={section} sections={settingsSections(keyboard)} /> : null;
}

/**
 * Settings covers the whole app, so it behaves like a dialog: it takes the
 * focus, keeps the page behind it out of reach and gives the focus back when
 * it closes. Whatever is painted above it (toasts) stays usable.
 */
function useOverlayFocus(root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = root.current;
    const opener = document.activeElement as HTMLElement | null;
    const made: HTMLElement[] = [];
    for (const child of el?.parentElement?.children ?? []) {
      if (child === el || !(child instanceof HTMLElement) || child.hasAttribute('inert')) continue;
      const style = getComputedStyle(child);
      if (style.position === 'fixed' && Number(style.zIndex) > 30) continue;
      child.setAttribute('inert', '');
      made.push(child);
    }
    return () => {
      for (const child of made) child.removeAttribute('inert');
      const now = document.activeElement;
      if (now && now !== document.body && !el?.contains(now)) return;
      opener?.focus?.();
      // Opened by something that is gone (a drawer or menu that closed), by a
      // shortcut with nothing focused, or the opener cannot take the focus:
      // the header's way back into Settings takes it instead of the page.
      if (opener && opener !== document.body && opener.isConnected && document.activeElement === opener) return;
      const fallback = [...document.querySelectorAll<HTMLElement>('[data-settings-return]')].find((b) => !b.closest('[inert]'));
      fallback?.focus();
    };
  }, [root]);
}

function SettingsOverlay({ section, sections }: { section: SettingsSection; sections: typeof SECTIONS }) {
  const t = useT();
  const mobile = useIsMobile();
  const surface = useSettings((s) => s.surface);
  const list = useUi((s) => s.settingsList);
  const root = useRef<HTMLDivElement>(null);
  const contentHeading = useRef<HTMLHeadingElement>(null);
  const navItems = useRef(new Map<SettingsSection, HTMLButtonElement>());
  const titleId = useId();
  useOverlayFocus(root);

  // Phones show one pane at a time; from 761 px on both sit side by side.
  const showNav = !mobile || list;
  const showContent = !mobile || !list;

  // Onto the section on screen. A phone going back to the list lands on the
  // section it came from.
  useEffect(() => {
    if (showContent) contentHeading.current?.focus();
    else (navItems.current.get(useUi.getState().settings ?? 'account') ?? navItems.current.get('general'))?.focus();
  }, [showContent]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isModalOpen()) return;
      // An open menu or picker closes first.
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-floating-ui-portal], [aria-expanded="true"]')) return;
      useUi.getState().openSettings(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ui = useUi.getState();
  return (
    <div ref={root} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`animate-fade bg-frame text-frame-text pt-safe fixed inset-0 z-30 flex text-pretty ${TOUCH_AREA}`}>
      {showNav && (
        <nav aria-labelledby={titleId} className={`flex shrink-0 flex-col ${mobile ? 'w-full' : 'w-[var(--sidebar-width)]'}`}>
          {/* The headers are marked for the toasts, which keep clear of them (Toasts.tsx). */}
          <div data-dialog-header className="flex h-14 items-center gap-2 px-3">
            <IconButton tone="frame" label={t('settings.back')} onClick={() => ui.closeSettings()}>
              <ArrowLeft size={20} />
            </IconButton>
            <h1 id={titleId} className="text-lg font-semibold">
              {t('settings.title')}
            </h1>
          </div>
          <ul className="flex-1 overflow-y-auto px-3 py-1">
            {sections.map((s) => (
              <li key={s.id}>
                <button
                  ref={(el) => {
                    if (el) navItems.current.set(s.id, el);
                    else navItems.current.delete(s.id);
                  }}
                  type="button"
                  aria-current={section === s.id && !mobile ? 'page' : undefined}
                  onClick={() => (mobile ? ui.showSettingsList(false, s.id) : ui.openSettings(s.id))}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${TOUCH_MIN_H} ${
                    section === s.id && !mobile ? 'bg-frame-active font-semibold' : 'hover:bg-frame-hover'
                  }`}
                >
                  <span className="text-frame-weak">{s.icon}</span>
                  {t(s.key)}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {showContent && (
        <main
          aria-labelledby={`${titleId}-section`}
          className={`bg-bg text-text flex min-w-0 flex-1 flex-col overflow-hidden ${mobile ? '' : `mt-2 mr-2 ${surface === 'card' ? 'mb-2 rounded-xl' : 'rounded-t-xl'}`}`}
        >
          <div data-dialog-header className="flex h-14 shrink-0 items-center gap-2 px-4 sm:px-8">
            {mobile && (
              <>
                {/* Back to the list of sections, which is not the calendar. */}
                <IconButton label={t('settings.allSettings')} onClick={() => ui.showSettingsList(true)}>
                  <ArrowLeft size={20} />
                </IconButton>
                {/* The dialog's name, while the list that carries the title is not shown. */}
                <span id={titleId} className="sr-only">
                  {t('settings.title')}
                </span>
              </>
            )}
            <h2 ref={contentHeading} id={`${titleId}-section`} tabIndex={-1} className="min-w-0 truncate text-lg font-semibold outline-none">
              {t(SECTIONS.find((s) => s.id === section)!.key)}
            </h2>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(2.5rem+var(--safe-bottom))] sm:px-8">
            <div className="max-w-3xl">
              {section === 'account' && <AccountSection />}
              {section === 'general' && <GeneralSection />}
              {section === 'appearance' && <AppearanceSection />}
              {section === 'calendars' && <CalendarsSection />}
              {section === 'tasks' && <TasksSection />}
              {section === 'notifications' && <NotificationsSection />}
              {section === 'import' && <ImportSection />}
              {section === 'shortcuts' && <ShortcutList />}
              {section === 'about' && <AboutSection />}
            </div>
          </div>
        </main>
      )}
    </div>
  );
}

function ImportSection() {
  const t = useT();
  const calendars = useData((s) => s.calendars);
  const objects = useData((s) => s.objects);
  const writable = calendars.filter((c) => !c.readOnly);
  const [target, setTarget] = useState(writable[0]?.id ?? '');
  const [exportId, setExportId] = useState(calendars[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const ui = useUi();

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const items = splitIcsFile(await file.text());
      const cal = calendars.find((c) => c.id === target);
      const accepted = items.filter((i) => cal?.components.includes(i.kind === 'task' ? 'VTODO' : 'VEVENT'));
      const n = await useData.getState().importObjects(target, accepted);
      ui.toast(t('toast.imported', { n }), 'success');
    } catch (err) {
      ui.toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const exportCal = () => {
    const cal = calendars.find((c) => c.id === exportId);
    if (!cal) return;
    const ics = mergeObjects(Object.values(objects[cal.id] ?? {}), cal.name);
    downloadText(`${cal.name.replace(/[^\w\- ]+/g, '').trim() || 'calendar'}.ics`, ics);
  };

  return (
    <>
      <SettingRow label={t('settings.import')} hint={t('settings.importHint')}>
        {/* The whole width, so that on a phone both selects fill it alike, their buttons under them. */}
        <div className="flex w-full flex-wrap items-center gap-2">
          <select className={SELECT} value={target} onChange={(e) => setTarget(e.target.value)} aria-label={t('settings.importInto')}>
            {writable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input ref={fileRef} type="file" accept=".ics,text/calendar" hidden onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
          <Button icon={<FileUp size={16} />} loading={busy} onClick={() => fileRef.current?.click()} disabled={!target}>
            {t('settings.chooseFile')}
          </Button>
        </div>
      </SettingRow>
      <SettingRow label={t('settings.export')} hint={t('settings.exportHint')}>
        <div className="flex w-full flex-wrap items-center gap-2">
          <select className={SELECT} value={exportId} onChange={(e) => setExportId(e.target.value)} aria-label={t('settings.export')}>
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button onClick={exportCal}>{t('settings.download')}</Button>
        </div>
      </SettingRow>
    </>
  );
}

function AboutSection() {
  const t = useT();
  const [licensesOpen, setLicensesOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex items-center gap-3">
        <LogoMark size={56} />
        <div>
          <div className="text-xl font-semibold">{t('app.name')}</div>
          <div className="text-text-weak text-[0.8125rem]">{t('settings.version', { v: __APP_VERSION__ })}</div>
        </div>
      </div>
      <p>{t('settings.about.text')}</p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <button type="button" onClick={() => setLicensesOpen(true)} className={`text-primary flex items-center font-medium hover:underline ${TOUCH_MIN_H}`}>
          {t('settings.about.licenses')}
        </button>
        {/* AGPL-3.0: whoever uses the app over a network can get its source. */}
        <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className={`text-primary flex items-center font-medium hover:underline ${TOUCH_MIN_H}`}>
          {t('settings.about.source')}
        </a>
        <LegalLinks linkClassName={`text-primary flex items-center font-medium hover:underline ${TOUCH_MIN_H}`} />
      </div>
      <Copyright className="text-text-weak text-[0.8125rem]" linkClassName="text-primary hover:underline" />
      <CloudPromo compact />
      <LicensesDialog open={licensesOpen} onClose={() => setLicensesOpen(false)} />
    </div>
  );
}
