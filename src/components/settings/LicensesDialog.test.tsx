// @vitest-environment jsdom
import { createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LicensesDialog } from './LicensesDialog';

let root: Root | null = null;

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }),
  });
  Element.prototype.scrollTo ??= () => {};
});

afterEach(() => {
  root?.unmount();
  root = null;
  vi.unstubAllGlobals();
});

describe('LicensesDialog', () => {
  it('asks for the notices of the release that is running', async () => {
    const fetch = vi.fn(async () => new Response('Some package 1.0\nMIT', { headers: { 'content-type': 'text/plain; charset=utf-8' } }));
    vi.stubGlobal('fetch', fetch);
    root = createRoot(document.body.appendChild(document.createElement('div')));
    root.render(h(LicensesDialog, { open: true, onClose: () => {} }));
    // The answer is read as a stream, which on a busy machine takes longer than waitFor's default second.
    await vi.waitFor(() => expect(document.body.textContent).toContain('Some package 1.0'), { timeout: 5000 });
    // The service worker keeps a copy per address; another release must not get this one.
    expect(fetch).toHaveBeenCalledWith(`/THIRD-PARTY-NOTICES.txt?v=${encodeURIComponent(__APP_VERSION__)}`);
  });
});
