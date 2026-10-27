#!/usr/bin/env node
// Apex test harness: one command that says whether the game works.
//
//   node tools/check.mjs smoke [options]   console/page errors, every mode transition, mobile, file://
//   node tools/check.mjs sim   [options]   headless balance simulations + Verification targets
//   node tools/check.mjs shots [options]   review screenshots (desktop 1440x900, mobile 390x844)
//
// Common options
//   --url <path[?query]>   page to test, relative to the project root (default index.html).
//                          Also accepts http(s):// URLs (then no static server and no file:// step).
//   --out <dir>            screenshot root (default <root>/shots)
//   --headed               show the browser
//   --timeout <sec>        hard limit for the whole command (default: smoke 300, shots 300, sim 1800)
// sim options
//   --runs <n>             seeds 1..n per bot x path (default 3)
//   --bots <list>          balanced,greedy,passive (default all three)
//   --paths <list>         land,sky,sea or shared (default shared, the M1 path)
//   --max <sec>            game-time cap per run passed to Apex.debug.simulate (default 1500)
//   --run-timeout <sec>    wall-clock limit per run (default 120)
//   --parallel <n>         runs in parallel (default min(3, cpus-1))
//   --target-min/--target-max <min>   override the balanced finish-time target, in minutes
//   --strict               exit 1 when any target FAILs (run errors always exit 1)
//
// Exit code: 0 all good, 1 any error / failed step (/ failed target with --strict), 2 usage.
// Needs from the game: window.Apex, Apex.G.mode, Apex.TIERS, Apex.on, Apex.newRun/restart/choose/
// closeEditor/togglePause and Apex.debug.{setTier,killPlayer,fillGrowth,forceMishap,win,simulate}.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COLOR = process.stdout.isTTY;
const paint = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s) => paint(32, s), red = (s) => paint(31, s), yellow = (s) => paint(33, s), dim = (s) => paint(2, s);
const firstLine = (err) => String((err && err.message) || err).split('\n')[0].replace(/^page\.evaluate: /, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Events recorded in the page so short-lived modes and one-shot events are not missed between polls.
const HOOKED_EVENTS = ['mishapStart', 'mishapEnd', 'finalStart', 'victory', 'evolveReady', 'evolve', 'rebirth',
  'playerDeath', 'decomposeDone', 'runStart', 'restart', 'tierStart', 'pause', 'editorOpen', 'editorDone'];
const PLAYABLE = ['intro', 'play'];
const MISHAP_TYPES = ['famine', 'boom', 'disease', 'barren', 'surge'];

// ---------------------------------------------------------------- args

const BOOLEAN_FLAGS = new Set(['strict', 'headed', 'help']);

function parseArgs(argv) {
  const opts = {}, pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const eq = a.indexOf('=');
    const key = a.slice(2, eq > 0 ? eq : undefined);
    if (eq > 0) opts[key] = a.slice(eq + 1);
    else if (BOOLEAN_FLAGS.has(key)) opts[key] = true;
    else opts[key] = argv[++i];
  }
  return { opts, command: pos[0] };
}

const USAGE = `usage: node tools/check.mjs <smoke|sim|shots> [--url <path>] [--out <dir>] [--headed] [--timeout <sec>]
  sim: [--runs 3] [--bots balanced,greedy,passive] [--paths shared|land,sky,sea] [--max 1500]
       [--run-timeout 120] [--parallel N] [--target-min M] [--target-max M] [--strict]`;

// ---------------------------------------------------------------- static server

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
};

function startServer(root) {
  const server = http.createServer((req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = path.normalize(path.join(root, rel));
      if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end('forbidden'); return; }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found: ' + rel); return; }
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

// ---------------------------------------------------------------- error collection

const LOC_RE = /((?:https?|file):\/\/[^\s)]*?):(\d+)(?::(\d+))?(?=\)|\s|$)/;

class Collector {
  constructor(root, origin) {
    this.root = root; this.origin = origin;
    this.events = [];   // every error event, in order (duplicates included, so marks stay valid)
    this.warnings = [];
  }

