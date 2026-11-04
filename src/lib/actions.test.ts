// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventIcs, eventDataFor, expandEvent } from '@/lib/ical/events';
import { parseObject } from '@/lib/ical/parse';
import { emptyTask } from '@/lib/ical/tasks';
import { useData } from '@/store/data';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { saveEvent, saveTask, syncNow } from './actions';

afterEach(() => {
  useSettings.getState().update({ language: 'en' });
  useUi.setState({ toasts: [] });
});

/** An event that was open in the editor and is gone from the store since (deleted on the server, say). */
function goneEvent() {
  const start = new Date(2026, 9, 12, 9);
  const ics = createEventIcs({ uid: 'gone', title: 'Gone', description: '', location: '', start, end: start, allDay: false, timezone: 'UTC', alarms: [], busy: true, attendees: [], categories: [] });
  const obj = parseObject({ url: 'https://dav.example.com/cal/gone.ics', etag: '"1"', calendarId: 'local|personal', data: ics })!;
  const [occ] = expandEvent(obj, new Date(2026, 9, 1), new Date(2026, 10, 1));
  return { occ, data: eventDataFor(obj, occ) };
}

describe('saving an item that is gone', () => {
  it('says so in the user\'s language', async () => {
    useData.setState({ objects: {} });
    useSettings.getState().update({ language: 'pl' });
    const missing = 'Nie znaleziono elementu. Mógł zostać usunięty na serwerze.';

    const { occ, data } = goneEvent();
    expect(await saveEvent({ mode: 'edit', data, calendarId: occ.calendarId, occurrence: occ }, data, occ.calendarId)).toBe(false);
    expect(useUi.getState().toasts.at(-1)).toMatchObject({ message: missing, kind: 'error' });

    const task = emptyTask({ uid: 'gone-task', title: 'Gone' });
    expect(await saveTask({ mode: 'edit', data: task, calendarId: 'local|tasks', objectUrl: 'https://dav.example.com/tasks/gone.ics' }, task, 'local|tasks')).toBe(false);
    expect(useUi.getState().toasts.at(-1)).toMatchObject({ message: missing, kind: 'error' });
  });
});

describe('a refresh by hand', () => {
  const DAV = { id: 'dav1', kind: 'caldav' as const, name: 'Server', serverUrl: 'https://dav.example.org/', username: 'me', password: 'secret', useProxy: false };

  it('says nothing when it worked, and why when it did not', async () => {
    const syncAccount = vi.fn(() => Promise.resolve());
    const original = useData.getState().syncAccount;
    useData.setState({ accounts: [DAV], calendars: [], syncAccount });
    try {
      await syncNow();
      expect(syncAccount).toHaveBeenCalledWith('dav1');
      expect(useUi.getState().toasts).toEqual([]);

      syncAccount.mockImplementation(() => Promise.reject(new Error('Server down')));
      await syncNow(true);
      expect(useUi.getState().toasts).toEqual([]);
      await syncNow();
      expect(useUi.getState().toasts.at(-1)).toMatchObject({ kind: 'error', message: expect.stringContaining('Server down') });
    } finally {
      useData.setState({ accounts: [], syncAccount: original });
    }
  });
});
