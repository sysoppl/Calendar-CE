import { useMemo, useState } from 'react';
import { ChevronDown, Plus, MoreHorizontal, Eye, EyeOff, Pencil, Trash2, Focus, RefreshCw, ListTodo, CalendarPlus, Server, Lock, Rss, PartyPopper, PanelLeftClose } from 'lucide-react';
import { useData, calendarsFor, isGeneratedCalendar, type Calendar } from '@/store/data';
import { useUi, errorMessage } from '@/store/ui';
import { useSettings } from '@/store/settings';
import { t as tr, useT } from '@/i18n';
import { useIsNarrow } from '@/hooks/useMediaQuery';
import { viewRange } from '@/lib/date';
import { openNewTask, startNewEvent } from '@/lib/actions';
import { Menu } from '@/components/ui/Menu';
import { ColorCheckbox } from '@/components/ui/Controls';
import { IconButton } from '@/components/ui/Button';
import { SidebarAccount } from '@/components/account/AccountChip';
import { accountTitle } from '@/components/account/shared';
import { useBackdropDismiss } from '@/components/ui/backdrop';
import { HOME_URL } from '@/lib/links';
import { Logo } from './Logo';
import { MiniCalendar } from './MiniCalendar';

export function Sidebar() {
  const narrow = useIsNarrow();
  const open = useUi((s) => s.sidebarOpen);
  const setOpen = useUi((s) => s.setSidebarOpen);
  const collapsed = useSettings((s) => s.sidebarCollapsed);
  const backdrop = useBackdropDismiss(() => setOpen(false));

  if (narrow) {
    if (!open) return null;
    return (
      <div className="animate-fade fixed inset-0 z-40" style={{ background: 'var(--backdrop)' }} {...backdrop}>
        <aside
          // Wider on a touch screen, so that the days of the mini calendar are 44 px targets on most phones.
          className="animate-slide-left bg-frame text-frame-text pt-safe pb-safe flex h-full w-[min(var(--sidebar-width),86vw)] flex-col shadow-2xl pointer-coarse:w-[min(21rem,86vw)]"
          onClick={(e) => e.stopPropagation()}
        >
          <SidebarContent />
        </aside>
      </div>
    );
  }
  if (collapsed) return null;
  return (
    <aside className="bg-frame text-frame-text flex h-full w-[var(--sidebar-width)] shrink-0 flex-col">
      <SidebarContent collapsible />
    </aside>
  );
}

function SidebarContent({ collapsible = false }: { collapsible?: boolean }) {
  const t = useT();
  const date = useUi((s) => s.date);
  const view = useUi((s) => s.view);
  const goTo = useUi((s) => s.goTo);
  const weekStartsOn = useSettings((s) => s.weekStartsOn);
  const customDays = useSettings((s) => s.customDays);
  const calendars = useData((s) => s.calendars);
  const accounts = useData((s) => s.accounts);
  const highlight = useMemo(
    () => (view === 'week' || view === 'day' || view === 'days' ? viewRange(view, date, weekStartsOn, customDays) : undefined),
    [view, date, weekStartsOn, customDays],
  );

  const eventCals = calendarsFor('VEVENT', calendars).filter((c) => !isGeneratedCalendar(c));
  const taskCals = calendarsFor('VTODO', calendars).filter((c) => !c.components.includes('VEVENT'));
  const other = calendars.filter(isGeneratedCalendar).sort((a, b) => a.order - b.order);

  return (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between pr-3 pl-5">
        <Logo />
        {collapsible && (
          <IconButton tone="frame" label={t('sidebar.collapse')} className="text-frame-weak" onClick={() => useSettings.getState().update({ sidebarCollapsed: true })}>
            <PanelLeftClose size={18} />
          </IconButton>
        )}
      </div>
      <div className="px-4 pt-1 pb-3">
        <NewButton />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div className="px-1 pb-4 pointer-coarse:px-0">
          <MiniCalendar selected={date} highlight={highlight} onSelect={(d) => goTo(d)} />
        </div>
        <CalendarGroup title={t('sidebar.myCalendars')} calendars={eventCals} accounts={accounts} kind="events" />
        {taskCals.length > 0 && <CalendarGroup title={t('sidebar.taskLists')} calendars={taskCals} accounts={accounts} kind="tasks" />}
        <CalendarGroup title={t('sidebar.otherCalendars')} calendars={other} accounts={accounts} kind="other" />
      </div>
      <SidebarAccount />
      <Credit />
    </>
  );
}

