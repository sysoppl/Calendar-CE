import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { X, AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { useUi, type Toast } from '@/store/ui';
import { useT } from '@/i18n';
import { useMediaQuery } from '@/hooks/useMediaQuery';

/** Below Tailwind's `sm`: where the toasts sit at the top of the screen. */
const PHONE = '(width < 40rem)';
/** Space between a dialog's header and the first toast. */
const GAP = 8;

/**
 * How far down the toasts move so that they stay off a dialog's title and
 * close button: 0 when, at the top of the screen, they would be clear of it
 * anyway. `pad` is where the first toast starts without the move, `height`
 * what the toasts take up together.
 */
export function toastOffset(header: { top: number; bottom: number }, pad: number, height: number): number {
  if (header.top >= pad + height + GAP) return 0;
  return Math.max(0, header.bottom + GAP - pad);
}

/**
 * The move for the headers on screen now: those of the dialog on top (the
 * dialogs under it are inert) marked with `data-dialog-header`.
 */
function measure(box: HTMLElement): number {
  const items = [...box.querySelectorAll(':scope > [data-toast]')].map((c) => c.getBoundingClientRect());
  if (!items.length) return 0;
  const pad = parseFloat(getComputedStyle(box).paddingTop) || 0;
  const height = items[items.length - 1].bottom - items[0].top;
  let offset = 0;
  for (const header of document.querySelectorAll<HTMLElement>('[data-dialog-header]')) {
    if (header.closest('[inert]')) continue;
    const r = header.getBoundingClientRect();
    if (r.height) offset = Math.max(offset, toastOffset(r, pad, height));
  }
  return offset;
}

/**
 * Keeps the move up to date while toasts are on screen: dialogs open, close
 * and settle (their entrance animation scales them) under the toasts.
 */
function useHeaderClearance(box: RefObject<HTMLDivElement | null>, active: boolean): number {
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    if (!active) {
      setOffset(0);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      if (box.current) setOffset(measure(box.current));
    };
    const soon = () => {
      frame ||= requestAnimationFrame(update);
    };
    update();
    const observer = new MutationObserver(soon);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', soon);
    document.addEventListener('animationend', soon, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', soon);
      document.removeEventListener('animationend', soon, true);
    };
  }, [box, active]);
  return offset;
}

/** How long a live region stays empty before the next message goes in, so that a screen reader notices the change. */
export const ANNOUNCE_GAP_MS = 100;

/**
 * What screen readers hear of the toasts. The two regions are always there,
 * so that a message written into them is announced reliably (a region added
 * together with its text often is not): errors into the assertive one,
 * everything else into the polite one. The region is emptied first and the
 * message goes in a moment later, so the same message twice ("Saved",
 * "Saved") is announced twice. The text is written straight into the region:
 * through React, the emptying and the message could land in one render,
 * which changes nothing a screen reader would hear. Of toasts that come
 * together, each region says the newest of its own. The focus never moves.
 */
function useAnnouncements(toasts: Toast[], polite: RefObject<HTMLDivElement | null>, assertive: RefObject<HTMLDivElement | null>): void {
  const last = useRef(0);
  useEffect(() => {
    const fresh = toasts.filter((toast) => toast.id > last.current);
    if (!fresh.length) return;
    last.current = fresh[fresh.length - 1].id;
    for (const [ref, errors] of [
      [polite, false],
      [assertive, true],
    ] as const) {
      const newest = [...fresh].reverse().find((toast) => (toast.kind === 'error') === errors);
      const region = ref.current;
      if (!newest || !region) continue;
      const id = String(newest.id);
      region.textContent = '';
      region.dataset.next = id;
      // Not called off when the list changes again: a toast closed at once
      // was still said. A newer message for the same region takes its place.
      setTimeout(() => {
        if (region.dataset.next === id) region.textContent = newest.message;
      }, ANNOUNCE_GAP_MS);
    }
  }, [toasts, polite, assertive]);
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const phone = useMediaQuery(PHONE);
  const offset = useHeaderClearance(box, phone && toasts.length > 0);
  const polite = useRef<HTMLDivElement>(null);
  const assertive = useRef<HTMLDivElement>(null);
  useAnnouncements(toasts, polite, assertive);
  return (
    // Phones show them at the top: at the bottom they would cover the
    // buttons of a dialog, a bottom sheet and the new-event button. Over an
    // open dialog they move below its header, clear of its title and close button.
    <div
      ref={box}
      style={offset ? { top: offset } : undefined}
      className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex flex-col items-center gap-2 p-4 pt-[calc(1rem+var(--safe-top))] sm:top-auto sm:bottom-0 sm:items-start sm:pt-4 sm:pb-[calc(1rem+var(--safe-bottom))] sm:pl-6"
    >
      {/* Inside the box, which stays usable over Settings (Settings marks what is under it inert). Their text is written by useAnnouncements. */}
      <div ref={polite} className="sr-only" aria-live="polite" aria-atomic="true" data-live="polite" />
      <div ref={assertive} className="sr-only" role="alert" aria-atomic="true" data-live="assertive" />
      {toasts.map((toast) => (
        <div
          key={toast.id}
          data-toast={toast.kind}
          className="animate-slide-up bg-bg-elevated border-border-weak text-text shadow-elevated pointer-events-auto flex max-w-[min(480px,100%)] items-center gap-3 rounded-xl border py-2.5 pr-2 pl-4"
        >
          {toast.kind === 'error' ? (
            <AlertCircle size={18} className="text-danger shrink-0" aria-hidden />
          ) : toast.kind === 'success' ? (
            <CheckCircle2 size={18} className="text-success shrink-0" aria-hidden />
          ) : (
            <Info size={18} className="text-primary shrink-0" aria-hidden />
          )}
          <span className="min-w-0 flex-1 text-[0.8125rem] break-words">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="text-primary hover:bg-primary-weak pointer-coarse:min-h-11 rounded-md px-2 py-1 text-[0.8125rem] font-semibold"
              onClick={() => {
                toast.action!.run();
                dismiss(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label={t('common.close')}
            className="text-text-weak hover:bg-bg-strong hover:text-text pointer-coarse:size-11 flex items-center justify-center rounded-md p-1"
            onClick={() => dismiss(toast.id)}
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
