// What is open on the page, for the update check's question whether the app
// may be locked and the page loaded again without a word
// (src/lib/appUpdate/reload.ts), and the signals that it may have changed.
import type { ReloadProbe } from '@/lib/appUpdate/reload';
import { isDialogOpen } from '@/components/ui/Modal';
import { useData } from '@/store/data';
import { useUi } from '@/store/ui';

/** Text fields: what a person types into (not buttons, boxes or sliders). */
const TEXT_FIELDS = 'textarea, [contenteditable=""], [contenteditable="true"], input:not([type]), input[type="text"], input[type="email"], input[type="password"], input[type="search"], input[type="url"], input[type="tel"], input[type="number"]';

function isTextField(el: Element | null): boolean {
  return !!el && el instanceof HTMLElement && el.matches(TEXT_FIELDS) && !(el as HTMLInputElement).readOnly;
}

/**
 * Work under way that a reload would cut off without a word: a sync of any
 * account (it writes what was changed here to the CalDAV server). Moving
 * calendars between accounts runs in its own dialog, which counts as open
 * anyway.
 */
function workUnderWay(): boolean {
  return Object.values(useData.getState().syncing).some(Boolean);
}

/** The page as it is now. */
export function readReloadProbe(): ReloadProbe {
  const ui = useUi.getState();
  const overlayOpen = !!(
    ui.eventEditor ||
    ui.taskEditor ||
    ui.quickCreate ||
    ui.popover ||
    ui.settings ||
    ui.searchOpen ||
    ui.calendarDialog ||
    ui.accountDialog ||
    ui.subscriptionDialog ||
    ui.holidaysDialog ||
    ui.confirmPrompt ||
    ui.scopePrompt
  );
  const fields = typeof document === 'undefined' ? [] : [...document.querySelectorAll<HTMLElement>(TEXT_FIELDS)];
  const filled = fields.some((el) => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value !== '' : (el.textContent ?? '') !== ''));
  return {
    modalOpen: isDialogOpen(),
    overlayOpen,
    typing: typeof document !== 'undefined' && isTextField(document.activeElement),
    filled,
    working: workUnderWay(),
  };
}

/**
 * Calls `changed` whenever what `readReloadProbe` reads may have changed: the
 * interface's store (editors, Settings, prompts), the data store (syncs), a
 * dialog opened or closed (each is a child of <body>, as the toasts are), the
 * focus moving and text typed or cleared. No polling. Returns what stops it.
 */
export function watchReloadProbe(changed: () => void): () => void {
  const stops = [useUi.subscribe(changed), useData.subscribe((s, before) => s.syncing !== before.syncing && changed())];
  if (typeof document !== 'undefined') {
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(() => changed()) : null;
    observer?.observe(document.body, { childList: true });
    // After the event's own handlers ran (a field cleared by its form's reset, an editor closed by a click).
    const later = () => void setTimeout(changed, 0);
    const events = ['focusin', 'focusout', 'input', 'change', 'reset', 'submit'] as const;
    for (const name of events) document.addEventListener(name, later, true);
    stops.push(() => {
      observer?.disconnect();
      for (const name of events) document.removeEventListener(name, later, true);
    });
  }
  return () => {
    for (const stop of stops) stop();
  };
}