function NewButton() {
  const t = useT();
  // One event is created at a time.
  const creating = useUi((s) => !!s.quickCreate);
  const newEvent = () => {
    useUi.getState().setSidebarOpen(false);
    startNewEvent();
  };
  return (
    <div className="flex">
      <button
        type="button"
        disabled={creating}
        onClick={newEvent}
        className="bg-primary text-primary-contrast hover:bg-primary-hover flex h-10 flex-1 items-center justify-center gap-2 rounded-l-lg font-semibold transition-colors disabled:opacity-50 pointer-coarse:h-11"
      >
        <Plus size={18} strokeWidth={2.5} />
        {t('sidebar.newEvent')}
      </button>
      <Menu
        placement="bottom-end"
        trigger={
          <button
            type="button"
            aria-label={t('common.more')}
            className="bg-primary text-primary-contrast hover:bg-primary-hover flex h-10 w-10 items-center justify-center rounded-r-lg border-l border-white/25 transition-colors pointer-coarse:size-11"
          >
            <ChevronDown size={18} />
          </button>
        }
        items={[
          {
            label: t('sidebar.newEvent'),
            icon: <CalendarPlus size={16} />,
            hint: 'N',
            onSelect: newEvent,
          },
          {
            label: t('sidebar.newTask'),
            icon: <ListTodo size={16} />,
            hint: 'Shift+N',
            onSelect: () => {
              useUi.getState().setSidebarOpen(false);
              openNewTask();
            },
          },
        ]}
      />
    </div>
  );
}