  rel(url) {
    if (!url) return '(unknown)';
    if (url.startsWith('data:')) return '(inline data)';
    if (this.origin && url.startsWith(this.origin)) return decodeURIComponent(url.slice(this.origin.length).split('?')[0].replace(/^\//, '')) || '/';
    if (url.startsWith('file://')) {
      const p = decodeURIComponent(new URL(url).pathname);
      return p.startsWith(this.root + path.sep) ? path.relative(this.root, p) : p;
    }
    return url;
  }

  locate(text) {
    // First stack frame that points at a real page file (skips playwright's injected/eval frames).
    for (const line of String(text || '').split('\n')) {
      if (/__playwright|eval at|UtilityScript/.test(line)) continue;
      const m = line.match(LOC_RE);
      if (m) return { file: this.rel(m[1]), line: +m[2] };
    }
    return null;
  }

  addError(kind, text, loc, label) {
    this.events.push({ kind, text: String(text).split('\n')[0].slice(0, 400), file: loc?.file || '(unknown)', line: loc?.line ?? null, label });
  }

  addWarning(text) {
    if (!this.warnings.includes(text)) this.warnings.push(text);
  }

  mark() { return this.events.length; }
  since(mark) { return this.events.slice(mark); }

  grouped() {
    const out = {}, counts = new Map();
    for (const e of this.events) {
      const key = `${e.file}|${e.line}|${e.kind}|${e.text}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const [key, n] of counts) {
      const [file, line, kind, ...rest] = key.split('|');
      (out[file] ||= []).push(`${line !== 'null' ? 'L' + line + ' ' : ''}[${kind}] ${rest.join('|')}${n > 1 ? ` (x${n})` : ''}`);
    }
    return out;
  }

  // Wire up one page. pageErrorsOnly: file:// runs where only uncaught exceptions count as errors.
  attach(page, label, { pageErrorsOnly = false } = {}) {
    const optional = new Set(['script', 'stylesheet', 'image', 'media', 'font', 'manifest', 'other']);
    const missing = (req, why) => {
      const url = req.url();
      if (/favicon\.ico$/.test(url)) return;
      const rel = this.rel(url), type = req.resourceType();
      if (optional.has(type)) this.addWarning(`${rel}: ${why} (${type}, optional resource missing)`);
      else if (pageErrorsOnly) this.addWarning(`${rel}: ${why} (file://)`);
      else this.addError('request', `${why} ${rel}`, { file: rel, line: null }, label);
    };
    page.on('pageerror', (err) => {
      const stack = err.stack || '';
      const loc = this.locate(stack) || null;
      this.addError('pageerror', err.message || String(err), loc, label);
    });
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      if (/^Failed to load resource/.test(msg.text())) return;   // reported through response/requestfailed
      const l = msg.location();
      const loc = l?.url ? { file: this.rel(l.url), line: l.lineNumber + 1 } : this.locate(msg.text());
      if (pageErrorsOnly) this.addWarning(`console.error ${loc ? loc.file + ':' + loc.line : ''} ${msg.text().slice(0, 200)} [${label}]`);
      else this.addError('console', msg.text(), loc, label);
    });
    page.on('response', (res) => { if (res.status() >= 400) missing(res.request(), `HTTP ${res.status()}`); });
    page.on('requestfailed', (req) => {
      const err = req.failure()?.errorText || 'failed';
      if (/ERR_ABORTED/.test(err)) return;   // navigation away / media cancelled
      missing(req, err);
    });
  }
}

// ---------------------------------------------------------------- page helpers

const withTimeout = (promise, ms, what) => {
  let timer;
  const t = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${what} timed out after ${ms}ms`)), ms); });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
};

async function waitForApex(page, { mode = 'title', timeout = 10000 } = {}) {
  try {
    await page.waitForFunction((m) => window.Apex && window.Apex.G && (m === null || window.Apex.G.mode === m), mode, { timeout, polling: 100 });
  } catch {
    const d = await withTimeout(page.evaluate(() => ({
      apex: !!window.Apex, g: !!(window.Apex && window.Apex.G),
      mode: window.Apex && window.Apex.G && window.Apex.G.mode, keys: window.Apex ? Object.keys(window.Apex).slice(0, 30) : [],
    })), 3000, 'diagnose').catch(() => null);
    throw new Error(!d ? 'page is unresponsive (script stuck in a loop?)'
      : !d.apex ? 'window.Apex missing (scripts failed to load, or threw before defining it)'
      : !d.g ? `Apex.G missing (Apex.boot() not called or failed); Apex keys: ${d.keys.join(',')}`
      : `G.mode is '${d.mode}' after ${timeout}ms, expected '${mode}'`);
  }
}

// Subscribes in the page to modeChange + a few events; waitMode reads from that history.
async function installHook(page) {
  return page.evaluate(({ events }) => {
    const A = window.Apex, h = window.__chk = { modes: [A.G.mode], events: [], hooked: typeof A.on === 'function' };
    if (!h.hooked) return false;
    A.on('modeChange', (p) => h.modes.push(p && p.to));
    for (const n of events) {
      A.on(n, (p) => h.events.push({ name: n, type: p && p.type, path: p && p.path }));
    }
    return true;
  }, { events: HOOKED_EVENTS });
}

async function openGame(page, url, { mode = 'title', timeout = 10000 } = {}) {
  await page.goto(url, { waitUntil: 'load', timeout: 20000 });
  await waitForApex(page, { mode, timeout });
  await installHook(page);
}

const modeMark = (page) => page.evaluate(() => (window.__chk ? window.__chk.modes.length : 0));
const eventMark = (page) => page.evaluate(() => (window.__chk ? window.__chk.events.length : 0));
const getMode = (page) => page.evaluate(() => window.Apex && window.Apex.G && window.Apex.G.mode);

// Wait until current mode (or, unless current:true, any mode entered since `since`) is in `wanted`.
async function waitMode(page, wanted, timeout, { since = 0, current = false, closeEditor = false } = {}) {
  const t0 = Date.now();
  let last;
  for (;;) {
    last = await page.evaluate(({ since }) => {
      const h = window.__chk, A = window.Apex;
      return { cur: A && A.G && A.G.mode, seen: h ? h.modes.slice(since) : [] };
    }, { since });
    if (wanted.includes(last.cur)) return last.cur;
    if (!current) { const hit = last.seen.find((m) => wanted.includes(m)); if (hit) return hit; }
    if (closeEditor && last.cur === 'editor') await callApex(page, 'closeEditor');
    if (Date.now() - t0 > timeout) {
      throw new Error(`expected mode ${wanted.join('|')} within ${timeout}ms, G.mode is '${last.cur}'${last.seen.length ? ` (entered: ${last.seen.join(' > ')})` : ''}`);
    }
    await sleep(50);
  }
}

async function callApex(page, fn, ...args) {
  const r = await page.evaluate(([fn, args]) => {
    const parts = fn.split('.');
    let ctx = window.Apex, f = ctx;
    if (!f) return { missing: 'window.Apex' };
    for (const p of parts) { ctx = f; f = f && f[p]; }
    if (typeof f !== 'function') return { missing: 'Apex.' + fn };
    return { value: f.apply(ctx, args) };
  }, [fn, args]);
  if (r && r.missing) throw new Error(`${r.missing} missing`);
  return r.value;
}

async function setAutoplay(page, speed) {
  await page.evaluate((s) => { const f = window.Apex.G.flags = window.Apex.G.flags || {}; f.autoplay = true; f.speed = s; }, speed);
}

// Get into a stable playable state on `tier` (fresh eco, autoplay on at speed 1).
async function ensurePlay(page, tier, speed = 1, timeout = 6000) {
  await callApex(page, 'debug.setTier', tier);
  await setAutoplay(page, speed);
  await waitMode(page, PLAYABLE, timeout, { current: true, closeEditor: true });
}

const gState = (page) => page.evaluate(() => {
  const G = window.Apex.G;
  return { mode: G.mode, tierId: G.tierId, final: !!G.final, time: G.time, tierTime: G.tierTime,
    choices: (G.choices || []).map((c) => ({ sp: c.sp, tierId: c.tierId, path: c.path })),
    mishaps: ((G.eco && G.eco.mishaps) || []).map((m) => m.type) };
});

// ---------------------------------------------------------------- step runner

class Steps {
  constructor(col, { quiet = false } = {}) { this.col = col; this.list = []; this.quiet = quiet; }

  async run(name, fn, { timeout = 30000, warnOnly = false } = {}) {
    const mark = this.col.mark(), t0 = Date.now();
    let ok = true, detail = '';
    try {
      const r = await withTimeout(Promise.resolve().then(fn), timeout, `step "${name}"`);
      detail = r == null ? '' : String(r);
    } catch (err) {
      ok = false;
      detail = firstLine(err);
      const loc = this.col.locate(err.stack || err.message);
      if (loc && /TypeError|ReferenceError|RangeError|SyntaxError|Error:/.test(String(err.message))
        && !/timed out|expected mode|missing|is not a function \(harness\)/.test(detail)) {
        this.col.addError('exception', detail.replace(/^page\.evaluate: /, ''), loc, name);
      }
    }
    const errs = this.col.since(mark).filter((e) => e.kind !== 'warning');
    if (errs.length && ok) { ok = false; detail = (detail ? detail + ' | ' : '') + `${errs.length} error(s), first: ${errs[0].file}${errs[0].line ? ':' + errs[0].line : ''} ${errs[0].text}`; }
    if (!ok && warnOnly) { this.col.addWarning(`${name}: ${detail}`); ok = true; detail = 'warning: ' + detail; }
    const rec = { name, ok, detail, ms: Date.now() - t0 };
    this.list.push(rec);
    if (!this.quiet) console.log(`${ok ? green('  ok  ') : red(' FAIL ')} ${name}${detail ? dim(' - ' + detail) : ''}`);
    return rec;
  }

  get failed() { return this.list.filter((s) => !s.ok); }
}

// ---------------------------------------------------------------- context

async function makeContext(browser, kind) {
  if (kind === 'mobile') return browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (kind === 'desktop1440') return browser.newContext({ viewport: { width: 1440, height: 900 } });
  return browser.newContext({ viewport: { width: 1280, height: 800 } });
}

function buildTarget(opts) {
  const raw = opts.url || 'index.html';
  if (/^https?:\/\//.test(raw)) {
    const u = new URL(raw);
    return { external: true, origin: u.origin, pagePath: u.pathname, search: u.search, filePath: null };
  }
  const q = raw.indexOf('?');
  const p = q >= 0 ? raw.slice(0, q) : raw;
  const search = q >= 0 ? raw.slice(q) : '';
  let abs = path.resolve(process.cwd(), p);
  if (!fs.existsSync(abs)) abs = path.resolve(ROOT, p);
  if (!abs.startsWith(ROOT + path.sep)) throw new Error(`--url ${raw} is outside the project root ${ROOT}`);
  if (!fs.existsSync(abs)) {
    throw new Error(`${path.relative(ROOT, abs)} does not exist yet. Is index.html written? (looked in ${ROOT})`);
  }
  return { external: false, pagePath: '/' + path.relative(ROOT, abs).split(path.sep).join('/'), search, filePath: abs };
}

function makeUrlBuilder(target, origin, defaults) {
  return (extra = {}, base = origin) => {
    const u = new URL(target.pagePath + target.search, base);
    for (const [k, v] of Object.entries(defaults)) if (!u.searchParams.has(k)) u.searchParams.set(k, v);
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
    return u.href;
  };
}

// ---------------------------------------------------------------- smoke

async function smoke(env) {
  const { browser, col, gameUrl, target, outDir } = env;
  const steps = new Steps(col);
  const shotDir = path.join(outDir, 'smoke');
  fs.mkdirSync(shotDir, { recursive: true });
  const shot = async (page, name) => { const f = path.join(shotDir, name + '.png'); await page.screenshot({ path: f }); return path.relative(ROOT, f); };

  console.log(dim(`smoke: ${gameUrl()}`));
  const ctx = await makeContext(browser, 'desktop');
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  col.attach(page, 'desktop');

  const loaded = (await steps.run('desktop: load and reach title', () => openGame(page, gameUrl()), { timeout: 40000 })).ok;
  if (!loaded) return finishSmoke(env, steps, ctx);

  let tierIds = [];
  await steps.run('api surface', async () => {
    const missing = await page.evaluate(() => {
      const A = window.Apex, miss = [];
      for (const f of ['newRun', 'restart', 'choose', 'closeEditor', 'togglePause', 'on', 'debug.setTier', 'debug.killPlayer', 'debug.fillGrowth', 'debug.forceMishap', 'debug.win']) {
        const v = f.split('.').reduce((o, k) => (o ? o[k] : undefined), A);
        if (typeof v !== 'function') miss.push('Apex.' + f);
      }
      if (!A.TIERS || !Object.keys(A.TIERS).length) miss.push('Apex.TIERS');
      return miss;
    });
    tierIds = await page.evaluate(() => Object.keys((window.Apex.TIERS) || {}));
    if (missing.length) throw new Error('missing: ' + missing.join(', '));
    return `${tierIds.length} tiers: ${tierIds.join(', ')}`;
  });
  if (!tierIds.length) return finishSmoke(env, steps, ctx);
  const tierDefs = await page.evaluate(() => Object.fromEntries(Object.entries(window.Apex.TIERS).map(([id, t]) => [id, { final: !!t.final }])));
  const firstTier = tierIds[0];
  const midTier = tierIds[1] || tierIds[0];
  const finalTier = tierIds.find((id) => tierDefs[id].final);
  const nonFinal = tierIds.find((id) => !tierDefs[id].final);

  await steps.run('newRun (+ editor if shown)', async () => {
    await callApex(page, 'newRun');
    await waitMode(page, ['editor', 'intro', 'play'], 3000, { current: true });
    let note = '';
    if ((await getMode(page)) === 'editor') { await callApex(page, 'closeEditor'); note = 'editor closed via Apex.closeEditor(); '; }
    const m = await waitMode(page, PLAYABLE, 5000, { current: true });
    return note + `mode ${m}`;
  });

  // Every tier, autoplay speed 3 for ~4s.
  for (const id of tierIds) {
    await steps.run(`tier ${id}: autoplay 4s`, async () => {
      await callApex(page, 'debug.setTier', id);
      await setAutoplay(page, 3);
      const first = await gState(page);
      if (first.tierId !== id) throw new Error(`G.tierId is '${first.tierId}' after setTier('${id}')`);
      await page.waitForTimeout(4000);
      const s = await gState(page);
      const file = await shot(page, id);
      const advanced = s.time > first.time || s.tierTime > first.tierTime;
      if (PLAYABLE.includes(s.mode) && !advanced && s.mode === 'play') throw new Error('mode is play but G.time did not advance in 4s (game loop stuck?)');
      if (PLAYABLE.includes(s.mode)) return `mode ${s.mode}, time ${s.time.toFixed(1)}s -> ${file}`;
      if (['dying', 'rebirthChoice', 'evolveChoice', 'evolving', 'editor', 'victory'].includes(s.mode)) return `mode ${s.mode} (normal gameplay transition) -> ${file}`;
      throw new Error(`unexpected mode '${s.mode}' -> ${file}`);
    }, { timeout: 25000 });
  }

  // Evolve flow.
  await steps.run(`evolve: fillGrowth -> evolveChoice -> choose -> evolving -> play (${nonFinal})`, async () => {
    if (!nonFinal) return 'skipped (no non-final tier)';
    await ensurePlay(page, nonFinal);
    const mm = await modeMark(page);
    await callApex(page, 'debug.fillGrowth');
    await waitMode(page, ['evolveChoice'], 3000, { since: mm });
    const s = await gState(page);
    if (!s.choices.length) throw new Error('evolveChoice with empty G.choices');
    const pick = s.choices[0];
    const mm2 = await modeMark(page);
    await callApex(page, 'choose', pick.sp);
    await waitMode(page, ['evolving'], 2500, { since: mm2 });
    await waitMode(page, ['editor', 'intro', 'play'], 5000, { current: true, closeEditor: true });
    const end = await waitMode(page, PLAYABLE, 4000, { current: true, closeEditor: true });
    const after = await gState(page);
    if (pick.tierId && after.tierId !== pick.tierId) throw new Error(`after choosing ${pick.sp} G.tierId is '${after.tierId}', expected '${pick.tierId}'`);
    return `chose ${pick.sp} -> ${after.tierId}, mode ${end}`;
  }, { timeout: 30000 });

  await steps.run(`final tier: fillGrowth -> finalStart (${finalTier})`, async () => {
    if (!finalTier) return 'skipped (no tier has final: true)';
    await ensurePlay(page, finalTier);
    const em = await eventMark(page);
    await callApex(page, 'debug.fillGrowth');
    await page.waitForFunction((em) => (window.Apex.G.final || window.__chk.events.slice(em).some((e) => e.name === 'finalStart')), em, { timeout: 3000 })
      .catch(() => { throw new Error('expected G.final or a finalStart event within 3s of fillGrowth on the final tier'); });
    const s = await gState(page);
    if (s.mode === 'evolveChoice') throw new Error('final tier opened evolveChoice instead of the final hold');
    return `G.final=${s.final}, mode ${s.mode}`;
  });

  // Death -> rebirth flow.
  await steps.run(`death: killPlayer -> dying -> key -> rebirthChoice -> play (${midTier})`, async () => {
    await ensurePlay(page, midTier);
    const before = await gState(page);
    const mm = await modeMark(page);
    await callApex(page, 'debug.killPlayer');
    await waitMode(page, ['dying'], 3000, { since: mm });
    await page.waitForTimeout(1700);
    await page.keyboard.press('Space');
    let skipped = true;
    try { await waitMode(page, ['rebirthChoice'], 1500, { since: mm }); } catch {
      skipped = false;
      col.addWarning('death: key press after 1.7s did not skip the decomposition (waited for it to end naturally)');
      await waitMode(page, ['rebirthChoice'], 6000, { since: mm });
    }
    const s = await gState(page);
    if (!s.choices.length) throw new Error('rebirthChoice with empty G.choices');
    await callApex(page, 'choose', s.choices[0].sp);
    const end = await waitMode(page, ['editor', 'intro', 'play'], 4000, { current: true, closeEditor: true });
    const after = await gState(page);
    const expected = await page.evaluate((id) => (window.Apex.lowerTier ? window.Apex.lowerTier(id) : null), before.tierId);
    if (expected && after.tierId !== expected) throw new Error(`reborn in '${after.tierId}', expected lowerTier('${before.tierId}') = '${expected}'`);
    return `reborn ${before.tierId} -> ${after.tierId} as ${s.choices[0].sp}, mode ${end}${skipped ? '' : ' (skip key ignored)'}`;
  }, { timeout: 30000 });

  // Mishaps: fresh eco each time.
  for (const type of MISHAP_TYPES) {
    await steps.run(`mishap: ${type}`, async () => {
      await ensurePlay(page, midTier);
      const em = await eventMark(page);
      await callApex(page, 'debug.forceMishap', type);
      await page.waitForFunction(({ em, type }) => {
        const A = window.Apex;
        const ev = window.__chk.events.slice(em).some((e) => e.name === 'mishapStart' && (!e.type || e.type === type));
        const list = ((A.G.eco && A.G.eco.mishaps) || []).some((m) => m.type === type);
        return ev || list;
      }, { em, type }, { timeout: 2500, polling: 50 })
        .catch(() => { throw new Error(`forceMishap('${type}') produced neither a mishapStart event nor an entry in G.eco.mishaps`); });
      return 'started';
    });
  }

  // Victory, restart, pause.
  await steps.run('victory: debug.win -> victory', async () => {
    await ensurePlay(page, midTier);
    const mm = await modeMark(page);
    await callApex(page, 'debug.win');
    await waitMode(page, ['victory'], 3000, { since: mm });
    await page.waitForTimeout(500);
    return 'shot ' + await shot(page, 'victory');
  });
  await steps.run('restart: press R from victory -> intro/play', async () => {
    await page.keyboard.press('r');
    const m = await waitMode(page, ['editor', 'intro', 'play'], 4000, { current: true, closeEditor: true });
    return `mode ${m}`;
  });
  await steps.run('pause: Escape -> paused -> Escape -> previous mode', async () => {
    await setAutoplay(page, 3);
    await waitMode(page, ['play'], 8000, { current: true, closeEditor: true });
    await page.keyboard.press('Escape');
    await waitMode(page, ['paused'], 1500, { current: true });
    await page.keyboard.press('Escape');
    const m = await waitMode(page, ['play'], 1500, { current: true });
    return `back to ${m}`;
  });
  await steps.run('mute: M key toggles without errors', async () => {
    await page.keyboard.press('m');
    await page.waitForTimeout(150);
    await page.keyboard.press('m');
    return 'ok';
  });

  await combatSteps(page, steps, col);
  await ctx.close();

  // Mobile.
  const mctx = await makeContext(browser, 'mobile');
  const mpage = await mctx.newPage();
  mpage.setDefaultTimeout(10000);
  col.attach(mpage, 'mobile');
  const mobileLoaded = (await steps.run('mobile 390x844: load and reach title', () => openGame(mpage, gameUrl()), { timeout: 40000 })).ok;
  if (mobileLoaded) {
    await steps.run('mobile: tap Play -> HUD screenshot', async () => {
      const btn = await findPlayButton(mpage);
      await btn.tap();
      await waitMode(mpage, ['editor', 'intro', 'play'], 5000, { current: true });
      await waitMode(mpage, PLAYABLE, 5000, { current: true, closeEditor: true });
      await waitMode(mpage, ['play'], 6000, { current: true }).catch(() => {});
      await mpage.waitForTimeout(500);
      const overflow = await mpage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) col.addWarning(`mobile: page is ${overflow}px wider than the 390px viewport (horizontal scroll)`);
      return 'shot ' + await shot(mpage, 'mobile-hud');
    }, { timeout: 30000 });
    await steps.run('mobile: tap dash button (if any)', async () => {
      const dash = mpage.locator('#dash, [data-dash], .dash, .dash-btn, button[aria-label*="dash" i], button:has-text("dash")').filter({ visible: true }).first();
      if (!(await dash.count())) return 'no visible dash button found (skipped)';
      await dash.tap();
      await mpage.waitForTimeout(400);
      return 'tapped';
    });
  }
  await mctx.close();

  // file:// load.
  if (target.external || !target.filePath) {
    steps.list.push({ name: 'file:// load', ok: true, detail: 'skipped (--url is remote)', ms: 0 });
    console.log(`${yellow(' skip ')} file:// load ${dim('(remote --url)')}`);
  } else {
    const fctx = await makeContext(browser, 'desktop');
    const fpage = await fctx.newPage();
    col.attach(fpage, 'file://', { pageErrorsOnly: true });
    await steps.run('file:// load: no page errors in 3s', async () => {
      const u = new URL(pathToFileURL(target.filePath).href);
      u.search = new URL(gameUrl()).search;
      await fpage.goto(u.href, { waitUntil: 'load', timeout: 15000 });
      await fpage.waitForTimeout(3000);
      const has = await fpage.evaluate(() => !!(window.Apex && window.Apex.G));
      if (!has) throw new Error('window.Apex / Apex.G missing when opened from file://');
      return 'Apex booted from file://';
    }, { timeout: 25000 });
    await fctx.close();
  }
  return finishSmoke(env, steps);
}

