import { useEffect } from 'react';
import { canDeleteItems, useData } from '@/store/data';
import { useSettings, VIEWS } from '@/store/settings';
import { errorMessage, useUi } from '@/store/ui';
import { deleteOccurrence, openEditEvent, openNewTask, startNewEvent } from '@/lib/actions';
import { refreshNow } from '@/lib/autoSync';
import { t } from '@/i18n';
import { isModalOpen } from '@/components/ui/Modal';

/**
 * R: brings every account and feed up to date at once, although the app
 * does that by itself. Says nothing when it worked; a failure is said.
 */
export function refreshFromKey(): Promise<void> {
  return refreshNow().catch((err: unknown) => useUi.getState().toast(t('status.refreshFailed', { error: errorMessage(err) }), 'error'));
}

/** Keys pressed in a field, or anywhere in a form popover or menu, are not shortcuts. */
export function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || !!el.closest?.('[data-form-layer]'));
}

function anyOverlayOpen() {
  const ui = useUi.getState();
  return !!(
    ui.eventEditor ||
    ui.taskEditor ||
    ui.settings ||
    ui.searchOpen ||
    ui.shortcutsOpen ||
    ui.scopePrompt ||
    ui.confirmPrompt ||
    ui.calendarDialog ||
    ui.accountDialog ||
    ui.subscriptionDialog ||
    ui.holidaysDialog ||
    // Dialogs without a slice in the ui store.
    isModalOpen()
  );
}

/** The calendar's keyboard shortcuts (the list is in ShortcutsDialog). The arrows step by the period on screen, as the swipe does. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e) || anyOverlayOpen()) return;
      const ui = useUi.getState();
      const settings = useSettings.getState();
      // Letters are matched case-insensitively so Caps Lock does not break
      // them; Shift is what distinguishes "new task" from "new event".
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const view = VIEWS.find((v) => v.key.toLowerCase() === k || v.digit === k);
      // With an event's details open, E and Delete act on that event.
      const selected = ui.popover?.occurrence;
      const calendar = selected && useData.getState().calendars.find((c) => c.id === selected.calendarId);
      const editable = selected && !calendar?.readOnly;
      const deletable = selected && (!calendar || canDeleteItems(calendar));

      if (k === 't') ui.setDate(new Date());
      else if (k === 'ArrowLeft' || k === 'j') ui.step(-1);
      else if (k === 'ArrowRight' || k === 'k') ui.step(1);
      else if (view) ui.setView(view.id);
      else if (k === 'n' && e.shiftKey) openNewTask();
      else if (k === 'n' || k === 'c') {
        // The popover focuses its title at once; without this the letter would land in it.
        e.preventDefault();
        startNewEvent();
      }
      else if (k === 'e' && editable) openEditEvent(selected);
      else if ((k === 'Delete' || k === 'Backspace') && deletable) void deleteOccurrence(selected);
      else if (k === '/') {
        e.preventDefault();
        ui.setSearch(true);
      } else if (k === 'g') settings.update({ tasksPanelOpen: !settings.tasksPanelOpen });
      else if (k === 'r') void refreshFromKey();
      else if (k === 's') ui.openSettings('general');
      else if (k === '?') ui.setShortcutsOpen(true);
      else if (k === 'Escape') {
        ui.openPopover(null);
        ui.openQuickCreate(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
