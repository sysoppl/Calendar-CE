import { afterEach, describe, expect, it, vi } from 'vitest';
import { FONTS } from '@/theme/fonts';
import { LEGACY_FONT_IDS, LEGACY_THEME_IDS, currentThemeId } from '@/theme/legacy';
import { THEMES } from '@/theme/themes';
import { DEFAULT_SETTINGS, SETTINGS_VERSION, isTextSize, migrateSettings } from './settings';

const themeIds: string[] = THEMES.map((t) => t.id);
const fontIds = FONTS.map((f) => f.id);

describe('settings defaults', () => {
  it('start with themes and a font that exist', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ theme: 'daylight', lightTheme: 'daylight', darkTheme: 'graphite', fontFamily: 'inter' });
    expect(SETTINGS_VERSION).toBe(4);
  });

  it('start light whatever the system says, with the text size of the system', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ themeMode: 'fixed', theme: 'daylight', textSize: 'system' });
    expect('fontScale' in DEFAULT_SETTINGS).toBe(false);
  });

  it('tell a usable text size', () => {
    for (const ok of ['system', 0.75, 0.85, 1, 1.1, 1.5]) expect(isTextSize(ok), String(ok)).toBe(true);
    for (const bad of ['auto', '1.1', 0.5, 1.6, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, {}]) expect(isTextSize(bad), String(bad)).toBe(false);
  });
});

describe('migrateSettings', () => {
  it('renames the themes of version 2, to the themes of today', () => {
    expect(migrateSettings({ theme: 'snow', lightTheme: 'classic', darkTheme: 'carbon' }, 2)).toEqual({ theme: 'daylight', lightTheme: 'daylight', darkTheme: 'graphite' });
    expect(migrateSettings({ theme: 'legacy', lightTheme: 'legacy', darkTheme: 'monokai' }, 2)).toEqual({ theme: 'daylight', lightTheme: 'daylight', darkTheme: 'graphite' });
    expect(migrateSettings({ theme: 'contrast', darkTheme: 'pine' }, 2)).toEqual({ theme: 'high-contrast', darkTheme: 'graphite' });
  });

  it('keeps "Sync with system" of version 2 where a theme of then was chosen for it', () => {
    // 'classic' was a light theme of its own then, not the default, although
    // today it resolves to the default.
    expect(migrateSettings({ themeMode: 'system', lightTheme: 'classic', darkTheme: 'carbon' }, 2)).toEqual({ themeMode: 'system', lightTheme: 'daylight', darkTheme: 'graphite' });
    expect(migrateSettings({ themeMode: 'system', lightTheme: 'snow', darkTheme: 'monokai' }, 2)).toEqual({ themeMode: 'system', lightTheme: 'daylight', darkTheme: 'graphite' });
  });

  it('gives every old theme id a theme that exists, in each of the three fields', () => {
    for (const [old, now] of LEGACY_THEME_IDS) {
      const migrated = migrateSettings({ theme: old, lightTheme: old, darkTheme: old }, 2);
      expect(migrated).toEqual({ theme: now, lightTheme: now, darkTheme: now });
      expect(themeIds).toContain(migrated.theme);
    }
  });

  it('replaces fonts that are no longer bundled', () => {
    expect(migrateSettings({ fontFamily: 'lexend' }, 2).fontFamily).toBe('outfit');
    expect(migrateSettings({ fontFamily: 'ibm-plex-sans' }, 2).fontFamily).toBe('inter');
    expect(migrateSettings({ fontFamily: 'source-sans-3' }, 2).fontFamily).toBe('open-sans');
    expect(migrateSettings({ fontFamily: 'figtree' }, 2).fontFamily).toBe('figtree');
    for (const [old, now] of LEGACY_FONT_IDS) {
      expect(migrateSettings({ fontFamily: old }, 2).fontFamily).toBe(now);
      expect(fontIds).toContain(now);
    }
  });

  it('keeps everything else, including the accent colour', () => {
    const stored = { theme: 'snow', accentColor: '#8080ff', shape: 'round', surface: 'card', weekStartsOn: 0, notificationsEnabled: false, defaultAlarms: [5, 30] };
    expect(migrateSettings(stored, 2)).toEqual({ ...stored, theme: 'daylight' });
    // The stored object itself is not touched.
    expect(stored.theme).toBe('snow');
  });

  it('still applies the step of version 2', () => {
    expect(migrateSettings({ theme: 'carbon', notificationsEnabled: false }, 1)).toEqual({ theme: 'graphite', notificationsEnabled: true });
    expect(migrateSettings({ notificationsEnabled: false }, 2)).toEqual({ notificationsEnabled: false });
  });

  it('leaves current settings and odd values alone', () => {
    const current = { theme: 'dusk', lightTheme: 'azure', darkTheme: 'midnight', fontFamily: 'outfit' };
    expect(migrateSettings(current, 4)).toEqual(current);
    expect(migrateSettings({ theme: 'snow', fontFamily: 'lexend', fontScale: 1.1, themeMode: 'system' }, 4)).toEqual({ theme: 'snow', fontFamily: 'lexend', fontScale: 1.1, themeMode: 'system' });
    // Version 4 maps theme ids again (to the theme set of today), but not fonts.
    expect(migrateSettings({ theme: 'snow', fontFamily: 'lexend' }, 3)).toEqual({ theme: currentThemeId('snow'), fontFamily: 'lexend' });
    expect(migrateSettings({ theme: 42, fontFamily: null }, 2)).toEqual({ theme: 42, fontFamily: null });
    expect(migrateSettings({ theme: 'something-else' }, 2)).toEqual({ theme: 'something-else' });
    expect(migrateSettings(null, 2)).toEqual({});
    expect(migrateSettings(undefined, 0)).toEqual({ notificationsEnabled: true });
  });
});