// ---------------------------------------------------------------- combat scenarios (smoke)
// Each scenario clears the world, puts the player at the centre facing +x with no hunters around, and drives the real
// input flags (A.input.biteQueued / abilityQueued / dirX), so the keyboard-to-gameplay path is what is exercised.

async function scenario(page, sp, setup) {
  return page.evaluate(({ sp, setup }) => {
    const A = window.Apex, G = A.G;
    A.debug.setTier('t1_litter', sp);
    G.flags.autoplay = false; G.flags.speed = 1;
    G.entities.slice().forEach((e) => { if (!e.isPlayer) A.kill(e, 'x'); });
    G.zones.length = 0;
    const p = G.player;
    p.invulnT = 0; p.x = 600; p.y = 600; p.angle = 0; p.vx = p.vy = 0; p.energy = 100; p.hp = p.maxHp;
    p.biteCdT = 0; p.ability.cdT = 0; p.ability.activeT = 0;
    Object.assign(A.input, { dirX: 0, dirY: 0, biteQueued: false, dashQueued: false, abilityQueued: false, active: false });
    window.__cev = [];
    if (!window.__cevHooked) {
      window.__cevHooked = true;
      for (const n of ['bite', 'damage', 'abilityUse', 'angry', 'flinch', 'carcass', 'playerEat', 'playerHit', 'playerDeath', 'tutorialStep']) {
        A.on(n, (d) => window.__cev.push({ name: n, id: d && d.id, sp: d && d.food && d.food.sp, step: d && d.id }));
      }
    }
    const still = (key, r, x, y) => A.spawn(key, { sp: key, role: 'grazer', beh: 'static', r, n0: 0, speed: 0 }, x, y);
    return window.eval('(' + setup + ')')(A, G, p, still);
  }, { sp, setup: setup.toString() });
}

