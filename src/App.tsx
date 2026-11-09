import { useEffect, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { useApp } from '@/store/app';
import { useData } from '@/store/data';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { useIsNarrow } from '@/hooks/useMediaQuery';
import { useFormat } from '@/hooks/useFormat';
import { useKeyboardDetection } from '@/hooks/useKeyboardUi';
import { useT } from '@/i18n';
import { isNative } from '@/lib/platform';
import { tellFirstScreen } from '@/lib/display';
import { startReminders } from '@/lib/reminders';
import { startNotificationAccess } from '@/lib/notificationAccess';
import { useAppearance } from '@/app/useAppearance';
import { useAutoSync } from '@/app/useAutoSync';
import { useShortcuts } from '@/app/useShortcuts';
import { useSaveFeedback } from '@/lib/saveFeedback';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { AppRail } from '@/components/layout/AppRail';
import { Fab } from '@/components/layout/Fab';
import { ViewBar } from '@/components/layout/ViewBar';
import { PermissionNotice } from '@/components/settings/PermissionNotice';
import { DeviceStorageNotices, StorageRiskDialog } from '@/components/storage/DeviceStorage';
import { CalendarView } from '@/components/views/CalendarView';
import { SyncActivity } from '@/components/views/SyncActivity';
import { EventPopover } from '@/components/events/EventPopover';
import { QuickCreate } from '@/components/events/QuickCreate';
import { EventEditor } from '@/components/events/EventEditor';
import { TasksPanel } from '@/components/tasks/TasksPanel';
import { TaskEditor } from '@/components/tasks/TaskEditor';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { AccountDialog } from '@/components/settings/AccountDialog';
import { CalendarDialog } from '@/components/settings/CalendarDialog';
import { SubscriptionDialog } from '@/components/settings/SubscriptionDialog';
import { HolidaysDialog } from '@/components/settings/HolidaysDialog';
import { SearchOverlay } from '@/components/SearchOverlay';
import { ShortcutsDialog } from '@/components/ShortcutsDialog';
import { Toasts } from '@/components/ui/Toasts';
import { ErrorBoundary, ErrorScreen, errorCode, logFailure } from '@/components/ui/ErrorScreen';
// For `main.tsx`, which loads this file only once the page may run the app.
export { ROOT_ERROR_OPTIONS } from '@/components/ui/ErrorScreen';
import { ConfirmDialog, ScopeDialog } from '@/components/ui/Prompts';
import { StartingScreen } from '@/components/ui/StartingScreen';
import { closeTopModal, isModalOpen } from '@/components/ui/Modal';
import { closeTopFloating } from '@/components/ui/Menu';
import { BACK_DEPTH, handleBackButton, useBackButtonLayer } from '@/components/onboarding/back';
import { Onboarding } from '@/components/onboarding/Onboarding';

/** Tab title: the month being shown, then the app's name ("October 2026 | Calendar"). */
function useTabTitle() {
  const date = useUi((s) => s.date);
  const fmt = useFormat();
  const t = useT();
  const month = fmt.date(date, { month: 'long', year: 'numeric' });
  const title = `${month.charAt(0).toUpperCase()}${month.slice(1)} | ${t('app.name')}`;
  useEffect(() => {
    document.title = title;
  }, [title]);
}

/**
 * Android hardware back button: an open menu or picker first, then the top
 * dialog (one that must be answered keeps the press), then whatever screen is
 * showing, deepest layer first (see components/onboarding/back.ts); in the
 * calendar the last layer goes back through the views and dates it showed.
 * With nothing left to close the app is minimised.
 */
function useBackButton() {
  useEffect(() => {
    if (!isNative) return;
    const handle = CapApp.addListener('backButton', () => {
      if (closeTopFloating() || closeTopModal() || isModalOpen()) return;
      if (!handleBackButton()) void CapApp.minimizeApp();
    });
    return () => void handle.then((h) => h.remove());
  }, []);
}

/** The calendar's own layers for the back button, under any dialog. */
function useShellBackButton() {
  useBackButtonLayer(BACK_DEPTH.shell, () => {
    const ui = useUi.getState();
    const settings = useSettings.getState();
    // Dialogs, normally closed through the Modal stack before this is asked.
    if (ui.confirmPrompt) ui.confirmPrompt.resolve(false);
    else if (ui.scopePrompt) ui.scopePrompt.resolve(null);
    else if (ui.eventEditor) ui.openEventEditor(null);
    else if (ui.taskEditor) ui.openTaskEditor(null);
    else if (ui.calendarDialog) ui.openCalendarDialog(null);
    else if (ui.accountDialog) ui.openAccountDialog(false);
    else if (ui.subscriptionDialog) ui.openSubscriptionDialog(false);
    else if (ui.holidaysDialog) ui.openHolidaysDialog(false);
    else if (ui.searchOpen) ui.setSearch(false);
    else if (ui.shortcutsOpen) ui.setShortcutsOpen(false);
    else if (ui.popover || ui.quickCreate) {
      ui.openPopover(null);
      ui.openQuickCreate(null);
    } else if (ui.settings) ui.openSettings(null);
    else if (ui.sidebarOpen) ui.setSidebarOpen(false);
    else if (settings.tasksPanelOpen) settings.update({ tasksPanelOpen: false });
    else return false;
    return true;
  });
}

type Screen = 'failed' | 'loading' | 'onboarding' | 'shell';

/** The app, with a page that says so when drawing any part of it fails instead of a blank one. */
export function App() {
  return (
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  );
}

/**
 * The root: appearance, toasts, prompts and which screen is up. The calendar
 * (the shell) starts only after the welcome screen, so nothing syncs,
 * schedules reminders or listens for shortcuts behind it.
 */
function Root() {
  const t = useT();
  useAppearance();
  useKeyboardDetection();
  useBackButton();
  // When the start began, for the loading screen to tell a start that takes long.
  const [startedAt] = useState(() => Date.now());
  // Set when the start failed: the loading screen would otherwise stay for good.
  const [failed, setFailed] = useState<string | null>(null);
  const hydrated = useData((s) => s.hydrated);
  const onboarded = useApp((s) => s.onboarded);

  useEffect(() => {
    const fail = (err: unknown) => {
      const code = errorCode('start', err);
      logFailure(code, err);
      setFailed(code);
    };
    useData.getState().init().catch(fail);
  }, []);

  let screen: Screen;
  if (failed) screen = 'failed';
  else if (!hydrated) screen = 'loading';
  else if (!onboarded) screen = 'onboarding';
  else screen = 'shell';

  const name = t('app.name');
  useEffect(() => {
    if (screen !== 'shell') document.title = name;
  }, [screen, name]);

  // Android holds the splash until a screen other than the loading one is in
  // the page. Told on the next task, after the browser had the chance to lay
  // it out (no animation frame: the splash keeps the WebView from drawing).
  useEffect(() => {
    if (screen === 'loading') return;
    const timer = setTimeout(tellFirstScreen, 0);
    return () => clearTimeout(timer);
  }, [screen === 'loading']);

  return (
    <>
      {screen === 'failed' && failed && <ErrorScreen kind="start" code={failed} />}
      {screen === 'loading' && <StartingScreen since={startedAt} />}
      {screen === 'onboarding' && <Onboarding />}
      {screen === 'shell' && <Shell />}
      <ScopeDialog />
      <ConfirmDialog />
      <Toasts />
    </>
  );
}

/** The calendar: layout, shortcuts, background sync, reminders. */
function Shell() {
  const narrow = useIsNarrow();
  const surface = useSettings((s) => s.surface);
  const sidebarCollapsed = useSettings((s) => s.sidebarCollapsed);
  useTabTitle();
  useShortcuts();
  useAutoSync();
  useSaveFeedback();
  useShellBackButton();

  useEffect(() => startReminders(), []);
  // Asks for the notification permission on the first run and keeps PermissionNotice in step.
  useEffect(() => startNotificationAccess(), []);

  // Wide screens show the calendar inside the frame: attached to the bottom
  // edge or as a floating card. Narrow ones use every pixel.
  const panel = narrow ? '' : surface === 'card' ? 'mb-2 rounded-xl border' : 'rounded-t-xl border-x';
  return (
    <div className="bg-frame text-frame-text pt-safe flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <div className={`flex min-h-0 flex-1 ${sidebarCollapsed && !narrow ? 'pl-2' : ''}`}>
          {/* Notices sit on top of the calendar, as wide as it. */}
          <div className="flex min-w-0 flex-1 flex-col">
            <PermissionNotice className={narrow ? 'mx-2' : ''} />
            <DeviceStorageNotices className={narrow ? 'mx-2' : ''} />
            <main className={`bg-bg text-text border-border-weak relative min-h-0 min-w-0 flex-1 overflow-hidden border-t ${panel}`}>
              <SyncActivity />
              <CalendarView />
            </main>
          </div>
          <TasksPanel />
          {!narrow && <AppRail />}
        </div>
        <ViewBar />
      </div>

      <Fab />

      <EventPopover />
      <QuickCreate />
      <EventEditor />
      <TaskEditor />
      <SettingsPage />
      <AccountDialog />
      <CalendarDialog />
      <SubscriptionDialog />
      <HolidaysDialog />
      <SearchOverlay />
      <ShortcutsDialog />
      <StorageRiskDialog />
    </div>
  );
}
