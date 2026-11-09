import { create } from 'zustand';
import type { EditScope, EventData, Occurrence, TaskData } from '@/lib/ical/types';
import { stepDate, viewRange } from '@/lib/date';
import { useSettings, type ViewType } from './settings';

/**
 * Which way the calendar last moved: 1 to a later period, -1 to an earlier
 * one, 0 for a change of view (or no move). The views slide their new period
 * in from that side (hooks/usePeriodTransition.ts).
 */
export type NavDir = -1 | 0 | 1;

/** A place in the calendar: a view and a date in the period it shows. */
export interface NavEntry {
  view: ViewType;
  date: Date;
}

/** How many places back the history reaches. */
export const NAV_HISTORY_MAX = 50;

export interface SetDateOptions {
  /**
   * False when the calendar only follows something else (the event being
   * created moved to another week): the place it leaves is not one the user
   * went to, so Back does not return there.
   */
  history?: boolean;
}

/** The first day of the period `view` shows around `date`: two dates show the same period when these are equal. */
function periodStart(view: ViewType, date: Date): number {
  const s = useSettings.getState();
  return viewRange(view, date, s.weekStartsOn, s.customDays).start.getTime();
}

/** Same view, same period. */
function samePlace(a: NavEntry, b: NavEntry): boolean {
  return a.view === b.view && periodStart(a.view, a.date) === periodStart(b.view, b.date);
}

/** The direction from one place to another of the same view (0 for another view or the same period). */
function direction(from: NavEntry, to: NavEntry): NavDir {
  if (from.view !== to.view) return 0;
  return Math.sign(periodStart(to.view, to.date) - periodStart(from.view, from.date)) as NavDir;
}

/**
 * The view in which the last moves were steps to the previous or next
 * period, or null. A run of such steps is one place in the history: Back
 * returns to where the run began, not through every period it passed.
 */
let stepRun: ViewType | null = null;

/**
 * True once the user picked the view shown in this session (a view button, a
 * shortcut, Back to another view). Until then the calendar shows the default
 * view and follows it when it changes in Settings (`followDefaultView`).
 */
let viewChosen = false;

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error' | 'success';
  action?: { label: string; run: () => void };
  /** What the toast is about, for taking it away early once that is no longer true (`dismissToasts`). */
  tag?: string;
}

export interface EventEditorState {
  mode: 'create' | 'edit';
  data: EventData;
  calendarId: string;
  occurrence?: Occurrence;
  /** Open with the custom repeat rule editor showing. */
  customRepeat?: boolean;
}

export interface TaskEditorState {
  mode: 'create' | 'edit';
  data: TaskData;
  calendarId: string;
  objectUrl?: string;
}

export interface PopoverState {
  occurrence: Occurrence;
  anchor: { x: number; y: number; width: number; height: number };
}

export interface QuickCreateState {
  /** One opening of the popover; the form starts fresh for each. */
  id: number;
  start: Date;
  end: Date;
  allDay: boolean;
  /** What the form holds so far, mirrored on the placeholder in the grid. */
  title: string;
  color?: string;
  /** Where the popover points when the grid shows no placeholder to attach to. */
  anchor?: { x: number; y: number; width: number; height: number };
}

export type QuickCreateInput = Pick<QuickCreateState, 'start' | 'end' | 'allDay' | 'anchor'>;

export interface ScopePrompt {
  kind: 'edit' | 'delete';
  allowFuture: boolean;
  resolve: (scope: EditScope | null) => void;
}

export interface ConfirmPrompt {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

export interface CalendarDialogState {
  calendarId?: string;
  kind: 'events' | 'tasks';
}

export type SettingsSection = 'account' | 'general' | 'appearance' | 'calendars' | 'tasks' | 'notifications' | 'import' | 'backup' | 'shortcuts' | 'about';

export interface OpenSettingsOptions {
  /** Phones: start on the list of sections rather than on `section` (the generic "Settings" entry). */
  list?: boolean;
}

/** Same breakpoint as `useIsMobile`: Settings shows one pane at a time below it. */
const PHONE_QUERY = '(max-width: 760px)';

interface UiState {
  view: ViewType;
  date: Date;
  /** Which way the last move went (see NavDir). */
  navDir: NavDir;
  /** Counts changes of view, so that a view that appears can tell it came from a switch (and animate). */
  viewSeq: number;
  /** Places the calendar was at before, oldest first: where the Android back button returns to. */
  navHistory: NavEntry[];
  sidebarOpen: boolean;
  popover: PopoverState | null;
  quickCreate: QuickCreateState | null;
  eventEditor: EventEditorState | null;
  taskEditor: TaskEditorState | null;
  settings: SettingsSection | null;
  /** Phones only: Settings shows its list of sections instead of `settings`. */
  settingsList: boolean;
  /** Phones only: the section on screen was opened from that list, so going back returns to it. */
  settingsFromList: boolean;
  searchOpen: boolean;
  searchQuery: string;
  shortcutsOpen: boolean;
  toasts: Toast[];
  scopePrompt: ScopePrompt | null;
  confirmPrompt: ConfirmPrompt | null;
  calendarDialog: CalendarDialogState | null;
  accountDialog: boolean;
  subscriptionDialog: boolean;
  holidaysDialog: boolean;

