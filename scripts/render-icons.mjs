// Renders every icon from the one master drawing (src/theme/iconMaster.ts),
// with a local Chrome, and writes the SVG icons and the Android vector
// drawables from it. Pictures of 48 px and less get the small drawing (four
// weeks of four days), larger ones the whole month:
//   public/favicon.svg                   the tab icon: the small drawing on the paper tile (src/theme/logo.ts)
//   public/icons/icon.svg                the installed web app's scalable icon: the month on the paper tile
//   public/icons/icon-<size>.webp        the installed web app's icons (the tile, transparent corners)
//   public/icons/icon-512-maskable.webp  maskable: paper edge to edge, the month inside the safe circle
//   public/icons/apple-touch-icon.png    180 × 180, paper edge to edge (iOS rounds it itself)
//   public/icons/icon-192.png            the tile, for web notifications
//   public/icons/badge-96.png            the small drawing in white on nothing, a web notification's badge
//   android/.../mipmap-*/ic_launcher*.png  launcher icons of Android 7.x, which has no adaptive icons
//   android/.../drawable/ic_launcher_foreground.xml, ic_launcher_monochrome.xml, ic_stat_calendar.xml
//                                        the adaptive icon's foreground (also the splash icon), its
//                                        monochrome layer and the notification icon, as vectors
//   assets/play-icon-512.png             a 512 px icon, paper edge to edge (for app listings)
//   assets/play-icon-512-ink.png         the same on the ink (the palette of the logo in a dark theme)
// The logo in the app is the SVG of src/theme/logo.ts.
//
// Run from the repository root: node scripts/render-icons.mjs
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { LEGACY_FILL, LEGACY_LAUNCHER, SMALL_UP_TO, WEB_SIZES, badgeSvg, drawables, faviconSvg, fullBleedSvg, readMaster, roundSvg, tileSvg } from './icon-art.mjs';

const master = readMaster();

function write(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  console.log('wrote', file);
}

for (const [file, xml] of Object.entries(drawables(master))) write(file, xml);
write('public/favicon.svg', faviconSvg(master));
write('public/icons/icon.svg', faviconSvg(master, { small: false }));

// The installed Chrome, wherever it lives; CHROME_PATH names another Chromium build.
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });

/** An SVG drawn to `size` × `size` pixels; transparent where it draws nothing unless `opaque`. */
async function render(size, svg, { opaque = false } = {}) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent"><style>svg{display:block;width:${size}px;height:${size}px}</style>${svg}</body></html>`);
  const png = await page.screenshot({ omitBackground: !opaque });
  await page.close();
  return png;
}

/** PNG to lossless WebP through a canvas in the browser, so no image library is needed. */
async function toWebp(png) {
  const page = await browser.newPage();
  const data = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toDataURL('image/webp', 1).split(',')[1];
  }, `data:image/png;base64,${png.toString('base64')}`);
  await page.close();
  return Buffer.from(data, 'base64');
}

try {
  for (const size of WEB_SIZES) write(`public/icons/icon-${size}.webp`, await toWebp(await render(size, tileSvg(master, { small: size <= SMALL_UP_TO }))));
  // 90 units of the grid in view: the month (29.2 from the centre) stays inside the safe circle of 40%.
  write('public/icons/icon-512-maskable.webp', await toWebp(await render(512, fullBleedSvg(master, { size: 90 }), { opaque: true })));
  write('public/icons/apple-touch-icon.png', await render(180, fullBleedSvg(master), { opaque: true }));
  write('public/icons/icon-192.png', await render(192, tileSvg(master)));
  write('public/icons/badge-96.png', await render(96, badgeSvg(master)));

  for (const [density, size] of Object.entries(LEGACY_LAUNCHER)) {
    const dir = `android/app/src/main/res/mipmap-${density}`;
    const small = size <= SMALL_UP_TO;
    write(`${dir}/ic_launcher.png`, await render(size, tileSvg(master, { fill: LEGACY_FILL, small })));
    write(`${dir}/ic_launcher_round.png`, await render(size, roundSvg(master, { fill: LEGACY_FILL, small })));
  }

  write('assets/play-icon-512.png', await render(512, fullBleedSvg(master), { opaque: true }));
  write('assets/play-icon-512-ink.png', await render(512, fullBleedSvg(master, { palette: 'ink' }), { opaque: true }));
} finally {
  await browser.close();
}