const evCount = (page, name, filter) => page.evaluate(({ name, filter }) => window.__cev.filter((e) => e.name === name && (!filter || e.id === filter || e.sp === filter)).length, { name, filter });

async function combatSteps(page, steps, col) {
  const T = { timeout: 20000 };
  await steps.run('combat: bite reduces a target\'s hp', async () => {
    await scenario(page, 'ant', (A, G, p, still) => { window.__t = still('caterpillar', 14, 630, 600); });
    await page.evaluate(() => { window.Apex.input.biteQueued = true; });
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => ({ hp: window.__t.hp, max: window.__t.maxHp, alive: window.__t.alive }));
    if (!(r.hp < r.max)) throw new Error(`bite did not reduce hp (${r.hp}/${r.max})`);
    if (!(await evCount(page, 'bite'))) throw new Error('no bite event');
    if (!(await evCount(page, 'damage'))) throw new Error('no damage event');
    return `caterpillar ${r.hp.toFixed(0)}/${r.max.toFixed(0)} hp after one bite`;
  }, T);

  await steps.run('combat: killing a mid-size target leaves a carcass that can be eaten', async () => {
    // (a) a bite that brings a target to 0 hp leaves a carcass
    await scenario(page, 'ant', (A, G, p, still) => { const t = still('caterpillar', 14, 636, 600); t.hp = 1; window.__t = t; });
    await page.evaluate(() => { window.Apex.input.biteQueued = true; });
    await page.waitForTimeout(150);
    if (!(await evCount(page, 'carcass'))) throw new Error('a bitten-down target died without a carcass event');
    // (b) a carcass far from the player: right kind of entity, amount = mass, eaten on contact
    const info = await page.evaluate(() => {
      const A = window.Apex, G = A.G, p = G.player;
      const t = A.spawn('caterpillar', { sp: 'caterpillar', role: 'grazer', beh: 'static', r: 14, n0: 0, speed: 0 }, 600, 760);
      const mass = t.mass, score = G.score;
      A.damageEntity(t, 1e6, p);
      const c = G.entities.find((e) => e.alive && e.sp === 'carcass' && e.y > 700);
      return c ? { amount: c.amount, mass, role: c.role, from: c.fromSp, x: c.x, y: c.y, score } : null;
    });
    if (!info) throw new Error('no carcass entity after the kill');
    if (info.role !== 'producer' || info.from !== 'caterpillar' || Math.abs(info.amount - info.mass) > 0.01) throw new Error('bad carcass ' + JSON.stringify(info));
    await page.evaluate((c) => { const p = window.Apex.G.player; p.x = c.x; p.y = c.y - 14; }, info);
    await page.waitForTimeout(250);
    const after = await page.evaluate((y) => ({ left: window.Apex.G.entities.filter((e) => e.alive && e.sp === 'carcass' && e.y > y).length, score: window.Apex.G.score }), 700);
    if (after.left || !(after.score > info.score)) throw new Error('carcass was not eaten: ' + JSON.stringify(after));
    return `carcass of ${info.mass.toFixed(1)} mass eaten for ${(after.score - info.score).toFixed(0)} points`;
  }, T);

  await steps.run('combat: a hunter lunge hurts, but does not kill unless much bigger', async () => {
    await scenario(page, 'ant', (A, G, p) => {
      const h = A.spawn('beetle', { sp: 'beetle', role: 'hunter', beh: 'chase', r: 14, n0: 0, speed: 120 }, 660, 600, { tutorial: true, lastAte: G.time - 12 });
      window.__h = h;
    });
    await page.waitForFunction(() => window.Apex.G.player.hp < window.Apex.G.player.maxHp, null, { timeout: 8000, polling: 50 })
      .catch(() => { throw new Error('hunter never damaged the player in 8s'); });
    const r = await page.evaluate(() => { const p = window.Apex.G.player; return { hp: p.hp, max: p.maxHp, alive: p.alive, mode: window.Apex.G.mode }; });
    if (!r.alive || r.mode === 'dying') throw new Error('a slightly bigger hunter killed the player outright');
    // a much bigger hunter (centipede, r 40) kills in a hit or two
    await scenario(page, 'ant', (A, G, p) => {
      A.spawn('centipede', { sp: 'centipede', role: 'hunter', beh: 'chase', r: 40, n0: 0, speed: 135 }, 700, 600, { tutorial: true, lastAte: G.time - 12 });
    });
    await page.waitForFunction(() => !window.Apex.G.player.alive, null, { timeout: 8000, polling: 50 })
      .catch(() => { throw new Error('a much bigger hunter did not kill the player within 8s'); });
    return `r14 hunter left ${r.hp.toFixed(0)}/${r.max.toFixed(0)} hp; r40 hunter killed`;
  }, { timeout: 30000 });

  const ABIL = {
    ant: { id: 'spray', setup: (A, G, p, still) => { window.__t = still('caterpillar', 14, 630, 600); },
      check: () => window.__t.hp < window.__t.maxHp && window.__t.slowT > 0 },
    pillbug: { id: 'roll', setup: () => {}, check: () => window.Apex.G.player.invulnT > 0 && window.Apex.G.player.ability.activeT > 0 },
    spider: { id: 'web', setup: () => {}, check: () => window.Apex.G.zones.some((z) => z.type === 'web') },
    beetle: { id: 'charge', setup: (A, G, p, still) => { window.__t = still('caterpillar', 14, 660, 600); },
      check: () => window.__t.stunT > 0 || window.__t.hp < window.__t.maxHp },
    frog: { id: 'tongue', setup: (A, G, p, still) => { window.__t = still('mite', 3, 650, 600); },
      check: () => !window.__t.alive },
    skink: { id: 'tail', setup: () => {}, check: () => window.Apex.G.entities.some((e) => e.alive && e.sp === 'decoy') },
  };
  for (const [sp, a] of Object.entries(ABIL)) {
    await steps.run(`combat: ability fires (${sp}: ${a.id})`, async () => {
      await scenario(page, sp, a.setup);
      await page.evaluate(() => { window.Apex.input.abilityQueued = true; });
      await page.waitForTimeout(350);
      const used = await evCount(page, 'abilityUse', a.id);
      if (!used) throw new Error(`no abilityUse '${a.id}' event`);
      const ok = await page.evaluate(a.check);
      if (!ok) throw new Error(`${a.id} had no effect`);
      const cd = await page.evaluate(() => window.Apex.G.player.ability.cdT);
      if (!(cd > 0)) throw new Error('cooldown did not start');
      return `${a.id} ok, cooldown ${cd.toFixed(1)}s`;
    }, T);
  }

  await steps.run('combat: an angry neutral nips the player', async () => {
    await scenario(page, 'ant', (A, G, p, still) => { window.__t = still('caterpillar', 14, 640, 600); });
    await page.evaluate(() => { window.Apex.input.dirX = 1; });
    await page.waitForFunction(() => window.__cev.some((e) => e.name === 'angry'), null, { timeout: 4000, polling: 30 })
      .catch(() => { throw new Error('bumping a neutral at speed did not make it angry'); });
    await page.evaluate(() => { window.Apex.input.dirX = 0; });
    await page.waitForFunction(() => window.Apex.G.player.hp < window.Apex.G.player.maxHp, null, { timeout: 5000, polling: 50 })
      .catch(() => { throw new Error('the angry animal never nipped'); });
    const r = await page.evaluate(() => ({ hp: window.Apex.G.player.hp, max: window.Apex.G.player.maxHp, tip: window.Apex.G.tip && window.Apex.G.tip.id }));
    return `hp ${r.hp.toFixed(0)}/${r.max.toFixed(0)}${r.tip ? ', tip ' + r.tip : ''}`;
  }, T);

  await steps.run('controls: Space bite, Shift dash, E ability, Tab eco view, left click bite, right click dash', async () => {
    await scenario(page, 'ant', (A, G, p, still) => { still('caterpillar', 14, 900, 900); });
    const st = () => page.evaluate(() => { const p = window.Apex.G.player; return { dash: p.dashCdT, ability: p.ability.cdT, bite: p.biteCdT, eco: window.Apex.input.ecoView }; });
    const reset = () => page.evaluate(() => { const p = window.Apex.G.player; p.dashCdT = 0; p.ability.cdT = 0; p.ability.activeT = 0; p.biteCdT = 0; p.invulnT = 1e9; });
    await reset();
    await page.keyboard.press('Space'); await page.waitForTimeout(60);
    if (!(await st()).bite) {
      const d = await page.evaluate(() => { const a = document.activeElement; return { active: a && (a.tagName + '#' + a.id + '.' + a.className), mode: window.Apex.G.mode, auto: window.Apex.G.flags.autoplay, q: window.Apex.input.biteQueued, focus: document.hasFocus(), cd: window.Apex.G.player.biteCdT }; });
      throw new Error('Space did not bite ' + JSON.stringify(d));
    }
    await reset();
    await page.keyboard.press('Shift'); await page.waitForTimeout(60);
    if (!(await st()).dash) throw new Error('Shift did not dash');
    await reset();
    await page.keyboard.press('e'); await page.waitForTimeout(60);
    if (!(await st()).ability) throw new Error('E did not use the ability');
    await reset();
    await page.keyboard.press('q'); await page.waitForTimeout(60);
    if (!(await st()).ability) throw new Error('Q did not use the ability');
    await page.keyboard.down('Tab'); await page.waitForTimeout(60);
    const held = (await st()).eco;
    await page.keyboard.up('Tab'); await page.waitForTimeout(60);
    if (!held || (await st()).eco) throw new Error('Tab (hold) did not toggle the ecosystem view');
    await reset();
    await page.mouse.click(640, 300, { button: 'left' }); await page.waitForTimeout(60);
    if (!(await st()).bite) throw new Error('left click did not bite');
    if ((await st()).dash) throw new Error('left click dashed');
    await reset();
    await page.mouse.click(640, 300, { button: 'right' }); await page.waitForTimeout(60);
    if (!(await st()).dash) throw new Error('right click did not dash');
    const prevented = await page.evaluate(() => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); window.Apex.canvas.dispatchEvent(e); return e.defaultPrevented; });
    if (!prevented) throw new Error('contextmenu is not prevented on the canvas');
    return 'all mapped';
  }, T);

  await steps.run('tutorial: steps 1 to 6 (+ harmony), real move action, then done', async () => {
    await scenario(page, 'ant', () => {});
    await page.evaluate(() => { try { localStorage.removeItem('apex.tutorial'); } catch (e) {} window.Apex.debug.tutorialStart(); });
    const first = await page.evaluate(() => ({ ...window.Apex.G.tutorial }));
    if (!first.active || first.id !== 'move' || !first.text || !first.target || !first.canSkip) throw new Error('tutorial did not start on step 1: ' + JSON.stringify(first));
    // real action: walk into the target ring and the tutorial must move on by itself
    await page.evaluate(() => { const A = window.Apex, p = A.G.player, t = A.G.tutorial.target; p.x = t.x; p.y = t.y; });
    await page.waitForFunction(() => window.Apex.G.tutorial.id === 'eat', null, { timeout: 3000 })
      .catch(() => { throw new Error('reaching the ring did not advance to step 2'); });
    const eat = await page.evaluate(() => ({ hl: window.Apex.G.tutorial.highlight.length, dmg: window.Apex.G.tutorial.dmgMul }));
    if (!eat.hl) throw new Error('step 2 has no highlighted food');
    if (eat.dmg !== 0) throw new Error('predators are not harmless during step 2');
    const ids = ['move', 'eat'];
    for (let i = 0; i < 12; i++) {
      const id = await page.evaluate(() => window.Apex.debug.tutorialAdvance());
      const st = await page.evaluate(() => ({ id: window.Apex.G.tutorial.id, text: window.Apex.G.tutorial.text, active: window.Apex.G.tutorial.active }));
      if (st.id !== ids[ids.length - 1]) ids.push(st.id);
      if (!st.active) break;
      if (st.id !== 'harmony' && !st.text) throw new Error('step ' + st.id + ' has no hint text');
    }
    const expected = ['move', 'eat', 'grow', 'bite', 'danger', 'ability', 'harmony', 'done'];
    if (ids.join() !== expected.join()) throw new Error('step order ' + ids.join('>') + ', expected ' + expected.join('>'));
    const events = await page.evaluate(() => window.__cev.filter((e) => e.name === 'tutorialStep').map((e) => e.step));
    if (events.join() !== expected.join()) throw new Error('tutorialStep events ' + events.join('>'));
    const done = await page.evaluate(() => ({ done: window.Apex.G.tutorial.done, ls: localStorage.getItem('apex.tutorial') }));
    if (!done.done || done.ls !== 'done') throw new Error('tutorial not recorded as done: ' + JSON.stringify(done));
    return ids.join(' > ');
  }, { timeout: 30000 });

  await steps.run('tutorial: skip works and is remembered', async () => {
    await page.evaluate(() => { try { localStorage.removeItem('apex.tutorial'); } catch (e) {} window.Apex.debug.tutorialStart(); });
    const on = await page.evaluate(() => window.Apex.G.tutorial.active);
    if (!on) throw new Error('tutorial did not restart');
    await page.evaluate(() => window.Apex.Tutorial.skip());
    const r = await page.evaluate(() => ({ active: window.Apex.G.tutorial.active, done: window.Apex.G.tutorial.done, ls: localStorage.getItem('apex.tutorial'), calm: window.Apex.G.tutorial.calm, hl: window.Apex.G.tutorial.highlight.length }));
    if (r.active || !r.done || r.ls !== 'done' || r.calm || r.hl) throw new Error('skip left tutorial state behind: ' + JSON.stringify(r));
    return 'skipped, apex.tutorial=done';
  });
}

