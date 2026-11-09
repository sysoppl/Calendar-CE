// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { createElement as h } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/en';
import { createEventIcs } from '@/lib/ical/events';
import { useData } from '@/store/data';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { Button } from '@/components/ui/Button';
import { RestoreBackup } from './RestoreBackup';

vi.setConfig({ testTimeout: 30_000 });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;

const event = (uid: string) =>
  createEventIcs({ uid, title: uid, description: '', location: '', start: new Date(2026, 10, 12, 9), end: new Date(2026, 10, 12, 10), allDay: false, timezone: 'UTC', alarms: [], busy: true, attendees: [], categories: [] });

const FILE = JSON.stringify({
  format: 'calendar-ce-backup',
  version: 1,
  createdAt: '2026-11-01T08:30:00.000Z',
  app: '1.15.0',
  settingsVersion: 4,
  settings: { weekStartsOn: 0 },
  calendars: [{ id: 'local|old', name: 'Old one', color: '#1b8037', components: ['VEVENT'], visible: true, order: 0, objects: [event('a'), event('b')] }],
  generated: [],
});

beforeEach(async () => {
  localStorage.clear();
  useSettings.setState({ language: 'en', weekStartsOn: 1 });
  useUi.setState({ toasts: [] });
  await useData.getState().init();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

const button = (name: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === name);
const flush = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 20)));

async function choose(text: string, name = 'backup.json') {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([text], name, { type: 'application/json' })] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await flush();
}

describe('restoring a backup file', () => {
  it('shows what the file holds, restores it with the settings when asked, and says so', async () => {
    const restored = vi.fn();
    act(() =>
      root!.render(
        h(RestoreBackup, { settingsByDefault: true, onRestored: restored, children: (open: () => void) => h(Button, { onClick: open }, 'Pick') }),
      ),
    );
    await choose(FILE);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain(en['backup.restore.title']);
    expect(dialog.textContent).toContain(`${en['backup.restore.calendars']}1`);
    expect(dialog.textContent).toContain(`${en['backup.restore.items']}2`);
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);

    await act(async () => button(en['backup.restore.go'])!.click());
    await flush();
    expect(restored).toHaveBeenCalledWith(expect.objectContaining({ calendars: 1, created: 1, items: 2 }));
    const made = useData.getState().calendars.find((c) => c.name === 'Old one')!;
    expect(Object.keys(useData.getState().objects[made.id])).toHaveLength(2);
    expect(useSettings.getState().weekStartsOn).toBe(0);
    expect(useUi.getState().toasts.map((t) => t.message)).toContain(en['backup.restored']);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('turns away a file that is no backup', async () => {
    act(() => root!.render(h(RestoreBackup, { children: (open: () => void) => h(Button, { onClick: open }, 'Pick') })));
    await choose('BEGIN:VCALENDAR\r\nEND:VCALENDAR', 'calendar.ics');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(useUi.getState().toasts.map((t) => t.message)).toContain(en['backup.error.notBackup']);
  });
});