describe('migrateSettings to version 4', () => {
  /** Version 3's defaults for the look: "Sync with system", the two default themes, no accent. */
  const untouched = { themeMode: 'system', theme: 'daylight', lightTheme: 'daylight', darkTheme: 'graphite', accentColor: '' } as const;

  it('makes an appearance nobody changed light', () => {
    expect(migrateSettings(untouched, 3)).toEqual({ ...untouched, themeMode: 'fixed', theme: 'daylight' });
    // The themes of the system mode stay as they were, for whoever picks it again.
    expect(migrateSettings({ ...untouched, theme: 'dusk' }, 3)).toEqual({ ...untouched, themeMode: 'fixed', theme: 'daylight' });
    // Also from older versions, through every step.
    expect(migrateSettings({ themeMode: 'system', lightTheme: 'snow', darkTheme: 'carbon' }, 2)).toEqual({ themeMode: 'fixed', theme: 'daylight', lightTheme: 'daylight', darkTheme: 'graphite' });
    // Fields that are absent count as their defaults.
    expect(migrateSettings({ themeMode: 'system' }, 3)).toEqual({ themeMode: 'fixed', theme: 'daylight' });
  });

  it('keeps "Sync with system" where the look was changed', () => {
    expect(migrateSettings({ ...untouched, darkTheme: 'pine' }, 3)).toEqual({ ...untouched, darkTheme: currentThemeId('pine') });
    expect(migrateSettings({ ...untouched, lightTheme: 'paper' }, 3)).toEqual({ ...untouched, lightTheme: currentThemeId('paper') });
    expect(migrateSettings({ ...untouched, accentColor: '#0e8a7e' }, 3)).toEqual({ ...untouched, accentColor: '#0e8a7e' });
  });

  it('keeps a theme chosen to be always on, under its id of today', () => {
    expect(migrateSettings({ themeMode: 'fixed', theme: 'dusk' }, 3)).toEqual({ themeMode: 'fixed', theme: currentThemeId('dusk') });
    expect(migrateSettings({ themeMode: 'fixed', theme: 'graphite', lightTheme: 'daylight', darkTheme: 'graphite', accentColor: '' }, 3)).toMatchObject({ themeMode: 'fixed', theme: 'graphite' });
    for (const [old, now] of LEGACY_THEME_IDS) {
      expect(migrateSettings({ themeMode: 'fixed', theme: old, lightTheme: old, darkTheme: old }, 3)).toEqual({ themeMode: 'fixed', theme: now, lightTheme: now, darkTheme: now });
    }
  });

  it('turns the font scale into the text size, "normal" following the system', () => {
    expect(migrateSettings({ fontScale: 1 }, 3)).toEqual({ textSize: 'system' });
    expect(migrateSettings({ fontScale: 1.1 }, 3)).toEqual({ textSize: 1.1 });
    expect(migrateSettings({ fontScale: 0.85 }, 3)).toEqual({ textSize: 0.85 });
    expect(migrateSettings({ fontScale: 1.2, density: 'compact' }, 3)).toEqual({ textSize: 1.2, density: 'compact' });
    // A value that was never one of the sizes is dropped; the default applies.
    for (const odd of [5, 0, -1, '1.1', null, Number.NaN]) expect(migrateSettings({ fontScale: odd }, 3), String(odd)).toEqual({});
  });

  it('leaves a partial set alone in what it does not carry', () => {
    expect(migrateSettings({ weekStartsOn: 0, timeFormat: '24h' }, 3)).toEqual({ weekStartsOn: 0, timeFormat: '24h' });
    expect(migrateSettings({ lightTheme: 'daylight', darkTheme: 'graphite', accentColor: '' }, 3)).toEqual({ lightTheme: 'daylight', darkTheme: 'graphite', accentColor: '' });
    expect(migrateSettings({ density: 'compact' }, 3)).toEqual({ density: 'compact' });
    expect('textSize' in migrateSettings({ density: 'compact' }, 3)).toBe(false);
  });

  it('leaves a set written by version 4 alone, although it says version 3', () => {
    const chosen = { ...untouched, textSize: 'system' };
    expect(migrateSettings(chosen, 3)).toEqual(chosen);
    expect(migrateSettings({ ...chosen, textSize: 1.1 }, 3)).toEqual({ ...chosen, textSize: 1.1 });
  });

  it('does not touch the object it was given', () => {
    const stored = { ...untouched, fontScale: 1.1 };
    migrateSettings(stored, 3);
    expect(stored).toEqual({ ...untouched, fontScale: 1.1 });
  });
});