async function findPlayButton(page) {
  const candidates = [
    page.getByRole('button', { name: /^\s*play\s*$/i }),
    page.getByRole('button', { name: /^(?!.*how).*play/i }),
    page.getByText(/^\s*play\s*$/i),
  ];
  for (const c of candidates) {
    const loc = c.filter({ visible: true }).first();
    if (await loc.count().catch(() => 0)) return loc;
  }
  throw new Error('no visible Play button found on the title screen (looked for button text /play/i)');
}

async function finishSmoke(env, steps, ctx) {
  if (ctx) await ctx.close().catch(() => {});
  return summarize(env, 'smoke', steps.list, {});
}

// ---------------------------------------------------------------- summary printing

// JSON with one line per array item (steps / runs / targets) so the output stays scannable.
function compactJson(obj) {
  const lines = Object.entries(obj).map(([k, v]) => (Array.isArray(v) && v.length && typeof v[0] === 'object'
    ? `  ${JSON.stringify(k)}: [\n${v.map((x) => '    ' + JSON.stringify(x)).join(',\n')}\n  ]`
    : `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`));
  return `{\n${lines.join(',\n')}\n}`;
}

function summarize(env, command, stepList, extra) {
  const { col } = env;
  const errors = col.grouped();
  const failed = stepList.filter((s) => !s.ok);
  const errorCount = Object.values(errors).reduce((n, l) => n + l.length, 0);
  const summary = { command, url: env.gameUrl(), ok: !failed.length && !errorCount, steps: stepList.map(({ name, ok, detail }) => ({ name, ok, detail })), errors, warnings: col.warnings, ...extra };
  console.log('\n' + dim('--- JSON summary ---'));
  console.log(compactJson(summary));
  console.log('\n' + dim('--- summary ---'));
  console.log(`${command}: ${stepList.length - failed.length}/${stepList.length} steps ok, ${errorCount} distinct error(s) in ${Object.keys(errors).length} file(s), ${col.warnings.length} warning(s)`);
  for (const [file, list] of Object.entries(errors)) { console.log(red(`  ${file}`)); list.forEach((l) => console.log(red(`    ${l}`))); }
  for (const s of failed) console.log(red(`  FAILED step: ${s.name} - ${s.detail}`));
  for (const w of col.warnings) console.log(yellow(`  warning: ${w}`));
  console.log(summary.ok ? green(`${command.toUpperCase()} PASSED`) : red(`${command.toUpperCase()} FAILED`));
  return summary.ok ? 0 : 1;
}

