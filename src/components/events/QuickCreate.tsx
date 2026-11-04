import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { autoUpdate, flip, offset, shift, useFloating, FloatingPortal } from '@floating-ui/react';
import { startOfDay } from 'date-fns';
import { GripVertical, X } from 'lucide-react';
import { useUi, type QuickCreateState } from '@/store/ui';
import { useSettings } from '@/store/settings';
import { calendarsFor, useData } from '@/store/data';
import { useT } from '@/i18n';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { newEventDraft, saveEvent } from '@/lib/actions';
import { defaultAlarmsFor } from '@/lib/calendarAlarms';
import { viewRange } from '@/lib/date';
import { isRangeInvalid } from '@/lib/eventTimes';
import { presetRule, weekdayCode, type RepeatPreset } from '@/lib/ical/recurrence';
import type { EventData } from '@/lib/ical/types';
import { Button, IconButton } from '@/components/ui/Button';
import { useBackdropDismiss } from '@/components/ui/backdrop';
import { placedStyle, popIn } from '@/components/ui/floating';
import { CalendarRow, DateTimeRow, DescriptionRow, LocationRow, MilestoneRow, ParticipantsRow, RepeatButton, TitleRow } from './EventFields';

/**
 * Popover that creates an event in place, next to its placeholder in the
 * grid: title, dates, calendar and colour, guests,
 * location and description, with "More options" for the full editor.
 */
export function QuickCreate() {
  const qc = useUi((s) => s.quickCreate);
  // Keyed, so every opening starts with a fresh form.
  return qc ? <QuickCreateForm key={qc.id} qc={qc} /> : null;
}

