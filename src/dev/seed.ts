// Development helper: fills the local calendars with realistic sample data.
// Exposed as window.__calendarSeed() in dev builds only.
import { addDays, differenceInCalendarWeeks, startOfMonth, startOfWeek } from 'date-fns';
import { LOCAL_ACCOUNT_ID, useData } from '@/store/data';
import { createEventIcs } from '@/lib/ical/events';
import { swatchColor } from '@/theme/themes';
import { createTaskIcs, emptyTask } from '@/lib/ical/tasks';
import { newUid } from '@/lib/ical/parse';
import { localTimezone } from '@/lib/ical/timezone';
import type { EventData } from '@/lib/ical/types';
import type { WriteOp } from '@/lib/ical/events';

export async function seedDemo() {
  while (!useData.getState().hydrated) await new Promise((r) => setTimeout(r, 50));
  const store = useData.getState();
  // A fresh install has no local calendars until the welcome screen asks for them.
  await store.setupLocalDefaults();
  const own = () => useData.getState().calendars.filter((c) => c.accountId === LOCAL_ACCOUNT_ID && !c.readOnly);
  let work = own().find((c) => c.name === 'Work');
  if (!work) work = await store.createCalendar(LOCAL_ACCOUNT_ID, { name: 'Work', color: swatchColor('blue'), components: ['VEVENT'] });
  let family = own().find((c) => c.name === 'Family');
  if (!family) family = await store.createCalendar(LOCAL_ACCOUNT_ID, { name: 'Family', color: swatchColor('gold'), components: ['VEVENT'] });
  const personal = own().find((c) => c.components.includes('VEVENT') && c.id !== work!.id && c.id !== family!.id)?.id ?? work.id;
  const tasks = own().find((c) => c.components.includes('VTODO'))!.id;

  const week = startOfWeek(new Date(), { weekStartsOn: 1 });
  const at = (day: number, h: number, m = 0) => {
    const d = addDays(week, day);
    d.setHours(h, m, 0, 0);
    return d;
  };
  // The first week of the month, so that a month view is full from its first row, not only from this week on.
  const monthWeek = startOfWeek(startOfMonth(new Date()), { weekStartsOn: 1 });
  const thisWeek = differenceInCalendarWeeks(week, monthWeek, { weekStartsOn: 1 });
  const atM = (day: number, h: number, m = 0) => at(day - thisWeek * 7, h, m);
  const ev = (calendarId: string, title: string, start: Date, end: Date, extra: Partial<EventData> = {}): WriteOp => {
    const uid = newUid();
    return {
      type: 'create',
      calendarId,
      uid,
      data: createEventIcs({
        uid,
        title,
        description: '',
        location: '',
        start,
        end,
        allDay: false,
        timezone: localTimezone(),
        alarms: [10],
        busy: true,
        attendees: [],
        categories: [],
        ...extra,
      }),
    };
  };

  const ops: WriteOp[] = [
    ev(work.id, 'Daily standup', atM(0, 9, 30), atM(0, 9, 45), { rrule: { freq: 'WEEKLY', interval: 1, byDay: ['MO', 'TU', 'WE', 'TH', 'FR'] }, location: 'https://meet.jit.si/team-standup' }),
    ev(work.id, 'Sprint planning', at(0, 10, 0), at(0, 11, 30), { description: 'Plan the next two weeks.\nBoard: https://example.com/board', attendees: [{ email: 'anna@example.com', name: 'Anna Nowak', status: 'ACCEPTED' }, { email: 'tom@example.com', status: 'TENTATIVE' }], organizer: { email: 'me@example.com', name: 'Me' } }),
    ev(work.id, 'Design review', at(1, 13, 0), at(1, 14, 0), { location: 'Room 4.02' }),
    ev(work.id, '1:1 with Kasia', at(1, 13, 30), at(1, 14, 0)),
    // Invitations from others: set "My email addresses" to me@example.com to answer them.
    ev(work.id, 'Offsite kickoff', at(2, 10, 0), at(2, 11, 30), {
      location: 'Room 2.11',
      organizer: { email: 'anna@example.com', name: 'Anna Nowak' },
      attendees: [{ email: 'me@example.com', name: 'Me' }, { email: 'tom@example.com', name: 'Tom Lee', status: 'ACCEPTED' }],
    }),
    ev(work.id, 'Vendor demo', at(4, 14, 0), at(4, 15, 0), {
      organizer: { email: 'tom@example.com', name: 'Tom Lee' },
      attendees: [{ email: 'me@example.com', name: 'Me', status: 'DECLINED' }, { email: 'anna@example.com', name: 'Anna Nowak', status: 'TENTATIVE' }],
    }),
    ev(work.id, 'Customer call', at(2, 15, 0), at(2, 16, 0), { status: 'TENTATIVE' }),
    ev(work.id, 'Deep work', at(3, 8, 0), at(3, 11, 0), { busy: true, color: swatchColor('indigo') }),
    ev(work.id, 'Release 2.4', at(3, 16, 0), at(3, 17, 0)),
    ev(personal, 'Lunch with Ola', at(2, 12, 30), at(2, 13, 30), { location: 'Cafe Botanica' }),
    ev(personal, 'Gym', atM(0, 18, 0), atM(0, 19, 15), { rrule: { freq: 'WEEKLY', interval: 1, byDay: ['MO', 'TH'] } }),
    ev(personal, 'Dentist', at(4, 11, 0), at(4, 11, 45)),
    ev(family.id, 'Dinner at parents', at(5, 17, 0), at(5, 20, 0)),
    ev(family.id, 'Weekend in the mountains', addDays(week, 5), addDays(week, 7), { allDay: true, alarms: [], busy: false }),
    ev(family.id, "Mom's birthday", addDays(week, 9), addDays(week, 10), { allDay: true, rrule: { freq: 'YEARLY', interval: 1 }, alarms: [900] }),
    // A birth date and a wedding day: the views show the age and the anniversary.
    ev(family.id, "Anna's birthday", addDays(week, 3), addDays(week, 4), { allDay: true, rrule: { freq: 'YEARLY', interval: 1 }, alarms: [900], busy: false, since: new Date(week.getFullYear() - 36, week.getMonth(), week.getDate() + 3) }),
    ev(family.id, 'Wedding anniversary', addDays(week, 6), addDays(week, 7), { allDay: true, rrule: { freq: 'YEARLY', interval: 1 }, alarms: [900], busy: false, since: new Date(week.getFullYear() - 10, week.getMonth(), week.getDate() + 6) }),
    // Shown as "Hidden event" until it is opened.
    ev(personal, 'Doctor’s appointment', at(4, 16, 30), at(4, 17, 30), { hidden: true, location: 'Medical centre' }),
    ev(personal, 'Concert', at(11, 20, 0), at(11, 23, 0), { location: 'Stodoła' }),
    ev(work.id, 'Quarterly review', at(15, 10, 0), at(15, 12, 0)),
    ev(personal, 'Yoga', atM(2, 19, 0), atM(2, 20, 0), { rrule: { freq: 'WEEKLY', interval: 1, byDay: ['WE'] } }),
    ev(work.id, 'Team retro', atM(4, 15, 0), atM(4, 16, 0), { rrule: { freq: 'WEEKLY', interval: 2, byDay: ['FR'] } }),
    // The other weeks of the month, one plan or two a day here and there, as in this one.
    ...[
      ['Project kickoff', 1, 10, 'Car service', 3, 8, 'Brunch with Ola', 6, 11],
      ['Budget meeting', 1, 14, 'Parents evening at school', 3, 18, 'Bike trip', 5, 9],
      ['Workshop: accessibility', 2, 9, 'Haircut', 4, 17, 'Cinema', 6, 19],
      ['Board update', 0, 11, 'Plumber visit', 3, 12, 'Farmers market', 5, 10],
      ['Hackathon', 2, 10, 'Piano lesson', 4, 18, 'Family lunch', 6, 13],
    ].flatMap(([a, ad, ah, b, bd, bh, c, cd, ch], i) => {
      const w = i < thisWeek ? i : i + 1;
      const day = (d: unknown, h: unknown, hours = 1) => [atM(w * 7 + Number(d), Number(h)), atM(w * 7 + Number(d), Number(h) + hours)] as const;
      return [
        ev(work.id, String(a), ...day(ad, ah)),
        ev(personal, String(b), ...day(bd, bh)),
        ev(family.id, String(c), ...day(cd, ch, 2)),
      ];
    }),
  ];

  const now = new Date();
  const taskOps: WriteOp[] = [
    { title: 'Send invoice to client', due: addDays(now, -1), priority: 1 },
    { title: 'Book flights for conference', due: now, priority: 5 },
    { title: 'Prepare slides for review', due: addDays(now, 1) },
    { title: 'Renew passport', due: addDays(now, 6), priority: 9 },
    { title: 'Read "Designing Data-Intensive Applications"' },
    { title: 'Water the plants', due: addDays(now, 2), rrule: { freq: 'WEEKLY' as const, interval: 1 } },
  ].map((t) => {
    const data = emptyTask({ ...t, due: t.due ? new Date(t.due.getFullYear(), t.due.getMonth(), t.due.getDate()) : undefined });
    return { type: 'create', calendarId: tasks, uid: data.uid, data: createTaskIcs(data) };
  });

  await store.applyOps([...ops, ...taskOps]);
}
