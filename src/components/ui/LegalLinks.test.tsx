// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { act, createElement as h, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppLinks } from '@/lib/links';
import { useApp } from '@/store/app';
import { useSettings } from '@/store/settings';
import { Onboarding } from '@/components/onboarding/Onboarding';
import { LegalLinks } from './LegalLinks';

// What a build with every link set compiles in; `none` is the default build.
const links = vi.hoisted(() => ({
  set: { privacy: 'https://example.org/privacy', terms: 'https://example.org/terms', contact: 'mailto:hello@example.org' },
  none: { privacy: '', terms: '', contact: '' },
  current: { privacy: '', terms: '', contact: '' },
}));
vi.mock('@/lib/links', async (original) => {
  const actual = await original<typeof import('@/lib/links')>();
  return {
    ...actual,
    get APP_LINKS() {
      return links.current;
    },
    legalLinks: (value: AppLinks = links.current) => actual.legalLinks(value),
  };
});

let root: Root | null = null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }),
  });
  useApp.setState({ onboarded: false, storageMode: null });
  useSettings.setState({ language: 'en' });
  links.current = links.none;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function render(node: ReactNode) {
  root = createRoot(document.body.appendChild(document.createElement('div')));
  act(() => root!.render(node));
}

const anchors = () => [...document.querySelectorAll('a')].map((a) => ({ text: a.textContent, href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') }));

describe('Legal links', () => {
  it('render nothing while the build names none', () => {
    render(h('div', null, h(LegalLinks)));
    expect(document.body.innerHTML).toBe('<div><div></div></div>');

    // Nor on the pages that would show them.
    act(() => root!.render(h(Onboarding)));
    expect(document.querySelector('nav[aria-label="Legal information"]')).toBeNull();
    expect(document.body.textContent).not.toContain('Privacy policy');
  });

  it('open outside the app, without a way back into it', () => {
    links.current = links.set;
    render(h(LegalLinks));
    expect(anchors()).toEqual([
      { text: 'Privacy policy', href: 'https://example.org/privacy', target: '_blank', rel: 'noopener noreferrer' },
      { text: 'Terms of service', href: 'https://example.org/terms', target: '_blank', rel: 'noopener noreferrer' },
      // An e-mail address is handed to the mail app as it is.
      { text: 'Contact', href: 'mailto:hello@example.org', target: null, rel: null },
    ]);
  });

  it('are at the foot of the welcome screen once set', () => {
    links.current = links.set;
    render(h(Onboarding));
    expect([...document.querySelectorAll('nav[aria-label="Legal information"] a')].map((a) => a.textContent)).toEqual(['Privacy policy', 'Terms of service', 'Contact']);
  });

  it('show only those that are set', () => {
    links.current = { ...links.none, terms: 'https://example.org/terms' };
    render(h(LegalLinks));
    expect(anchors().map((a) => a.text)).toEqual(['Terms of service']);
  });

});
