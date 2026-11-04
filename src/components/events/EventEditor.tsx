import { useEffect, useMemo, useState } from 'react';
import { Repeat, Bell, Eye, Globe, Link2, Tag } from 'lucide-react';
import { useUi, type EventEditorState } from '@/store/ui';
import { calendarsFor, canDeleteItems, useData } from '@/store/data';
import { useT } from '@/i18n';
import { deleteOccurrence, saveEvent } from '@/lib/actions';
import { defaultAlarmsFor, sameAlarms } from '@/lib/calendarAlarms';
import { isRangeInvalid } from '@/lib/eventTimes';
import { localTimezone } from '@/lib/ical/timezone';
import { presetRule } from '@/lib/ical/recurrence';
import type { EventData, EventStatus } from '@/lib/ical/types';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { IconRow as Row } from '@/components/ui/Controls';
import { CalendarRow, DateTimeRow, DescriptionRow, LocationRow, MilestoneRow, ParticipantsRow, TitleRow } from './EventFields';
import { RecurrenceFields } from './RecurrenceFields';
import { AlarmFields } from './AlarmFields';

export function EventEditor() {
  const state = useUi((s) => s.eventEditor);
  if (!state) return null;
  return <EditorForm key={state.occurrence?.key ?? state.data.uid} state={state} />;
}

function allTimezones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
  } catch {
    return [localTimezone(), 'UTC'];
  }
}

