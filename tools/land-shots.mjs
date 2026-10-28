// Land path screenshot pass: one Chromium launch, 1440x900 + 390x844, every screen a player sees on the Land path.
// Usage: node tools/land-shots.mjs <round> [names]   -> shots/land/r<round>/<name>-d.png and -m.png
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const round = process.argv[2] || '1';
const only = process.argv[3] ? process.argv[3].split(',') : null;
const want = (n) => !only || only.includes(n);
const out = path.join(ROOT, 'shots', 'land', 'r' + round);
fs.mkdirSync(out, { recursive: true });
const base = pathToFileURL(path.join(ROOT, 'index.html')).href;
const browser = await chromium.launch();
const logs = [];

for (const v of [
  { tag: 'd', opts: { viewport: { width: 1440, height: 900 } } },
  { tag: 'm', opts: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
]) {
  const ctx = await browser.newContext(v.opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push(`[${v.tag}] ${e.message}`));
  const shot = (n) => page.screenshot({ path: path.join(out, `${n}-${v.tag}.png`) });
  const ev = (fn, a) => page.evaluate(fn, a);
  const play = async (tier, sp, extra = '') => {
    await page.goto(`${base}?tier=${tier}${sp ? '&sp=' + sp : ''}&tutorial=0&skipEditor=1&seed=1&mute=1${extra}`);
    await page.waitForFunction(() => window.Apex && Apex.G && Apex.G.mode === 'play', null, { timeout: 20000 });
    await ev(() => { if (Apex.World) Apex.World.autoQuality = false; });
  };
  const mode = (m, t = 9000) => page.waitForFunction((m) => Apex.G.mode === m, m, { timeout: t });

  if (want('evolve_pond')) {
    await play('t3_pond', 'frog'); await page.waitForTimeout(1500);
    await ev(() => Apex.debug.fillGrowth()); await mode('evolveChoice'); await page.waitForTimeout(1300); await shot('evolve_pond');
  }
  for (const [tier, sp] of [['t4_meadow', 'snake'], ['t5_forest', 'fox'], ['t6_valley', 'wolf']]) {
    if (want('intro_' + tier)) {
      await play(tier, sp); await ev(() => Apex.setMode('intro')); await page.waitForTimeout(900); await shot('intro_' + tier);
    }
    if (want('hud_' + tier)) {
      await play(tier, sp, '&autoplay=1'); await page.waitForTimeout(7000); await shot('hud_' + tier);
    }
  }
  const casts = [['t4_meadow', 'snake'], ['t4_meadow', 'weasel'], ['t5_forest', 'fox'], ['t5_forest', 'lynx'], ['t6_valley', 'wolf'], ['t6_valley', 'bear']];
  for (const [tier, sp] of casts) {
    if (!want('cast_' + sp)) continue;
    await play(tier, sp); await page.waitForTimeout(2600);
    await ev(() => { const p = Apex.G.player; p.ability.cdT = 0; if (Apex.input) Apex.input.abilityQueued = true; });
    await page.waitForTimeout(160); await shot('cast_' + sp);
  }
  if (want('eco_forest')) {
    await play('t5_forest', 'fox', '&autoplay=1'); await page.waitForTimeout(3000);
    if (v.tag === 'm') await page.tap('.dial'); else await page.keyboard.down('Tab');
    await page.waitForTimeout(700); await shot('eco_forest'); if (v.tag !== 'm') await page.keyboard.up('Tab');
  }
  if (want('dying') || want('rebirth')) {
    await play('t6_valley', 'bear'); await page.waitForTimeout(2000);
    await ev(() => Apex.debug.killPlayer()); await mode('dying'); await page.waitForTimeout(2300); await shot('dying');
    await page.keyboard.press('Space');
    try { await mode('rebirthChoice', 9000); } catch (e) { await page.keyboard.press('Space'); await mode('rebirthChoice', 6000); }
    await page.waitForTimeout(1200); await shot('rebirth');
  }
  if (want('final')) {
    await play('t6_valley', 'wolf', '&autoplay=1'); await page.waitForTimeout(1500);
    await ev(() => Apex.debug.fillGrowth()); await page.waitForTimeout(2500); await shot('final');
  }
  if (want('victory')) {
    await play('t6_valley', 'bear'); await page.waitForTimeout(1500);
    await ev(() => Apex.debug.win()); await mode('victory'); await page.waitForTimeout(1300); await shot('victory');
  }
  await ctx.close();
}
await browser.close();
console.log(logs.length ? logs.join('\n') : '(no page errors)');
console.log('wrote ' + out);
