import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { isWeekend } from 'date-fns';
import { useUi } from '@/store/ui';
import { useSettings, type ViewType } from '@/store/settings';
import { useSwipePager } from '@/hooks/useSwipePager';
import { daysInRange, stepDate, viewRange, type WeekStart } from '@/lib/date';
import { BACK_DEPTH, useBackButtonLayer } from '@/components/onboarding/back';
import { TimeGridView } from './TimeGridView';
import { MonthView } from './MonthView';
import { YearView } from './YearView';
import { AgendaView } from './AgendaView';

/** The days a time grid shows around `date`. */
function gridDays(view: ViewType, date: Date, weekStartsOn: WeekStart, showWeekends: boolean, customDays: number): Date[] {
  const all = daysInRange(viewRange(view, date, weekStartsOn, customDays));
  return view === 'week' && !showWeekends ? all.filter((d) => !isWeekend(d)) : all;
}

export function CalendarView() {
  const view = useUi((s) => s.view);
  const date = useUi((s) => s.date);
  const weekStartsOn = useSettings((s) => s.weekStartsOn);
  const showWeekends = useSettings((s) => s.showWeekends);
  const customDays = useSettings((s) => s.customDays);
  const isGrid = view === 'day' || view === 'days' || view === 'week';

  const days = useMemo(() => (isGrid ? gridDays(view, date, weekStartsOn, showWeekends, customDays) : []), [isGrid, view, date, weekStartsOn, showWeekends, customDays]);

  // A finger swiped sideways pages through the periods; the year scrolls instead.
  // While it swipes, the month or the days before and after are drawn beside
  // the ones on screen (`peek`) as a low-priority update, so that drawing them
  // never holds up the finger. The agenda's list has no neighbours.
  const pager = useRef<HTMLDivElement>(null);
  const [peek, setPeek] = useState(false);
  useSwipePager(pager, {
    enabled: view !== 'year',
    onStep: (dir) => useUi.getState().step(dir),
    onPeek: isGrid || view === 'month' ? (on) => (on ? startTransition(() => setPeek(true)) : setPeek(false)) : undefined,
  });
  const peers = useMemo(() => {
    if (!peek || !isGrid) return null;
    const around = (dir: 1 | -1) => gridDays(view, stepDate(view, date, dir, customDays), weekStartsOn, showWeekends, customDays);
    return { before: around(-1), after: around(1) };
  }, [peek, isGrid, view, date, weekStartsOn, showWeekends, customDays]);

  // The Android back button, once nothing is left open, returns to the view
  // and dates shown before (the month a day was opened from, say). Where the
  // calendar has been is forgotten when it closes.
  useBackButtonLayer(BACK_DEPTH.history, () => useUi.getState().navBack());
  useEffect(() => () => useUi.getState().clearNavHistory(), []);

  return (
    // Sideways moves of a finger are the pager's; up and down (and pinching) stay with the browser.
    <div ref={pager} className="h-full [touch-action:pan-y_pinch-zoom] [&_*]:[touch-action:pan-y_pinch-zoom]">
      {isGrid ? (
        <TimeGridView key={view} days={days} peers={peers} />
      ) : view === 'month' ? (
        // The same month view for every month: changing month redraws it rather than building it anew.
        <MonthView peek={peek} />
      ) : view === 'year' ? (
        <YearView />
      ) : (
        <AgendaView />
      )}
    </div>
  );
}