/** The full event form: the quick-create rows plus everything else an event can carry. */
function EditorForm({ state }: { state: EventEditorState }) {
  const t = useT();
  const close = () => useUi.getState().openEventEditor(null);
  const calendars = useData((s) => s.calendars);
  const writable = useMemo(() => calendarsFor('VEVENT', calendars).filter((c) => !c.readOnly || c.id === state.calendarId), [calendars, state.calendarId]);
  const [data, setData] = useState<EventData>(state.data);
  const [calendarId, setCalendarId] = useState(state.calendarId);
  const [saving, setSaving] = useState(false);
  // Bumped when a birth date makes the event yearly: the repeat control then starts again from the rule.
  const [repeatSet, setRepeatSet] = useState(0);
  const [showTz, setShowTz] = useState(!state.data.allDay && state.data.timezone !== localTimezone() && state.data.timezone !== 'floating');
  // Kept as typed: the parsed list would drop the comma the moment it is entered.
  const [categories, setCategories] = useState(state.data.categories.join(', '));
  const timezones = useMemo(allTimezones, []);
  const calendar = calendars.find((c) => c.id === calendarId);

  // A new event's notifications are its calendar's defaults (lib/calendarAlarms.ts)
  // until they are changed here: while untouched, they follow the calendar
  // chosen and the kind of event (timed or all-day). Changed ones stay, and an
  // existing event's are never touched. A draft that comes with others than
  // the defaults counts as changed.
  const [alarmsTouched, setAlarmsTouched] = useState(() => state.mode !== 'create' || !sameAlarms(state.data.alarms, defaultAlarmsFor(state.calendarId, state.data.allDay)));
  const set = (patch: Partial<EventData>) =>
    setData((d) => {
      const allDayChanged = patch.allDay !== undefined && patch.allDay !== d.allDay;
      return { ...d, ...patch, ...(allDayChanged && !alarmsTouched ? { alarms: defaultAlarmsFor(calendarId, patch.allDay!) } : {}) };
    });
  const chooseCalendar = (id: string) => {
    setCalendarId(id);
    if (!alarmsTouched) setData((d) => ({ ...d, alarms: defaultAlarmsFor(id, d.allDay) }));
  };
  const invalid = isRangeInvalid(data);

  const submit = async () => {
    // Enter and Ctrl+Enter bypass the disabled button; a prompt may be open.
    if (invalid || saving || useUi.getState().scopePrompt || useUi.getState().confirmPrompt) return;
    setSaving(true);
    const ok = await saveEvent(state, data, calendarId);
    setSaving(false);
    if (ok) close();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <Modal
      open
      onClose={close}
      size="lg"
      fullscreenOnMobile
      initialFocus="input[name=title]"
      title={state.mode === 'create' ? t('editor.create') : t('editor.editTitle')}
      footer={
        <>
          {state.mode === 'edit' && state.occurrence && canDeleteItems(calendars.find((c) => c.id === state.occurrence!.calendarId)) && (
            <Button
              variant="ghost"
              className="text-danger mr-auto"
              onClick={async () => {
                if (await deleteOccurrence(state.occurrence!)) close();
              }}
            >
              {t('editor.delete')}
            </Button>
          )}
          <Button onClick={close}>{t('editor.cancel')}</Button>
          <Button variant="primary" onClick={() => void submit()} loading={saving} disabled={invalid || calendar?.readOnly}>
            {t('editor.save')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-4 pb-2"
      >
        <TitleRow data={data} set={set} />

        <DateTimeRow data={data} set={set}>
          {!data.allDay && !showTz && (
            <button type="button" className="text-text-weak hover:text-text flex min-w-0 items-center gap-1.5 text-[0.8125rem]" onClick={() => setShowTz(true)}>
              <Globe size={14} className="shrink-0" />
              <span className="truncate">{(data.timezone === 'floating' ? localTimezone() : data.timezone).replace(/_/g, ' ')}</span>
            </button>
          )}
        </DateTimeRow>
        {!data.allDay && showTz && (
          <Row icon={<Globe size={18} />} label={t('editor.timezone')}>
            <select className="field" value={data.timezone} onChange={(e) => set({ timezone: e.target.value })} aria-label={t('editor.timezone')}>
              {[...new Set([data.timezone, localTimezone(), ...timezones])].map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Row>
        )}

        <MilestoneRow
          data={data}
          set={set}
          repeats={!!data.rrule || !!data.ruleAsWritten}
          repeatYearly={() => {
            set({ rrule: presetRule('yearly', data.start) });
            setRepeatSet((n) => n + 1);
          }}
        />

        <Row icon={<Repeat size={18} />} label={t('editor.repeat')}>
          <RecurrenceFields
            key={repeatSet}
            rule={data.rrule}
            asWritten={data.ruleAsWritten}
            start={data.start}
            onChange={(rrule, ruleAsWritten) => set({ rrule, ruleAsWritten })}
            initialCustom={!repeatSet && state.customRepeat}
          />
        </Row>

        <CalendarRow data={data} set={set} calendars={writable} calendarId={calendarId} onCalendar={chooseCalendar} />
        <ParticipantsRow data={data} set={set} calendarId={calendarId} hint />
        <LocationRow data={data} set={set} />

        <Row icon={<Bell size={18} />} label={t('editor.notifications')}>
          <AlarmFields
            alarms={data.alarms}
            allDay={data.allDay}
            onChange={(alarms) => {
              setAlarmsTouched(true);
              set({ alarms });
            }}
          />
        </Row>

        <DescriptionRow data={data} set={set} rows={3} />

        <Row icon={<Eye size={18} />} label={t('editor.showAs')}>
          <div className="flex flex-wrap gap-2">
            <select className="field w-auto" value={data.busy ? 'busy' : 'free'} onChange={(e) => set({ busy: e.target.value === 'busy' })} aria-label={t('editor.showAs')}>
              <option value="busy">{t('event.busy')}</option>
              <option value="free">{t('event.free')}</option>
            </select>
            <select
              className="field w-auto"
              value={data.status ?? ''}
              onChange={(e) => set({ status: (e.target.value || undefined) as EventStatus | undefined })}
              aria-label={t('editor.status')}
            >
              <option value="">{t('editor.status')}: —</option>
              <option value="CONFIRMED">{t('event.confirmed')}</option>
              <option value="TENTATIVE">{t('event.tentative')}</option>
              <option value="CANCELLED">{t('event.cancelled')}</option>
            </select>
          </div>
        </Row>

        <Row icon={<Link2 size={18} />} label={t('editor.url')}>
          <input className="field" type="url" value={data.url ?? ''} onChange={(e) => set({ url: e.target.value || undefined })} placeholder="https://" aria-label={t('editor.url')} />
        </Row>

        <Row icon={<Tag size={18} />} label={t('editor.categories')}>
          <input
            className="field"
            value={categories}
            onChange={(e) => {
              setCategories(e.target.value);
              set({
                categories: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              });
            }}
            placeholder={t('editor.categoriesHint')}
            aria-label={t('editor.categories')}
          />
        </Row>
        <button type="submit" hidden />
      </form>
      {/* Only with a keyboard, which is what it is about. */}
      <p className="text-text-hint keys:block hidden pb-2 text-right text-[0.6875rem]">{t('editor.saveHint')}</p>
    </Modal>
  );
}
