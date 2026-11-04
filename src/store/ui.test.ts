import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NAV_HISTORY_MAX, followDefaultView, resetViewChosen, useUi } from './ui';
import { useSettings } from './settings';

const day = (d: number, m = 9, y = 2026) => new Date(y, m, d);
const place = () => ({ view: useUi.getState().view, date: useUi.getState().date });

beforeEach(() => {
  useSettings.setState({ weekStartsOn: 1, customDays: 4 });
  useUi.setState({ view: 'month', date: day(16), navDir: 0, viewSeq: 0, popover: null, sidebarOpen: false });
  useUi.getState().clearNavHistory();
});

afterEach(() => useUi.getState().clearNavHistory());

describe('moving through the calendar', () => {
  it('steps by the period on screen and says which way it went', () => {
    useUi.getState().step(1);
    expect(place()).toEqual({ view: 'month', date: day(16, 10) });
    expect(useUi.getState().navDir).toBe(1);
    useUi.getState().step(-1);
    useUi.getState().step(-1);
    expect(useUi.getState().date).toEqual(day(16, 8));
    expect(useUi.getState().navDir).toBe(-1);
  });

  it('steps a week by seven days, a phone too', () => {
    useUi.setState({ view: 'week', date: day(14) });
    useUi.getState().step(1);
    expect(useUi.getState().date).toEqual(day(21));
  });

  it('gives a jump the direction of the dates, and none when the period stays', () => {
    useUi.getState().setDate(day(3));
    expect(useUi.getState().navDir).toBe(0);
    useUi.getState().goTo(day(1, 0, 2027));
    expect(useUi.getState().navDir).toBe(1);
    useUi.getState().setDate(day(20));
    expect(useUi.getState().navDir).toBe(-1);
  });

  it('counts a change of view and gives it no direction', () => {
    useUi.getState().step(1);
    useUi.getState().setView('day');
    expect(useUi.getState().navDir).toBe(0);
    expect(useUi.getState().viewSeq).toBe(1);
    // The same view again is no change.
    useUi.getState().setView('day');
    expect(useUi.getState().viewSeq).toBe(1);
    useUi.getState().goTo(day(18), 'week');
    expect(useUi.getState().viewSeq).toBe(2);
  });

  it('closes the event details and, going to a date, the drawer', () => {
    useUi.setState({ sidebarOpen: true, popover: { occurrence: {} as never, anchor: { x: 0, y: 0, width: 0, height: 0 } } });
    useUi.getState().goTo(day(18));
    expect(useUi.getState().popover).toBeNull();
    expect(useUi.getState().sidebarOpen).toBe(false);
  });
});

describe('going back (the Android back button)', () => {
  it('returns from a day opened in the month to that month, then has nowhere left to go', () => {
    useUi.getState().goTo(day(22), 'day');
    expect(useUi.getState().view).toBe('day');
    expect(useUi.getState().navBack()).toBe(true);
    expect(place()).toEqual({ view: 'month', date: day(16) });
    expect(useUi.getState().navDir).toBe(0);
    expect(useUi.getState().navBack()).toBe(false);
    expect(place()).toEqual({ view: 'month', date: day(16) });
  });

  it('returns through the views and dates in the order they were shown', () => {
    useUi.getState().setView('year');
    useUi.getState().goTo(day(1, 2, 2026), 'month');
    useUi.getState().goTo(day(5, 2, 2026), 'day');
    useUi.getState().navBack();
    expect(place()).toEqual({ view: 'month', date: day(1, 2, 2026) });
    useUi.getState().navBack();
    expect(useUi.getState().view).toBe('year');
    useUi.getState().navBack();
    expect(place()).toEqual({ view: 'month', date: day(16) });
  });

  it('takes a run of swipes to the next or previous period as one step back, in the direction it goes', () => {
    useUi.getState().step(1);
    useUi.getState().step(1);
    useUi.getState().step(1);
    expect(useUi.getState().date).toEqual(day(16, 0, 2027));
    expect(useUi.getState().navBack()).toBe(true);
    expect(place()).toEqual({ view: 'month', date: day(16) });
    expect(useUi.getState().navDir).toBe(-1);
    expect(useUi.getState().navBack()).toBe(false);
  });

  it('starts a new run after a jump', () => {
    useUi.getState().step(1);
    useUi.getState().goTo(day(3, 11), 'day');
    useUi.getState().step(1);
    useUi.getState().step(1);
    useUi.getState().navBack();
    expect(place()).toEqual({ view: 'day', date: day(3, 11) });
    useUi.getState().navBack();
    expect(place()).toEqual({ view: 'month', date: day(16, 10) });
    useUi.getState().navBack();
    expect(place()).toEqual({ view: 'month', date: day(16) });
  });

  it('remembers nothing for a move that keeps the same period', () => {
    useUi.getState().setDate(day(30));
    useUi.getState().setView('month');
    expect(useUi.getState().navHistory).toEqual([]);
  });

  it('does not return to where the calendar only followed the event being created', () => {
    useUi.getState().setDate(day(16, 11), { history: false });
    expect(useUi.getState().date).toEqual(day(16, 11));
    expect(useUi.getState().navBack()).toBe(false);
  });

  it('keeps the newest places when the history is full', () => {
    for (let i = 0; i < NAV_HISTORY_MAX + 10; i++) useUi.getState().setView(i % 2 ? 'month' : 'day');
    expect(useUi.getState().navHistory).toHaveLength(NAV_HISTORY_MAX);
  });

  it('forgets everything when the calendar closes', () => {
    useUi.getState().goTo(day(22), 'day');
    useUi.getState().clearNavHistory();
    expect(useUi.getState().navBack()).toBe(false);
  });
});

describe('the default view', () => {
  beforeEach(() => {
    useSettings.setState({ defaultView: 'week' });
    useUi.setState({ view: 'week' });
    resetViewChosen();
  });
  afterEach(() => resetViewChosen());

  it('is followed when it changes before a view was picked (signing in on a new device)', () => {
    const seq = useUi.getState().viewSeq;
    const date = useUi.getState().date;
    useSettings.setState({ defaultView: 'month' });
    expect(useUi.getState().view).toBe('month');
    expect(useUi.getState().viewSeq).toBe(seq + 1);
    expect(useUi.getState().date).toBe(date);
    expect(useUi.getState().navHistory).toEqual([]);
  });

  it('no longer moves the calendar once a view was picked in this session', () => {
    useUi.getState().setView('day');
    useSettings.setState({ defaultView: 'month' });
    expect(useUi.getState().view).toBe('day');
  });

  it('is not a pick when only the date moves', () => {
    useUi.getState().step(1);
    useUi.getState().setDate(day(3));
    useSettings.setState({ defaultView: 'agenda' });
    expect(useUi.getState().view).toBe('agenda');
  });

  it('leaves the calendar alone when the view shown is the default already', () => {
    useUi.setState({ view: 'month' });
    const seq = useUi.getState().viewSeq;
    followDefaultView('month');
    expect(useUi.getState().viewSeq).toBe(seq);
  });
});
