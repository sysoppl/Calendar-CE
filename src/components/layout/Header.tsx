import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isSameDay, isSameMonth, isSameYear } from 'date-fns';
import { ChevronLeft, ChevronRight, ChevronDown, Menu as MenuIcon, MoreVertical, PanelLeftOpen, Plus, Search, Settings, ListTodo, Keyboard, Server } from 'lucide-react';
import { useUi } from '@/store/ui';
import { useSettings, VIEWS, type ViewType } from '@/store/settings';
import { useT } from '@/i18n';
import { useFormat, type Formatter } from '@/hooks/useFormat';
import { useIsMobile, useIsNarrow } from '@/hooks/useMediaQuery';
import { useKeyboardUi } from '@/hooks/useKeyboardUi';
import { useNow } from '@/hooks/useNow';
import { useTasks } from '@/hooks/useCalendarData';
import { animatePeriod, prefersReducedMotion } from '@/hooks/usePeriodTransition';
import { viewRange, type Range, type WeekStart } from '@/lib/date';
import type { Task } from '@/lib/ical/types';
import { startNewEvent } from '@/lib/actions';
import { Button, IconButton } from '@/components/ui/Button';
import { Menu, Popover } from '@/components/ui/Menu';
import { HeaderAccount } from '@/components/account/AccountChip';
import { TOUCH_AREA, TOUCH_HIT, TOUCH_MIN, TOUCH_MIN_H } from '@/components/ui/touch';
import { MiniCalendar } from './MiniCalendar';

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

/**
 * The phone's title: the month on screen ("October"), with the year only when
 * it is not this year's; a week across two months names both ("Oct – Nov").
 * The day view's own header row says which day it is. `short` names the month
 * shortly ("Oct 2027"), for when the long name does not fit.
 */
export function phoneTitle(fmt: Formatter, view: ViewType, range: Range, date: Date, now: Date, short = false): string {
  if (view === 'year') return String(date.getFullYear());
  const first = view === 'week' || view === 'days' ? range.start : date;
  const last = view === 'week' || view === 'days' ? new Date(range.end.getTime() - 1) : date;
  const year = (d: Date) => (isSameYear(d, now) ? '' : ` ${d.getFullYear()}`);
  if (isSameMonth(first, last)) return cap(fmt.date(first, { month: short ? 'short' : 'long' })) + year(first);
  const sameYear = isSameYear(first, last);
  return `${cap(fmt.date(first, { month: 'short' }))}${sameYear ? '' : year(first)} – ${cap(fmt.date(last, { month: 'short' }))}${year(last)}`;
}

/** Whether today is on screen; the phone's Today button shows only when it is not. */
export function showsToday(view: ViewType, date: Date, now: Date, weekStartsOn: WeekStart, customDays: number): boolean {
  switch (view) {
    case 'day':
    case 'agenda':
      return isSameDay(date, now);
    case 'month':
      return isSameMonth(date, now);
    case 'year':
      return isSameYear(date, now);
    default: {
      const range = viewRange(view, date, weekStartsOn, customDays);
      return now >= range.start && now < range.end;
    }
  }
}

/** Open tasks due by the end of today, and whether any of them is overdue (its time has passed). */
export function dueTasks(tasks: Task[], now: Date): { due: number; overdue: boolean } {
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let due = 0;
  let overdue = false;
  for (const task of tasks) {
    if (task.completed || !task.due || task.due > endOfToday) continue;
    due++;
    if (task.dueAllDay ? task.due < startOfToday : task.due < now) overdue = true;
  }
  return { due, overdue };
}

