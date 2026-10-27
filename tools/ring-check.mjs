// One Chromium launch: close-ups of the player's in-world rings in several frozen states, desktop + mobile.
// Usage: node tools/ring-check.mjs <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(ROOT, 'shots', 'ring'));
fs.mkdirSync(out, { recursive: true });
const url = (q) => pathToFileURL(path.join(ROOT, 'index.html')).href + '?' + q + '&skipEditor=1&seed=1&mute=1&tutorial=0';

const STATES = {
  cooling: (p) => { p.ability.cdT = p.ability.cd * 0.5; p.ability.activeT = 0; },
  ready: (p) => { p.ability.cdT = 0; p.ability.activeT = 0; },
  active: (p) => { p.ability.cdT = p.ability.cd; p.ability.activeT = 1; },
  hurt_hungry: (p) => { p.ability.cdT = p.ability.cd * 0.2; p.hp = p.maxHp * 0.35; p.energy = 12; },
};
const browser = await chromium.launch();
const logs = [];
for (const v of [
  { tag: 'd', opts: { viewport: { width: 1440, height: 900 } } },
  { tag: 'm', opts: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
]) {
  const ctx = await browser.newContext(v.opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push(`[${v.tag}] pageerror: ${e.message}`));
  for (const tier of ['t1_litter', 't3_pond']) {
    await page.goto(url('tier=' + tier));
    await page.waitForFunction(() => window.Apex && Apex.G && Apex.G.mode === 'play' && Apex.G.player, null, { timeout: 15000 });
    await page.waitForTimeout(2600); // past the intro grace shimmer
    for (const [name, fn] of Object.entries(STATES)) {
      const box = await page.evaluate((src) => {
        const G = Apex.G, p = G.player;
        G.timeScale = 0.0001; p.invulnT = 0; p.growth = 0.45; p.angle = 0.5; p.hp = p.maxHp; p.energy = 80;
        (0, eval)('(' + src + ')')(p);
        const s = Apex.worldToScreen(p.x, p.y), half = Math.max(90, p.r * G.cam.zoom * 3.2);
        return { x: Math.max(0, s.x - half), y: Math.max(0, s.y - half), width: half * 2, height: half * 2 };
      }, fn.toString());
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(out, `${tier}-${name}-${v.tag}.png`), clip: box });
    }
  }
  await ctx.close();
}
await browser.close();
console.log(logs.length ? logs.join('\n') : '(no page errors)');
console.log('wrote ' + out);
