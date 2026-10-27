// One Chromium launch, two viewports (1440x900 desktop, 390x844 mobile), every UI screen.
// Usage: node tools/ui-shots.mjs <round> [only,names] [--firefox]
// Output: shots/ui/r<round>/<name>-d.png and -m.png (Firefox: <name>-ff.png)
import { chromium, firefox } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const round = process.argv[2] || '1';
const only = (process.argv[3] && !process.argv[3].startsWith("--") && process.argv[3] !== "all") ? process.argv[3].split(",") : null;
const useFirefox = process.argv.includes('--firefox');
const out = path.join(ROOT, 'shots', 'ui', 'r' + round);
fs.mkdirSync(out, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
const BASE = 'skipEditor=1&seed=1&mute=1';

const browser = await (useFirefox ? firefox : chromium).launch();
const logs = [];
const want = (n) => !only || only.includes(n);

const views = useFirefox
  ? [{ tag: 'ff', opts: { viewport: { width: 1440, height: 900 } } }]
  : [
    { tag: 'd', opts: { viewport: { width: 1440, height: 900 } } },
    { tag: 'm', opts: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  ];

const vf = process.argv.includes('--mobile') ? 'm' : process.argv.includes('--desktop') ? 'd' : null;
for (const v of views.filter((x) => !vf || x.tag === vf)) {
  const ctx = await browser.newContext(v.opts);
  await ctx.addInitScript(() => {
    try { localStorage.setItem('apex.best', JSON.stringify({ shared: { time: 612.3, score: 48210, deaths: 2, harmony: 61 } })); } catch (e) { /* ignore */ }
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/404|ERR_FILE|Failed to load resource/.test(m.text())) logs.push(`[${v.tag}] ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[${v.tag}] pageerror: ${e.message}`));
  const shot = async (name) => { await page.screenshot({ path: path.join(out, `${name}-${v.tag}.png`) }); };
  const open = async (query) => {
    await page.goto(`${origin}/index.html?${query}`);
    await page.waitForFunction(() => window.Apex && Apex.G && Apex.G.mode);
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.waitForTimeout(500);
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const mode = () => ev(() => Apex.G.mode);
  const waitMode = (m, t = 8000) => page.waitForFunction((m) => Apex.G.mode === m, m, { timeout: t });
  const play = (tier, extra = '') => open(`tier=${tier}&autoplay=1&tutorial=0&${BASE}${extra}`);

  if (want('title')) { await open(BASE); await page.waitForTimeout(1200); await shot('title'); }
  if (want('how') && !useFirefox) { await open(BASE); await page.click('[data-act="how"]'); await page.waitForTimeout(500); await shot('how'); }

  if (want('hud_t1')) { await play('t1_litter'); await page.waitForTimeout(6000); await shot('hud_t1'); }
  if (want('fx_t1')) {
    // a busy moment: damaged, hungry, ability cooling down, a stunned and an angry neighbour
    await play('t1_litter');
    await page.waitForTimeout(4000);
    await ev(() => {
      const G = Apex.G, p = G.player;
      G.flags.autoplay = false; p.hp = p.maxHp * 0.55; p.growth = 0.7; p.energy = 22;
      p.ability = p.ability || { id: 'formic_spray', cd: 8, cdT: 4, activeT: 0 }; p.ability.cdT = 3.2;
      const near = G.entities.filter((e) => !e.isPlayer && e.role !== 'producer' && Math.hypot(e.x - p.x, e.y - p.y) < 260).slice(0, 4);
      if (near[0]) near[0].stunT = 2; if (near[1]) near[1].angryT = 5; if (near[2]) near[2].flinchT = 0.4;
      Apex.emit('damage', { target: p, amount: 6, by: near[1] || null });
      Apex.emit('bite', { e: p, hits: near.slice(0, 1) });
    });
    await page.waitForTimeout(120);
    await shot('fx_t1');
  }
  if (want('hud_t3')) { await play('t3_pond'); await page.waitForTimeout(6000); await shot('hud_t3'); }
  if (want('eco')) {
    await play('t3_pond'); await page.waitForTimeout(3500);
    if (v.tag === 'm') await page.tap('.dial'); else await page.keyboard.down('Tab');
    await page.waitForTimeout(700); await shot('eco');
    if (v.tag !== 'm') await page.keyboard.up('Tab');
  }
  if (want('tutorial')) {
    await open(`tier=t1_litter&tutorial=1&${BASE}`);
    await page.waitForTimeout(1500); await shot('tutorial');
    // the bite step shows a highlighted caterpillar and the Skip control
    await ev(() => { Apex.Tutorial.advance(); Apex.Tutorial.advance(); Apex.Tutorial.advance(); });
    await page.waitForTimeout(1200); await shot('tutorial_bite');
  }
  if (want('intro')) {
    await play('t1_litter'); await page.waitForTimeout(800);
    await ev(() => { Apex.G.flags.autoplay = false; Apex.setMode('intro'); });
    await page.waitForTimeout(900); await shot('intro');
  }
  if (want('evolve')) {
    await play('t1_litter'); await page.waitForTimeout(1500);
    await ev(() => { Apex.G.flags.autoplay = false; Apex.debug.fillGrowth(); });
    await waitMode('evolveChoice'); await page.waitForTimeout(1500); await shot('evolve');
  }
  if (want('evolve_t3')) {
    await play('t3_pond'); await page.waitForTimeout(1500);
    // t3 is the last tier of the slice, so fake the six-card Pond Edge choice (three paths)
    await ev(() => {
      Apex.G.flags.autoplay = false;
      Apex.G.choices = ['weasel', 'snake', 'kingfisher', 'swallow', 'pike', 'otter'].map((sp, i) => ({ sp, tierId: 't4_meadow', path: ['land', 'sky', 'sea'][i >> 1] }));
      Apex.setMode('evolveChoice');
    });
    await waitMode('evolveChoice'); await page.waitForTimeout(1500); await shot('evolve_t3');
  }
  if (want('dying') || want('rebirth')) {
    await play('t2_under'); await page.waitForTimeout(2000);
    await ev(() => { Apex.G.flags.autoplay = false; Apex.debug.killPlayer(); });
    await waitMode('dying'); await page.waitForTimeout(2300); await shot('dying');
    await page.keyboard.press('Space');
    try { await waitMode('rebirthChoice', 9000); } catch (e) { await page.keyboard.press('Space'); await waitMode('rebirthChoice', 6000); }
    await page.waitForTimeout(1300); await shot('rebirth');
  }
  if (want('pause')) {
    await open(`tier=t1_litter&tutorial=1&${BASE}`);
    await page.waitForTimeout(1500);
    await ev(() => Apex.togglePause());
    await waitMode('paused'); await page.waitForTimeout(500); await shot('pause');
  }
  if (want('victory')) {
    await play('t3_pond'); await page.waitForTimeout(2000);
    await ev(() => Apex.debug.win());
    await waitMode('victory'); await page.waitForTimeout(1200); await shot('victory');
  }
  if (want('final')) {
    await play('t3_pond'); await page.waitForTimeout(1500);
    await ev(() => { Apex.debug.fillGrowth(); });
    await page.waitForTimeout(2500); await ev(() => Apex.debug.forceMishap && Apex.debug.forceMishap('famine'));
    await page.waitForTimeout(900); await shot('final');
  }
  await ctx.close();
}
await browser.close();
server.close();
console.log(logs.length ? logs.join('\n') : '(no console errors)');
console.log('wrote ' + out);
