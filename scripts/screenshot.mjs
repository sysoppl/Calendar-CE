// Captures screenshots of the running dev server: the README images and
// themed views for visual checks.
//
//   node scripts/screenshot.mjs [baseUrl] [outDir]
//   ONLY=welcome,mobile-welcome node scripts/screenshot.mjs http://localhost:5173 docs/images
//
// Every shot is in the light Daylight theme, the app's default, unless it names
// a theme; a shot in a dark colour scheme without a theme follows the system
// ("Sync with system"), which gives Graphite. `mobile-*` shots are taken as on
// a small phone: 360 × 780 with a touch screen and no keyboard (the bar of
// views at the bottom, no keyboard hints), at twice the pixels.
//
// Needs the dev server, not a production build: the sample data comes from
// window.__calendarSeed, which only dev builds have. Requests to any other
// origin than the app's are blocked, so nothing ever reaches a real server. Requires a local Chrome (set CHROME_PATH to use another Chromium).
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'screenshots';
const origin = new URL(base).origin;
mkdirSync(out, { recursive: true });

// The installed Chrome, wherever it lives; CHROME_PATH names another Chromium build.
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });

/** PNG to WebP through a canvas in the browser, so no image library is needed (as scripts/render-icons.mjs). */
async function toWebp(png, quality = 0.86) {
  const page = await browser.newPage();
  const data = await page.evaluate(
    async ([src, q]) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
      canvas.getContext('2d').drawImage(img, 0, 0);
      return canvas.toDataURL('image/webp', q).split(',')[1];
    },
    [`data:image/png;base64,${png.toString('base64')}`, quality],
  );
  await page.close();
  return Buffer.from(data, 'base64');
}

/** Closes the toasts on screen (a saved setting), so they cover nothing. */
async function closeToasts(page) {
  for (const button of await page.locator('[data-toast]').getByRole('button', { name: 'Close' }).all()) await button.click().catch(() => {});
}

/** The phone the `mobile-*` shots are taken on: 360 × 780 CSS pixels, touch only. */
const PHONE = { width: 360, height: 780, scale: 2, touch: true };

/**
 * `start` is where the shot begins: 'calendar' (the welcome screen done with
 * on-device storage, sample data loaded) or 'welcome' (a first start: nothing
 * stored). `file` saves
 * the shot there instead of `<outDir>/<name>.png`, as WebP when it ends so.
 * `touch` emulates a phone (coarse pointer, no keyboard), `scale` the device
 * pixels per CSS pixel.
 */
async function shoot(name, { width, height, scale = 1, touch = false, theme, view, setup, settings = {}, colorScheme = 'light', lang = 'en', start = 'calendar', file }) {
  const context = await browser.newContext({
    // Notifications allowed, as on a set-up device: no banner asking for them on the pictures.
    permissions: ['notifications'],
    viewport: { width, height },
    colorScheme,
    locale: lang === 'pl' ? 'pl-PL' : 'en-GB',
    deviceScaleFactor: scale,
    ...(touch ? { isMobile: true, hasTouch: true } : {}),
  });
  await context.route((url) => url.origin !== origin, (route) => route.abort());
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`[${name}] page error:`, e.message));
  page.on('console', (m) => m.type() === 'error' && console.error(`[${name}] console:`, m.text()));
  await page.addInitScript(
    ([theme, view, lang, extra, onboarded, followSystem]) => {
      // myEmails makes the seeded invitations answerable. The default look is the fixed
      // Daylight theme; a dark shot without a theme of its own follows the system instead.
      const state = { themeMode: followSystem ? 'system' : 'fixed', theme: theme ?? 'daylight', defaultView: view ?? 'week', language: lang, dayStartHour: 8, myEmails: 'me@example.com', ...extra };
      // The version the app stores (SETTINGS_VERSION), so nothing is migrated on load.
      localStorage.setItem('calendar.settings', JSON.stringify({ state, version: 4 }));
      // What the welcome screen stores once "On this device" was chosen (store/app.ts).
      if (onboarded && localStorage.getItem('calendar.app') === null) {
        localStorage.setItem('calendar.app', JSON.stringify({ state: { onboarded: true, storageMode: 'local' }, version: 1 }));
      }
    },
    [theme, view, lang, settings, start === 'calendar', !theme && colorScheme === 'dark'],
  );
  try {
    await page.goto(base);
    if (start === 'calendar') {
      await page.waitForFunction(() => '__calendarSeed' in window);
      await page.evaluate(async () => {
        if (!localStorage.getItem('seeded')) {
          await window.__calendarSeed();
          localStorage.setItem('seeded', '1');
        }
      });
    } else {
      // A first start shows the welcome screen.
      await page.getByRole('heading', { name: lang === 'pl' ? 'Witamy w Kalendarzu' : 'Welcome to Calendar' }).waitFor();
    }
    await page.waitForTimeout(400);
    if (setup) await setup(page);
    await page.waitForTimeout(300);
    // Pictures on the page wait until they have loaded.
    await page.waitForFunction(() => [...document.images].every((img) => img.complete));
    const path = file ?? `${out}/${name}.png`;
    mkdirSync(dirname(path), { recursive: true });
    const png = await page.screenshot();
    writeFileSync(path, path.endsWith('.webp') ? await toWebp(png) : png);
    console.log('saved', name, path);
  } finally {
    await context.close();
  }
}

