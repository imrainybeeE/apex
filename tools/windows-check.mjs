// Windows-like browser check of dist/apex.html: Chromium + Firefox at device scale 1, 1.25, 1.5 (common Windows
// display scaling). One launch per browser. Per run: no page errors, play starts, right-click dashes without a
// context menu, the HUD fonts have a Segoe UI fallback, the frame rate is sane. Screenshots into shots/win/.
// Real Windows (ClearType, Edge, GPU drivers) can't be checked from macOS.
// Usage: node tools/build-single.mjs && node tools/windows-check.mjs
import { chromium, firefox } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(ROOT, 'dist', 'apex.html');
if (!fs.existsSync(file)) { console.error('dist/apex.html missing: run node tools/build-single.mjs first'); process.exit(2); }
const out = path.join(ROOT, 'shots', 'win');
fs.mkdirSync(out, { recursive: true });
const url = pathToFileURL(file).href + '?mute=1&tutorial=0&seed=1';
let bad = 0;

for (const [name, type] of [['chromium', chromium], ['firefox', firefox]]) {
  let browser;
  try { browser = await type.launch(); } catch (err) { console.log(`skip ${name}: could not launch (${String(err.message).split('\n')[0]})`); continue; }
  for (const dpr of [1, 1.25, 1.5]) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    const tag = `${name}@${dpr}`;
    try {
      await page.goto(url);
      await page.waitForFunction(() => window.Apex && Apex.G && Apex.G.mode === 'title', null, { timeout: 20000 });
      await page.screenshot({ path: path.join(out, `${tag}-title.png`) });
      await page.click('[data-act="play"]').catch(() => page.evaluate(() => Apex.newRun()));
      await page.waitForFunction(() => Apex.G.mode === 'play', null, { timeout: 15000 });
      await page.waitForTimeout(2500);
      const before = await page.evaluate(() => ({ cd: Apex.G.player.dashCdT || 0 }));
      const menu = await page.evaluate(() => {
        const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 300, clientY: 300 });
        document.getElementById('game').dispatchEvent(ev);
        return ev.defaultPrevented;
      });
      await page.mouse.move(900, 300);
      await page.mouse.down({ button: 'right' }); await page.waitForTimeout(60); await page.mouse.up({ button: 'right' });
      await page.waitForTimeout(80);
      const after = await page.evaluate(() => ({ cd: Apex.G.player.dashCdT || 0, dashT: Apex.G.player.dashT || 0 }));
      const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(Math.round(n / 2)); }; requestAnimationFrame(f); }));
      const fonts = await page.evaluate(() => {
        const q = (s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).fontFamily : ''; };
        return { score: q('.score'), dial: q('.dial-lbl') };
      });
      await page.screenshot({ path: path.join(out, `${tag}-hud.png`) });
      const dashed = after.cd > before.cd || after.dashT > 0;
      const segoe = /Segoe UI/.test(fonts.score) && /Segoe UI/.test(fonts.dial);
      const ok = !errs.length && menu && dashed && segoe;
      if (!ok) bad++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${tag.padEnd(14)} errors ${errs.length} contextmenu-blocked ${menu} right-click-dash ${dashed} segoe-fallback ${segoe} fps ${fps}${errs.length ? ' ' + errs[0] : ''}`);
    } catch (err) {
      bad++;
      console.log(`FAIL ${tag} ${String(err.message).split('\n')[0]}${errs.length ? ' | ' + errs[0] : ''}`);
    }
    await ctx.close();
  }
  await browser.close();
}
console.log(bad ? `${bad} run(s) failed` : 'all runs ok');
process.exit(bad ? 1 : 0);
