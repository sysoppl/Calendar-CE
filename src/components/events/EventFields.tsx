// The rows of an event form, shared by the quick-create popover and the full
// editor so both look and behave the same.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlignLeft, CalendarDays, ChevronDown, Clock, MapPin, Repeat, Text, Users, X } from 'lucide-react';
import { useT } from '@/i18n';
import { useFormat } from '@/hooks/useFormat';
import { eventColor } from '@/lib/color';
import { isRangeInvalid, shownEnd, withAllDay, withEndDate, withEndTime, withStartDate, withStartTime } from '@/lib/eventTimes';
import type { RepeatPreset } from '@/lib/ical/recurrence';
import type { EventData } from '@/lib/ical/types';
import { useData, type Calendar } from '@/store/data';
import { useSettings } from '@/store/settings';
import { useKeyboardUi } from '@/hooks/useKeyboardUi';
import { Checkbox, IconRow } from '@/components/ui/Controls';
import { ColorPicker } from '@/components/ui/ColorPicker';
import { DateField, TimeField } from '@/components/ui/DateTimeFields';
import { Menu, Popover } from '@/components/ui/Menu';
import { presetLabel, REPEAT_PRESETS } from './RecurrenceFields';

interface RowProps {
  data: EventData;
  set: (patch: Partial<EventData>) => void;
}

export function TitleRow({ data, set, autoFocus = false }: RowProps & { autoFocus?: boolean }) {
  const t = useT();
  return (
    <IconRow icon={<Text size={18} />} label={t('editor.title')}>
      <input name="title" className="field" autoFocus={autoFocus} value={data.title} onChange={(e) => set({ title: e.target.value })} placeholder={t('editor.title')} aria-label={t('editor.title')} maxLength={255} />
    </IconRow>
  );
}

/**
 * Start and end, each a date with (for timed events) a time, then the
 * "All day" switch; `children` sit beside it (repeat button, time zone).
 */
export function DateTimeRow({ data, set, children }: RowProps & { children?: ReactNode }) {
  const t = useT();
  const duration = useSettings((s) => s.defaultEventDuration);
  const time = t('tasks.dueTime');
  return (
    <IconRow icon={<Clock size={18} />} label={t('editor.from')}>
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <DateField className="min-w-0 flex-[1.35]" label={t('editor.from')} value={data.start} onChange={(d) => set(withStartDate(data, d))} />
          {!data.allDay && <TimeField className="min-w-0 flex-1" label={`${t('editor.from')} – ${time}`} value={data.start} onChange={(m) => set(withStartTime(data, m))} />}
        </div>
        <div className="flex gap-2">
          <DateField className="min-w-0 flex-[1.35]" label={t('editor.to')} value={shownEnd(data)} min={data.start} onChange={(d) => set(withEndDate(data, d))} />
          {!data.allDay && (
            <TimeField className="min-w-0 flex-1" label={`${t('editor.to')} – ${time}`} value={data.end} from={data.start} onChange={(m) => set(withEndTime(data, m))} />
          )}
        </div>
        {isRangeInvalid(data) && <p className="text-danger text-xs">{t('editor.endBeforeStart')}</p>}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <Checkbox checked={data.allDay} onChange={(allDay) => set(withAllDay(data, allDay, duration))}>
            {t('editor.allDay')}
          </Checkbox>
          {children}
        </div>
      </div>
    </IconRow>
  );
}

/** Compact repeat control of the popover: the presets as a menu. */
export function RepeatButton({ preset, start, onChange }: { preset: RepeatPreset; start: Date; onChange: (p: RepeatPreset) => void }) {
  const t = useT();
  const fmt = useFormat();
  return (
    <Menu
      placement="bottom-end"
      minWidth={230}
      trigger={
        <button type="button" aria-label={t('editor.repeat')} className="border-border hover:bg-bg-weak flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-lg border px-2.5 text-[0.8125rem] font-medium">
          <Repeat size={14} className="shrink-0" />
          <span className="truncate">{presetLabel(preset, start, t, fmt)}</span>
        </button>
      }
      items={REPEAT_PRESETS.flatMap((p) => [
        ...(p === 'custom' ? (['separator'] as const) : []),
        { label: presetLabel(p, start, t, fmt), checked: p === preset, onSelect: () => onChange(p) },
      ])}
    />
  );
}