// ---------------------------------------------------------------- sim

const fmtTime = (s) => (s == null || Number.isNaN(s) ? '?' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

// simulate() has no fixed report shape in the contract, so accept the obvious spellings.
function normalizeReport(rep) {
  const r = rep || {};
  const victory = r.victory ?? r.won ?? r.win ?? (r.outcome ? r.outcome === 'victory' : undefined);
  const time = num(r.time) ?? num(r.duration) ?? num(r.gameTime) ?? num(r.t) ?? num(r.seconds);
  const dl = r.deathLog ?? r.deathList ?? r.deaths;
  const deaths = Array.isArray(dl)
    ? dl.map((d) => (typeof d === 'string' ? d : [d.cause, d.killerSp || d.killer].filter(Boolean).join(':') || 'death'))
    : Array(num(dl) || 0).fill('death');
  const mishaps = {};
  const mi = r.mishaps ?? r.mishapCounts;
  if (Array.isArray(mi)) mi.forEach((m) => { const k = typeof m === 'string' ? m : m.type; mishaps[k] = (mishaps[k] || 0) + 1; });
  else if (mi && typeof mi === 'object') Object.entries(mi).forEach(([k, v]) => { if (num(v)) mishaps[k] = v; });
  let harmony = num(r.harmonyAvg) ?? num(r.harmony) ?? num(r.avgHarmony);
  if (harmony === undefined && r.stats && num(r.stats.harmonyN)) harmony = r.stats.harmonySum / r.stats.harmonyN;
  const tt = r.tierTimes ?? r.tiers ?? r.perTier;
  const tierTimes = {};
  const sumOf = (v) => (Array.isArray(v) ? v.reduce((a, b) => a + b, 0) : v);
  if (Array.isArray(tt)) tt.forEach((x) => { tierTimes[x.tierId || x.id] = x.time ?? x.t; });
  else if (tt && typeof tt === 'object') Object.entries(tt).forEach(([k, v]) => { tierTimes[k] = sumOf(v); });
  // clearTimes: first full-growth time per tier from a fresh start (what the pacing targets measure).
  const clearTimes = r.clearTimes && typeof r.clearTimes === 'object' ? { ...r.clearTimes } : {};
  const mishapList = Array.isArray(mi) ? mi : [];
  return { victory: victory === undefined ? undefined : !!victory, time, deaths, mishaps, mishapList, harmony, tierTimes, clearTimes, recognized: victory !== undefined || time !== undefined };
}

async function sim(env) {
  const { browser, col, gameUrl, opts } = env;
  const bots = String(opts.bots || 'balanced,greedy,passive').split(',').map((s) => s.trim()).filter(Boolean);
  const paths = String(opts.paths || 'shared').split(',').map((s) => s.trim()).filter(Boolean);
  const runs = Math.max(1, +opts.runs || 3);
  const max = +opts.max || 1500;
  const runTimeout = (+opts['run-timeout'] || 120) * 1000;
  const parallel = Math.max(1, +opts.parallel || Math.min(3, Math.max(1, os.cpus().length - 1)));

  console.log(dim(`sim: ${gameUrl()}  bots=${bots} paths=${paths} runs=${runs} max=${max}s parallel=${parallel}`));
  const jobs = [];
  for (const p of paths) for (const bot of bots) for (let seed = 1; seed <= runs; seed++) jobs.push({ path: p, bot, seed });

  // Precheck once so a missing simulate() gives one clear message, not N copies.
  const pre = await (await makeContext(browser, 'desktop')).newPage();
  col.attach(pre, 'sim-precheck');
  let fatal = null;
  try {
    await openGame(pre, gameUrl({ seed: 1 }));
    const has = await pre.evaluate(() => !!(window.Apex.debug && typeof window.Apex.debug.simulate === 'function'));
    if (!has) fatal = 'Apex.debug.simulate missing (core.js has not implemented it yet)';
  } catch (err) { fatal = firstLine(err); }
  await pre.context().close().catch(() => {});
  if (fatal) {
    console.log(red(`sim: cannot run: ${fatal}`));
    return summarize(env, 'sim', [{ name: 'precheck', ok: false, detail: fatal }], { runs: [], targets: [] });
  }

  const results = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      const job = jobs[i];
      const label = `sim ${job.path}/${job.bot}/${job.seed}`;
      const ctx = await makeContext(browser, 'desktop');
      const page = await ctx.newPage();
      col.attach(page, label);
      const t0 = Date.now();
      const res = { ...job, ok: false };
      try {
        await openGame(page, gameUrl({ seed: job.seed }));
        const rep = await withTimeout(page.evaluate(([max, o]) => window.Apex.debug.simulate(max, o), [max, job]), runTimeout, `simulate (${label})`);
        res.raw = rep; res.norm = normalizeReport(rep); res.ok = true;
        if (!res.norm.recognized) res.error = 'report not recognised (no victory/time fields): ' + JSON.stringify(rep).slice(0, 160);
        else if (rep && rep.error) { res.ok = false; res.error = String(rep.error); }
      } catch (err) {
        res.error = firstLine(err);
        const loc = col.locate(err.stack);
        if (loc) col.addError('exception', res.error, loc, label);
      }
      res.wallMs = Date.now() - t0;
      results[i] = res;
      console.log(`${res.ok ? green('  ok  ') : red(' FAIL ')} ${label} ${dim(`(${(res.wallMs / 1000).toFixed(1)}s wall)`)}${res.error ? ' ' + red(res.error) : ''}`);
      await Promise.race([ctx.close().catch(() => {}), sleep(3000)]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, worker));

  printSimTable(results);
  const targets = evaluateTargets(results, opts);
  console.log('\nTargets');
  for (const t of targets) {
    const tag = t.status === 'PASS' ? green('PASS') : t.status === 'FAIL' ? red('FAIL') : yellow('SKIP');
    console.log(`  ${tag}  ${t.name}${t.detail ? dim(' - ' + t.detail) : ''}`);
  }
  const runSteps = results.map((r) => ({ name: `${r.path}/${r.bot}/seed ${r.seed}`, ok: r.ok && !r.error, detail: r.error || '' }));
  const rows = results.map((r) => ({ path: r.path, bot: r.bot, seed: r.seed, ok: r.ok, error: r.error, wallSec: +(r.wallMs / 1000).toFixed(1), report: r.norm, raw: r.raw }));
  const code = summarize(env, 'sim', runSteps, { runs: rows, targets });
  const failedTargets = targets.filter((t) => t.status === 'FAIL');
  if (failedTargets.length) console.log(opts.strict ? red(`${failedTargets.length} target(s) failed (--strict: exit 1)`) : yellow(`${failedTargets.length} target(s) failed (not strict: exit code unaffected)`));
  return code || (opts.strict && failedTargets.length ? 1 : 0);
}