  setView: (view: ViewType) => void;
  /** Shows the period around `date` in the current view (Today, the date picker). */
  setDate: (date: Date, options?: SetDateOptions) => void;
  /** Shows `date`, in `view` when given (a tap on a day, a search result). Closes the drawer. */
  goTo: (date: Date, view?: ViewType) => void;
  /** The previous (-1) or next (1) period of the current view. */
  step: (dir: 1 | -1) => void;
  /**
   * Back to the place before the last move (the Android back button). False
   * when there is none: the calendar is where the user started.
   */
  navBack: () => boolean;
  /** Forgets where the calendar has been (the calendar closed). */
  clearNavHistory: () => void;
  setSidebarOpen: (open: boolean) => void;
  openPopover: (p: PopoverState | null) => void;
  openQuickCreate: (q: QuickCreateInput | null) => void;
  updateQuickCreate: (patch: Partial<Pick<QuickCreateState, 'start' | 'end' | 'allDay' | 'title' | 'color'>>) => void;
  openEventEditor: (e: EventEditorState | null) => void;
  openTaskEditor: (e: TaskEditorState | null) => void;
  /**
   * Opens Settings at `section` (on phones directly on it, unless `list`).
   * `null` steps back the way the back button does: on a phone, from a
   * section that was chosen in the list back to the list; otherwise Settings
   * closes. `closeSettings` always closes.
   */
  openSettings: (section: SettingsSection | null, options?: OpenSettingsOptions) => void;
  /** Phones: shows the list of sections, or the given section chosen from it. */
  showSettingsList: (show: boolean, section?: SettingsSection) => void;
  closeSettings: () => void;
  setSearch: (open: boolean, query?: string) => void;
  setShortcutsOpen: (open: boolean) => void;
  toast: (message: string, kind?: Toast['kind'], action?: Toast['action'], tag?: string) => void;
  dismissToast: (id: number) => void;
  /** Takes away every toast with this tag. */
  dismissToasts: (tag: string) => void;
  askScope: (kind: 'edit' | 'delete', allowFuture?: boolean) => Promise<EditScope | null>;
  confirm: (p: Omit<ConfirmPrompt, 'resolve'>) => Promise<boolean>;
  openCalendarDialog: (d: CalendarDialogState | null) => void;
  openAccountDialog: (open: boolean) => void;
  openSubscriptionDialog: (open: boolean) => void;
  openHolidaysDialog: (open: boolean) => void;
}

let toastId = 0;
let quickCreateId = 0;

/** The tag of the toasts that report a change of the settings (lib/saveFeedback.ts). */
export const SETTINGS_SAVE_TAG = 'settings-save';

/**
 * How long a toast stays, in milliseconds, or null for "until it is closed":
 * an error that offers something to do about it ("Try again") waits for the
 * user; the "Saved" of a change of the settings is brief; anything else with
 * a button (Undo) gets the time of an error.
 */
export function toastDuration(toast: Pick<Toast, 'kind' | 'action' | 'tag'>): number | null {
  if (toast.kind === 'error') return toast.action ? null : 8000;
  if (toast.action) return 8000;
  return toast.kind === 'success' && toast.tag === SETTINGS_SAVE_TAG ? 2500 : 4500;
}

export const useUi = create<UiState>()((set, get) => {
  /**
   * Moves the calendar to `next`, remembering where it was when that is a
   * different place. `stepping` marks a step to the previous or next period:
   * only the first of a run is remembered.
   */
  const move = (next: NavEntry, extra: Partial<UiState> = {}, { history = true, stepping = false }: { history?: boolean; stepping?: boolean } = {}) => {
    const s = get();
    const here: NavEntry = { view: s.view, date: s.date };
    const moved = !samePlace(here, next);
    let navHistory = s.navHistory;
    if (moved && history && !(stepping && stepRun === s.view)) {
      const last = navHistory[navHistory.length - 1];
      if (!last || !samePlace(last, here)) navHistory = [...navHistory, here].slice(-NAV_HISTORY_MAX);
    }
    if (moved) stepRun = stepping ? s.view : null;
    if (next.view !== s.view) viewChosen = true;
    set({
      view: next.view,
      date: next.date,
      navDir: direction(here, next),
      viewSeq: next.view !== s.view ? s.viewSeq + 1 : s.viewSeq,
      navHistory,
      popover: null,
      ...extra,
    });
  };

  return {
    view: useSettings.getState().defaultView,
    date: new Date(),
    navDir: 0,
    viewSeq: 0,
    navHistory: [],
    sidebarOpen: false,
    popover: null,
    quickCreate: null,
    eventEditor: null,
    taskEditor: null,
    settings: null,
    settingsList: false,
    settingsFromList: false,
    searchOpen: false,
    searchQuery: '',
    shortcutsOpen: false,
    toasts: [],
    scopePrompt: null,
    confirmPrompt: null,
    calendarDialog: null,
    accountDialog: false,
    subscriptionDialog: false,
    holidaysDialog: false,

    setView: (view) => move({ view, date: get().date }),
    setDate: (date, options) => move({ view: get().view, date }, {}, { history: options?.history ?? true }),
    goTo: (date, view) => move({ view: view ?? get().view, date }, { sidebarOpen: false }),
    step: (dir) => {
      const s = get();
      move({ view: s.view, date: stepDate(s.view, s.date, dir, useSettings.getState().customDays) }, {}, { stepping: true });
    },
    navBack: () => {
      const s = get();
      const back = s.navHistory[s.navHistory.length - 1];
      if (!back) return false;
      stepRun = null;
      set({
        view: back.view,
        date: back.date,
        navDir: direction({ view: s.view, date: s.date }, back),
        viewSeq: back.view !== s.view ? s.viewSeq + 1 : s.viewSeq,
        navHistory: s.navHistory.slice(0, -1),
        popover: null,
      });
      return true;
    },
    clearNavHistory: () => {
      stepRun = null;
      set({ navHistory: [] });
    },
    setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    openPopover: (popover) => set({ popover, quickCreate: null }),
    openQuickCreate: (q) => set({ quickCreate: q && { ...q, id: ++quickCreateId, title: '' }, popover: null }),
    updateQuickCreate: (patch) => set((s) => ({ quickCreate: s.quickCreate && { ...s.quickCreate, ...patch } })),
    openEventEditor: (eventEditor) => set({ eventEditor, popover: null, quickCreate: null }),
    openTaskEditor: (taskEditor) => set({ taskEditor, popover: null }),
    openSettings: (settings, options) => {
      if (settings) {
        set({ settings, settingsList: !!options?.list, settingsFromList: false, popover: null, sidebarOpen: false });
        return;
      }
      const s = get();
      const phone = typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches;
      if (phone && s.settings && !s.settingsList && s.settingsFromList) set({ settingsList: true, settingsFromList: false });
      else get().closeSettings();
    },
    showSettingsList: (show, section) =>
      set((s) => (show ? { settingsList: true, settingsFromList: false } : { settings: section ?? s.settings, settingsList: false, settingsFromList: true })),
    closeSettings: () => set({ settings: null, settingsList: false, settingsFromList: false }),
    setSearch: (searchOpen, searchQuery) => set({ searchOpen, searchQuery: searchQuery ?? (searchOpen ? get().searchQuery : '') }),
    setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
    toast: (message, kind = 'info', action, tag) => {
      const id = ++toastId;
      set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, kind, action, ...(tag ? { tag } : {}) }] }));
      const ms = toastDuration({ kind, action, tag });
      if (ms !== null) setTimeout(() => get().dismissToast(id), ms);
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    dismissToasts: (tag) => set((s) => (s.toasts.some((t) => t.tag === tag) ? { toasts: s.toasts.filter((t) => t.tag !== tag) } : {})),
    askScope: (kind, allowFuture = true) =>
      new Promise((resolve) => {
        set({
          scopePrompt: {
            kind,
            allowFuture,
            resolve: (scope) => {
              set({ scopePrompt: null });
              resolve(scope);
            },
          },
        });
      }),
    confirm: (p) =>
      new Promise((resolve) => {
        set({
          confirmPrompt: {
            ...p,
            resolve: (ok) => {
              set({ confirmPrompt: null });
              resolve(ok);
            },
          },
        });
      }),
    openCalendarDialog: (calendarDialog) => set({ calendarDialog, sidebarOpen: false }),
    openAccountDialog: (accountDialog) => set({ accountDialog, sidebarOpen: false }),
    openSubscriptionDialog: (subscriptionDialog) => set({ subscriptionDialog, sidebarOpen: false }),
    openHolidaysDialog: (holidaysDialog) => set({ holidaysDialog, sidebarOpen: false }),
  };
});

/**
 * Shows a new default view while the user has not picked one in this session:
 * the store took the default when it was made, before Settings changed it.
 * Only the view changes; the date and the way back stay.
 */
export function followDefaultView(defaultView: ViewType): void {
  if (viewChosen) return;
  const s = useUi.getState();
  if (s.view === defaultView) return;
  stepRun = null;
  useUi.setState({ view: defaultView, navDir: 0, viewSeq: s.viewSeq + 1, popover: null });
}

useSettings.subscribe((s, prev) => {
  if (s.defaultView !== prev.defaultView) followDefaultView(s.defaultView);
});

/** For tests: as at the start of a session, before the user picked a view. */
export function resetViewChosen(): void {
  viewChosen = false;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
