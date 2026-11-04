import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, MapPin, CalendarClock } from 'lucide-react';
import { useUi } from '@/store/ui';
import { useData } from '@/store/data';
import { useT } from '@/i18n';
import { useFormat } from '@/hooks/useFormat';
import { useCalendarMap, useSelfEmails, useTasks } from '@/hooks/useCalendarData';
import { expandEvent } from '@/lib/ical/events';
import { parseObject } from '@/lib/ical/parse';
import { openEditTask } from '@/lib/actions';
import type { Occurrence } from '@/lib/ical/types';
import { eventColor, normalizeItemColor } from '@/lib/color';
import { titleWithYears } from '@/lib/milestone';

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ł/g, 'l');

export function SearchOverlay() {
  const open = useUi((s) => s.searchOpen);
  if (!open) return null;
  return <SearchPanel />;
}

function SearchPanel() {
  const t = useT();
  const fmt = useFormat();
  const query = useUi((s) => s.searchQuery);
  const setSearch = useUi((s) => s.setSearch);
  const calendars = useData((s) => s.calendars);
  const objects = useData((s) => s.objects);
  // The views' addresses, so that search and the views share the read of each event.
  const self = useSelfEmails();
  const calendarMap = useCalendarMap();
  const tasks = useTasks();
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0);
  const close = () => setSearch(false);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const results = useMemo(() => {
    const q = fold(query.trim());
    if (q.length < 2) return { events: [] as Occurrence[], tasks: [] as typeof tasks };
    const now = new Date();
    const from = new Date(now.getFullYear() - 2, 0, 1);
    const to = new Date(now.getFullYear() + 3, 0, 1);
    const events: Occurrence[] = [];
    for (const cal of calendars) {
      if (!cal.visible || !cal.components.includes('VEVENT')) continue;
      for (const raw of Object.values(objects[cal.id] ?? {})) {
        if (!fold(raw.data).includes(q)) continue; // cheap prefilter
        const obj = parseObject(raw);
        if (obj?.kind !== 'event') continue;
        let occs: Occurrence[] = [];
        try {
          occs = expandEvent(obj, from, to, self.get(cal.accountId)).filter((o) => fold(`${o.title} ${o.location} ${o.description}`).includes(q));
        } catch {
          continue;
        }
        if (!occs.length) continue;
        const next = occs.find((o) => o.end >= now) ?? occs[occs.length - 1];
        events.push(next);
      }
    }
    events.sort((a, b) => {
      const af = a.end >= now;
      const bf = b.end >= now;
      if (af !== bf) return af ? -1 : 1;
      return af ? a.start.getTime() - b.start.getTime() : b.start.getTime() - a.start.getTime();
    });
    const matchedTasks = tasks.filter((x) => fold(`${x.title} ${x.description}`).includes(q)).slice(0, 30);
    return { events: events.slice(0, 50), tasks: matchedTasks };
  }, [query, calendars, objects, tasks, self]);

  const flat = [...results.events.map((e) => ({ kind: 'event' as const, e })), ...results.tasks.map((task) => ({ kind: 'task' as const, task }))];

  const choose = (i: number) => {
    const item = flat[i];
    if (!item) return;
    const ui = useUi.getState();
    close();
    if (item.kind === 'task') {
      openEditTask(item.task);
      return;
    }
    ui.goTo(item.e.start, ui.view === 'year' || ui.view === 'agenda' ? 'week' : ui.view);
    setTimeout(() => {
      ui.openPopover({ occurrence: item.e, anchor: { x: window.innerWidth / 2 - 190, y: 120, width: 0, height: 0 } });
    }, 50);
  };

  return createPortal(
    <div className="animate-fade fixed inset-0 z-50 flex items-start justify-center p-3 pt-[8vh]" style={{ background: 'var(--backdrop)' }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="animate-pop bg-bg-elevated text-text shadow-elevated flex max-h-[80vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl" role="dialog" aria-label={t('nav.search')}>
        <div className="border-border-weak flex items-center gap-3 border-b px-4">
          <Search size={20} className="text-text-weak shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setSearch(true, e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(flat.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') choose(active);
            }}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none"
          />
          <button type="button" aria-label={t('search.close')} className="text-text-weak hover:bg-bg-weak rounded-lg p-1.5" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {query.trim().length < 2 ? (
            <p className="text-text-weak px-3 py-6 text-center text-[0.8125rem]">{t('search.hint')}</p>
          ) : flat.length === 0 ? (
            <p className="text-text-weak px-3 py-6 text-center">{t('search.noResults', { q: query })}</p>
          ) : (
            <>
              {results.events.length > 0 && <h3 className="text-text-weak px-3 pt-2 pb-1 text-xs font-semibold tracking-wide uppercase">{t('search.events')}</h3>}
              {results.events.map((e, i) => {
                const color = eventColor(e.color, calendarMap.get(e.calendarId)?.color);
                return (
                  <button
                    key={e.key}
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(i)}
                    className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left ${active === i ? 'bg-bg-weak' : ''}`}
                  >
                    <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{titleWithYears(e, t('grid.noTitle'))}</span>
                      <span className="text-text-weak flex flex-wrap gap-x-3 text-[0.8125rem]">
                        <span>
                          {fmt.date(e.start, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                          {!e.allDay && `, ${fmt.time(e.start)}`}
                        </span>
                        {e.location && (
                          <span className="flex min-w-0 items-center gap-1">
                            <MapPin size={12} />
                            <span className="truncate">{e.location}</span>
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
              {results.tasks.length > 0 && <h3 className="text-text-weak px-3 pt-3 pb-1 text-xs font-semibold tracking-wide uppercase">{t('search.tasks')}</h3>}
              {results.tasks.map((task, j) => {
                const i = results.events.length + j;
                return (
                  <button
                    key={task.objectUrl}
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(i)}
                    className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left ${active === i ? 'bg-bg-weak' : ''}`}
                  >
                    <span className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2" style={{ borderColor: normalizeItemColor(calendarMap.get(task.calendarId)?.color) }} />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate font-semibold ${task.completed ? 'text-text-hint line-through' : ''}`}>{task.title}</span>
                      {task.due && (
                        <span className="text-text-weak flex items-center gap-1 text-[0.8125rem]">
                          <CalendarClock size={12} />
                          {fmt.date(task.due, { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