/** Opens the "Edit" dialog of the sample calendar `name` from its menu in the sidebar. */
async function editCalendar(page, name) {
  const row = page.locator('aside li:not(:has(li))').filter({ hasText: name }).first();
  await row.hover();
  await row.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await page.getByRole('dialog').waitFor();
}

const only = process.env.ONLY?.split(',');
const shots = {
  'welcome': { width: 1440, height: 900, start: 'welcome' },
  'mobile-welcome': { ...PHONE, start: 'welcome' },
  'account-storage': {
    width: 1440,
    height: 900,
    setup: async (p) => {
      await p.keyboard.press('s');
      await p.getByRole('button', { name: 'Account & storage', exact: true }).click();
      await p.getByRole('heading', { name: 'Account & storage' }).waitFor();
    },
  },
  'week-daylight': { width: 1440, height: 900 },
  'week-graphite': { width: 1440, height: 900, theme: 'graphite' },
  // Linen with round corners, the calendar as a floating card and another font.
  'week-linen': { width: 1440, height: 900, theme: 'linen', settings: { shape: 'round', surface: 'card', fontFamily: 'outfit' } },
  'week-night': { width: 1440, height: 900, theme: 'night', setup: (p) => p.keyboard.press('g') },
  'popover': {
    width: 1440,
    height: 900,
    setup: async (p) => {
      await p.locator('[data-occ]').filter({ hasText: 'Offsite kickoff' }).first().click();
    },
  },
  'new-event': { width: 1440, height: 900, setup: (p) => p.keyboard.press('n') },
  'editor': {
    width: 1440,
    height: 900,
    setup: async (p) => {
      await p.keyboard.press('n');
      await p.getByRole('button', { name: 'More options' }).click();
    },
  },
  'settings-appearance': {
    width: 1440,
    height: 900,
    setup: async (p) => {
      await p.keyboard.press('s');
      await p.getByRole('button', { name: 'Appearance' }).click();
    },
  },
  'holidays': {
    width: 1440,
    height: 900,
    view: 'month',
    setup: async (p) => {
      await p.getByRole('button', { name: 'Add calendar' }).last().click();
      await p.getByRole('menuitem', { name: 'Add public holidays' }).click();
    },
  },
  // A calendar's own default notifications, in its Edit dialog.
  'calendar-defaults': {
    width: 1440,
    height: 900,
    view: 'month',
    setup: async (p) => {
      await editCalendar(p, 'Work');
      await p.locator('[data-kind="timed"]').getByText('Custom').click();
    },
  },
  'mobile-week': { ...PHONE },
  'mobile-month-pl': { ...PHONE, view: 'month', lang: 'pl' },
  'mobile-dark-agenda': { ...PHONE, view: 'agenda', colorScheme: 'dark' },
  // Settings → Appearance on a phone.
  'mobile-settings': {
    ...PHONE,
    setup: async (p) => {
      await closeToasts(p);
      // "More", or "More, overdue tasks" while a task is overdue.
      await p.locator('header').getByRole('button', { name: /^More/ }).tap();
      await p.getByRole('menuitem', { name: 'Settings' }).tap();
      await p.getByRole('button', { name: 'Appearance', exact: true }).tap();
      await p.getByRole('heading', { name: 'Appearance' }).waitFor();
      await closeToasts(p);
    },
  },
};

for (const [name, opts] of Object.entries(shots)) {
  if (only && !only.includes(name)) continue;
  try {
    await shoot(name, opts);
  } catch (err) {
    process.exitCode = 1;
    console.error('failed', name, err.message);
  }
}
await browser.close();
