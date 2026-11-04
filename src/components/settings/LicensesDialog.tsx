import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/Alert';
import { Button, Spinner } from '@/components/ui/Button';

/**
 * Written by scripts/third-party-notices.mjs before every build and shipped
 * as a static file, so the Android app has it offline and the service worker
 * keeps it once it has been opened. The version makes the address one of this
 * release, so a copy kept from another one never stands in for it.
 */
const NOTICES_URL = `${import.meta.env.BASE_URL}THIRD-PARTY-NOTICES.txt?v=${encodeURIComponent(__APP_VERSION__)}`;

/**
 * The file's rules of "=" and "-" are drawn as lines instead, so that they do
 * not wrap into two on a narrow screen. Captured, so they alternate with the text.
 */
const RULE_LINE = /\n?^(={20,}|-{20,})$\n?/m;

/** The file only changes with a new version of the app, so one read per session is enough. */
let cached: string | null = null;

async function loadNotices(): Promise<string> {
  if (cached !== null) return cached;
  const res = await fetch(NOTICES_URL);
  // A server that answers a missing file with the app shell must not put the page's HTML on screen.
  if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) throw new Error(`HTTP ${res.status}`);
  cached = await res.text();
  return cached;
}

/** The third-party notices: every bundled component with its copyright lines and licence text. */
export function LicensesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState(cached);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pre = useRef<HTMLPreElement>(null);
  // Text and rule lines, alternating.
  const parts = useMemo(() => text?.split(RULE_LINE) ?? [], [text]);

  useEffect(() => {
    if (!open || text !== null) return;
    let live = true;
    setFailed(false);
    loadNotices().then(
      (loaded) => live && setText(loaded),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [open, text, attempt]);

  // The text arrives after the dialog took the focus; it takes it over, unless
  // the focus has moved on (to the close button, say), so the keys scroll at once.
  useEffect(() => {
    if (!open || text === null) return;
    const active = document.activeElement;
    if (!active || active === document.body || active.getAttribute('role') === 'dialog') {
      pre.current?.focus({ preventScroll: true });
    }
  }, [open, text]);

  return (
    <Modal open={open} onClose={onClose} size="lg" fullscreenOnMobile title={t('settings.about.licenses')} initialFocus="[data-notices]">
      <p className="text-text-weak mb-3 text-[0.8125rem]">{t('settings.about.licensesIntro')}</p>
      {text !== null ? (
        // Focusable, so the arrow keys and Page Down scroll the dialog around it;
        // a document, so screen readers read it as text inside the dialog.
        <pre
          ref={pre}
          data-notices
          tabIndex={0}
          role="document"
          translate="no"
          aria-label={t('settings.about.licenses')}
          className="bg-bg-weak rounded-xl p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere select-text"
        >
          {parts.map((part, i) =>
            i % 2 ? <span key={i} aria-hidden className={`my-2 block border-t ${part.startsWith('=') ? 'border-border' : 'border-border-weak'}`} /> : <Fragment key={i}>{part}</Fragment>,
          )}
        </pre>
      ) : failed ? (
        <Alert
          tone="danger"
          actions={
            <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>
              {t('settings.about.licensesRetry')}
            </Button>
          }
        >
          {t('settings.about.licensesError')}
        </Alert>
      ) : (
        <div role="status" className="text-text-weak flex flex-col items-center gap-3 py-12 text-[0.8125rem]">
          <Spinner size={24} />
          <span>{t('settings.about.licensesLoading')}</span>
        </div>
      )}
    </Modal>
  );
}
