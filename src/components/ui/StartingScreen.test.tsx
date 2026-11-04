// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '@/store/settings';
import { SLOW_START_MS, StartingScreen } from './StartingScreen';

let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  useSettings.setState({ language: 'en' });
  host = document.body.appendChild(document.createElement('div'));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  vi.useRealTimers();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

const show = (props: Parameters<typeof StartingScreen>[0]) =>
  act(() => {
    root ??= createRoot(host);
    root.render(h(StartingScreen, props));
  });

const line = () => host.querySelector('[role="status"]')!.textContent;

describe('StartingScreen', () => {
  it('shows only the spinner at first, and a calm line with Reload once the start takes long', () => {
    const onReload = vi.fn();
    show({ since: Date.now(), onReload });
    expect(host.querySelector('svg.animate-spin')).not.toBeNull();
    expect(line()).toBe('');

    act(() => vi.advanceTimersByTime(SLOW_START_MS - 1));
    expect(line()).toBe('');
    act(() => vi.advanceTimersByTime(1));
    expect(line()).toContain('Calendar is taking longer than usual to start');
    // Still starting, not a failure: the spinner stays.
    expect(host.querySelector('svg.animate-spin')).not.toBeNull();
    const reload = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Reload')!;
    act(() => reload.click());
    expect(onReload).toHaveBeenCalledOnce();
  });

  it('counts from when the start began, not from when the screen came', () => {
    show({ since: Date.now() - SLOW_START_MS });
    expect(line()).toContain('Calendar is taking longer than usual to start');
    act(() => root!.unmount());
    root = null;

    show({ since: Date.now() - SLOW_START_MS + 1000 });
    expect(line()).toBe('');
    act(() => vi.advanceTimersByTime(1000));
    expect(line()).toContain('Calendar is taking longer than usual to start');
  });

  it('speaks Polish', () => {
    useSettings.setState({ language: 'pl' });
    show({ since: Date.now() - SLOW_START_MS });
    expect(line()).toContain('Uruchamianie Kalendarza trwa dłużej niż zwykle');
    expect(line()).toContain('Wczytaj ponownie');
  });
});