/** Calendar select with the event's own colour beside it. */
export function CalendarRow({ data, set, calendars, calendarId, onCalendar }: RowProps & { calendars: Calendar[]; calendarId: string; onCalendar: (id: string) => void }) {
  const t = useT();
  const calendar = calendars.find((c) => c.id === calendarId);
  return (
    <IconRow icon={<CalendarDays size={18} />} label={t('editor.calendar')}>
      <div className="flex gap-2">
        <select className="field min-w-0 flex-1 font-medium" value={calendarId} onChange={(e) => onCalendar(e.target.value)} aria-label={t('editor.calendar')}>
          {calendars.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Popover
          placement="bottom-end"
          trigger={
            <button type="button" aria-label={t('editor.color')} title={t('editor.color')} className="field flex w-auto shrink-0 items-center gap-2 px-2.5">
              <span className="h-4 w-4 rounded-full" style={{ background: eventColor(data.color, calendar?.color) }} />
              <ChevronDown size={14} className="text-text-weak" />
            </button>
          }
        >
          {(close) => (
            <div className="w-[min(20rem,calc(100vw-2rem))] p-3">
              <ColorPicker
                value={data.color}
                onChange={(color) => {
                  set({ color });
                  close();
                }}
                inherit={{
                  label: t('editor.defaultColor'),
                  color: calendar?.color,
                  onSelect: () => {
                    // Also drops a COLOR in a notation the app cannot show.
                    set({ color: undefined, colorAsWritten: undefined });
                    close();
                  },
                }}
              />
            </div>
          )}
        </Popover>
      </div>
    </IconRow>
  );
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function ParticipantsRow({ data, set, calendarId, hint = false }: RowProps & { calendarId: string; hint?: boolean }) {
  const t = useT();
  const keys = useKeyboardUi();
  const [input, setInput] = useState('');

  const add = () => {
    const emails = input
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => EMAIL.test(s));
    if (!emails.length) return;
    const known = new Set(data.attendees.map((a) => a.email.toLowerCase()));
    const { accounts, calendars } = useData.getState();
    const account = accounts.find((a) => a.id === calendars.find((c) => c.id === calendarId)?.accountId);
    set({
      attendees: [...data.attendees, ...emails.filter((e) => !known.has(e.toLowerCase())).map((email) => ({ email }))],
      organizer: data.organizer ?? (account?.email ? { email: account.email, name: account.name } : undefined),
    });
    setInput('');
  };

  return (
    <IconRow icon={<Users size={18} />} label={t('editor.participants')}>
      <div className="field flex flex-wrap items-center gap-1.5 py-1">
        {data.attendees.map((a) => (
          <span key={a.email} className="bg-bg-strong flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-[0.8125rem]">
            {a.name ?? a.email}
            <button type="button" aria-label={t('editor.removeParticipant')} className="hover:bg-border rounded-full p-0.5" onClick={() => set({ attendees: data.attendees.filter((x) => x.email !== a.email) })}>
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          className="field-plain min-w-[9rem] flex-1 py-0.5"
          value={input}
          type="email"
          placeholder={data.attendees.length ? '' : t('editor.participants')}
          aria-label={t('editor.participants')}
          onChange={(e) => setInput(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            // With an address typed, Enter adds it; an empty field lets the form submit.
            if ((e.key === 'Enter' && input.trim()) || e.key === ',') {
              e.preventDefault();
              add();
            } else if (e.key === 'Backspace' && !input && data.attendees.length) {
              set({ attendees: data.attendees.slice(0, -1) });
            }
          }}
        />
        {/* A soft keyboard's Enter may not reach the field: a button adds the address too. */}
        {input.trim() && (
          <button
            type="button"
            // Keeps the focus (and the soft keyboard) in the field for the next address.
            onPointerDown={(e) => e.preventDefault()}
            onClick={add}
            className="bg-primary-weak text-primary hover:bg-primary hover:text-primary-contrast relative shrink-0 rounded-full px-2.5 py-0.5 text-[0.8125rem] font-semibold transition-colors pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:top-1/2 pointer-coarse:after:h-11 pointer-coarse:after:-translate-y-1/2"
          >
            {t('editor.addParticipant')}
          </button>
        )}
      </div>
      {hint && <p className="text-text-hint mt-1 text-xs">{keys ? t('editor.participantsHint') : t('editor.participantsHintTouch')}</p>}
    </IconRow>
  );
}

export function LocationRow({ data, set }: RowProps) {
  const t = useT();
  return (
    <IconRow icon={<MapPin size={18} />} label={t('editor.location')}>
      <input className="field" value={data.location} onChange={(e) => set({ location: e.target.value })} placeholder={t('editor.location')} aria-label={t('editor.location')} />
    </IconRow>
  );
}

/** Description that grows with its text, up to a limit. */
export function DescriptionRow({ data, set, rows = 2 }: RowProps & { rows?: number }) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 240)}px`;
  }, [data.description]);
  return (
    <IconRow icon={<AlignLeft size={18} />} label={t('editor.description')}>
      <textarea
        ref={ref}
        className="field block resize-y"
        rows={rows}
        value={data.description}
        onChange={(e) => set({ description: e.target.value })}
        placeholder={t('editor.description')}
        aria-label={t('editor.description')}
      />
    </IconRow>
  );
}
