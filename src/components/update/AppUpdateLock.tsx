import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CircleArrowUp, Download, RefreshCw } from 'lucide-react';
import { useT } from '@/i18n';
import { ANDROID_UPDATE, updateNow, useAppUpdate } from '@/lib/appUpdate';
import { Button } from '@/components/ui/Button';
import { setAppLock, trapTab } from '@/components/ui/Modal';
import { TOUCH_AREA } from '@/components/ui/touch';

const LINK = 'bg-primary text-primary-contrast hover:bg-primary-hover mt-6 inline-flex h-[var(--field-h)] w-full items-center justify-center gap-2 rounded-lg px-4 font-medium';

/**
 * The whole app, locked while a newer version is known (src/lib/appUpdate):
 * on top of every screen and dialog, for the device's calendars as much as
 * for CalDAV ones. It cannot be put away (no close, no Escape, no back
 * button, no way out but the update) and keeps the focus; what is open under
 * it stays as it was. One button per channel: the browser loads the new
 * version, the Android app built with a server links the download of the
 * new APK (VITE_ANDROID_URL). Nothing the server answered is shown: only this
 * copy's own version, as text.
 */
export function AppUpdateLock({ downloadUrl = ANDROID_UPDATE.downloadUrl }: { downloadUrl?: string }) {
  const locked = useAppUpdate((s) => s.locked);
  // Never a notice without something to do: the Android channel exists only with a download address.
  const waiting = useAppUpdate((s) => s.waiting && s.channel !== 'none' && (s.channel !== 'android' || !!downloadUrl));
  if (locked) return <Lock downloadUrl={downloadUrl} />;
  return waiting ? <Waiting /> : null;
}

/**
 * A newer version waits until nothing open would be lost (the controller's
 * `waiting`): a small notice at the top that takes no tap and no focus, above
 * the dialogs, so that the person can save or close what they are doing.
 */
function Waiting() {
  const t = useT();
  return createPortal(
    // Above the dialogs' layer (50), so that an open dialog leaves it readable (Modal.tsx keeps such elements out of `inert`).
    <div data-app-update-waiting style={{ zIndex: 60 }} className="pointer-events-none fixed inset-x-0 top-0 flex justify-center px-4 pt-[calc(0.5rem+var(--safe-top))]">
      <p role="status" className="bg-bg-elevated border-border-weak text-text shadow-elevated flex max-w-[min(28rem,100%)] items-center gap-2 rounded-xl border px-3 py-2 text-[0.8125rem]">
        <CircleArrowUp size={16} className="text-primary shrink-0" aria-hidden />
        <span className="min-w-0 break-words">{t('app.update.waiting')}</span>
      </p>
    </div>,
    document.body,
  );
}

function Lock({ downloadUrl }: { downloadUrl: string }) {
  const t = useT();
  const { channel, busy } = useAppUpdate();
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    setAppLock(el);
    heading.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') trapTab(e, el);
      else if (e.key === 'Escape') {
        // Seen first (the window, capturing): no menu, picker or dialog under the lock hears it.
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      setAppLock(null);
    };
  }, []);

  // Never locked without something to do: the Android channel exists only with a download address.
  if (channel === 'none' || (channel === 'android' && !downloadUrl)) return null;

  const action =
    channel === 'android' ? (
      <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className={LINK} data-update-action="download">
        <Download size={16} aria-hidden />
        {t('app.update.download')}
      </a>
    ) : (
      <Button variant="primary" className="mt-6 w-full" icon={<RefreshCw size={16} />} loading={busy} data-update-action="reload" onClick={() => void updateNow()}>
        {t(busy ? 'app.update.reloading' : 'app.update.reload')}
      </Button>
    );

  return createPortal(
    <div ref={root} role="alertdialog" aria-modal="true" aria-labelledby="app-update-title" aria-describedby="app-update-text" data-app-update-lock={channel} className={`bg-frame text-frame-text pt-safe fixed inset-0 z-[100] flex overflow-y-auto text-pretty ${TOUCH_AREA}`}>
      <main className="m-auto w-full max-w-[28rem] px-4 py-10">
        <section className="bg-bg text-text border-border-weak rounded-2xl border p-5 sm:p-8">
          <span aria-hidden className="bg-primary-weak text-primary flex h-11 w-11 items-center justify-center rounded-full">
            <CircleArrowUp size={22} />
          </span>
          <h1 ref={heading} id="app-update-title" tabIndex={-1} className="mt-4 text-xl leading-snug font-semibold tracking-tight outline-none">
            {t('app.update.title')}
          </h1>
          <p id="app-update-text" className="text-text-weak mt-1.5">
            {t(channel === 'android' ? 'app.update.text.direct' : 'app.update.text.web')}
          </p>
          <p className="text-text-weak mt-3 text-[0.8125rem]">{t('app.update.version', { version: __APP_VERSION__ })}</p>
          {action}
        </section>
      </main>
    </div>,
    document.body,
  );
}
