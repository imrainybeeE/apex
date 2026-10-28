// Boss screenshot pass: one Chromium launch, 1440x900 + 390x844. Arrival, each telegraph, enraged, death light.
// Usage: node tools/boss-shots.mjs [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(ROOT, 'shots', 'boss'));
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch(); const logs = [];
for (const v of [{ tag: 'd', o: { viewport: { width: 1440, height: 900 } } }, { tag: 'm', o: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } }]) {
  const ctx = await b.newContext(v.o); const p = await ctx.newPage();
  p.on('pageerror', (e) => logs.push(v.tag + ' ' + e.message));
  await p.goto(pathToFileURL(path.join(ROOT, 'index.html')).href + '?tier=t6_valley&sp=wolf&tutorial=0&mute=1&skipEditor=1&autoplay=1');
  await p.waitForFunction(() => Apex.G.mode === 'play');
  await p.evaluate(() => { if (Apex.World) Apex.World.autoQuality = false; Apex.debug.fillGrowth(); });
  await p.waitForTimeout(600);
  await p.evaluate(() => { Apex.G.finalHold = 15; });
  const shot = (n) => p.screenshot({ path: path.join(out, `${n}-${v.tag}.png`) });
  await p.waitForFunction(() => { const s = Apex.Boss.stats(); return s && s.hp != null; }, null, { timeout: 15000 });
  await p.waitForTimeout(700); await shot('arrive');
  const waitState = async (st, prep) => {
    if (prep) await p.evaluate(prep);
    try {
      await p.waitForFunction((st) => { const s = Apex.Boss.stats(); return s && s.state === st && Apex.G.boss; }, st, { timeout: 40000, polling: 'raf' });
      await p.waitForTimeout(st.endsWith('Wind') ? 350 : 100);
      await p.evaluate(() => { Apex.G.timeScale = 0.0001; }); await p.waitForTimeout(150);
      await shot(st); await p.evaluate(() => { Apex.G.timeScale = 1; });
    } catch (e) { logs.push(v.tag + ' no ' + st); }
  };
  await waitState('chargeWind');
  await waitState('stunned');
  await waitState('slamWind', () => { const e = Apex.G.entities.find((x) => x.boss); e.hp = e.maxHp * 0.6; });
  await waitState('roarWind');
  await p.evaluate(() => { const e = Apex.G.entities.find((x) => x.boss); e.hp = e.maxHp * 0.25; });
  await p.waitForTimeout(3500); await shot('enraged');
  await p.evaluate(() => { const e = Apex.G.entities.find((x) => x.boss); Apex.damageEntity(e, e.hp + 1, Apex.G.player, { kind: 'bite' }); });
  await p.waitForTimeout(1600); await shot('death');
  await p.waitForFunction(() => Apex.G.mode === 'victory', null, { timeout: 15000 }).catch(() => logs.push(v.tag + ' no victory'));
  await p.waitForTimeout(1200); await shot('victory');
  await ctx.close();
}
await b.close();
console.log(logs.length ? logs.join('\n') : '(no page errors)'); console.log('wrote ' + out);
