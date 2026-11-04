import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useT } from '@/i18n';
import { IconButton } from './Button';
import { TOUCH_AREA } from './touch';

interface BaseProps {
  open: boolean;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Becomes a full-screen sheet on phones. */
  fullscreenOnMobile?: boolean;
  initialFocus?: string;
}

/**
 * With `dismissible={false}` the dialog has to be answered: no close button,
 * and Escape, the backdrop and the back button do nothing. Only its own
 * content can end it, so `onClose` is optional then.
 */
type ModalProps = BaseProps & ({ dismissible?: true; onClose: () => void } | { dismissible: false; onClose?: () => void });

interface OpenModal {
  /** The backdrop, a child of <body>. */
  root: HTMLElement;
  dismissible: () => boolean;
  close: () => void;
}

/** Open dialogs, bottom to top. */
const openModals: OpenModal[] = [];

/** Where a dialog that closed without returning the focus would have returned it; for the one that follows. */
let handover: HTMLElement | null = null;

/**
 * Closes the topmost dialog the way Escape would (for the Android back
 * button). False when none is open or the top one has to be answered;
 * `isModalOpen()` tells the two apart.
 */
export function closeTopModal(): boolean {
  const top = openModals[openModals.length - 1];
  if (!top?.dismissible()) return false;
  top.close();
  return true;
}

/** Whether a dialog is open, dismissible or not. */
export function isModalOpen(): boolean {
  return openModals.length > 0;
}

/** z-index of the dialog layer (`z-50` below). */
const LAYER = 50;

/** What this module made inert, so that only that is released again. */
let inerted = new Set<HTMLElement>();

/**
 * Makes the page behind the top dialog inert: out of reach for the pointer,
 * the keyboard and assistive technology. Whatever is painted above the dialog
 * layer stays usable, as it was before: the toasts, and a picker or menu that
 * is open over the dialog. A click on an inert element there would fall
 * through to the backdrop and close the dialog.
 */
function syncInert() {
  const top = openModals[openModals.length - 1];
  const next = new Set<HTMLElement>();
  if (top) {
    const above = [...document.querySelectorAll<HTMLElement>('.fixed, [data-floating-ui-portal] > *')];
    const keep = [top.root, ...above.filter((el) => Number(getComputedStyle(el).zIndex) > LAYER)];
    const visit = (parent: Element) => {
      for (const child of parent.children) {
        if (!(child instanceof HTMLElement) || keep.includes(child)) continue;
        if (keep.some((k) => child.contains(k))) visit(child);
        // Something that is inert for a reason of its own is not ours to release.
        else if (inerted.has(child) || !child.hasAttribute('inert')) next.add(child);
      }
    };
    visit(document.body);
  }
  for (const el of inerted) if (!next.has(el)) el.removeAttribute('inert');
  for (const el of next) el.setAttribute('inert', '');
  inerted = next;
}

const TABBABLE = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable=""], [contenteditable="true"]';

/** Where Tab stops inside `root`, in order. */
function tabStops(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => {
    if (el.tabIndex < 0 || el.matches(':disabled') || el.closest('[inert]')) return false;
    // Of a group of radio buttons only the chosen one is a stop.
    if (el instanceof HTMLInputElement && el.type === 'radio' && !el.checked) {
      const chosen = [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]:checked')];
      if (chosen.some((r) => r.name === el.name && r.form === el.form)) return false;
    }
    return el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : el.getClientRects().length > 0;
  });
}

/** Keeps Tab and Shift+Tab inside the dialog. */
function trapTab(e: KeyboardEvent, panel: HTMLElement) {
  const active = document.activeElement as HTMLElement | null;
  const stops = tabStops(panel);
  const moveTo = (el: HTMLElement | undefined) => {
    e.preventDefault();
    (el ?? panel).focus();
  };
  const edge = e.shiftKey ? stops[stops.length - 1] : stops[0];
  // A picker or menu opened from the dialog sits in a portal of its own: Tab
  // walks through it and then returns to the dialog.
  const scope = panel.contains(active) ? panel : active?.closest<HTMLElement>('[data-floating-ui-portal]');
  // The focus got away (a click on the backdrop or on a toast).
  if (!active || !scope) return moveTo(edge);
  const ahead = e.shiftKey ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING;
  // With another stop ahead the browser's own step stays inside.
  if ((scope === panel ? stops : tabStops(scope)).some((el) => active.compareDocumentPosition(el) & ahead)) return;
  moveTo(scope === panel ? edge : (panel.querySelector<HTMLElement>('[aria-expanded="true"]') ?? edge));
}

const SIZES = { sm: 'max-w-[400px]', md: 'max-w-[520px]', lg: 'max-w-[680px]' };

