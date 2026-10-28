// Apex ecosystem: producers, grazer/hunter populations, harmony and mishaps.
// The player is the keystone predator: over- or under-hunting triggers mishaps.
(function () {
  'use strict';
  const A = window.Apex = window.Apex || {};

  const TICK = 1;               // eco step length in seconds
  const WALL = 50;              // keep spawns this far from the world edge
  const MISHAP_TYPES = ['famine', 'boom', 'disease', 'barren', 'surge'];
  const DISEASE_NEED = 8;       // seconds a boom species must stay > 2.0 n0 before disease

  // ------------------------------------------------------------ helpers
  const cfg = (k, d) => (A.CFG && A.CFG[k] !== undefined ? A.CFG[k] : d);
  const rnd = () => (A.rand ? A.rand() : Math.random());
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const alive = (e) => e && e.alive !== false;
  const timeOf = (G) => G.time || 0;

  function tierOf(G) {
    return G.tier || (A.TIERS && A.TIERS[G.tierId]) || null;
  }

  function worldOf(G) {
    const t = tierOf(G);
    return (t && t.world) || cfg('WORLD', 2600);
  }

  function spNameOf(sp) {
    const d = A.SPECIES && A.SPECIES[sp];
    return d ? d.name : (sp || 'prey');
  }

  function spawnEnt(sp, ro, x, y) {
    return A.spawn ? A.spawn(sp, ro, x, y) : null;
  }

  function killEnt(e, cause) {
    if (A.kill) A.kill(e, cause);
    else e.alive = false;
  }

  function newState() {
    return {
      acc: 0, sust: {}, endSust: {}, cd: {}, zeroT: {}, gone: {},
      fertUntil: 0, fertVal: 1, hunterSeq: 0,
    };
  }

  // ------------------------------------------------------------ view / spawn spots
  // Rectangle (world units) currently visible, or null when nothing is known.
  function viewRect(G) {
    const cam = G.cam, p = G.player;
    if (cam && cam.zoom > 0 && A.W > 0 && A.H > 0) {
      return { x: cam.x, y: cam.y, hw: A.W / (2 * cam.zoom), hh: A.H / (2 * cam.zoom) };
    }
    if (p) return { x: p.x, y: p.y, hw: 400, hh: 400 };
    return null;
  }

  function inView(v, x, y, margin) {
    if (!v) return false;
    return Math.abs(x - v.x) < v.hw + margin && Math.abs(y - v.y) < v.hh + margin;
  }

  function randomPoint(G) {
    const w = worldOf(G);
    return { x: WALL + rnd() * (w - 2 * WALL), y: WALL + rnd() * (w - 2 * WALL) };
  }

  function pickOf(list) {
    return list.length ? list[Math.floor(rnd() * list.length)] : null;
  }

  // Find a point near `near` (entities), else near `fallback`, else anywhere, outside the camera view.
  function offscreenSpot(G, near, fallback) {
    const v = viewRect(G), w = worldOf(G);
    for (let i = 0; i < 16; i++) {
      const list = (i < 9 && near && near.length) ? near : (fallback && fallback.length ? fallback : null);
      const a = list ? pickOf(list) : randomPoint(G);
      const ang = rnd() * Math.PI * 2, d = 25 + rnd() * 80;
      const x = clamp(a.x + Math.cos(ang) * d, WALL, w - WALL);
      const y = clamp(a.y + Math.sin(ang) * d, WALL, w - WALL);
      if (!inView(v, x, y, 40)) return { x, y };
    }
    return null;
  }

  // ------------------------------------------------------------ census
  function census(G) {
    const out = { bySp: {}, plants: [], carrion: [], carcass: [], grazers: [], hunters: [], total: 0 };
    (G.entities || []).forEach((e) => {
      if (!alive(e)) return;
      out.total++;
      if (e.isPlayer || e.sp === 'decoy' || e.tutorialProp) return;   // tutorial extras are not part of the populations
      if (e.sp === 'carcass') { out.carcass.push(e); return; }      // kills left by the player's bites; not part of any population
      if (e.sp === 'carrion') { out.carrion.push(e); return; }
      (out.bySp[e.sp] = out.bySp[e.sp] || []).push(e);
      if (e.role === 'producer') out.plants.push(e);
      else if (e.role === 'grazer') out.grazers.push(e);
      else if (e.role === 'hunter') out.hunters.push(e);
    });
    return out;
  }

  function countOf(w, sp) {
    return w.bySp[sp] ? w.bySp[sp].length : 0;
  }

  function rosterOf(G, role) {
    const t = tierOf(G);
    return t ? t.roster.filter((r) => !role || r.role === role) : [];
  }

  function speciesCap(n0) {
    return Math.max(n0 + 1, Math.floor(cfg('SPECIES_CAP_MULT', 2.6) * n0));
  }

  function setPops(G, w) {
    const eco = G.eco;
    rosterOf(G).forEach((r) => { eco.pops[r.sp] = countOf(w, r.sp); });
  }

  // ------------------------------------------------------------ initial populations
  function spawnProducers(G) {
    const w = worldOf(G), cells = [];
    rosterOf(G, 'producer').forEach((ro) => {
      const clumps = Math.ceil(ro.n0 / 4), side = Math.ceil(Math.sqrt(clumps));
      const cell = (w - 2 * WALL) / side;
      cells.length = 0;
      for (let i = 0; i < side * side; i++) cells.push(i);
      cells.sort(() => rnd() - 0.5);
      for (let i = 0; i < ro.n0; i++) {
        const c = cells[i % clumps], cx = WALL + ((c % side) + 0.5) * cell, cy = WALL + (Math.floor(c / side) + 0.5) * cell;
        const ang = rnd() * Math.PI * 2, d = 15 + rnd() * 70;
        const e = spawnEnt(ro.sp, ro, clamp(cx + Math.cos(ang) * d + (rnd() - 0.5) * cell * 0.5, WALL, w - WALL),
          clamp(cy + Math.sin(ang) * d + (rnd() - 0.5) * cell * 0.5, WALL, w - WALL));
        if (e) e.amount = 0.7 + rnd() * 0.3;
      }
    });
  }

  function spawnGrazers(G, w) {
    const plants = w.plants;
    rosterOf(G, 'grazer').forEach((ro) => {
      for (let i = 0; i < ro.n0; i++) {
        const spot = offscreenSpotAnywhere(G, plants);
        spawnEnt(ro.sp, ro, spot.x, spot.y);
      }
    });
  }

  // Initial placement ignores the camera: the intro hides the world anyway.
  function offscreenSpotAnywhere(G, anchors) {
    const world = worldOf(G), a = anchors.length ? pickOf(anchors) : randomPoint(G);
    const ang = rnd() * Math.PI * 2, d = 25 + rnd() * 70;
    return { x: clamp(a.x + Math.cos(ang) * d, WALL, world - WALL), y: clamp(a.y + Math.sin(ang) * d, WALL, world - WALL) };
  }

  // Hunters spread around a ring just outside the player's starting view (the player spawns at the centre).
  function spawnHunters(G) {
    const world = worldOf(G), mid = world / 2, hunters = rosterOf(G, 'hunter');
    const total = hunters.reduce((n, r) => n + r.n0, 0);
    const maxR = mid - WALL;
    const v = viewRect(G);
    const minR = Math.min(maxR * 0.8, (v ? Math.hypot(v.hw, v.hh) : 300) * 1.15);
    const base = rnd() * Math.PI * 2;
    let k = 0;
    hunters.forEach((ro) => {
      for (let i = 0; i < ro.n0; i++, k++) {
        const ang = base + (k + rnd() * 0.6) / Math.max(1, total) * Math.PI * 2;
        const dist = minR + rnd() * Math.max(0, maxR - minR);
        const e = spawnEnt(ro.sp, ro, clamp(mid + Math.cos(ang) * dist, WALL, world - WALL),
          clamp(mid + Math.sin(ang) * dist, WALL, world - WALL));
        if (e) seedHunger(G, e);
      }
    });
  }

  // New hunters start partly hungry (staggered) so they do not all starve at once.
  function seedHunger(G, e) {
    e.lastAte = timeOf(G) - (8 + rnd() * 18);
    e.fed = 0;
  }

  function initTier(G) {
    const tier = tierOf(G);
    if (!tier) return;
    const eco = G.eco = {
      pops: {}, n0: {}, producerLevel: 1, harmony: 70, mishaps: [],
      flags: { famine: false, boomSp: null, diseaseSp: null, barren: false, surge: false },
      fertility: 1, _s: newState(),
    };
    tier.roster.forEach((r) => { eco.n0[r.sp] = r.n0; eco.pops[r.sp] = 0; });
    spawnProducers(G);
    spawnHunters(G);
    const w = census(G);
    spawnGrazers(G, w);
    const after = census(G);
    eco.producerLevel = meanAmount(after.plants);
    setPops(G, after);
  }

  // ------------------------------------------------------------ plants: grazing and regrowth
  function meanAmount(plants) {
    if (!plants.length) return 1;
    let s = 0;
    plants.forEach((p) => { s += p.amount === undefined ? 1 : p.amount; });
    return s / plants.length;
  }

  // The nearest plant with food that a grazer is touching, or null.
  function touchedPlant(g, plants) {
    let best = null, bd = Infinity;
    for (let i = 0; i < plants.length; i++) {
      const p = plants[i];
      if (!(p.amount > 0.02)) continue;
      const dx = g.x - p.x, dy = g.y - p.y, reach = g.r + p.r + 4;
      const d2 = dx * dx + dy * dy;
      if (d2 < reach * reach && d2 < bd) { bd = d2; best = p; }
    }
    return best;
  }

  function graze(G, w, dt) {
    const boom = G.eco.flags.boomSp, rate = cfg('GRAZE_RATE', 0.15), v = viewRect(G);
    w.grazers.forEach((g) => {
      const p = touchedPlant(g, w.plants);
      if (!p) return;
      // Fuller plants are easier to graze, so plant level settles smoothly instead of crashing.
      p.amount = Math.max(0, p.amount - rate * p.amount * (g.sp === boom ? 2 : 1) * dt);
      g.lastAte = timeOf(G);
      if (A.emit && inView(v, g.x, g.y, 60)) A.emit('graze', { e: g, producer: p });
    });
  }

  function regrow(G, w, dt) {
    const base = cfg('REGROW', 0.02) * G.eco.fertility * dt;
    const rot = w.carrion.concat(w.carcass);   // anything dead nearby feeds the soil
    w.plants.forEach((p) => {
      let near = 0;
      for (let i = 0; i < rot.length; i++) {
        const c = rot[i], dx = p.x - c.x, dy = p.y - c.y;
        if (dx * dx + dy * dy < 160 * 160) near++;
      }
      p.amount = clamp(p.amount + base * (1 + Math.min(1.5, near * 0.6)), 0, 1);
    });
  }

  function decayCarrion(w, dt) {
    w.carrion.forEach((c) => {
      c.amount = (c.amount === undefined ? 1 : c.amount) - dt / 20;
      if (c.amount <= 0) killEnt(c, 'decayed');
    });
  }

  // ------------------------------------------------------------ births, starvation, migration
  function growSpot(G, w, ro) {
    const kin = w.bySp[ro.sp] || [];
    return offscreenSpot(G, kin, w.plants);
  }

  function addOne(G, w, ro) {
    const spot = growSpot(G, w, ro);
    if (!spot) return null;
    const e = spawnEnt(ro.sp, ro, spot.x, spot.y);
    if (!e) return null;
    if (ro.role === 'hunter') seedHunger(G, e);
    (w.bySp[ro.sp] = w.bySp[ro.sp] || []).push(e);
    w.total++;
    if (A.emit) A.emit('birth', { e });
    return e;
  }

  function canAdd(w, ro, n) {
    return n < speciesCap(ro.n0) && w.total < cfg('MAX_ENTITIES', 230);
  }

  // Stochastic rounding keeps small populations from freezing at fractional births.
  function roundRand(x) {
    return Math.floor(x) + (rnd() < x - Math.floor(x) ? 1 : 0);
  }

  function growGrazers(G, w, dt) {
    const eco = G.eco, pl = eco.producerLevel;
    const rg = cfg('RG', 0.016) * ((tierOf(G) || {}).rgMul || 1);   // optional per-tier breeding multiplier
    rosterOf(G, 'grazer').forEach((ro) => {
      let n = countOf(w, ro.sp);
      if (n === 0) return;
      const swarm = ro.sp === eco.flags.boomSp ? 1.35 : 1;   // a booming species keeps swarming past normal K
      const K = ro.n0 * cfg('K_MULT', 2) * clamp(pl * 1.25, 0.25, 1.25) * swarm;
      const births = roundRand(Math.max(0, rg * n * (1 - n / K)) * dt);
      for (let i = 0; i < births && canAdd(w, ro, n); i++) { if (addOne(G, w, ro)) n++; else break; }
    });
  }

  function starveGrazers(G, w, dt) {
    if (G.eco.producerLevel >= 0.25) return;
    const p = cfg('GRAZER_STARVE', 0.03) * dt;
    w.grazers.forEach((g) => { if (rnd() < p) killEnt(g, 'starved'); });
  }

  function starveHunters(G, w) {
    const now = timeOf(G), limit = cfg('HUNTER_STARVE', 50);
    w.hunters.forEach((h) => {
      if (!(h.lastAte > -900)) seedHunger(G, h);
      h.hungerT = now - h.lastAte;
      h.desperate = G.eco.flags.famine;
      if (h.hungerT > limit) killEnt(h, 'starved');
    });
  }

  function breedHunters(G, w) {
    const need = cfg('HUNTER_BREED_FED', 3);
    rosterOf(G, 'hunter').forEach((ro) => {
      const n = countOf(w, ro.sp);
      if (n === 0 || n >= cfg('HUNTER_BREED_CAP', 2.5) * ro.n0 || !canAdd(w, ro, n)) return;
      const parent = (w.bySp[ro.sp] || []).find((h) => alive(h) && (h.fed || 0) >= need);
      if (!parent) return;
      const spot = offscreenSpot(G, [parent], w.plants);
      if (!spot) return;
      const kid = spawnEnt(ro.sp, ro, spot.x, spot.y);
      if (!kid) return;
      seedHunger(G, kid);
      kid.lastAte = timeOf(G) - 10;
      parent.fed = 0;
      w.bySp[ro.sp].push(kid);
      w.total++;
      if (A.emit) A.emit('birth', { e: kid });
    });
  }

  // Extinct species return after MIGRATION_DELAY seconds so the world never stays empty.
  function migrate(G, w, dt) {
    const s = G.eco._s;
    rosterOf(G).forEach((ro) => {
      if (ro.role === 'producer') return;
      if (countOf(w, ro.sp) > 0) { s.zeroT[ro.sp] = 0; s.gone[ro.sp] = false; return; }
      s.zeroT[ro.sp] = (s.zeroT[ro.sp] || 0) + dt;
      if (!s.gone[ro.sp]) { s.gone[ro.sp] = true; if (A.emit) A.emit('extinct', { sp: ro.sp }); }
      if (s.zeroT[ro.sp] < cfg('MIGRATION_DELAY', 12)) return;
      const want = ro.role === 'hunter' ? 1 : 2;
      let got = 0;
      for (let i = 0; i < want; i++) if (addOne(G, w, ro)) got++;
      if (got) {
        s.zeroT[ro.sp] = 0; s.gone[ro.sp] = false;
        if (A.emit) A.emit('migration', { sp: ro.sp });
      }
    });
  }

  // ------------------------------------------------------------ harmony
  function deviation(v, band) {
    return Math.max(0, band[0] - v, v - band[1]) / 0.6;
  }

  function harmonyTarget(G, w) {
    const eco = G.eco, band = cfg('HARMONY_BAND', [0.6, 1.45]);
    const devs = [deviation(eco.producerLevel, cfg('PRODUCER_BAND', [0.45, 1]))];
    rosterOf(G).forEach((r) => {
      if (r.role !== 'producer') devs.push(deviation(countOf(w, r.sp) / r.n0, band));
    });
    const mean = devs.reduce((a, b) => a + b, 0) / devs.length;
    return 100 * (1 - Math.min(1, mean * 1.4));
  }

  function updateHarmony(G, w) {
    const eco = G.eco;
    eco.harmony += (harmonyTarget(G, w) - eco.harmony) * 0.2;
    if (G.stats) {
      G.stats.harmonySum = (G.stats.harmonySum || 0) + eco.harmony;
      G.stats.harmonyN = (G.stats.harmonyN || 0) + 1;
    }
  }

  // ------------------------------------------------------------ mishaps
  function ratioOf(G, w, sp) {
    return countOf(w, sp) / (G.eco.n0[sp] || 1);
  }

  function sumN0(G, role) {
    return rosterOf(G, role).reduce((n, r) => n + r.n0, 0);
  }

  function countRole(w, role) {
    return role === 'grazer' ? w.grazers.length : w.hunters.length;
  }

  function topGrazer(G, w) {
    let best = null, br = 0;
    rosterOf(G, 'grazer').forEach((r) => {
      const q = ratioOf(G, w, r.sp);
      if (q > br) { br = q; best = r.sp; }
    });
    return { sp: best, ratio: br };
  }

  // Start/end conditions for each mishap type; `boom` also carries the species involved.
  function conditions(G, w) {
    const eco = G.eco, f = eco.flags;
    const grazeFrac = countRole(w, 'grazer') / Math.max(1, sumN0(G, 'grazer'));
    const hunterFrac = countRole(w, 'hunter') / Math.max(1, sumN0(G, 'hunter'));
    const top = topGrazer(G, w);
    const boomRatio = f.boomSp ? ratioOf(G, w, f.boomSp) : 0;
    return {
      famine: { start: grazeFrac < 0.45, end: grazeFrac > 0.65, need: cfg('MISHAP_SUSTAIN', 4), sp: null },
      boom: { start: top.ratio > 1.75, end: boomRatio < 1.4, need: cfg('MISHAP_SUSTAIN', 4), sp: top.sp },
      disease: { start: !!f.boomSp && boomRatio > 2.0 && !f.diseaseSp, end: f.diseaseSp ? ratioOf(G, w, f.diseaseSp) < 1.3 : false, need: DISEASE_NEED, sp: f.boomSp },
      barren: { start: eco.producerLevel < 0.3, end: eco.producerLevel > 0.5, need: cfg('MISHAP_SUSTAIN', 4), sp: null },
      surge: { start: hunterFrac > 1.7, end: hunterFrac < 1.3, need: cfg('MISHAP_SUSTAIN', 4), sp: null },
    };
  }

  function fillText(str, sp) {
    return String(str || '').replace(/\{sp\}/g, spNameOf(sp));
  }

  function flavor(G, type, sp) {
    const t = tierOf(G);
    const src = (t && t.mishaps && t.mishaps[type]) || (A.MISHAP_DEFAULTS && A.MISHAP_DEFAULTS[type]) || { title: type, text: '' };
    return { title: fillText(src.title, sp), text: fillText(src.text, sp) };
  }

  function activeOf(eco, type) {
    return eco.mishaps.find((m) => m.type === type) || null;
  }

  function applyStart(G, type, sp) {
    const f = G.eco.flags;
    if (type === 'famine') f.famine = true;
    else if (type === 'boom') f.boomSp = sp;
    else if (type === 'disease') f.diseaseSp = sp;
    else if (type === 'barren') f.barren = true;
    else if (type === 'surge') f.surge = true;
  }

  function applyEnd(G, w, type) {
    const f = G.eco.flags;
    if (type === 'famine') f.famine = false;
    else if (type === 'boom') f.boomSp = null;
    else if (type === 'barren') f.barren = false;
    else if (type === 'surge') f.surge = false;
    else if (type === 'disease') {
      (w.bySp[f.diseaseSp] || []).forEach((e) => { e.sick = false; });
      f.diseaseSp = null;
    }
  }

  function startMishap(G, type, sp) {
    const eco = G.eco, text = flavor(G, type, sp);
    applyStart(G, type, sp);
    eco.mishaps.push({ type, sp, t: timeOf(G), title: text.title, text: text.text });
    if (G.stats) G.stats.mishaps = (G.stats.mishaps || 0) + 1;
    if (A.emit) A.emit('mishapStart', { type, title: text.title, text: text.text, sp });
  }

  function endMishap(G, w, type) {
    const eco = G.eco, s = eco._s;
    applyEnd(G, w, type);
    eco.mishaps = eco.mishaps.filter((m) => m.type !== type);
    s.cd[type] = timeOf(G) + cfg('MISHAP_COOLDOWN', 25);
    s.sust[type] = 0; s.endSust[type] = 0;
    if (A.emit) A.emit('mishapEnd', { type });
  }

  function updateMishaps(G, w, dt) {
    const eco = G.eco, s = eco._s, cond = conditions(G, w);
    MISHAP_TYPES.forEach((type) => {
      const c = cond[type], act = activeOf(eco, type);
      if (act) {
        s.endSust[type] = c.end ? (s.endSust[type] || 0) + dt : 0;
        if (s.endSust[type] >= cfg('MISHAP_SUSTAIN', 4)) endMishap(G, w, type);
        return;
      }
      s.sust[type] = c.start ? (s.sust[type] || 0) + dt : 0;
      const ready = s.sust[type] >= c.need && timeOf(G) >= (s.cd[type] || 0) && eco.mishaps.length < cfg('MAX_MISHAPS', 2);
      const needsSp = type === 'boom' || type === 'disease';
      if (ready && (!needsSp || c.sp)) startMishap(G, type, c.sp);
    });
  }

  // Disease: keep ~35% of the species sick; sick animals die at 4%/s.
  function spreadDisease(G, w, dt) {
    const sp = G.eco.flags.diseaseSp;
    if (!sp) return;
    const list = (w.bySp[sp] || []).filter(alive);
    const want = Math.ceil(list.length * 0.35);
    let sick = list.filter((e) => e.sick).length;
    list.forEach((e) => {
      if (!e.sick && sick < want) { e.sick = true; sick++; }
    });
    list.forEach((e) => { if (e.sick && rnd() < 0.04 * dt) killEnt(e, 'disease'); });
  }

  // ------------------------------------------------------------ tick
  function step(G, dt) {
    const eco = G.eco, s = eco._s;
    let w = census(G);
    eco.fertility = timeOf(G) < s.fertUntil ? s.fertVal : 1;
    graze(G, w, dt);
    regrow(G, w, dt);
    decayCarrion(w, dt);
    eco.producerLevel = meanAmount(w.plants);
    starveGrazers(G, w, dt);
    starveHunters(G, w);
    spreadDisease(G, w, dt);
    w = census(G);                       // deaths above change the counts
    growGrazers(G, w, dt);
    breedHunters(G, w);
    migrate(G, w, dt);
    w = census(G);
    setPops(G, w);
    updateHarmony(G, w);
    updateMishaps(G, w, dt);
  }

  function tick(G, dt) {
    G = G || A.G;
    if (!G || !G.eco || !G.eco._s || !(dt > 0)) return;
    const s = G.eco._s;
    s.acc += Math.min(dt, 3);
    let guard = 3;
    while (s.acc >= TICK && guard-- > 0) { s.acc -= TICK; step(G, TICK); }
  }

  // ------------------------------------------------------------ events from core
  function onEat(eater, food) {
    const G = A.G;
    if (!G || !eater || eater.isPlayer || eater.role !== 'hunter') return;
    eater.lastAte = timeOf(G);
    eater.fed = (eater.fed || 0) + 1;
  }

  function spawnCarrion(G, e) {
    if (!A.spawn || countAlive(G) >= cfg('MAX_ENTITIES', 230) - 2) return;
    const ro = { sp: 'carrion', role: 'producer', beh: 'static', r: Math.max(2, e.r * 0.8), n0: 0, speed: 0 };
    const c = spawnEnt('carrion', ro, e.x, e.y);
    if (!c) return;
    c.amount = 1;
    c.carrion = true;
    if (!(c.r > 0)) c.r = ro.r;
  }

  function countAlive(G) {
    let n = 0;
    (G.entities || []).forEach((e) => { if (alive(e)) n++; });
    return n;
  }

  function playerDied(G, e) {
    const s = G.eco._s;
    s.fertUntil = timeOf(G) + 20;
    s.fertVal = 1.6;
    (G.entities || []).forEach((p) => {
      if (!alive(p) || p.role !== 'producer' || p.amount === undefined) return;
      const dx = p.x - e.x, dy = p.y - e.y;
      if (dx * dx + dy * dy < 260 * 260) p.amount = Math.min(1, p.amount + 0.3);
    });
  }

  function onDeath(e, cause) {
    const G = A.G;
    if (!G || !G.eco || !e) return;
    if (e.isPlayer) { playerDied(G, e); return; }
    if (e.role === 'producer') return;
    if (cause === 'starved' || cause === 'disease') spawnCarrion(G, e);
  }

  // ------------------------------------------------------------ queries
  function harmonyMult() {
    const G = A.G, h = G && G.eco ? G.eco.harmony : 0;
    if (h < 40) return 1;
    return h <= 75 ? 2 : 3;
  }

  function statusOf(sp) {
    const G = A.G, eco = G && G.eco;
    if (!eco || !(eco.n0[sp] > 0)) return 'ok';
    const ro = rosterOf(G).find((r) => r.sp === sp);
    if (ro && ro.role === 'producer') {
      return eco.producerLevel < cfg('PRODUCER_BAND', [0.45, 1])[0] ? 'low' : 'ok';
    }
    const q = (eco.pops[sp] || 0) / eco.n0[sp], band = cfg('HARMONY_BAND', [0.6, 1.45]);
    if (q < band[0]) return 'low';
    return q > band[1] ? 'high' : 'ok';
  }

  A.Eco = { init() {}, initTier, tick, onEat, onDeath, harmonyMult, statusOf };
})();