export function Header() {
  const t = useT();
  const fmt = useFormat();
  const mobile = useIsMobile();
  const narrow = useIsNarrow();
  const keys = useKeyboardUi();
  const now = useNow();
  const { view, date, setView, setDate, goTo, step, setSidebarOpen, setSearch, openSettings } = useUi();
  const weekStartsOn = useSettings((s) => s.weekStartsOn);
  const customDays = useSettings((s) => s.customDays);
  const tasksPanelOpen = useSettings((s) => s.tasksPanelOpen);
  const sidebarCollapsed = useSettings((s) => s.sidebarCollapsed);
  const updateSettings = useSettings((s) => s.update);

  const range = useMemo(() => viewRange(view, date, weekStartsOn, customDays), [view, date, weekStartsOn, customDays]);
  const todayShown = showsToday(view, date, now, weekStartsOn, customDays);
  // A phone's title takes the short month name when the long one does not fit
  // (another year's month beside the Today button on a narrow phone). Each
  // change of title, of the buttons beside it or of the width tries the long one again.
  const longTitle = phoneTitle(fmt, view, range, date, now);
  const [longFits, setLongFits] = useState(true);
  useLayoutEffect(() => setLongFits(true), [longTitle, todayShown]);
  useEffect(() => {
    const retry = () => setLongFits(true);
    window.addEventListener('resize', retry);
    return () => window.removeEventListener('resize', retry);
  }, []);
  const title = !mobile ? fmt.title(view, range, date) : longFits ? longTitle : phoneTitle(fmt, view, range, date, now, true);
  const viewLabel = (v: ViewType) => t(`view.${v}`, { n: customDays });
  // Without the sidebar, its two essentials move up here.
  const collapsed = sidebarCollapsed && !narrow;

  // The title changes with a short fade, in step with the period sliding in.
  const titleRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (mobile && longFits && el && el.scrollWidth > el.clientWidth) setLongFits(false);
  });
  const shownTitle = useRef(title);
  useEffect(() => {
    if (shownTitle.current === title) return;
    shownTitle.current = title;
    const el = titleRef.current;
    if (el && !prefersReducedMotion()) animatePeriod(el, [{ opacity: 0.4 }, { opacity: 1 }], { duration: 150, easing: 'linear' });
  }, [title]);

  const datePicker = (
    <Popover
      trigger={
        <button
          type="button"
          title={t('nav.goToDate')}
          aria-label={mobile ? `${title}, ${t('nav.goToDate')}` : undefined}
          className={`hover:bg-frame-hover -ml-1 flex min-w-0 items-center gap-1 rounded-lg py-1 pr-1.5 pl-2 font-semibold ${mobile ? 'text-lg' : 'text-base sm:text-lg'} ${TOUCH_MIN_H}`}
        >
          <span ref={titleRef} className="truncate">
            {title}
          </span>
          <ChevronDown size={16} className="text-frame-weak shrink-0" />
        </button>
      }
    >
      {(close) => (
        // Wider on a touch screen, so that each day's column is a 44 px target.
        <div className="w-[17.5rem] p-3 pointer-coarse:w-[min(21rem,calc(100vw-1rem))]">
          <MiniCalendar
            tone="content"
            selected={date}
            onSelect={(d) => {
              goTo(d);
              close();
            }}
          />
        </div>
      )}
    </Popover>
  );

  if (mobile) return <PhoneHeader title={datePicker} todayShown={todayShown} />;

  return (
    // On a touch screen its buttons are 44 px targets (TOUCH_AREA); a mouse keeps the compact toolbar.
    <header className={`bg-frame text-frame-text flex h-14 shrink-0 items-center gap-1 pr-2 pl-2 sm:gap-2 sm:pr-3 ${TOUCH_AREA} ${collapsed ? '' : 'lg:pl-0'}`}>
      {narrow && (
        <IconButton tone="frame" label={t('nav.menu')} onClick={() => setSidebarOpen(true)}>
          <MenuIcon size={20} />
        </IconButton>
      )}
      {collapsed && (
        <>
          <IconButton tone="frame" label={t('sidebar.expand')} onClick={() => updateSettings({ sidebarCollapsed: false })}>
            <PanelLeftOpen size={20} />
          </IconButton>
          <button
            type="button"
            aria-label={t('sidebar.newEvent')}
            title={t('sidebar.newEvent')}
            onClick={startNewEvent}
            className={`bg-primary text-primary-contrast hover:bg-primary-hover flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${TOUCH_MIN}`}
          >
            <Plus size={18} strokeWidth={2.5} />
          </button>
        </>
      )}
      <Button variant="frame" size="sm" className="h-9 px-4" onClick={() => setDate(new Date())} title={keys ? 'T' : undefined}>
        {t('nav.today')}
      </Button>
      <div className="flex max-sm:hidden">
        <IconButton tone="frame" label={t('nav.previous')} onClick={() => step(-1)}>
          <ChevronLeft size={20} />
        </IconButton>
        <IconButton tone="frame" label={t('nav.next')} onClick={() => step(1)}>
          <ChevronRight size={20} />
        </IconButton>
      </div>
      <h1 className="flex min-w-0 flex-1" aria-live="polite">
        {datePicker}
      </h1>

      <Menu
        trigger={
          <button
            type="button"
            // Its border keeps the toolbar's 36 px; a finger gets 44 px.
            className={`border-frame-border hover:bg-frame-hover flex h-9 shrink-0 items-center gap-1.5 rounded-lg border pr-2.5 pl-3 text-[0.8125rem] font-medium ${TOUCH_HIT}`}
            aria-label={t('nav.view')}
          >
            {viewLabel(view)}
            <ChevronDown size={16} />
          </button>
        }
        minWidth={190}
        items={VIEWS.map((v) => ({
          label: viewLabel(v.id),
          hint: v.key,
          checked: v.id === view,
          onSelect: () => setView(v.id),
        }))}
      />

      <IconButton tone="frame" label={t('nav.search')} onClick={() => setSearch(true)}>
        <Search size={19} />
      </IconButton>

      {narrow && (
        <IconButton tone="frame" label={t('nav.tasks')} active={tasksPanelOpen} onClick={() => updateSettings({ tasksPanelOpen: !tasksPanelOpen })}>
          <ListTodo size={19} />
        </IconButton>
      )}

      <Menu
        trigger={
          <IconButton tone="frame" label={t('nav.settings')} data-settings-return="">
            <Settings size={19} />
          </IconButton>
        }
        items={[
          { label: t('nav.settings'), icon: <Settings size={16} />, hint: 'S', onSelect: () => openSettings('general') },
          { label: t('settings.section.appearance'), icon: <span className="bg-primary block h-3 w-3 rounded-full" />, onSelect: () => openSettings('appearance') },
          { label: t('sidebar.addAccount'), icon: <Server size={16} />, onSelect: () => useUi.getState().openAccountDialog(true) },
          // The list of shortcuts is of use only with a keyboard.
          ...(keys
            ? [
                'separator' as const,
                { label: t('nav.shortcuts'), icon: <Keyboard size={16} />, hint: '?', onSelect: () => useUi.getState().setShortcutsOpen(true) },
              ]
            : []),
        ]}
      />

      {/* Its round button is drawn in AccountChip; on a touch screen it is a 44 px target like the rest. */}
      <div className="flex shrink-0 empty:hidden pointer-coarse:[&>button]:size-11">
        <HeaderAccount />
      </div>
    </header>
  );
}

