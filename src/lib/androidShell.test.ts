// The Android app's shell kept in step with the rest: the icons drawn from the
// one master (src/theme/iconMaster.ts), the light first frame in the colour
// of the default theme, the notification accent, and the words reminders
// name their time with in both languages.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEMES } from '@/theme/themes';
import * as iconMaster from '@/theme/iconMaster';
import { LEGACY_LAUNCHER, WEB_SIZES, drawables, readMaster } from '../../scripts/icon-art.mjs';

const RES = 'android/app/src/main/res';
const read = (file: string) => readFileSync(file, 'utf8');
const daylight = THEMES.find((theme) => theme.id === 'daylight')!.tokens;

/** Every file under `dir`, with paths relative to the repository root. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name).replaceAll('\\', '/');
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** Width and height of a PNG, from its header. */
function pngSize(file: string): [number, number] {
  const head = readFileSync(file);
  expect(head.subarray(1, 4).toString('latin1'), file).toBe('PNG');
  return [head.readUInt32BE(16), head.readUInt32BE(20)];
}

/** A colour resource's value, upper case. */
function color(file: string, name: string): string | undefined {
  return new RegExp(`<color name="${name}">(#[0-9A-Fa-f]{6,8})</color>`).exec(read(file))?.[1].toUpperCase();
}

/** The strings of an Android resource file, by name. */
function strings(file: string): Record<string, string> {
  return Object.fromEntries([...read(file).matchAll(/<string name="(\w+)">([^<]*)<\/string>/g)].map(([, name, text]) => [name, text]));
}

describe('the icons', () => {
  it('are read from the master the way the scripts read it', () => {
    const master = readMaster();
    for (const [name, value] of Object.entries(iconMaster)) expect(master[name], name).toBe(value);
  });

  it('as Android vectors are the ones the master gives (scripts/render-icons.mjs writes them)', () => {
    for (const [file, xml] of Object.entries(drawables(readMaster()))) expect(read(file), file).toBe(xml);
  });

  it('make an adaptive icon of the month on the paper, with the month in one colour as its themed layer', () => {
    for (const name of ['ic_launcher', 'ic_launcher_round']) {
      const xml = read(`${RES}/mipmap-anydpi-v26/${name}.xml`);
      expect(xml, name).toContain('<background android:drawable="@color/ic_launcher_background" />');
      expect(xml, name).toContain('<foreground android:drawable="@drawable/ic_launcher_foreground" />');
      expect(xml, name).toContain('<monochrome android:drawable="@drawable/ic_launcher_monochrome" />');
      // No raster layers or insets from the old icon.
      expect(xml, name).not.toMatch(/@mipmap|<inset/);
    }
    expect(color(`${RES}/values/ic_launcher_background.xml`, 'ic_launcher_background')).toBe(iconMaster.ICON_PAPER.toUpperCase());
    // The paper is the Daylight frame, so the splash's icon disc is the splash itself.
    expect(iconMaster.ICON_PAPER.toUpperCase()).toBe(daylight.frameBg.toUpperCase());
  });

  it('leave nothing of the old icon and splash behind', () => {
    const left = files(RES).filter((file) => /splash\.png$|ic_launcher_(fore|back)ground\.png$|drawable-v24|drawable\/ic_launcher_background\.xml$/.test(file));
    expect(left).toEqual([]);
    expect(readdirSync('assets').sort()).toEqual(['play-icon-512-ink.png', 'play-icon-512.png']);
  });

  it('come in every size the installed app, the launchers and the notifications use', () => {
    for (const [density, size] of Object.entries(LEGACY_LAUNCHER)) {
      for (const name of ['ic_launcher', 'ic_launcher_round']) expect(pngSize(`${RES}/mipmap-${density}/${name}.png`), `${density} ${name}`).toEqual([size, size]);
    }
    for (const size of WEB_SIZES) expect(existsSync(`public/icons/icon-${size}.webp`), String(size)).toBe(true);
    expect(existsSync('public/icons/icon-512-maskable.webp')).toBe(true);
    expect(pngSize('public/icons/apple-touch-icon.png')).toEqual([180, 180]);
    expect(pngSize('public/icons/icon-192.png')).toEqual([192, 192]);
    expect(pngSize('public/icons/badge-96.png')).toEqual([96, 96]);
    expect(pngSize('assets/play-icon-512.png')).toEqual([512, 512]);
    expect(pngSize('assets/play-icon-512-ink.png')).toEqual([512, 512]);
    // What the page and the manifests point at is there.
    const icons = [...read('index.html').matchAll(/href="(\/icons\/[^"]+)"/g), ...['public/manifest.webmanifest', 'public/manifest.pl.webmanifest'].flatMap((file) => [...read(file).matchAll(/"src": "(\/icons\/[^"]+)"/g)])];
    expect(icons.length).toBeGreaterThan(0);
    for (const [, path] of icons) expect(existsSync(`public${path}`), path).toBe(true);
  });
});