function QuickCreateForm({ qc }: { qc: QuickCreateState }) {
  const t = useT();
  const mobile = useIsMobile();
  const close = () => useUi.getState().openQuickCreate(null);
  const allCalendars = useData((s) => s.calendars);
  const calendars = calendarsFor('VEVENT', allCalendars).filter((c) => !c.readOnly);
  const view = useUi((s) => s.view);
  const date = useUi((s) => s.date);

  const [draft] = useState(() => newEventDraft(qc.start, qc.end, qc.allDay));
  const [data, setData] = useState<EventData | null>(draft?.data ?? null);
  const [calendarId, setCalendarId] = useState(draft?.calendarId ?? '');
  const [repeat, setRepeat] = useState<RepeatPreset>('none');
  const [saving, setSaving] = useState(false);
  const calendarColor = calendars.find((c) => c.id === calendarId)?.color;
  const dialog = useRef<HTMLDivElement>(null);
  const backdrop = useBackdropDismiss(close);

  const { refs, floatingStyles, isPositioned } = useFloating({
    placement: 'right-start',
    middleware: [offset(10), flip({ fallbackPlacements: ['left-start', 'bottom', 'top'] }), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
    // Placed by left/top: the pop-in animation owns `transform` (see floating.ts).
    transform: false,
  });

  // Without a calendar to write to there is nothing to create (a toast said so).
  useEffect(() => {
    if (!draft) close();
  }, [draft]);

  // The grid draws the event while it is being typed.
  const { start, end, allDay, title, color } = data ?? qc;
  useEffect(() => {
    useUi.getState().updateQuickCreate({ start, end, allDay, title, color: color ?? calendarColor });
  }, [start, end, allDay, title, color, calendarColor]);

  // A start outside of what is shown moves the calendar there. Following the
  // event is no place of its own: the back button does not return to it.
  useEffect(() => {
    const ui = useUi.getState();
    const s = useSettings.getState();
    const range = viewRange(ui.view, ui.date, s.weekStartsOn, s.customDays);
    if (start < range.start || start >= range.end) ui.setDate(start, { history: false });
  }, [start]);

  // Point at the placeholder in the grid, else at the day or the spot clicked.
  useLayoutEffect(() => {
    const target = document.querySelector('[data-quick-ghost]') ?? document.querySelector(`[data-day="${startOfDay(qc.start).getTime()}"]`);
    if (target) return refs.setReference(target);
    const a = qc.anchor ?? { x: window.innerWidth / 2 - 210, y: 88, width: 0, height: 0 };
    refs.setReference({ getBoundingClientRect: () => ({ ...a, left: a.x, top: a.y, right: a.x + a.width, bottom: a.y + a.height }) });
  }, [qc.start, qc.end, qc.allDay, qc.anchor, view, date, refs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') return void saveRef.current();
      if (e.key !== 'Escape') return;
      // An open dropdown or picker closes first.
      const target = e.target as HTMLElement;
      const layer = target.closest?.('[role="dialog"],[role="menu"],[role="listbox"]');
      if (target.closest?.('[aria-expanded="true"]') || (layer && layer !== dialog.current)) return;
      close();
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (dialog.current?.contains(target) || target.closest('[role="menu"],[role="dialog"],[role="listbox"]')) return;
      // Clicking the grid again is handled by the grid itself.
      if (!target.closest('.time-grid-bg,[data-day]')) close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, []);

  // The key handler is registered once; this keeps it calling the current save.
  const saveRef = useRef<() => unknown>(() => {});

  // The header is a handle: the popover can be moved off whatever it covers.
  const [moved, setMoved] = useState({ x: 0, y: 0 });
  const startMove = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const origin = { x: e.clientX - moved.x, y: e.clientY - moved.y };
    const onMove = (ev: PointerEvent) => setMoved({ x: ev.clientX - origin.x, y: ev.clientY - origin.y });
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (!draft || !data) return null;

  // The form has no notifications to edit: they are always the defaults of
  // the calendar chosen, for the kind of event it is (timed or all-day).
  const set = (patch: Partial<EventData>) =>
    setData((d) => {
      if (!d) return d;
      const alarms = patch.allDay !== undefined && patch.allDay !== d.allDay ? { alarms: defaultAlarmsFor(calendarId, patch.allDay) } : {};
      return { ...d, ...patch, ...alarms };
    });
  const chooseCalendar = (id: string) => {
    setCalendarId(id);
    setData((d) => (d ? { ...d, alarms: defaultAlarmsFor(id, d.allDay) } : d));
  };
  const invalid = isRangeInvalid(data);
  /** The event as it will be saved, with the chosen repeat preset as a rule. */
  const event = (): EventData => ({ ...data, rrule: repeat === 'none' || repeat === 'custom' ? undefined : presetRule(repeat, data.start) });

  const save = async () => {
    if (saving || invalid) return;
    setSaving(true);
    const ok = await saveEvent(draft, event(), calendarId);
    setSaving(false);
    if (ok) close();
  };
  saveRef.current = save;
  const more = (customRepeat = false) => {
    const rrule = customRepeat ? { freq: 'WEEKLY' as const, interval: 1, byDay: [weekdayCode(data.start)] } : event().rrule;
    useUi.getState().openEventEditor({ ...draft, calendarId, data: { ...data, rrule }, customRepeat });
  };

  const form = (
    <form
      className="flex flex-col gap-4 px-4 pt-4 pb-4 sm:px-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <TitleRow data={data} set={set} autoFocus />
      <DateTimeRow data={data} set={set}>
        <RepeatButton preset={repeat} start={data.start} onChange={(p) => (p === 'custom' ? more(true) : setRepeat(p))} />
      </DateTimeRow>
      <MilestoneRow data={data} set={set} repeats={repeat !== 'none'} repeatYearly={() => setRepeat('yearly')} />
      <CalendarRow data={data} set={set} calendars={calendars} calendarId={calendarId} onCalendar={chooseCalendar} />
      <ParticipantsRow data={data} set={set} calendarId={calendarId} />
      <LocationRow data={data} set={set} />
      <DescriptionRow data={data} set={set} />
      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={() => more()}>{t('editor.moreOptions')}</Button>
        <Button variant="primary" type="submit" loading={saving} disabled={invalid}>
          {t('editor.save')}
        </Button>
      </div>
    </form>
  );

  if (mobile) {
    return (
      <FloatingPortal>
        <div className="animate-fade fixed inset-0 z-40" style={{ background: 'var(--backdrop)' }} {...backdrop}>
          <div
            ref={dialog}
            role="dialog"
            aria-label={t('editor.create')}
            data-form-layer
            className="animate-slide-up bg-bg-elevated pb-safe absolute inset-x-0 bottom-0 max-h-[92%] overflow-y-auto rounded-t-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pt-2 pr-2 pl-4">
              <span className="font-semibold">{t('editor.create')}</span>
              <IconButton label={t('common.close')} onClick={close}>
                <X size={20} />
              </IconButton>
            </div>
            {form}
          </div>
        </div>
      </FloatingPortal>
    );
  }

  return (
    <FloatingPortal>
      <div ref={refs.setFloating} style={placedStyle(floatingStyles, isPositioned)} className="z-40">
        <div
          ref={dialog}
          role="dialog"
          aria-label={t('editor.create')}
          data-form-layer
          style={{ transform: `translate(${moved.x}px, ${moved.y}px)` }}
          className={`${popIn(isPositioned)} bg-bg-elevated border-border-weak shadow-elevated text-text flex max-h-[calc(100vh-24px)] w-[400px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border`}
        >
          <div className="bg-bg-weak border-border-weak flex h-10 shrink-0 cursor-grab items-center justify-between border-b pr-1.5 pl-3 active:cursor-grabbing" onPointerDown={startMove}>
            <GripVertical size={16} className="text-text-hint" />
            <IconButton label={t('common.close')} size={30} onClick={close} onPointerDown={(e) => e.stopPropagation()}>
              <X size={18} />
            </IconButton>
          </div>
          <div className="min-h-0 overflow-y-auto">{form}</div>
        </div>
      </div>
    </FloatingPortal>
  );
}