describe('stored settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /** Loads the store over a fake localStorage holding `stored`. */
  async function load(stored: unknown) {
    const items = new Map<string, string>();
    if (stored !== undefined) items.set('calendar.settings', JSON.stringify(stored));
    const localStorage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    };
    // The persist middleware reads window.localStorage when the store is created.
    vi.stubGlobal('window', { localStorage });
    vi.resetModules();
    const { useSettings } = await import('./settings');
    return { state: useSettings.getState(), saved: () => JSON.parse(items.get('calendar.settings') ?? 'null') as { version: number; state: Record<string, unknown> } | null };
  }

  it('are migrated when the app starts and saved in the new form', async () => {
    const { state, saved } = await load({ state: { themeMode: 'fixed', theme: 'classic', lightTheme: 'snow', darkTheme: 'carbon', fontFamily: 'lexend', showWeekNumbers: true }, version: 2 });
    expect(state).toMatchObject({ themeMode: 'fixed', theme: 'daylight', lightTheme: 'daylight', darkTheme: 'graphite', fontFamily: 'outfit', showWeekNumbers: true });
    // Fields the stored state did not have come from the defaults.
    expect(state.defaultView).toBe(DEFAULT_SETTINGS.defaultView);
    expect(saved()).toMatchObject({ version: 4, state: { theme: 'daylight', lightTheme: 'daylight', darkTheme: 'graphite', fontFamily: 'outfit' } });
  });

  it('of version 3 that nobody changed start light, and keep the text size as it was', async () => {
    const { textSize: _t, ...v3 } = DEFAULT_SETTINGS;
    const { state, saved } = await load({ state: { ...v3, themeMode: 'system', fontScale: 1.1, density: 'compact' }, version: 3 });
    expect(state).toMatchObject({ themeMode: 'fixed', theme: 'daylight', textSize: 1.1, density: 'compact' });
    expect('fontScale' in state).toBe(false);
    const after = saved()!;
    expect(after.version).toBe(4);
    expect(after.state).toMatchObject({ themeMode: 'fixed', theme: 'daylight', textSize: 1.1 });
    expect('fontScale' in after.state).toBe(false);
  });

  it('of version 3 with a theme chosen for the system mode keep following the system', async () => {
    const { textSize: _t, ...v3 } = DEFAULT_SETTINGS;
    const { state } = await load({ state: { ...v3, themeMode: 'system', darkTheme: 'midnight', fontScale: 1 }, version: 3 });
    expect(state).toMatchObject({ themeMode: 'system', darkTheme: currentThemeId('midnight'), textSize: 'system' });
  });

  it('of version 1 go through both steps', async () => {
    const { state } = await load({ state: { theme: 'monokai', notificationsEnabled: false }, version: 1 });
    expect(state).toMatchObject({ theme: 'graphite', notificationsEnabled: true });
  });

  it('of the current version are read as they are', async () => {
    const { state } = await load({ state: { theme: 'paper', themeMode: 'system', notificationsEnabled: false }, version: 4 });
    expect(state).toMatchObject({ theme: 'paper', themeMode: 'system', notificationsEnabled: false });
  });

  it('load with a field no version reads any more (a device profile)', async () => {
    const { state } = await load({ state: { theme: 'paper', deviceProfile: 'phone', density: 'compact' }, version: 4 });
    expect(state).toMatchObject({ theme: 'paper', density: 'compact', textSize: 'system' });
  });

  it('start from the defaults on a first run', async () => {
    const { state } = await load(undefined);
    expect(state).toMatchObject(DEFAULT_SETTINGS);
  });

  it('still change when they cannot be saved on the device, and say so to whoever listens', async () => {
    let full = true;
    const items = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        items.set(key, value);
      },
      removeItem: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
    };
    vi.stubGlobal('window', { localStorage });
    vi.resetModules();
    const { useSettings, onPersistError, settingsWriteFailed } = await import('./settings');
    const errors: unknown[] = [];
    const stop = onPersistError((err) => errors.push(err));
    // A listener that fails itself changes nothing for the others or the store.
    const stopBroken = onPersistError(() => {
      throw new Error('broken listener');
    });

    expect(() => useSettings.getState().update({ density: 'compact' })).not.toThrow();
    expect(useSettings.getState().density).toBe('compact');
    expect(errors).toHaveLength(1);
    expect((errors[0] as DOMException).name).toBe('QuotaExceededError');
    expect(settingsWriteFailed()).toBe(true);
    expect(() => useSettings.getState().reset()).not.toThrow();
    expect(useSettings.getState().density).toBe('comfortable');
    expect(() => useSettings.persist.clearStorage()).not.toThrow();
    expect(errors).toHaveLength(3);

    // Room again: the next change is saved, and the failure is over.
    full = false;
    useSettings.getState().update({ density: 'compact' });
    expect(settingsWriteFailed()).toBe(false);
    expect(JSON.parse(items.get('calendar.settings')!).state.density).toBe('compact');
    expect(errors).toHaveLength(3);

    stop();
    stopBroken();
    full = true;
    useSettings.getState().update({ density: 'comfortable' });
    expect(errors).toHaveLength(3);
  });
});