/**
 * The phone's header, kept calm: the menu, the month (which opens the date
 * picker), Today only while today is off screen, search, and one menu with
 * the rest. The views are in the bar at the bottom (ViewBar).
 */
function PhoneHeader({ title, todayShown }: { title: ReactNode; todayShown: boolean }) {
  const t = useT();
  const keys = useKeyboardUi();
  const now = useNow();
  const tasks = useTasks();
  const tasksPanelOpen = useSettings((s) => s.tasksPanelOpen);
  const { setDate, setSidebarOpen, setSearch, openSettings } = useUi();
  const { due, overdue } = useMemo(() => dueTasks(tasks, now), [tasks, now]);

  return (
    <header className={`bg-frame text-frame-text flex h-14 shrink-0 items-center gap-1 pr-1 pl-2 ${TOUCH_AREA}`}>
      <IconButton tone="frame" label={t('nav.menu')} onClick={() => setSidebarOpen(true)}>
        <MenuIcon size={20} />
      </IconButton>
      <h1 className="flex min-w-0 flex-1" aria-live="polite">
        {title}
      </h1>
      {!todayShown && (
        <button
          type="button"
          onClick={() => setDate(new Date())}
          className={`border-frame-border hover:bg-frame-hover flex h-8 shrink-0 items-center rounded-full border px-3 text-[0.8125rem] font-semibold ${TOUCH_HIT}`}
        >
          {t('nav.today')}
        </button>
      )}
      <IconButton tone="frame" label={t('nav.search')} onClick={() => setSearch(true)}>
        <Search size={19} />
      </IconButton>
      <Menu
        trigger={
          // Where the focus returns when Settings, opened from here, closes.
          <IconButton tone="frame" label={overdue ? t('nav.moreOverdue') : t('common.more')} data-settings-return="">
            <span className="relative flex">
              <MoreVertical size={20} />
              {overdue && <span data-overdue className="bg-primary ring-frame absolute -top-0.5 -right-1 h-2 w-2 rounded-full ring-2" />}
            </span>
          </IconButton>
        }
        minWidth={220}
        items={[
          {
            label: t('nav.tasks'),
            icon: <ListTodo size={16} />,
            checked: tasksPanelOpen,
            badge: due,
            badgeLabel: t('nav.dueCount', { n: due }),
            onSelect: () => useSettings.getState().update({ tasksPanelOpen: !tasksPanelOpen }),
          },
          { label: t('nav.settings'), icon: <Settings size={16} />, hint: 'S', onSelect: () => openSettings('general', { list: true }) },
          ...(keys ? [{ label: t('nav.shortcuts'), icon: <Keyboard size={16} />, hint: '?', onSelect: () => useUi.getState().setShortcutsOpen(true) }] : []),
        ]}
      />
      {/* Its round button is drawn in AccountChip; on a touch screen it is a 44 px target like the rest. */}
      <div className="flex shrink-0 empty:hidden pointer-coarse:[&>button]:size-11">
        <HeaderAccount />
      </div>
    </header>
  );
}
