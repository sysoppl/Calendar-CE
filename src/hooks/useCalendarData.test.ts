import { describe, expect, it } from 'vitest';
import { createEventIcs, expandEvent } from '@/lib/ical/events';
import { parseObject, type RawObject } from '@/lib/ical/parse';
import type { EventData } from '@/lib/ical/types';
import { useData, type Calendar } from '@/store/data';
import { currentOccurrence } from './useCalendarData';

const calendar: Calendar = { id: 'local|personal', accountId: 'local', remoteId: 'personal', name: 'Personal', color: '#2d772a', components: ['VEVENT'], readOnly: false, visible: true, order: 0 };
const event = (start: Date, over: Partial<EventData> = {}) =>
  createEventIcs({ uid: 'dentist', title: 'Dentist', description: '', location: '', start, end: new Date(start.getTime() + 3600_000), allDay: false, timezone: 'Europe/Warsaw', alarms: [], busy: true, attendees: [], categories: [], ...over });
const store = (data: string, etag: string) => {
  const raw: RawObject = { url: 'dentist.ics', etag, calendarId: calendar.id, data };
  useData.setState({ calendars: [calendar], objects: { [calendar.id]: { [raw.url]: raw } } });
  return raw;
};

describe('currentOccurrence', () => {
  it('finds an event a sync moved since it was read', () => {
    const raw = store(event(new Date(2026, 9, 14, 9)), '"1"');
    const [shown] = expandEvent(parseObject(raw)!, new Date(2026, 9, 1), new Date(2026, 10, 1));
    store(event(new Date(2026, 9, 16, 15)), '"2"');
    expect(currentOccurrence(shown)?.start).toEqual(new Date(2026, 9, 16, 15));
  });

  it('finds an instance of a series by its key, also when it was moved', () => {
    const series = event(new Date(2026, 9, 5, 9), { rrule: { freq: 'WEEKLY', interval: 1 } });
    const raw = store(series, '"1"');
    const shown = expandEvent(parseObject(raw)!, new Date(2026, 9, 12), new Date(2026, 9, 13))[0];
    const moved = series.replace(
      'END:VCALENDAR',
      'BEGIN:VEVENT\r\nUID:dentist\r\nRECURRENCE-ID;TZID=Europe/Warsaw:20261012T090000\r\nDTSTART;TZID=Europe/Warsaw:20261013T170000\r\nDTEND;TZID=Europe/Warsaw:20261013T180000\r\nSUMMARY:Dentist (moved)\r\nEND:VEVENT\r\nEND:VCALENDAR',
    );
    store(moved, '"2"');
    expect(currentOccurrence(shown)).toMatchObject({ key: shown.key, start: new Date(2026, 9, 13, 17), title: 'Dentist (moved)' });
  });

  it('finds nothing once the event is gone', () => {
    const raw = store(event(new Date(2026, 9, 14, 9)), '"1"');
    const [shown] = expandEvent(parseObject(raw)!, new Date(2026, 9, 1), new Date(2026, 10, 1));
    useData.setState({ objects: { [calendar.id]: {} } });
    expect(currentOccurrence(shown)).toBeUndefined();
  });
});
