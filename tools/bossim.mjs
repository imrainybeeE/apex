// Usage: node tools/bossim.mjs '[["normal",1],["easy",1,"bear"]]'
// Boss fight sims: full-grown player in the valley, boss forced in at the start of the hold. One browser launch.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runs = JSON.parse(process.argv[2] || '[["normal",1],["normal",2],["normal",3]]');
const b = await chromium.launch(); const p = await b.newPage();
await p.goto(pathToFileURL(path.join(ROOT, 'index.html')).href + '?mute=1&tutorial=0');
await p.waitForFunction(() => window.Apex && Apex.G && Apex.G.mode === 'title');
for (const [diff, seed, sp] of runs) {
  console.log(await p.evaluate(([diff, seed, sp]) => {
    Apex.setDifficulty(diff);
    let start = null, end = null; const st = { playerHits: 0, kinds: {} };
    const f1 = (d) => { if (d.target && d.target.isPlayer) st.playerHits++; };
    const f4 = (d) => { st.kinds[d.kind] = (st.kinds[d.kind] || 0) + 1; };
    const f2 = () => { if (start == null) start = Apex.G.time; }, f3 = () => { end = Apex.G.time; };
    Apex.on('damage', f1); Apex.on('bossHit', f4); Apex.on('bossArrive', f2); Apex.on('bossDeath', f3);
    const hook = Apex.Boss.update; Apex.Boss.update = function (G, dt) { if (G.final && !Apex.Boss.stats() && G.finalHold < 15) G.finalHold = 15; hook(G, dt); };
    const rep = Apex.debug.simulate(240, { tier: 't6_valley', sp: sp || 'wolf', bot: 'balanced', seed, growth: 1 });
    Apex.Boss.update = hook; Apex.off('damage', f1); Apex.off('bossHit', f4); Apex.off('bossArrive', f2); Apex.off('bossDeath', f3);
    return `${diff} s${seed} ${sp || 'wolf'}: victory ${rep.victory}, fight ${start != null && end != null ? Math.round(end - start) + 's' : 'unfinished'}, deaths ${rep.deaths.length}, hits taken ${JSON.stringify(st.kinds)}, boss ${JSON.stringify(Apex.Boss.stats())}`;
  }, [diff, seed, sp]));
}
await p.evaluate(() => Apex.setDifficulty('normal'));
await b.close();