describe('the first frame', () => {
  it('is light, in the frame colour of the default theme, until the page paints', () => {
    const surface = daylight.frameBg.toUpperCase();
    expect(color(`${RES}/values/colors.xml`, 'surface')).toBe(surface);
    expect(JSON.parse(read('capacitor.config.json')).backgroundColor.toUpperCase()).toBe(surface);
    for (const file of [`${RES}/values/styles.xml`, `${RES}/values-v27/styles.xml`]) {
      const styles = read(file);
      const window = /<style name="AppTheme.NoActionBar" parent="Theme.AppCompat.Light.NoActionBar">([\s\S]*?)<\/style>/.exec(styles)?.[1] ?? '';
      expect(window, file).toContain('<item name="android:windowBackground">@color/surface</item>');
      expect(window, file).toContain('<item name="android:windowLightStatusBar">true</item>');
    }
    expect(read(`${RES}/values-v27/styles.xml`)).toContain('<item name="android:windowLightNavigationBar">true</item>');
  });

  it('shows a light splash with the icon on its paper disc, on every Android version', () => {
    const splash = /<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen.IconBackground">([\s\S]*?)<\/style>/.exec(read(`${RES}/values/styles.xml`))?.[1] ?? '';
    expect(splash).toContain('<item name="windowSplashScreenBackground">@color/surface</item>');
    expect(splash).toContain('<item name="windowSplashScreenIconBackgroundColor">@color/ic_launcher_background</item>');
    expect(splash).toContain('<item name="windowSplashScreenAnimatedIcon">@drawable/ic_launcher_foreground</item>');
    expect(splash).toContain('<item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>');
    expect(splash).not.toContain('@drawable/splash');
    const activity = read('android/app/src/main/java/pl/patrykpro/calendar/MainActivity.java');
    // Installed first, then the plugins, then the bridge; the WebView's own zoom held at 100% after it.
    const order = ['SplashScreen.installSplashScreen(this)', 'registerPlugin(DisplayPlugin.class)', 'super.onCreate(savedInstanceState)', 'setTextZoom(100)'].map((call) => activity.indexOf(call));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('the web view', () => {
  it('registers no service worker in the app, and lets none of its requests past the guard', () => {
    // Only the browser registers the worker; the native app serves its shell from the APK.
    const main = read('src/main.tsx');
    const registers = main.split('\n').filter((line) => line.includes('serviceWorker.register'));
    expect(registers.length).toBe(1);
    expect(main).toMatch(/if \(import\.meta\.env\.PROD && !isNative && 'serviceWorker' in navigator\) \{\n\s+window\.addEventListener\('load', \(\) => void navigator\.serviceWorker\.register\('\/sw\.js'\)/);
    // A worker registered all the same (by page script) would fetch through Capacitor's own
    // service-worker client, which goes straight to the local server and past
    // GuardedWebViewClient (MainActivity). With this off, Capacitor installs no such client.
    expect(JSON.parse(read('capacitor.config.json')).android).toEqual({ resolveServiceWorkerRequests: false });
  });
});

describe('reminder notifications', () => {
  it('carry the brand ink', () => {
    const notifier = read('android/app/src/main/java/pl/patrykpro/calendar/reminders/ReminderNotifier.java');
    expect(/ACCENT = 0xFF([0-9A-F]{6});/.exec(notifier)?.[1]).toBe(iconMaster.ICON_BRAND.slice(1).toUpperCase());
  });

  it('name their time with the same words in both languages', () => {
    const en = strings(`${RES}/values/strings_when.xml`);
    const pl = strings(`${RES}/values-pl/strings_when.xml`);
    expect(Object.keys(pl).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(en).sort()).toEqual(['when_day_at_time', 'when_today', 'when_tomorrow', 'when_yesterday']);
    for (const name of Object.keys(en)) expect((pl[name].match(/%\d\$s/g) ?? []).sort(), name).toEqual((en[name].match(/%\d\$s/g) ?? []).sort());
    expect(pl.when_day_at_time).toBe('%1$s o godzinie %2$s');
    expect(en.when_day_at_time).toBe('%1$s at %2$s');
  });
});