export function Modal({ open, onClose, dismissible = true, title, children, footer, size = 'md', fullscreenOnMobile = false, initialFocus }: ModalProps) {
  const t = useT();
  const titleId = useId();
  const backdrop = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  // Captured during render, i.e. before an autoFocus child takes the focus.
  const prevFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) prevFocus.current = document.activeElement as HTMLElement | null;
  wasOpen.current = open;

  useEffect(() => {
    if (!open || !backdrop.current) return;
    const entry: OpenModal = { root: backdrop.current, dismissible: () => dismissibleRef.current, close: () => onCloseRef.current?.() };
    // When one dialog replaces another, the element captured above went away
    // with the old one. That one has either passed on where it would have
    // returned the focus to, or has returned it there already.
    let restore = prevFocus.current;
    if (!restore?.isConnected) {
      const now = document.activeElement as HTMLElement | null;
      restore = handover ?? (now && now !== document.body && !entry.root.contains(now) ? now : null);
      // Kept for a second run of this effect (React repeats it in development).
      prevFocus.current = restore;
    }
    handover = null;
    openModals.push(entry);
    syncInert();
    requestAnimationFrame(() => {
      const target = initialFocus ? panel.current?.querySelector<HTMLElement>(initialFocus) : null;
      if (target) target.focus();
      // Leave the focus alone when a child (autoFocus) already has it.
      else if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      // Only the topmost dialog reacts, so Escape closes one layer at a time.
      if (openModals[openModals.length - 1] !== entry || !panel.current) return;
      if (e.key === 'Tab') trapTab(e, panel.current);
      else if (e.key === 'Escape' && dismissibleRef.current) {
        // A dropdown or picker opened from the dialog closes first.
        const target = e.target as HTMLElement;
        const layer = target.closest?.('[role="dialog"],[role="menu"],[role="listbox"]');
        if (target.closest?.('[aria-expanded="true"]') || (layer && layer !== panel.current)) return;
        e.stopImmediatePropagation();
        onCloseRef.current?.();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      openModals.splice(openModals.indexOf(entry), 1);
      // Before the focus goes back: an inert element cannot take it.
      syncInert();
      const now = document.activeElement;
      // Gone with the dialog: back to where it came from.
      if (!now || now === document.body) restore?.focus?.();
      // Somewhere else by now, e.g. on the default button of the dialog that
      // follows this one: it stays there. (Still inside this dialog means the
      // dialog is not really closing: React re-runs effects in development.)
      else if (!entry.root.contains(now)) handover = restore;
    };
  }, [open, initialFocus]);

  if (!open) return null;
  // A full-screen sheet reaches the screen edges, so it pads for the notch
  // and the gesture bar itself.
  const sheet = fullscreenOnMobile;
  const mobile = sheet ? 'max-sm:h-full max-sm:max-h-none max-sm:max-w-none max-sm:rounded-none' : 'max-sm:max-h-[calc(100%-1.5rem)]';

  return createPortal(
    <div
      ref={backdrop}
      className={`animate-fade fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 ${sheet ? 'max-sm:p-0' : ''}`}
      style={{ background: 'var(--backdrop)' }}
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        // Otherwise the press takes the focus away: out of a dialog that
        // stays, or from the element it has just been returned to.
        e.preventDefault();
        if (dismissible) onClose?.();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title !== undefined ? titleId : undefined}
        tabIndex={-1}
        className={`animate-pop bg-bg-elevated text-text shadow-elevated flex max-h-[calc(100%-2rem)] w-full flex-col overflow-hidden rounded-2xl text-pretty outline-none ${TOUCH_AREA} ${SIZES[size]} ${mobile}`}
      >
        {title !== undefined && (
          // Marked for the toasts, which keep clear of it (Toasts.tsx).
          <div data-dialog-header className={`flex items-center gap-3 px-4 pt-4 pb-2 sm:px-6 sm:pt-5 ${sheet ? 'max-sm:pt-[calc(0.75rem+var(--safe-top))]' : ''}`}>
            {/* The padding stands in for the close button, so every dialog's title sits at the same height. */}
            <h2 id={titleId} className={`min-w-0 flex-1 truncate text-lg font-semibold ${dismissible ? '' : 'py-1'}`}>
              {title}
            </h2>
            {dismissible && (
              <IconButton label={t('common.close')} onClick={onClose} className="-mr-2">
                <X size={20} />
              </IconButton>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-6">{children}</div>
        {footer && (
          <div className={`flex flex-wrap items-center justify-end gap-2 px-4 pt-3 pb-4 sm:px-6 sm:pb-5 ${sheet ? 'max-sm:pb-[calc(1rem+var(--safe-bottom))]' : ''}`}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
