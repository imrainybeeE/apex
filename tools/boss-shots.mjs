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
  // Keep the fight alive and deterministic: pin the boss above a hp floor and keep the player healed while we shoot.
  await p.evaluate(() => {
    window.__pin = { floor: 0.9, heal: true };
    setInterval(() => {
      const G = Apex.G, e = G.entities && G.entities.find((x) => x.boss), pl = G.player;
      if (pl && window.__pin.heal) pl.hp = pl.maxHp;
      if (pl && window.__pin.hold) { pl.x = window.__pin.hold.x; pl.y = window.__pin.hold.y; pl.vx = pl.vy = 0; }   // keep the framing steady
      if (e && e.alive && window.__pin.floor) e.hp = Math.max(e.hp, e.maxHp * window.__pin.floor);
    }, 40);
  });
  await p.waitForFunction(() => { const s = Apex.Boss.stats(); return s && s.hp != null; }, null, { timeout: 15000 });
  await p.waitForTimeout(700); await shot('arrive');
  const phaseTo = async (hpFrac, floor) => {
    await p.evaluate(([h, f]) => { window.__pin.floor = f; const e = Apex.G.entities.find((x) => x.boss); e.hp = e.maxHp * h; }, [hpFrac, floor]);
  };
  const toStalk = () => p.waitForFunction(() => { const s = Apex.Boss.stats(); return s && s.state === 'stalk'; }, null, { timeout: 25000, polling: 'raf' });
  // jump into one attack, wait `ms` of real time into its windup, freeze the frame, shoot, resume
  const attack = async (name, kind, ms, dist) => {
    try {
      await toStalk();
      const ok = await p.evaluate(([k, dist]) => {   // frame the fight: boss at the middle of the world, player a set distance off, then jump into the windup
        const G = Apex.G, e = G.entities.find((x) => x.boss), pl = G.player, W = G.world || 1200;
        const th = window.innerHeight > window.innerWidth ? -1.25 : -0.4, d = dist < 0 ? e.r * 1.1 + pl.r : e.r * dist;
        e.x = W / 2; e.y = W / 2; e.vx = e.vy = 0; pl.x = e.x + Math.cos(th) * d; pl.y = e.y + Math.sin(th) * d; pl.vx = pl.vy = 0;
        window.__pin.hold = { x: pl.x, y: pl.y };
        return Apex.Boss.force(k);
      }, [kind, dist]);
      if (!ok) throw new Error('force refused');
      await p.waitForTimeout(ms);
      await p.evaluate(() => { Apex.G.timeScale = 0.0001; }); await p.waitForTimeout(150);
      const st = await p.evaluate(() => Apex.Boss.stats().state);
      if (st !== kind + 'Wind') logs.push(v.tag + ' ' + name + ' wanted ' + kind + 'Wind got ' + st);
      await shot(name); await p.evaluate(() => { Apex.G.timeScale = 1; window.__pin.hold = null; });
    } catch (e) { logs.push(v.tag + ' no ' + name + ' (' + e.message.split('\n')[0] + ')'); await p.evaluate(() => { Apex.G.timeScale = 1; window.__pin.hold = null; }); }
  };
  await attack('chargeWind', 'charge', 650, 3);
  try {   // step the player out of the committed lane so the charge misses and it staggers
    await p.evaluate(() => { const G = Apex.G, e = G.entities.find((x) => x.boss), pl = G.player, a = e.angle; pl.x = e.x - Math.sin(a) * e.r * 4; pl.y = e.y + Math.cos(a) * e.r * 4; });
    await p.waitForFunction(() => Apex.Boss.stats().state === 'stunned', null, { timeout: 8000, polling: 'raf' });
    await p.waitForTimeout(500);
    await p.evaluate(() => { Apex.G.timeScale = 0.0001; }); await p.waitForTimeout(150);
    await shot('stunned'); await p.evaluate(() => { Apex.G.timeScale = 1; });
  } catch (e) { logs.push(v.tag + ' no stunned'); await p.evaluate(() => { Apex.G.timeScale = 1; }); }
  await attack('swipeWind', 'swipe', 450, -1);
  await phaseTo(0.6, 0.5);
  await attack('slamWind', 'slam', 850, 1.8);
  await attack('roarWind', 'roar', 480, 2.6);
  await phaseTo(0.25, 0.2);
  await p.waitForTimeout(3800); await shot('enraged');
  await attack('enraged-chargeWind', 'charge', 480, 3);
  await attack('enraged-slamWind', 'slam', 600, 1.8);
  await p.evaluate(() => { window.__pin.floor = 0; });
  await p.evaluate(() => { const e = Apex.G.entities.find((x) => x.boss); Apex.damageEntity(e, e.hp + 1, Apex.G.player, { kind: 'bite' }); });
  await p.waitForTimeout(1600); await shot('death');
  await p.waitForFunction(() => Apex.G.mode === 'victory', null, { timeout: 15000 }).catch(() => logs.push(v.tag + ' no victory'));
  await p.waitForTimeout(1200); await shot('victory');
  await ctx.close();
}
await b.close();
console.log(logs.length ? logs.join('\n') : '(no page errors)'); console.log('wrote ' + out);
