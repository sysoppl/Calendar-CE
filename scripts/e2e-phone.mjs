// Phone checks of the calendar against the running dev server, at the size of
// a common phone (360x780, 3 device pixels to a CSS pixel) and of a larger
// one (412x915 at 2.625), with a touch screen and in Polish:
// - a tap on an event opens its sheet (and the click of that tap does not close it again);
// - a tap on a free slot opens the quick create;
// - a swipe across the all-day strip changes the week and creates nothing;
// - a chip in the month shows at least five letters of its title;
// - nothing shows a keyboard shortcut (<kbd>) without a keyboard;
// - the back button returns from a day opened in the month to that month;
// - the week is seven days, and the views are in the bar at the bottom.
//
//   node scripts/e2e-phone.mjs [baseUrl]
//   SHOTS=some/folder node scripts/e2e-phone.mjs http://localhost:5173
//
// Needs the dev server (the sample data comes from window.__calendarSeed and
// the checks read the app's modules) and a local Chrome (CHROME_PATH names
// another Chromium). Requests to any other origin are blocked. SHOTS saves a
// picture of each view at each size. Exits with 1 when a check fails.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173';
const origin = new URL(base).origin;
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const PHONES = [
  { name: '360x780', width: 360, height: 780, deviceScaleFactor: 3 },
  { name: '412x915', width: 412, height: 915, deviceScaleFactor: 2.625 },
];
/** The event whose chip is measured: a title of a typical length. */
const TITLE = 'Przegląd auta';

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
const failures = [];

function check(phone, name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${phone.name} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(`${phone.name} ${name}${detail ? ` (${detail})` : ''}`);
}

/** Where the calendar is and what is open, read from the app's store. */
const state = (page) =>
  page.evaluate(async () => {
    const s = (await import('/src/store/ui.ts')).useUi.getState();
    return { view: s.view, date: s.date.toDateString(), month: s.date.getMonth(), quickCreate: !!s.quickCreate, popover: !!s.popover };
  });

/** Shows `view` around today, with nothing to go back to. */
async function show(page, view) {
  await page.evaluate(async (v) => {
    const { useUi } = await import('/src/store/ui.ts');
    useUi.getState().goTo(new Date(), v);
    useUi.getState().clearNavHistory?.();
  }, view);
  await page.waitForTimeout(500);
}

async function phonePage(phone) {
  const context = await browser.newContext({
    viewport: { width: phone.width, height: phone.height },
    deviceScaleFactor: phone.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
    locale: 'pl-PL',
    timezoneId: 'Europe/Warsaw',
    colorScheme: 'light',
  });
  await context.route((url) => url.origin !== origin, (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const state = { themeMode: 'fixed', theme: 'daylight', defaultView: 'month', language: 'pl', dayStartHour: 8, showWeekNumbers: true, myEmails: 'me@example.com' };
    localStorage.setItem('calendar.settings', JSON.stringify({ state, version: 4 }));
    if (localStorage.getItem('calendar.app') === null) localStorage.setItem('calendar.app', JSON.stringify({ state: { onboarded: true, storageMode: 'local' }, version: 1 }));
  });
  await page.goto(base);
  await page.waitForFunction(() => '__calendarSeed' in window);
  await page.evaluate(async (title) => {
    if (localStorage.getItem('seeded')) return;
    await window.__calendarSeed();
    // Today at 10:00, in a calendar that can be written to.
    const { useData, LOCAL_ACCOUNT_ID } = await import('/src/store/data.ts');
    const { createEventIcs } = await import('/src/lib/ical/events.ts');
    const { newUid } = await import('/src/lib/ical/parse.ts');
    const { localTimezone } = await import('/src/lib/ical/timezone.ts');
    const cal = useData.getState().calendars.find((c) => c.accountId === LOCAL_ACCOUNT_ID && !c.readOnly && c.components.includes('VEVENT'));
    const start = new Date();
    start.setHours(10, 0, 0, 0);
    const uid = newUid();
    const data = createEventIcs({ uid, title, description: '', location: '', start, end: new Date(start.getTime() + 3600000), allDay: false, timezone: localTimezone(), alarms: [], busy: true, attendees: [], categories: [] });
    await useData.getState().applyOps([{ type: 'create', calendarId: cal.id, uid, data }]);
    localStorage.setItem('seeded', '1');
  }, TITLE);
  await page.reload();
  await page.locator('main').first().waitFor();
  await page.waitForTimeout(600);
  return { context, page, errors };
}