function printSimTable(results) {
  const rows = [['path', 'bot', 'seed', 'victory', 'time', 'deaths', 'mishaps', 'harmony', 'full-growth time per tier']];
  for (const r of results) {
    if (!r.norm) { rows.push([r.path, r.bot, r.seed, 'ERROR', '', '', '', '', (r.error || '').slice(0, 50)]); continue; }
    const n = r.norm;
    const deaths = n.deaths.length ? `${n.deaths.length} (${[...new Set(n.deaths)].slice(0, 3).join(', ')})` : '0';
    const mishaps = Object.entries(n.mishaps).map(([k, v]) => `${k}${v > 1 ? 'x' + v : ''}`).join(' ') || '-';
    const tiers = Object.entries(n.clearTimes).map(([k, v]) => `${k.split('_')[0]} ${fmtTime(v)}`).join(' ') || '-';
    rows.push([r.path, r.bot, r.seed, n.victory === undefined ? '?' : n.victory ? 'yes' : 'no', fmtTime(n.time), deaths, mishaps, n.harmony === undefined ? '?' : n.harmony.toFixed(0), tiers]);
  }
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => String(r[c]).length)));
  console.log('');
  rows.forEach((r, i) => {
    console.log(r.map((cell, c) => String(cell).padEnd(widths[c])).join('  ').trimEnd());
    if (i === 0) console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  });
}

// Targets from docs/DESIGN.md "M1.5 Pacing": each tier 110-170s to full growth, the 3-tier 'shared' slice 6-8 min,
// a full 6-tier path about 15 min, 1-4 balanced deaths across the seeds.
const TIER_MIN = 110, TIER_MAX = 170;
function evaluateTargets(results, opts) {
  const out = [];
  const good = results.filter((r) => r.norm && r.ok);
  const paths = [...new Set(results.map((r) => r.path))];
  for (const p of paths) {
    const defMin = p === 'shared' ? 6 : 12, defMax = p === 'shared' ? 8 : 18;
    const tMin = opts['target-min'] != null ? +opts['target-min'] : defMin;
    const tMax = opts['target-max'] != null ? +opts['target-max'] : defMax;
    const byBot = (b) => good.filter((r) => r.path === p && r.bot === b);
    const missingBot = (b) => results.filter((r) => r.path === p && r.bot === b).length === 0;
    const add = (name, status, detail) => out.push({ name: `[${p}] ${name}`, status, detail });
    const all = (list, pred, fmt) => {
      const bad = list.filter((r) => !pred(r));
      return { pass: !bad.length, detail: bad.length ? 'failing: ' + bad.map((r) => `seed ${r.seed} ${fmt(r)}`).join('; ') : `all ${list.length} run(s) ok` };
    };
    const bal = byBot('balanced'), greedy = byBot('greedy'), passive = byBot('passive');
    const verdict = (name, list, pred, fmt, skipMsg) => {
      if (!list.length) return add(name, 'SKIP', skipMsg);
      const r = all(list, pred, fmt);
      add(name, r.pass ? 'PASS' : 'FAIL', r.detail);
    };
    verdict('balanced wins', bal, (r) => r.norm.victory === true, (r) => `victory=${r.norm.victory}`, missingBot('balanced') ? 'balanced bot not run' : 'no usable runs');
    verdict(`balanced time ${tMin}-${tMax} min`, bal.filter((r) => r.norm.time !== undefined), (r) => r.norm.time / 60 >= tMin && r.norm.time / 60 <= tMax, (r) => fmtTime(r.norm.time), 'balanced bot not run');
    verdict('balanced deaths 0-3 per run', bal, (r) => r.norm.deaths.length <= 3, (r) => `${r.norm.deaths.length} deaths`, 'balanced bot not run');
    if (bal.length >= 2) {
      const total = bal.reduce((n, r) => n + r.norm.deaths.length, 0);
      add('balanced dies 1-4 times across the seeds', total >= 1 && total <= 4 ? 'PASS' : 'FAIL', `${total} death(s) in ${bal.length} run(s)`);
    }
    verdict(`balanced every tier ${TIER_MIN}-${TIER_MAX}s to full growth`, bal.filter((r) => Object.keys(r.norm.clearTimes).length), (r) => Object.values(r.norm.clearTimes).every((t) => t >= TIER_MIN && t <= TIER_MAX),
      (r) => Object.entries(r.norm.clearTimes).map(([k, t]) => `${k.split('_')[0]} ${t.toFixed(0)}s`).join(' '), 'balanced bot not run (or no clearTimes in report)');
    verdict('balanced harmony >= 55', bal.filter((r) => r.norm.harmony !== undefined), (r) => r.norm.harmony >= 55, (r) => `harmony ${r.norm.harmony?.toFixed(0)}`, 'balanced bot not run');
    if (bal.length) {
      const per = bal.map((r) => Object.values(r.norm.mishaps).reduce((a, b) => a + b, 0) / Math.max(1, Object.keys(r.norm.clearTimes).length || 3));
      const avg = mean(per);
      add('balanced <= 1 mishap per tier on average', avg <= 1 ? 'PASS' : 'FAIL', `${avg.toFixed(2)} per tier (${bal.map((r) => Object.values(r.norm.mishaps).reduce((a, b) => a + b, 0)).join('/')} mishaps over the runs)`);
      const surges = bal.reduce((n, r) => n + (r.norm.mishaps.surge || 0), 0);
      add('balanced surge is rare (<= 1 per 3 runs)', surges * 3 <= bal.length ? 'PASS' : 'FAIL', `${surges} surge(s) in ${bal.length} run(s)`);
    }
    verdict('greedy triggers >= 1 famine per run', greedy, (r) => (r.norm.mishaps.famine || 0) >= 1, (r) => `famines ${r.norm.mishaps.famine || 0}`, 'greedy bot not run');
    const gh = mean(greedy.map((r) => r.norm.harmony).filter((h) => h !== undefined)), bh = mean(bal.map((r) => r.norm.harmony).filter((h) => h !== undefined));
    if (Number.isNaN(gh) || Number.isNaN(bh)) add('greedy harmony >= 15 below balanced', 'SKIP', 'needs both greedy and balanced harmony');
    else add('greedy harmony >= 15 below balanced', bh - gh >= 15 ? 'PASS' : 'FAIL', `balanced ${bh.toFixed(1)}, greedy ${gh.toFixed(1)}, gap ${(bh - gh).toFixed(1)}`);
    verdict('passive triggers boom or disease', passive, (r) => (r.norm.mishaps.boom || 0) + (r.norm.mishaps.disease || 0) >= 1, () => 'no boom/disease', 'passive bot not run');
  }
  return out;
}

