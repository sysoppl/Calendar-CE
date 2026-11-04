// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeFormatter } from '@/hooks/useFormat';
import { eventDataFor, expandEvent, type WriteOp } from '@/lib/ical/events';
import { parseObject, type ParsedObject } from '@/lib/ical/parse';
import { readTask } from '@/lib/ical/tasks';
import { useData, type Calendar } from '@/store/data';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { TaskEditor } from '@/components/tasks/TaskEditor';
import { EventEditor } from './EventEditor';

// The editors save through the app's own actions, scope question included;
// only the store's write to a backend is replaced by a record of the writes.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let writes: WriteOp[][];
const realApplyOps = useData.getState().applyOps;

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }),
  });
  Element.prototype.checkVisibility = () => true;
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  useSettings.setState({ language: 'en' });
  writes = [];
});

afterEach(() => {
  act(() => root.unmount());
  useUi.setState({ eventEditor: null, taskEditor: null, scopePrompt: null });
  useData.setState({ calendars: [], objects: {}, applyOps: realApplyOps });
  document.body.innerHTML = '';
});

const calendar = (components: Calendar['components']): Calendar => ({ id: 'cal', accountId: 'local', name: 'Work', color: '#069c8d', components, readOnly: false, visible: true, order: 0 });

const parse = (lines: string[]) => parseObject({ url: 'https://x.test/cal/a.ics', etag: '"1"', calendarId: 'cal', data: ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:test', ...lines, 'END:VCALENDAR', ''].join('\r\n') })!;

/** Puts `obj` into the store, where the actions look it up, and records what they write. */
function store(obj: ParsedObject, components: Calendar['components']) {
  useData.setState({
    calendars: [calendar(components)],
    objects: { cal: { [obj.url]: { url: obj.url, etag: obj.etag, calendarId: obj.calendarId, data: obj.data } } },
    applyOps: async (ops) => {
      writes.push(ops);
      return ops.map((op) => (op.type === 'create' ? `https://x.test/cal/${op.uid}.ics` : op.url));
    },
  });
}

const LAST_WORK_DAY = 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1';

/**
 * A series on the last weekday of each month from January 2026 (or with
 * `rule` from `day` at 9:00), as the event editor opens it on its first
 * instance.
 */
function openSeries(rule = LAST_WORK_DAY, day = '20260130') {
  const obj = parse(['BEGIN:VEVENT', 'UID:s1', `DTSTART;TZID=Europe/Warsaw:${day}T090000`, `DTEND;TZID=Europe/Warsaw:${day}T100000`, `RRULE:${rule}`, 'SUMMARY:Review', 'END:VEVENT']);
  const [occ] = expandEvent(obj, new Date(2026, 0, 1), new Date(2026, 3, 1));
  store(obj, ['VEVENT']);
  useUi.setState({ eventEditor: { mode: 'edit', calendarId: 'cal', occurrence: occ, data: eventDataFor(obj, occ) } });
  root = createRoot(document.body.appendChild(document.createElement('div')));
  act(() => root.render(h(EventEditor)));
}

const repeatSelect = () => document.querySelector<HTMLSelectElement>('select[aria-label="Repeat"]')!;
const selectedText = (select: HTMLSelectElement) => select.selectedOptions[0]?.textContent;
const hint = 'This repeat rule cannot be edited here';

function change(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

const button = (name: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === name || b.getAttribute('aria-label') === name)!;

async function save() {
  await act(async () => button('Save').click());
}

/** The VEVENT as written after Save, answering the scope question with "All events". */
async function saveForAll() {
  await save();
  const prompt = useUi.getState().scopePrompt;
  expect(prompt?.kind).toBe('edit');
  expect(writes).toEqual([]);
  await act(async () => prompt!.resolve('all'));
  expect(writes).toHaveLength(1);
  const [op] = writes[0];
  if (op.type !== 'update') throw new Error(`Expected an update, got ${op.type}`);
  const text = op.data.replace(/\r/g, '');
  return text.slice(text.indexOf('BEGIN:VEVENT'));
}

describe('event editor with a repeat rule it cannot show', () => {
  it('shows the rule as a read-only custom option with its description', () => {
    openSeries();
    const select = repeatSelect();
    expect(select.value).toBe('asWritten');
    expect(selectedText(select)).toBe('Custom repeat: Monthly (on the last weekday)');
    expect(document.body.textContent).toContain(hint);
    expect(document.getElementById(select.getAttribute('aria-describedby')!)?.textContent).toContain(hint);
    // Neither the custom rule editor nor a simpler preset stands in for it.
    expect(document.querySelector('input[type="number"]')).toBeNull();
    expect([...select.options].filter((o) => o.value === 'asWritten')).toHaveLength(1);
  });

  it('shows the label in Polish', () => {
    useSettings.setState({ language: 'pl' });
    openSeries();
    expect(selectedText(document.querySelector<HTMLSelectElement>('select[aria-label="Powtarzanie"]')!)).toBe('Powtarzanie niestandardowe: Co miesiąc (ostatni dzień roboczy)');
  });

  it('says "Custom repeat rule" where the rule cannot be put into words', () => {
    openSeries('FREQ=YEARLY;BYWEEKNO=5;BYDAY=FR');
    expect(repeatSelect().value).toBe('asWritten');
    expect(selectedText(repeatSelect())).toBe('Custom repeat rule');
  });

  it('keeps the rule of a BYSETPOS series when only the title and the location change', async () => {
    openSeries();
    change(document.querySelector<HTMLInputElement>('input[name="title"]')!, 'Monthly review');
    change(document.querySelector<HTMLInputElement>('input[aria-label="Add location"]')!, 'Room 2');
    expect(repeatSelect().value).toBe('asWritten');
    const written = await saveForAll();
    expect(written).toMatch(/^SUMMARY:Monthly review$/m);
    expect(written).toMatch(/^LOCATION:Room 2$/m);
    expect(written).toMatch(/^RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1$/m);
  });

  it('keeps the rule when the start moves to another day or the event becomes all-day', async () => {
    openSeries();
    await act(async () => button('From').click());
    const day = makeFormatter('en', '24h').date(new Date(2026, 0, 27), { dateStyle: 'full' });
    await act(async () => button(day).click());
    expect(repeatSelect().value).toBe('asWritten');
    act(() => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(repeatSelect().value).toBe('asWritten');
    const written = await saveForAll();
    expect(written).toMatch(/^DTSTART;VALUE=DATE:20260127$/m);
    expect(written).toMatch(/^RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1$/m);
  });

  it('removes the rule when "Does not repeat" is chosen', async () => {
    openSeries();
    change(repeatSelect(), 'none');
    expect(document.body.textContent).not.toContain(hint);
    expect(repeatSelect().hasAttribute('aria-describedby')).toBe(false);
    expect(await saveForAll()).not.toMatch(/^(RRULE|RDATE|EXDATE)/m);
  });

  it('replaces the rule when "Weekly" is chosen', async () => {
    openSeries();
    change(repeatSelect(), 'weekly');
    expect(selectedText(repeatSelect())).toBe('Every week on Friday');
    const written = await saveForAll();
    expect(written).toMatch(/^RRULE:FREQ=WEEKLY;BYDAY=FR$/m);
    expect(written).not.toMatch(/BYSETPOS/);
  });

  it('leaves the series alone when the scope question is cancelled', async () => {
    openSeries();
    change(repeatSelect(), 'none');
    await save();
    await act(async () => useUi.getState().scopePrompt!.resolve(null));
    expect(writes).toEqual([]);
    expect(repeatSelect().value).toBe('none');
  });

  it('keeps the rule again when the custom option is chosen back', async () => {
    openSeries();
    change(repeatSelect(), 'none');
    change(repeatSelect(), 'asWritten');
    expect(await saveForAll()).toMatch(/^RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1$/m);
  });

  it('starts the custom rule editor from what of the rule it can show', async () => {
    openSeries('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=5');
    change(repeatSelect(), 'custom');
    const numbers = [...document.querySelectorAll<HTMLInputElement>('input[type="number"]')];
    expect(numbers.map((n) => n.value)).toEqual(['1', '5']);
    expect(document.querySelector<HTMLSelectElement>('select:not([aria-label])')?.value).toBe('MONTHLY');
    expect(await saveForAll()).toMatch(/^RRULE:FREQ=MONTHLY;COUNT=5;BYMONTHDAY=30$/m);
  });

  it('starts the custom rule editor of a weekly BYSETPOS rule on the day of the event', () => {
    openSeries('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1');
    change(repeatSelect(), 'custom');
    const pressed = [...document.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.getAttribute('title'));
    expect(pressed).toEqual(['Friday']);
  });

  it('shows a rule it can show as before', () => {
    openSeries('FREQ=WEEKLY;BYDAY=FR');
    expect(repeatSelect().value).toBe('weekly');
    expect([...repeatSelect().options].some((o) => o.value === 'asWritten')).toBe(false);
  });
});

/** Moves the start of the open event to `date` with the date picker. */
async function moveStart(date: Date) {
  await act(async () => button('From').click());
  await act(async () => button(makeFormatter('en', '24h').date(date, { dateStyle: 'full' })).click());
}

/** The custom rule editor's choice between a day and a weekday of the month. */
const monthlySelect = () => [...document.querySelectorAll<HTMLSelectElement>('select:not([aria-label])')].find((s) => [...s.options].some((o) => o.value === 'weekday'))!;

describe('event editor with a rule in another form of a preset', () => {
  it('shows a yearly rule with INTERVAL=1, the month, the day and WKST as "Every year on …" and keeps it as written on a title edit', async () => {
    openSeries('FREQ=YEARLY;INTERVAL=1;BYMONTHDAY=30;BYMONTH=1;WKST=SU');
    expect(repeatSelect().value).toBe('yearly');
    expect(selectedText(repeatSelect())).toBe('Every year on January 30');
    expect([...repeatSelect().options].some((o) => o.value === 'asWritten')).toBe(false);
    expect(document.body.textContent).not.toContain(hint);
    change(document.querySelector<HTMLInputElement>('input[name="title"]')!, 'Anniversary');
    expect(await saveForAll()).toMatch(/^RRULE:FREQ=YEARLY;INTERVAL=1;BYMONTHDAY=30;BYMONTH=1;WKST=SU$/m);
  });

  it('moves a folded "Every year on …" with the start, as the preset does', async () => {
    openSeries('FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=30');
    await moveStart(new Date(2026, 1, 3));
    expect(repeatSelect().value).toBe('yearly');
    expect(selectedText(repeatSelect())).toBe('Every year on February 3');
    const written = await saveForAll();
    expect(written).toMatch(/^DTSTART;TZID=Europe\/Warsaw:20260203T090000$/m);
    expect(written).toMatch(/^RRULE:FREQ=YEARLY$/m);
  });

  it('shows the working days written as a daily rule as "Every weekday" and keeps it as written', async () => {
    openSeries('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR');
    expect(repeatSelect().value).toBe('weekdays');
    change(document.querySelector<HTMLInputElement>('input[name="title"]')!, 'Stand-up');
    expect(await saveForAll()).toMatch(/^RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR$/m);
  });

  it('keeps a yearly rule in two months read-only, not as "Every year on …"', async () => {
    openSeries('FREQ=YEARLY;BYMONTH=1,7;BYMONTHDAY=30');
    expect(repeatSelect().value).toBe('asWritten');
    expect(document.body.textContent).toContain(hint);
    change(document.querySelector<HTMLInputElement>('input[name="title"]')!, 'Twice a year');
    expect(await saveForAll()).toMatch(/^RRULE:FREQ=YEARLY;BYMONTH=1,7;BYMONTHDAY=30$/m);
  });

  it('names the fourth Friday of a monthly rule on a day that is also the last Friday', async () => {
    openSeries('FREQ=MONTHLY;BYDAY=4FR', '20260227');
    expect(repeatSelect().value).toBe('custom');
    expect(selectedText(monthlySelect())).toBe('On the fourth Friday');
    change(document.querySelector<HTMLInputElement>('input[name="title"]')!, 'Review');
    expect(await saveForAll()).toMatch(/^RRULE:FREQ=MONTHLY;BYDAY=4FR$/m);
  });

  it('names the day of the month a custom rule keeps when the start moves, and offers the new start for the other choice', async () => {
    openSeries('FREQ=MONTHLY;BYMONTHDAY=30;COUNT=5');
    expect(repeatSelect().value).toBe('custom');
    await moveStart(new Date(2026, 0, 27));
    expect(selectedText(monthlySelect())).toBe('On day 30');
    expect([...monthlySelect().options].map((o) => o.textContent)).toEqual(['On day 30', 'On the last Tuesday']);
    expect(await saveForAll()).toMatch(/^RRULE:FREQ=MONTHLY;BYMONTHDAY=30;COUNT=5$/m);
  });
});

describe('task editor with a repeat rule it cannot show', () => {
  function openTask(rule = LAST_WORK_DAY) {
    const obj = parse(['BEGIN:VTODO', 'UID:t1', 'SUMMARY:Report', 'DUE;VALUE=DATE:20261030', `RRULE:${rule}`, 'END:VTODO']);
    const task = readTask(obj)!;
    store(obj, ['VTODO']);
    useUi.setState({ taskEditor: { mode: 'edit', calendarId: 'cal', objectUrl: obj.url, data: task } });
    root = createRoot(document.body.appendChild(document.createElement('div')));
    act(() => root.render(h(TaskEditor)));
  }

  const select = () => document.querySelector<HTMLSelectElement>('select[aria-label="Repeat"]')!;

  async function savedTask() {
    await save();
    expect(writes).toHaveLength(1);
    const [op] = writes[0];
    if (op.type !== 'update') throw new Error(`Expected an update, got ${op.type}`);
    return op.data.replace(/\r/g, '');
  }

  it('shows the custom label and keeps the rule on a title edit', async () => {
    openTask();
    expect(select().value).toBe('asWritten');
    expect(selectedText(select())).toBe('Custom repeat: Monthly (on the last weekday)');
    change(document.querySelector<HTMLInputElement>('input[name="title"]')!, 'Monthly report');
    expect(select().value).toBe('asWritten');
    const written = await savedTask();
    expect(written).toMatch(/^SUMMARY:Monthly report$/m);
    expect(written).toMatch(/^RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1$/m);
  });

  it('removes the rule when "Does not repeat" is chosen', async () => {
    openTask();
    change(select(), 'none');
    expect(await savedTask()).not.toMatch(/^RRULE/m);
  });

  it('replaces the rule when "Weekly" is chosen', async () => {
    openTask();
    change(select(), 'weekly');
    const written = await savedTask();
    expect(written).toMatch(/^RRULE:FREQ=WEEKLY;BYDAY=FR$/m);
    expect(written).not.toMatch(/BYSETPOS/);
  });

  it('shows a yearly rule on the month and day of the due date as "Every year on …" and keeps it as written', async () => {
    openTask('FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=30');
    expect(select().value).toBe('yearly');
    expect(selectedText(select())).toBe('Every year on October 30');
    change(document.querySelector<HTMLInputElement>('input[name="title"]')!, 'Car insurance');
    expect(await savedTask()).toMatch(/^RRULE:FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=30$/m);
  });
});
