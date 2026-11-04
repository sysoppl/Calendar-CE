// @vitest-environment jsdom
// Live test against a real CalDAV server. Skipped unless configured:
//   CALDAV_TEST_URL=http://127.0.0.1:5232/ CALDAV_TEST_USER=alice CALDAV_TEST_PASS=secret npm test
import { describe, expect, it } from 'vitest';
import { CalDavClient } from './client';
import { directTransport } from './transport';
import { createEventIcs, expandEvent, updateEvent } from '../ical/events';
import { createTaskIcs, emptyTask, readTask, setTaskCompleted } from '../ical/tasks';
import { parseObject } from '../ical/parse';

const url = process.env.CALDAV_TEST_URL;
const user = process.env.CALDAV_TEST_USER ?? '';
const pass = process.env.CALDAV_TEST_PASS ?? '';

describe.skipIf(!url)('CalDAV server integration', () => {
  const client = new CalDavClient(directTransport, { username: user, password: pass });

  it('runs a full lifecycle: discover, create calendar, sync, edit, delete', async () => {
    const info = await client.discover(url!);
    expect(info.homeUrl).toMatch(/^https?:\/\//);

    const calUrl = await client.createCalendar(info.homeUrl, { displayName: 'Calendar test', color: '#069C8DFF', components: ['VEVENT', 'VTODO'] });
    try {
      const cals = await client.listCalendars(info.homeUrl);
      const cal = cals.find((c) => c.url.replace(/\/$/, '') === calUrl.replace(/\/$/, ''));
      expect(cal).toMatchObject({ displayName: 'Calendar test', color: '#069c8d' });
      expect(cal!.components).toEqual(expect.arrayContaining(['VEVENT', 'VTODO']));

      // Create a recurring event.
      const uid = `itest-${Date.now()}@calendar.example.org`;
      const ics = createEventIcs({
        uid,
        title: 'Integration standup',
        description: 'zażółć gęślą jaźń',
        location: 'Room 1',
        start: new Date(2026, 9, 12, 9, 0),
        end: new Date(2026, 9, 12, 9, 15),
        allDay: false,
        timezone: 'Europe/Warsaw',
        rrule: { freq: 'WEEKLY', interval: 1, byDay: ['MO', 'WE'] },
        alarms: [10],
        busy: true,
        attendees: [],
        categories: [],
      });
      const objUrl = new URL(`${uid}.ics`, calUrl).toString();
      const etag1 = await client.putObject(objUrl, ics);

      const refs = await client.listObjects(calUrl);
      expect(refs).toHaveLength(1);
      const [fetched] = await client.multiget(calUrl, refs.map((r) => r.url));
      expect(fetched.data).toContain('zażółć gęślą jaźń');
      const etag = etag1 ?? fetched.etag;

      // Initial sync token, then edit a single occurrence and sync incrementally.
      const before = (await client.getCalendar(calUrl))!;
      const obj = parseObject({ url: objUrl, etag, calendarId: 'c', data: fetched.data })!;
      const occs = expandEvent(obj, new Date(2026, 9, 12), new Date(2026, 9, 19));
      expect(occs.map((o) => o.start.getDate())).toEqual([12, 14]);
      const [op] = updateEvent(obj, occs[1], { ...occs[1], ...{ uid, title: 'Moved standup', description: '', location: '', start: new Date(2026, 9, 14, 11), end: new Date(2026, 9, 14, 11, 30), allDay: false, timezone: 'Europe/Warsaw', alarms: [], busy: true, attendees: [], categories: [] } }, 'single');
      await client.putObject(objUrl, (op as { data: string }).data, 'update', etag);

      if (before.syncToken) {
        const delta = await client.syncCollection(calUrl, before.syncToken);
        expect(delta?.changed.map((c) => c.url)).toEqual([objUrl]);
      }

      const again = (await client.multiget(calUrl, [objUrl]))[0];
      const updated = parseObject({ url: objUrl, etag: again.etag, calendarId: 'c', data: again.data })!;
      const titles = expandEvent(updated, new Date(2026, 9, 12), new Date(2026, 9, 19)).map((o) => o.title);
      expect(titles).toEqual(['Integration standup', 'Moved standup']);

      // Stale etag must be rejected.
      await expect(client.putObject(objUrl, again.data, 'update', '"stale"')).rejects.toMatchObject({ status: 412 });

      // Tasks.
      const task = emptyTask({ title: 'Integration task', due: new Date(2026, 9, 20) });
      const taskUrl = new URL(`${task.uid}.ics`, calUrl).toString();
      await client.putObject(taskUrl, createTaskIcs(task));
      const taskObj = (await client.getObject(taskUrl))!;
      const parsedTask = parseObject({ url: taskUrl, etag: taskObj.etag, calendarId: 'c', data: taskObj.data })!;
      await client.putObject(taskUrl, setTaskCompleted(parsedTask, true), 'update', taskObj.etag);
      const doneObj = (await client.getObject(taskUrl))!;
      expect(readTask(parseObject({ url: taskUrl, etag: doneObj.etag, calendarId: 'c', data: doneObj.data })!)?.completed).toBe(true);

      // Rename + recolour.
      await client.updateCalendar(calUrl, { displayName: 'Renamed', color: '#E83557FF' });
      expect(await client.getCalendar(calUrl)).toMatchObject({ displayName: 'Renamed', color: '#e83557' });

      // Delete.
      await client.deleteObject(objUrl, again.etag);
      expect((await client.listObjects(calUrl)).map((r) => r.url)).toEqual([taskUrl]);
    } finally {
      await client.deleteCalendar(calUrl);
    }
  }, 30000);

  it('rejects bad credentials with a clear error', async () => {
    const bad = new CalDavClient(directTransport, { username: user, password: 'wrong' });
    await expect(bad.discover(url!)).rejects.toMatchObject({ status: 401 });
  });
});