// ---------------------------------------------------------------- shots

async function shots(env) {
  const { browser, col, gameUrl, outDir } = env;
  const steps = new Steps(col);
  const written = [];
  console.log(dim(`shots: ${gameUrl()} -> ${path.relative(ROOT, outDir) || outDir}/{desktop,mobile}`));

  for (const kind of ['desktop1440', 'mobile']) {
    const label = kind === 'mobile' ? 'mobile' : 'desktop';
    const dir = path.join(outDir, label);
    fs.mkdirSync(dir, { recursive: true });
    const ctx = await makeContext(browser, kind);
    const page = await ctx.newPage();
    page.setDefaultTimeout(10000);
    col.attach(page, label);
    const snap = async (name) => { const f = path.join(dir, name + '.png'); await page.screenshot({ path: f }); written.push(path.relative(ROOT, f)); return name + '.png'; };
    const step = (name, fn, o) => steps.run(`${label}: ${name}`, fn, { timeout: 30000, ...o });

    if (!(await step('load title', async () => { await openGame(page, gameUrl()); await page.waitForTimeout(1000); return await snap('title'); })).ok) { await ctx.close(); continue; }
    const tierIds = await page.evaluate(() => Object.keys(window.Apex.TIERS || {})).catch(() => []);
    const defs = await page.evaluate(() => Object.fromEntries(Object.entries(window.Apex.TIERS || {}).map(([id, t]) => [id, !!t.final]))).catch(() => ({}));
    const nonFinal = tierIds.find((id) => !defs[id]), mid = tierIds[1] || tierIds[0];

    await step('editor', async () => {
      const hasEditor = await page.evaluate(() => !!(window.Apex.Editor && typeof window.Apex.Editor.open === 'function'));
      if (!hasEditor) return 'skipped (Apex.Editor missing)';
      await callApex(page, 'newRun');
      let m = await getMode(page);
      if (m !== 'editor') { await callApex(page, 'openEditor', { firstTime: true }).catch(() => {}); await page.waitForTimeout(300); m = await getMode(page); }
      if (m !== 'editor') return `skipped (mode is '${m}', editor did not open)`;
      await page.waitForTimeout(800);
      const f = await snap('editor');
      await callApex(page, 'closeEditor');
      return f;
    });

    for (const id of tierIds) {
      await step(`tier ${id} HUD`, async () => {
        await callApex(page, 'debug.setTier', id);
        await setAutoplay(page, 3);
        await page.waitForTimeout(3000);
        return await snap(`tier-${id}`);
      });
    }

    await step('evolve cards', async () => {
      if (!nonFinal) return 'skipped (no non-final tier)';
      await ensurePlay(page, nonFinal);
      await callApex(page, 'debug.fillGrowth');
      await waitMode(page, ['evolveChoice'], 3000, { current: true });
      await page.waitForTimeout(800);
      const f = await snap('evolve');
      const s = await gState(page);
      if (s.choices[0]) await callApex(page, 'choose', s.choices[0].sp);
      return f;
    });

    await step('dying + rebirth cards', async () => {
      await ensurePlay(page, mid);
      await callApex(page, 'debug.killPlayer');
      await waitMode(page, ['dying'], 3000, { current: true });
      await page.waitForTimeout(1500);
      const f1 = await snap('dying');
      await page.waitForTimeout(250);
      await page.keyboard.press('Space');
      let m = await waitMode(page, ['rebirthChoice'], 1500, { current: true }).catch(() => null);
      if (!m) m = await waitMode(page, ['rebirthChoice'], 6000, { current: true });
      await page.waitForTimeout(800);
      const f2 = await snap('rebirth');
      const s = await gState(page);
      if (s.choices[0]) await callApex(page, 'choose', s.choices[0].sp);
      return `${f1}, ${f2}`;
    }, { timeout: 40000 });

    await step('victory', async () => {
      await ensurePlay(page, mid);
      await callApex(page, 'debug.win');
      await waitMode(page, ['victory'], 3000, { current: true });
      await page.waitForTimeout(1200);
      return await snap('victory');
    });

    await step('paused', async () => {
      await page.keyboard.press('r');
      await waitMode(page, ['play'], 8000, { current: true, closeEditor: true });
      await page.keyboard.press('Escape');
      await waitMode(page, ['paused'], 1500, { current: true });
      await page.waitForTimeout(400);
      return await snap('paused');
    });
    await ctx.close();
  }
  console.log('\nWrote ' + written.length + ' screenshot(s):\n  ' + written.join('\n  '));
  return summarize(env, 'shots', steps.list, { files: written });
}

// ---------------------------------------------------------------- main

async function main() {
  const { opts, command } = parseArgs(process.argv.slice(2));
  if (opts.help || !['smoke', 'sim', 'shots'].includes(command)) {
    console.log(USAGE);
    return opts.help ? 0 : 2;
  }
  const limit = (+opts.timeout || (command === 'sim' ? 1800 : 300)) * 1000;
  const watchdog = setTimeout(() => { console.error(red(`check.mjs: hard timeout after ${limit / 1000}s, giving up`)); process.exit(1); }, limit);
  watchdog.unref();

  let target;
  try { target = buildTarget(opts); } catch (err) { console.error(red(err.message)); return 1; }

  let srv = null, origin = target.origin;
  if (!target.external) { srv = await startServer(ROOT); origin = srv.origin; }
  const col = new Collector(ROOT, origin);
  const defaults = command === 'shots' ? { mute: '1', seed: '1', tutorial: '0' } : { seed: '1', mute: '1', tutorial: '0' };
  const gameUrl = makeUrlBuilder(target, origin, defaults);

  let browser;
  try {
    browser = await chromium.launch({ headless: !opts.headed, args: ['--autoplay-policy=no-user-gesture-required'] });
  } catch (err) {
    console.error(red('could not launch Chromium: ' + String(err.message).split('\n')[0]) + '\n  (try: npx playwright install chromium)');
    srv?.server.close();
    return 1;
  }
  const env = { browser, col, gameUrl, target, opts, outDir: path.resolve(process.cwd(), opts.out || path.join(ROOT, 'shots')) };
  let code = 1;
  try {
    code = await ({ smoke, sim, shots }[command])(env);
  } catch (err) {
    console.error(red('check.mjs crashed: ' + (err.stack || err)));
    code = 1;
  } finally {
    await Promise.race([browser.close().catch(() => {}), sleep(5000)]);
    srv?.server.close();
  }
  return code;
}

process.on('unhandledRejection', (err) => { console.error(red('unhandled rejection: ' + (err?.stack || err))); });
main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(1); });