function CalendarGroup({
  title,
  calendars,
  accounts,
  kind,
}: {
  title: string;
  calendars: Calendar[];
  accounts: ReturnType<typeof useData.getState>['accounts'];
  kind: 'events' | 'tasks' | 'other';
}) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  const multiAccount = kind !== 'other' && new Set(calendars.map((c) => c.accountId)).size > 1;
  const byAccount = accounts
    .map((a) => ({ account: a, cals: calendars.filter((c) => c.accountId === a.id) }))
    .filter((g) => g.cals.length);

  return (
    <section className="mb-3">
      <div className="group flex items-center">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          className="hover:bg-frame-hover flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left font-semibold pointer-coarse:min-h-11"
        >
          <ChevronDown size={16} className={`transition-transform ${collapsed ? '-rotate-90' : ''}`} />
          <span className="truncate">{title}</span>
        </button>
        <Menu
          trigger={
            <button
              type="button"
              aria-label={t('sidebar.addCalendar')}
              title={t('sidebar.addCalendar')}
              className="hover:bg-frame-hover text-frame-weak flex items-center justify-center rounded-lg p-1.5 pointer-coarse:size-11"
            >
              <Plus size={18} />
            </button>
          }
          items={[
            ...(kind !== 'other'
              ? [
                  {
                    label: kind === 'events' ? t('settings.newCalendar') : t('settings.newTaskList'),
                    icon: <Plus size={16} />,
                    onSelect: () => useUi.getState().openCalendarDialog({ kind }),
                  },
                ]
              : []),
            { label: t('sidebar.addHolidays'), icon: <PartyPopper size={16} />, onSelect: () => useUi.getState().openHolidaysDialog(true) },
            { label: t('sidebar.addSubscription'), icon: <Rss size={16} />, onSelect: () => useUi.getState().openSubscriptionDialog(true) },
            { label: t('sidebar.addAccount'), icon: <Server size={16} />, onSelect: () => useUi.getState().openAccountDialog(true) },
          ]}
        />
      </div>
      {!collapsed && calendars.length === 0 && <p className="text-frame-weak px-3 py-1 text-xs">{t('sidebar.otherEmpty')}</p>}
      {!collapsed && (
        <ul className="mt-0.5">
          {byAccount.map(({ account, cals }) => (
            <li key={account.id}>
              {multiAccount && (
                <div className="text-frame-weak truncate px-3 pt-2 pb-1 text-[0.6875rem] font-semibold tracking-wide uppercase">{accountTitle(account, t)}</div>
              )}
              <ul>
                {cals.map((c) => (
                  <CalendarItem key={c.id} calendar={c} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CalendarItem({ calendar }: { calendar: Calendar }) {
  const t = useT();
  const setVisible = useData((s) => s.setCalendarVisible);
  const showOnly = useData((s) => s.showOnlyCalendar);
  const isTaskList = !calendar.components.includes('VEVENT');

  return (
    <li className="group hover:bg-frame-hover flex items-center gap-1 rounded-lg pr-1 pl-3">
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-1.5">
        <ColorCheckbox checked={calendar.visible} color={calendar.color} onChange={(v) => setVisible(calendar.id, v)} label={calendar.name} round={isTaskList} />
        <span className={`truncate ${calendar.visible ? '' : 'text-frame-weak'}`}>{calendar.name}</span>
        {calendar.readOnly && !isGeneratedCalendar(calendar) && <Lock size={12} className="text-frame-weak shrink-0" aria-label={t('sidebar.readOnly')} />}
      </label>
      <Menu
        trigger={
          <button
            type="button"
            aria-label={t('common.more')}
            className="text-frame-weak hover:bg-frame-active flex items-center justify-center rounded-md p-1 opacity-0 group-hover:opacity-100 focus:opacity-100 max-lg:opacity-100 pointer-coarse:size-11 pointer-coarse:opacity-100"
          >
            <MoreHorizontal size={16} />
          </button>
        }
        items={[
          { label: t('sidebar.showOnly'), icon: <Focus size={16} />, onSelect: () => showOnly(calendar.id) },
          {
            label: calendar.visible ? t('sidebar.hide') : t('sidebar.show'),
            icon: calendar.visible ? <EyeOff size={16} /> : <Eye size={16} />,
            onSelect: () => setVisible(calendar.id, !calendar.visible),
          },
          'separator',
          {
            label: t('sidebar.edit'),
            icon: <Pencil size={16} />,
            onSelect: () => useUi.getState().openCalendarDialog({ calendarId: calendar.id, kind: isTaskList ? 'tasks' : 'events' }),
          },
          ...(calendar.subscriptionUrl
            ? [
                {
                  label: t('subscription.refresh'),
                  icon: <RefreshCw size={16} />,
                  onSelect: () =>
                    void useData
                      .getState()
                      .refreshSubscription(calendar.id, true)
                      .catch((err) => useUi.getState().toast(errorMessage(err), 'error')),
                },
              ]
            : []),
          {
            label: t('sidebar.delete'),
            icon: <Trash2 size={16} />,
            danger: true,
            disabled: calendar.readOnly && !isGeneratedCalendar(calendar),
            onSelect: () => void confirmDeleteCalendar(calendar),
          },
        ]}
      />
    </li>
  );
}

export async function confirmDeleteCalendar(calendar: Calendar) {
  const ui = useUi.getState();
  const ok = await ui.confirm({
    title: tr('confirm.deleteCalendarTitle'),
    message: tr('confirm.deleteCalendar', { name: calendar.name }),
    confirmLabel: tr('confirm.delete'),
    danger: true,
  });
  if (!ok) return;
  try {
    await useData.getState().deleteCalendar(calendar.id);
    ui.toast(tr('toast.calendarDeleted'), 'success');
  } catch (err) {
    ui.toast(errorMessage(err), 'error');
  }
}

/** Last line of the sidebar: where the app comes from and its version. */
function Credit() {
  return (
    <div className="text-frame-weak flex items-center justify-between pr-4 pb-2 pl-5 text-[0.6875rem]">
      <a href={HOME_URL} target="_blank" rel="noreferrer" className="hover:text-frame-text underline-offset-2 hover:underline">
        patryk.pro
      </a>
      <span className="tabular-nums">{__APP_VERSION__}</span>
    </div>
  );
}
