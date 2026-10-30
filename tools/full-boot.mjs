// One launch: boot a built page through all six tiers, then reach the boss and check it draws. Counts pageerrors.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
const f = pathToFileURL(process.argv[2]).href; const errs = []; const res = {};
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(f + '?mute=1'); await p.waitForTimeout(1000); res.title = await p.evaluate(() => Apex.G.mode + (document.querySelector('.logo svg') ? ' +logo' : ' NO LOGO'));
for (const t of ['t1_litter', 't2_under', 't3_pond', 't4_meadow', 't5_forest', 't6_valley']) {
  await p.goto(f + '?tier=' + t + '&tutorial=0&mute=1&skipEditor=1');
  await p.waitForFunction(() => Apex.G.mode === 'play', null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(1200); res[t] = await p.evaluate(() => Apex.G.mode + ' ' + Apex.G.player.sp);
}
await p.evaluate(() => { Apex.debug.fillGrowth(); }); await p.waitForTimeout(500);
await p.evaluate(() => { Apex.G.finalHold = 15; });
res.boss = await p.waitForFunction(() => { const s = Apex.Boss.stats(); return s && s.hp != null && Apex.G.entities.some((e) => e.boss); }, null, { timeout: 20000 })
  .then(() => p.waitForTimeout(3000)).then(() => p.evaluate(() => { const s = Apex.Boss.stats(); return s.state + ' hp ' + Math.round(s.hp); })).catch(() => 'NO BOSS');
await b.close(); console.log(JSON.stringify({ res, pageerrors: errs.length, errs: errs.slice(0, 5) }));
