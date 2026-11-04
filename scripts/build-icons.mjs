// One-off generator for the PWA icons in public/icons (committed; the build does not run it,
// so deploys need no browser). Gold mark on Studio black only (brand rule 01).
// Usage: node scripts/build-icons.mjs
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const mark = readFileSync('public/brand/xyp3rn-mark.svg', 'utf8');
const ICONS = [
  // [file, size, mark width as a fraction of the icon]
  ['icon-192.png', 192, 0.62],
  ['icon-512.png', 512, 0.62],
  // Maskable: Android may crop to a circle of 80% diameter; the mark stays well inside it.
  ['icon-maskable-512.png', 512, 0.5],
  ['apple-touch-icon.png', 180, 0.6],
];

mkdirSync('public/icons', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, fraction] of ICONS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;background:#080808;display:grid;place-items:center">
    <div style="width:${Math.round(size * fraction)}px">${mark.replace('<svg ', '<svg style="display:block;width:100%;height:auto" ')}</div></body></html>`);
  await page.screenshot({ path: `public/icons/${file}`, omitBackground: false });
}
await browser.close();
console.log(`Wrote ${ICONS.length} icons to public/icons`);
