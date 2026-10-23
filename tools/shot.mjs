// Screenshot a page in headless Chromium and print its console output.
// Usage: node tools/shot.mjs <url-or-path[?query]> <out.png> [width=1280] [height=800] [waitMs=1500] [mobile]
// Paths are opened as file:// URLs, so classic-script pages work without a server.
import { chromium } from 'playwright';
import path from 'node:path';

const [, , target, out, w = '1280', h = '800', wait = '1500', mode] = process.argv;
if (!target || !out) {
  console.log('usage: node tools/shot.mjs <url-or-path> <out.png> [w] [h] [waitMs] [mobile]');
  process.exit(2);
}
let url = target;
if (!/^(https?|file):/.test(target)) {
  const q = target.indexOf('?');
  const p = q >= 0 ? target.slice(0, q) : target;
  url = 'file://' + path.resolve(p) + (q >= 0 ? target.slice(q) : '');
}
const mobile = mode === 'mobile';
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: +w, height: +h },
  deviceScaleFactor: mobile ? 2 : 1,
  isMobile: mobile,
  hasTouch: mobile,
});
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
await page.goto(url);
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
console.log(`saved ${out} (${url})`);
console.log(logs.length ? logs.join('\n') : '(no console output)');
await browser.close();
process.exit(logs.some((l) => l.startsWith('[pageerror]') || l.startsWith('[error]')) ? 1 : 0);
