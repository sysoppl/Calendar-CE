import { useState } from 'react';
import { useUi, errorMessage } from '@/store/ui';
import { defaultAccountId, isGeneratedCalendar, useData } from '@/store/data';
import { useT } from '@/i18n';
import type { ComponentType } from '@/lib/dav/client';
import { randomCalendarColor } from '@/theme/themes';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Controls';
import { ColorPicker } from '@/components/ui/ColorPicker';
import { confirmDeleteCalendar } from '@/components/layout/Sidebar';
import { calendarAlarmsOf, cleanEntry, withCalendarAlarms, type CalendarAlarms } from '@/lib/calendarAlarms';
import { changeSettings } from '@/lib/saveFeedback';
import { useSettings } from '@/store/settings';
import { CalendarAlarmsFields } from './CalendarAlarmsFields';

export function CalendarDialog() {
  const state = useUi((s) => s.calendarDialog);
  if (!state) return null;
  return <CalendarForm key={state.calendarId ?? state.kind} calendarId={state.calendarId} kind={state.kind} />;
}

function CalendarForm({ calendarId, kind }: { calendarId?: string; kind: 'events' | 'tasks' }) {
  const t = useT();
  const close = () => useUi.getState().openCalendarDialog(null);
  const accounts = useData((s) => s.accounts);
  const existing = useData((s) => s.calendars.find((c) => c.id === calendarId));
  const [name, setName] = useState(existing?.name ?? '');
  const [color, setColor] = useState(existing?.color ?? randomCalendarColor());
  const [description, setDescription] = useState(existing?.description ?? '');
  const [accountId, setAccountId] = useState(existing?.accountId ?? defaultAccountId());
  const [type, setType] = useState<'events' | 'tasks' | 'both'>(kind);
  const [alarms, setAlarms] = useState<CalendarAlarms>(() => calendarAlarmsOf(calendarId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default notifications are for calendars new events can go to.
  const holdsEvents = existing ? existing.components.includes('VEVENT') : type !== 'tasks';
  const showAlarms = holdsEvents && (!existing || (!isGeneratedCalendar(existing) && !existing.readOnly));

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      let id = existing?.id;
      if (existing) {
        await useData.getState().updateCalendar(existing.id, { name: name.trim(), color, description });
      } else {
        const components: ComponentType[] = type === 'events' ? ['VEVENT'] : type === 'tasks' ? ['VTODO'] : ['VEVENT', 'VTODO'];
        id = (await useData.getState().createCalendar(accountId, { name: name.trim(), color, components, description: description || undefined })).id;
      }
      // A change of the defaults is a change of the settings, which says
      // itself what became of it (saved, waiting for a connection, …).
      const next = cleanEntry(alarms) ?? {};
      if (id && showAlarms && JSON.stringify(next) !== JSON.stringify(calendarAlarmsOf(id))) {
        changeSettings({ calendarAlarms: withCalendarAlarms(useSettings.getState().calendarAlarms, id, next) });
      } else {
        useUi.getState().toast(t('toast.calendarSaved'), 'success');
      }
      close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const title = existing ? `${t('sidebar.edit')} · ${existing.name}` : kind === 'tasks' ? t('settings.newTaskList') : t('settings.newCalendar');

  return (
    <Modal
      open
      onClose={close}
      size="md"
      title={title}
      initialFocus="#cal-name"
      footer={
        <>
          {existing && (!existing.readOnly || isGeneratedCalendar(existing)) && (
            <Button
              variant="ghost"
              className="text-danger mr-auto"
              onClick={() => {
                close();
                void confirmDeleteCalendar(existing);
              }}
            >
              {t('sidebar.delete')}
            </Button>
          )}
          <Button onClick={close}>{t('settings.cancel')}</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void submit()}>
            {t('settings.save')}
          </Button>
        </>
      }
    >
      <form
        className="pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={t('settings.calendarName')} htmlFor="cal-name">
          <input id="cal-name" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
        </Field>
        <Field label={t('settings.calendarColor')}>
          <ColorPicker value={color} onChange={setColor} />
        </Field>
        <Field label={t('settings.calendarDescription')} htmlFor="cal-desc">
          <textarea id="cal-desc" className="field resize-y" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {!existing && (
          <>
            <Field label={t('settings.calendarAccount')} htmlFor="cal-account">
              <select id="cal-account" className="field" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.kind === 'local' ? t('settings.local') : a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('settings.calendarType')} htmlFor="cal-type">
              <select id="cal-type" className="field" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                <option value="events">{t('settings.calendarType.events')}</option>
                <option value="tasks">{t('settings.calendarType.tasks')}</option>
                <option value="both">{t('settings.calendarType.both')}</option>
              </select>
            </Field>
          </>
        )}
        {showAlarms && <CalendarAlarmsFields value={alarms} onChange={setAlarms} />}
        {error && <p className="text-danger text-[0.8125rem]">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
