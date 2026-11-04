// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

// The first test of the file also loads the modules, which takes a while on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const auto = vi.hoisted(() => ({ started: 0, stopped: 0 }));
vi.mock('@/lib/autoSync', () => ({
  startAutoSync: () => {
    auto.started++;
    return () => void auto.stopped++;
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('the automatic sync of the calendar', () => {
  it('starts once the stored calendars are loaded and stops with the calendar', async () => {
    const { useAutoSync } = await import('./useAutoSync');
    const { useData } = await import('@/store/data');
    useData.setState({ hydrated: false });
    const Probe = () => {
      useAutoSync();
      return null;
    };
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(h(Probe)));
    expect(auto.started).toBe(0);
    await act(async () => useData.setState({ hydrated: true }));
    expect(auto).toEqual({ started: 1, stopped: 0 });
    await act(async () => root.unmount());
    expect(auto).toEqual({ started: 1, stopped: 1 });
  });
});
