// End-to-end check through the UI and the /dav-proxy against a CalDAV server.
// Usage: node scripts/e2e-caldav.mjs <appUrl> <davUrl> <user> <pass> [checkUrl]
// Starts like a new user who picks "CalDAV server" on the welcome screen,
// creates a calendar, a task list, an event and a task from the UI, checks
// them on the server and removes the two collections again. The server side is
// read as Radicale lays it out (collections under /<user>/). Exit code 1 when
// a step or a check fails; a picture of the last screen goes to ./screenshots.
// checkUrl is where this script reads the server when the app reaches it by
// another name, e.g. davUrl http://radicale:5232/ for the Docker demo and
// checkUrl http://127.0.0.1:5232/ on the host.
// Requires a local Chrome (set CHROME_PATH to use another Chromium build).
import { chromium } from 'playwright-core';

const [appUrl = 'http://localhost:5173', davUrl = 'http://127.0.0.1:5232/', user = 'alice', pass = 'secret', checkUrl = davUrl] = process.argv.slice(2);
const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
const CALENDAR = 'E2E Calendar';
const TASK_LIST = 'E2E Tasks';

async function dav(method, path, { depth, body } = {}) {
  const headers = { Authorization: auth };
  if (depth !== undefined) headers.Depth = depth;
  if (body) headers['Content-Type'] = 'application/xml';
  const res = await fetch(new URL(path, checkUrl), { method, headers, body });
  return res.text();
}

const PROPFIND = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>';

/** The responses of a PROPFIND as { href, name }, whatever namespace prefix the server uses. */
async function listing(path) {
  const xml = await dav('PROPFIND', path, { depth: '1', body: PROPFIND });
  return [...xml.matchAll(/<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/g)].map(([, part]) => ({
    href: part.match(/<(?:[\w-]+:)?href>([^<]+)</)?.[1] ?? '',
    name: part.match(/<(?:[\w-]+:)?displayname>([^<]*)</)?.[1] ?? '',
  }));
}

/** The test's collections in the user's home, by display name. */
async function testCollections() {
  const home = `/${user}/`;
  return (await listing(home)).filter((r) => r.href !== home && (r.name === CALENDAR || r.name === TASK_LIST));
}

/** Text of every object in the given collections. */
async function objectsIn(collections) {
  const hrefs = (await Promise.all(collections.map((c) => listing(c.href)))).flat().map((r) => r.href).filter((h) => h.endsWith('.ics'));
  return (await Promise.all(hrefs.map((h) => dav('GET', h)))).join('\n');
}

let failed = false;
const check = (ok, yes, no) => {
  if (!ok) failed = true;
  console.log(ok ? `✓ ${yes}` : `✗ ${no}`);
};

// The installed Chrome, wherever it lives; CHROME_PATH names another Chromium build.
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const step = (s) => console.log('•', s);
// A toast, not the screen-reader live region that repeats its text.
const toast = (text) => page.getByText(text).and(page.locator(':not([aria-live])'));

/** A calendar of the CalDAV account, through "New calendar"; `type` is events or tasks. */
async function newCollection(name, type) {
  // The first "Add calendar" belongs to "My calendars", the one section that is always there.
  await page.getByRole('button', { name: 'Add calendar' }).first().click();
  await page.getByRole('menuitem', { name: 'New calendar' }).click();
  await page.locator('#cal-name').fill(name);
  const accountSelect = page.locator('#cal-account');
  const options = await accountSelect.locator('option').allTextContents();
  await accountSelect.selectOption({ label: options.find((o) => o !== 'On this device') });
  await page.locator('#cal-type').selectOption(type);
  await page.getByRole('button', { name: 'Save' }).click();
  await toast('Calendar saved').waitFor({ timeout: 15000 });
  // The toast stays a few seconds; the next one must not be mistaken for it.
  await toast('Calendar saved').waitFor({ state: 'hidden', timeout: 15000 });
}

try {
  // A new browser profile is a first start: the welcome screen asks where to keep the calendar.
  await page.goto(appUrl);
  await page.getByRole('button', { name: 'Connect a server' }).click();
  await page.locator('#acc-server').fill(davUrl);
  await page.locator('#acc-user').fill(user);
  await page.locator('#acc-pass').fill(pass);
  await page.getByRole('button', { name: 'Connect' }).click();
  await toast('Account added').waitFor({ timeout: 15000 });
  await page.locator('main').waitFor();
  step('account added through the proxy from the welcome screen');

  await newCollection(CALENDAR, 'events');
  step('calendar created via MKCALENDAR');
  await newCollection(TASK_LIST, 'tasks');
  step('task list created via MKCALENDAR');

  await page.keyboard.press('n');
  await page.locator('input[name=title]').fill('E2E meeting');
  await page.getByLabel('Calendar', { exact: true }).last().selectOption({ label: CALENDAR });
  await page.getByRole('button', { name: 'Save' }).click();
  await toast('Event created').waitFor({ timeout: 15000 });
  step('event created');

  // The drawer's quick add, which parses the date out of the text.
  await page.keyboard.press('g');
  await page.getByLabel('Add a task').fill('E2E task tomorrow');
  await page.keyboard.press('Enter');
  await page.getByText('E2E task', { exact: true }).first().waitFor({ timeout: 15000 });
  step('task created');

  // Writes are shown at once and stored in the background, so the server may need a moment.
  let collections = [];
  let ics = '';
  for (let tries = 0; tries < 30; tries++) {
    collections = await testCollections();
    ics = await objectsIn(collections);
    if (ics.includes('SUMMARY:E2E meeting') && ics.includes('SUMMARY:E2E task')) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  check(collections.some((c) => c.name === CALENDAR), 'calendar exists on server', 'calendar missing on server');
  check(collections.some((c) => c.name === TASK_LIST), 'task list exists on server', 'task list missing on server');
  check(ics.includes('SUMMARY:E2E meeting'), 'event exists on server', 'event missing on server');
  check(ics.includes('SUMMARY:E2E task'), 'task exists on server', 'task missing on server');
  if (errors.length) {
    failed = true;
    console.log('page errors:', errors);
  }
  await page.screenshot({ path: 'screenshots/e2e.png' });
} catch (err) {
  failed = true;
  console.error('E2E failed:', err.message);
  await page.screenshot({ path: 'screenshots/e2e-failure.png' });
} finally {
  await browser.close();
  // Leaves the server as it was, also after a failed run.
  for (const c of await testCollections().catch(() => [])) await dav('DELETE', c.href).catch(() => {});
}
if (failed) process.exitCode = 1;
