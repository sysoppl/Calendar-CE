// What is open on the page, for the update check's question whether the page
// may be loaded again without a word (src/lib/appUpdate/reload.ts).
import type { ReloadProbe } from '@/lib/appUpdate/reload';
import { isDialogOpen } from '@/components/ui/Modal';
import { useUi } from '@/store/ui';

/** Text fields: what a person types into (not buttons, boxes or sliders). */
const TEXT_FIELDS = 'textarea, [contenteditable=""], [contenteditable="true"], input:not([type]), input[type="text"], input[type="email"], input[type="password"], input[type="search"], input[type="url"], input[type="tel"], input[type="number"]';

function isTextField(el: Element | null): boolean {
  return !!el && el instanceof HTMLElement && el.matches(TEXT_FIELDS) && !(el as HTMLInputElement).readOnly;
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
  };
}