/** Swipes a finger across the screen from `from` to `to` (CSS px), in steps, like a person. */
async function swipe(page, from, to, steps = 8) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= steps; i++) {
    await page.waitForTimeout(16);
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Closes an open menu with a tap beside it (a key press would show the app a keyboard). */
async function tapBeside(page) {
  const bar = page.locator('[role="tablist"]');
  const box = (await bar.count()) ? await bar.boundingBox() : null;
  // The edge of the bar of views, or without one the screen's bottom corner.
  if (box) await page.touchscreen.tap(box.x + 1, box.y + box.height / 2);
  else await page.touchscreen.tap(1, page.viewportSize().height - 2);
  await page.waitForTimeout(250);
}

async function closeAll(page) {
  await page.evaluate(async () => {
    const { useUi } = await import('/src/store/ui.ts');
    useUi.getState().openPopover(null);
    useUi.getState().openQuickCreate(null);
    useUi.getState().setSidebarOpen(false);
  });
  await page.waitForTimeout(250);
}

for (const phone of PHONES) {
  const { context, page, errors } = await phonePage(phone);
  try {
    // A tap on an event opens its sheet, which stays.
    await show(page, 'day');
    const chip = page.locator('[data-occ]', { hasText: TITLE }).first();
    await chip.scrollIntoViewIfNeeded();
    await chip.tap();
    await page.waitForTimeout(600);
    check(phone, 'a tap on an event opens its sheet', (await page.locator('.rounded-t-2xl').count()) > 0);
    await closeAll(page);

    // A tap on a free slot opens the quick create.
    const free = await page.evaluate(() => {
      const grid = document.querySelector('.time-grid-bg');
      const scroller = grid.closest('.overflow-y-auto');
      const g = grid.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      for (let y = s.top + 40; y < s.bottom - 40; y += 20) {
        const x = g.left + g.width / 2;
        const el = document.elementFromPoint(x, y);
        if (el && grid.contains(el) && !el.closest('[data-occ],[data-task]')) return { x, y };
      }
      return null;
    });
    if (free) {
      await page.touchscreen.tap(free.x, free.y);
      await page.waitForTimeout(700);
    }
    check(phone, 'a tap on a free slot opens the quick create', !!free && (await page.locator('[role="dialog"][data-form-layer]').count()) > 0);
    await closeAll(page);

    // A swipe across the all-day strip changes the week and creates nothing.
    await show(page, 'week');
    const days = await page.evaluate(() => document.querySelector('.time-grid-bg').children.length);
    check(phone, 'the week shows seven days', days === 7, `${days} days`);
    const strip = await page.evaluate(() => {
      const el = document.querySelector('[data-all-day]') ?? [...document.querySelectorAll('div.relative.flex-1')].find((d) => d.style.touchAction === 'pan-y' && d.style.height);
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const before = (await state(page)).date;
    await swipe(page, { x: strip.x + strip.w - 12, y: strip.y + strip.h - 6 }, { x: strip.x + 20, y: strip.y + strip.h - 4 });
    // The new week is drawn after the old one has started to slide out; a busy machine takes longer.
    await page
      .waitForFunction(async (was) => (await import('/src/store/ui.ts')).useUi.getState().date.toDateString() !== was, before, { timeout: 3000 })
      .catch(() => {});
    await page.waitForTimeout(400);
    const after = await state(page);
    check(phone, 'a swipe across the all-day strip creates nothing', !after.quickCreate);
    check(phone, 'a swipe across the all-day strip changes the week', after.date !== before, `${before} -> ${after.date}`);
    await closeAll(page);

    // A chip in the month shows at least five letters.
    await show(page, 'month');
    const letters = await page.evaluate((title) => {
      const span = [...document.querySelectorAll('[data-item] span')].find((s) => s.textContent === title);
      if (!span) return -1;
      const chip = span.closest('[data-item]').firstElementChild.getBoundingClientRect();
      const style = getComputedStyle(span);
      let limit = Math.min(chip.right, span.getBoundingClientRect().right);
      // An ellipsis covers the end of what fits.
      if (style.textOverflow === 'ellipsis' && span.scrollWidth > span.clientWidth) {
        const probe = Object.assign(document.createElement('span'), { textContent: '…' });
        probe.style.font = style.font;
        document.body.append(probe);
        limit -= probe.getBoundingClientRect().width;
        probe.remove();
      }
      const text = span.firstChild;
      const range = document.createRange();
      let n = 0;
      for (let i = 0; i < text.length; i++) {
        range.setStart(text, i);
        range.setEnd(text, i + 1);
        if (range.getBoundingClientRect().right > limit + 0.5) break;
        n++;
      }
      return n;
    }, TITLE);
    check(phone, 'a month chip shows at least five letters', letters >= 5, `${letters} letters`);

    // The views are a tap away in the bar at the bottom.
    const tabs = await page.locator('[role="tablist"] [role="tab"]').allTextContents();
    check(phone, 'the bar at the bottom names the five views', tabs.join('|') === 'Agenda|Dzień|Tydzień|Miesiąc|Rok', tabs.join('|'));

    // Back returns from a day opened in the month to that month.
    const target = await page.evaluate(() => {
      const today = new Date();
      const cells = [...document.querySelectorAll('[data-day]')];
      const cell = cells.find((c) => {
        const d = new Date(Number(c.dataset.day));
        return d.getMonth() === today.getMonth() && d.getDate() !== today.getDate();
      });
      const r = cell.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height - 6 };
    });
    await page.touchscreen.tap(target.x, target.y);
    await page.waitForTimeout(500);
    const opened = (await state(page)).view;
    const handled = await page.evaluate(async () => (await import('/src/components/onboarding/back.ts')).handleBackButton());
    await page.waitForTimeout(300);
    const back = await state(page);
    check(phone, 'Back returns from a day opened in the month to that month', opened === 'day' && handled && back.view === 'month' && back.month === new Date().getMonth(), `${opened} -> ${back.view}`);

    // No keyboard shortcuts anywhere, in the header's menus and the drawer's.
    let kbd = 0;
    for (const trigger of await page.locator('header [aria-haspopup="menu"]').all()) {
      await trigger.tap();
      await page.waitForTimeout(300);
      kbd += await page.locator('kbd').count();
      await tapBeside(page);
    }
    await page.locator('header button[aria-label="Menu"]').tap();
    await page.waitForTimeout(400);
    const split = page.locator('aside [aria-haspopup="menu"]').first();
    if (await split.count()) {
      await split.tap();
      await page.waitForTimeout(300);
      kbd += await page.locator('kbd').count();
      await tapBeside(page);
    }
    kbd += await page.locator('kbd').count();
    await closeAll(page);
    check(phone, 'no keyboard shortcut shows without a keyboard', kbd === 0, `${kbd} <kbd>`);

    if (shots) {
      for (const view of ['month', 'week', 'day', 'agenda', 'year']) {
        await show(page, view);
        await page.screenshot({ path: `${shots}/phone-${phone.name}-${view}.png` });
      }
    }
    check(phone, 'no errors in the page', errors.length === 0, errors.join('; '));
  } catch (err) {
    check(phone, 'the checks ran', false, err.message.split('\n')[0]);
  } finally {
    await context.close();
  }
}

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall phone checks passed');
