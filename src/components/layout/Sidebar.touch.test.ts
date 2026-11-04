// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { compile } from 'tailwindcss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useData, type Account, type Calendar } from '@/store/data';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { Sidebar } from './Sidebar';

const require = createRequire(import.meta.url);

/** The CSS Tailwind makes of an element's classes, with its theme. */
async function css(classes: string): Promise<string> {
  const compiler = await compile('@import "tailwindcss/theme"; @import "tailwindcss/utilities";', {
    base: process.cwd(),
    loadStylesheet: async (id: string, base: string) => {
      const path = require.resolve(id.endsWith('.css') ? id : `${id}.css`);
      return { content: readFileSync(path, 'utf8'), base, path };
    },
  });
  return compiler.build(classes.split(/\s+/).filter(Boolean));
}

/** The declarations of `text` for a touch screen (inside `@media (pointer: coarse)`) and for a mouse (outside it). */
function split(text: string): { touch: string; mouse: string } {
  let touch = '';
  let mouse = '';
  let depth = 0;
  let inside = -1;
  for (let i = 0; i < text.length; i++) {
    if (inside < 0 && text.startsWith('@media (pointer: coarse)', i)) inside = depth;
    if (text[i] === '{') depth++;
    if (text[i] === '}') depth--;
    if (inside >= 0) touch += text[i];
    else mouse += text[i];
    if (inside >= 0 && text[i] === '}' && depth === inside) inside = -1;
  }
  return { touch, mouse };
}

const FINGER = 'calc(var(--spacing) * 11)';

/** What a touch screen and a mouse get for this element. */
async function sizes(el: Element) {
  const { touch, mouse } = split(await css(el.getAttribute('class') ?? ''));
  const decl = (text: string, prop: string) => [...text.matchAll(new RegExp(`(?:^|[\\s;{])${prop}: ([^;]+);`, 'g'))].map((m) => m[1]);
  return {
    touch: { height: decl(touch, 'height'), minHeight: decl(touch, 'min-height'), width: decl(touch, 'width'), opacity: decl(touch, 'opacity') },
    mouse: { text: mouse, height: decl(mouse, 'height'), width: decl(mouse, 'width'), padding: decl(mouse, 'padding'), paddingBlock: decl(mouse, 'padding-block') },
  };
}

const local: Account = { id: 'local', kind: 'local', name: 'On this device', useProxy: false };
const cal = (id: string, name: string, components: Calendar['components']): Calendar => ({
  id: `local|${id}`,
  accountId: 'local',
  remoteId: id,
  name,
  color: '#9171f0',
  components,
  readOnly: false,
  visible: true,
  order: 0,
});

let root: Root | null = null;

beforeEach(() => {
  // A phone: the sidebar is a drawer.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: /max-width/.test(query), media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }),
  });
  useSettings.setState({ language: 'en' });
  useData.setState({ accounts: [local], calendars: [cal('personal', 'Personal', ['VEVENT']), cal('tasks', 'Errands', ['VTODO'])] });
  useUi.setState({ sidebarOpen: true });
  document.body.innerHTML = '';
});

afterEach(() => {
  root?.unmount();
  root = null;
  useUi.setState({ sidebarOpen: false });
  useData.setState({ accounts: [], calendars: [] });
});

async function drawer(): Promise<HTMLElement> {
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  root.render(h(Sidebar));
  await vi.waitFor(() => expect(host.querySelector('aside li')).not.toBeNull());
  return host.querySelector('aside')!;
}

describe('The drawer on a touch screen', () => {
  it('gives New event and its menu a 44 px target, and keeps them at 40 px for a mouse', async () => {
    const aside = await drawer();
    const newEvent = [...aside.querySelectorAll('button')].find((b) => b.textContent === 'New event')!;
    const menu = newEvent.parentElement!.querySelectorAll('button')[1];
    expect(menu.getAttribute('aria-label')).toBe('More');

    const main = await sizes(newEvent);
    expect(main.touch.height).toEqual([FINGER]);
    expect(main.mouse.height).toEqual(['calc(var(--spacing) * 10)']);
    const more = await sizes(menu);
    expect(more.touch).toMatchObject({ height: [FINGER], width: [FINGER] });
    expect(more.mouse).toMatchObject({ height: ['calc(var(--spacing) * 10)'], width: ['calc(var(--spacing) * 10)'] });
  });

  it('gives the group headings, add-calendar and per-calendar buttons a 44 px target, and only there', async () => {
    const aside = await drawer();
    const headings = [...aside.querySelectorAll('section')].map((section) => section.querySelector('button')!);
    expect(headings.map((b) => b.textContent)).toEqual(['My calendars', 'Task lists', 'Other calendars']);
    const add = [...aside.querySelectorAll('button[aria-label="Add calendar"]')];
    const more = [...aside.querySelectorAll('li button[aria-label="More"]')];
    // My calendars, Task lists, Other calendars; one menu per calendar.
    expect([headings.length, add.length, more.length]).toEqual([3, 3, 2]);

    for (const heading of headings) {
      const s = await sizes(heading);
      expect(s.touch.minHeight).toEqual([FINGER]);
      expect(s.mouse.paddingBlock).toEqual(['calc(var(--spacing) * 1.5)']);
      expect(s.mouse.text).not.toContain(FINGER);
    }
    for (const button of add) {
      const s = await sizes(button);
      expect(s.touch).toMatchObject({ height: [FINGER], width: [FINGER] });
      // Drawn as before for a mouse: an 18 px icon in 6 px of padding.
      expect(s.mouse.padding).toEqual(['calc(var(--spacing) * 1.5)']);
      expect(s.mouse.text).not.toContain(FINGER);
    }
    for (const button of more) {
      const s = await sizes(button);
      expect(s.touch).toMatchObject({ height: [FINGER], width: [FINGER] });
      // No hover to reveal it with a finger.
      expect(s.touch.opacity).toContain('100%');
      expect(s.mouse.padding).toEqual(['var(--spacing)']);
      expect(s.mouse.text).not.toContain(FINGER);
    }
  });
});
