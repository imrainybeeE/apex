// core.js: the game hub. Loop, state machine, input, camera, entities, collisions, player, progression, render.
(function () {
  'use strict';
  const A = window.Apex = window.Apex || {};

  const STEP = 1 / 60;
  const TAU = Math.PI * 2;
  const CELL = 64;
  const SLOWMO = 0.15;
  const SIM_MODES = { title: 1, intro: 1, play: 1, evolveChoice: 1, evolving: 1, dying: 1 };
  const ROLE_COLOR = { producer: '#5fae5a', grazer: '#e8c25a', hunter: '#d9604f', player: '#c6f25a' };

  // Values used only when config.js lacks a key.
  const CFG_DEFAULT = {
    PLAYER_BASE_R: 12, PLAYER_SPEED: 150, VIEW_R_MULT: 26, EAT_RATIO: 0.92, ENERGY_MAX: 100,
    DASH_MULT: 2.6, DASH_TIME: 0.25, DASH_CD: 1.1, DASH_COST: 4, STARVE_GRACE: 4, COMBO_WINDOW: 2.2,
    SATIATED_TIME: 6, RESPAWN_GROWTH: 0.4, FORGIVE_GROWTH: 0.5, START_DNA: 15, EVOLVE_DNA: 15, DNA_PER_MASS: 0.6,
    DECOMPOSE_TIME: 4.5, DECOMPOSE_SKIP: 1.5, INTRO_TIME: 2.2, GRACE: 3, EVOLVE_TIME: 1.6,
    FINAL_HOLD: 45, FINAL_HARMONY: 55, WORLD: 1200, ARMOR_RECHARGE: [0, 30, 22, 15],
    POISON_TIME: 6, AIR_ALT: 0.35,
    HP_PER_MASS: 10, BITE_CD: 0.45, BITE_DMG: 9, BITE_SNAP: 0.12, BITE_SNAP_MUL: 1.6, BITE_ARC: 60, BITE_REACH: 1.4,
    BITE_JAWS_BONUS: 0.25, FIGHT_RATIO: 1.35, BIG_DMG_FRAC: 0.15, PRED_DMG: 12, PRED_INVULN: 0.6,
    FLINCH_FRAC: 0.35, FLINCH_WINDOW: 1.2, FLINCH_TIME: 0.5, WOUND_FLEE: 0.3, WOUND_RECOVER: 0.5,
    REGEN: 0.02, REGEN_DELAY: 4, REGEN_ENERGY: 0.3, NPC_REGEN: 0.02, NPC_REGEN_DELAY: 5,
    NIP_DMG: 4, NIP_CD: 1.1, NIP_INVULN: 0.5, ANGRY_TIME: 6, ANGRY_SPEED: 1.15, ANGRY_BUMP_SPEED: 90, ANGRY_LEASH: 400,
    RESTART_HOLD: 0.7, CARCASS_TIME: 25, CARCASS_GROWTH: 1, DECOY_TIME: 3, TIP_TIME: 8, TUT_BEETLE_DMG: 0.35,
  };
  function cf(key) {
    const v = A.CFG && A.CFG[key];
    return v === undefined ? CFG_DEFAULT[key] : v;
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrapAngle = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
  const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

  // ---------- errors and module calls ----------
  const errCounts = {};
  function report(label, err) {
    const n = errCounts[label] = (errCounts[label] || 0) + 1;
    if (n <= 5 && typeof console !== 'undefined') console.error('[apex] ' + label + ':', (err && err.stack) || err);
  }
  A.reportError = report;

  // Call A[mod][fn](...) if present; one module's failure never takes the loop down.
  function mod(name, fn, a, b, c, d, e) {
    const M = A[name];
    if (M && M[fn]) {
      try { return M[fn](a, b, c, d, e); } catch (err) { report(name + '.' + fn, err); }
    }
    return undefined;
  }

  // ---------- seeded random ----------
  let seedState = 1;
  A.setSeed = function (s) { seedState = (s >>> 0) || 1; };
  A.rand = function () {
    seedState = (seedState + 0x6D2B79F5) | 0;
    let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  A.randRange = (a, b) => a + (b - a) * A.rand();
  A.pick = (arr) => arr[Math.floor(A.rand() * arr.length)];

  // ---------- event bus ----------
  const handlers = {};
  A.on = function (name, fn) { (handlers[name] = handlers[name] || []).push(fn); return fn; };
  A.off = function (name, fn) {
    const l = handlers[name];
    const i = l ? l.indexOf(fn) : -1;
    if (i >= 0) l.splice(i, 1);
  };
  A.emit = function (name, payload) {
    const l = handlers[name];
    if (!l || !l.length) return;
    const copy = l.slice();
    for (let i = 0; i < copy.length; i++) {
      try { copy[i](payload); } catch (err) { report('event ' + name, err); }
    }
  };

  // ---------- shared state ----------
  const newCreature = () => ({ name: '', pal: null, parts: {} });
  const newStats = () => ({ eaten: 0, bySp: {}, maxCombo: 0, mishaps: 0, harmonySum: 0, harmonyN: 0 });
  const newEco = () => ({
    pops: {}, n0: {}, producerLevel: 1, harmony: 100, mishaps: [], fertility: 1,
    flags: { famine: false, boomSp: null, diseaseSp: null, barren: false, surge: false },
  });

  const G = A.G = {
    mode: null, prevMode: null, path: null, tierId: null, tier: null, world: 2600,
    time: 0, tierTime: 0, entities: [], player: null,
    cam: { x: 1300, y: 1300, zoom: 3, shakeX: 0, shakeY: 0, shake: 0 },
    score: 0, combo: 0, comboT: 0, deaths: 0, dna: 0,
    creature: newCreature(), lineage: [], eco: newEco(), final: false, finalHold: 0,
    stats: newStats(), choices: [], deathInfo: null, pending: null,
    flags: { autoplay: false, bot: 'balanced', debug: false, headless: false, speed: 1, seed: 1,
      skipEditor: false, mute: false, path: null, tier: null, sp: null, tutorial: null },
    timeScale: 1, hitstopT: 0, transT: 0, restartHold: 0, deathTier: null, tierDeaths: 0, difficulty: 'normal',
    // M1.5: guided tutorial (tutorial.js fills it), one-time tip, ground effects such as web zones
    tutorial: { active: false, id: null, text: '', anchor: null, highlight: [], canSkip: false, done: false },
    tip: null, zones: [],
  };

  // Queued flags are set by keys, mouse and the touch buttons (ui.js); core consumes them once per step.
  A.input = {
    x: 0, y: 0, wx: 0, wy: 0, dirX: 0, dirY: 0, pointerDown: false, touch: false, active: false,
    dashQueued: false, biteQueued: false, abilityQueued: false, ecoView: false,
  };
  A.W = 1280; A.H = 800; A.DPR = 1;

  let idSeq = 0;
  let simMode = false;    // true inside debug.simulate: skip cosmetic work
  let renderT = 0;
  let accum = 0;
  let lastFrame = 0;
  let fps = 60;
  let threatT = 0;
  let booted = false;

  // ---------- tiers and species helpers ----------
  const tiersOf = () => A.TIERS || {};

  A.lowerTier = function (tierId) {
    const t = tiersOf()[tierId];
    if (!t) return tierId;
    if (t.prev) return t.prev;
    const all = tiersOf();
    for (const id in all) if (all[id].next && all[id].next.indexOf(tierId) >= 0) return id;
    return tierId;
  };

  function playersOf(tier) {
    return ((tier && tier.players) || []).map((p) => (typeof p === 'string' ? p : p.sp));
  }

  A.nextChoices = function (tierId) {
    const t = tiersOf()[tierId];
    const out = [];
    if (!t || !t.next) return out;
    t.next.forEach((nid) => {
      const nt = tiersOf()[nid];
      if (!nt) return;
      playersOf(nt).forEach((sp) => out.push({ sp, tierId: nid, path: nt.path }));
    });
    return out;
  };

  // The first death in a tier is forgiven: reborn in the same tier at FORGIVE_GROWTH. Dying there again drops a tier.
  function rebirthChoices() {
    const forgive = G.tierDeaths <= 1;
    const lt = forgive ? G.tierId : A.lowerTier(G.tierId);
    const t = tiersOf()[lt];
    return playersOf(t).map((sp) => ({ sp, tierId: lt, path: t.path, growth: cf(forgive ? 'FORGIVE_GROWTH' : 'RESPAWN_GROWTH') }));
  }

  function findRoster(tier, sp) {
    const r = tier && tier.roster;
    if (!r) return null;
    for (let i = 0; i < r.length; i++) if (r[i].sp === sp) return r[i];
    return null;
  }

  const ROLE_ALIAS = { g: 'grazer', h: 'hunter', p: 'producer' };

  // ---------- spatial grid ----------
  const grid = { gw: 0, cells: [], used: [] };
  let maxR = 20;

  function gridAdd(e) {
    const gw = grid.gw;
    if (!gw) return;
    const cx = clamp((e.x / CELL) | 0, 0, gw - 1);
    const cy = clamp((e.y / CELL) | 0, 0, gw - 1);
    const idx = cy * gw + cx;
    let c = grid.cells[idx];
    if (!c) c = grid.cells[idx] = [];
    if (c.length === 0) grid.used.push(idx);
    c.push(e);
  }

  function buildGrid() {
    const gw = Math.ceil(G.world / CELL) + 1;
    if (gw !== grid.gw) { grid.gw = gw; grid.cells = new Array(gw * gw).fill(null); grid.used.length = 0; }
    const cells = grid.cells, used = grid.used;
    for (let i = 0; i < used.length; i++) cells[used[i]].length = 0;
    used.length = 0;
    maxR = 12;
    const list = G.entities;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      if (e.r > maxR) maxR = e.r;
      gridAdd(e);
    }
  }

  // Push every live entity in cells overlapping the box (x±r, y±r) into out.
  function scan(x, y, r, out) {
    const gw = grid.gw;
    if (!gw) return;
    const c0 = clamp(((x - r) / CELL) | 0, 0, gw - 1), c1 = clamp(((x + r) / CELL) | 0, 0, gw - 1);
    const r0 = clamp(((y - r) / CELL) | 0, 0, gw - 1), r1 = clamp(((y + r) / CELL) | 0, 0, gw - 1);
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const c = grid.cells[cy * gw + cx];
        if (!c) continue;
        for (let i = 0; i < c.length; i++) if (c[i].alive) out.push(c[i]);
      }
    }
  }

  const near = [];
  function gather(x, y, r) { near.length = 0; scan(x, y, r, near); return near.length; }

  // Live entities whose center lies within r of (x, y), optionally filtered.
  A.query = function (x, y, r, filter) {
    const box = [], out = [];
    scan(x, y, r, box);
    const r2 = r * r;
    for (let i = 0; i < box.length; i++) {
      const e = box[i], dx = e.x - x, dy = e.y - y;
      if (dx * dx + dy * dy <= r2 && (!filter || filter(e))) out.push(e);
    }
    return out;
  };

  // ---------- entities ----------
  A.spawn = function (sp, ro, x, y, opts) {
    const tier = G.tier;
    ro = ro || findRoster(tier, sp) || { sp, role: 'grazer', beh: 'wander', r: 8, n0: 1, speed: 60 };
    const role = ROLE_ALIAS[ro.role] || ro.role;
    const e = {
      id: ++idSeq, sp, def: (A.SPECIES && A.SPECIES[sp]) || {}, ro, role, beh: ro.beh,
      x, y, vx: 0, vy: 0, kx: 0, ky: 0, angle: A.rand() * TAU, r: ro.r, mass: ro.r * ro.r / 16, speed: ro.speed,
      state: 'idle', stateT: 0, target: null, tx: x, ty: y, hungerT: 0, fed: 0, sick: false, desperate: false,
      alive: true, age: 0, phase: A.rand() * 6, biteT: 0, hurtT: 0, alt: 0, amount: role === 'producer' ? 1 : 0,
      lastAte: -999, isPlayer: false, pal: null, parts: null, rs: {},
      hp: 0, maxHp: 0, biteCdT: 0, stunT: 0, slowT: 0, slowMul: 1, angryT: 0, flinchT: 0, nipCd: 0, sinceHurt: 99, dmgAcc: 0, dmgAccT: 0,
    };
    if (opts) {
      for (const k in opts) e[k] = opts[k];
      if (opts.r !== undefined) e.mass = e.r * e.r / 16;
    }
    if (role !== 'producer') e.maxHp = e.hp = cf('HP_PER_MASS') * e.mass;   // producers (and carcasses) have no hp
    G.entities.push(e);
    gridAdd(e);
    if (e.r > maxR) maxR = e.r;
    return e;
  };

  let needCompact = false;

  A.kill = function (e, cause, killer) {
    if (!e || !e.alive) return;
    if (e.isPlayer) { killPlayer(e, cause, killer); return; }
    e.alive = false;
    e.deathCause = cause;
    e.killer = killer || null;
    needCompact = true;
  };

  function compactEntities() {
    if (!needCompact) return;
    const list = G.entities;
    let j = 0;
    for (let i = 0; i < list.length; i++) if (list[i].alive) list[j++] = list[i];
    list.length = j;
    needCompact = false;
  }

  // ---------- eating rules ----------
  A.canEat = function (a, b) {
    if (!a || !b || a === b || !b.alive || !a.alive) return false;
    if (b.isPlayer && (b.invulnT > 0 || G.final)) return false;
    if ((a.alt > 0.5) !== (b.alt > 0.5)) return false;
    if (b.sp === 'carcass') return !!a.isPlayer;     // only the player scavenges
    if (b.sp === 'decoy' && a.isPlayer) return false; // the player's own tail is not food
    if (b.role === 'producer') return a.role === 'grazer' || !!(a.isPlayer && a.def && a.def.omni);
    if (a.role === 'producer' || (a.role === 'grazer' && !a.isPlayer)) return false;
    const ratio = a.isPlayer ? a.stats.eatRatio : cf('EAT_RATIO');
    return b.r < a.r * ratio;
  };
  const canEat = A.canEat;

  // ---------- player stats ----------
  const STAT_DEFAULT = () => ({
    speedMul: 1, eatRatio: cf('EAT_RATIO'), visionMul: 1, armorMax: 0, armorRecharge: 0,
    dashCdMul: 1, dashDistMul: 1, drainMul: 1, dnaMul: 1, stealthMul: 1,
  });

  function effectiveLevels(creature, sp) {
    const innate = (A.SPECIES && A.SPECIES[sp] && A.SPECIES[sp].innate) || {};
    const bought = (creature && creature.parts) || {};
    const ids = A.PARTS ? Object.keys(A.PARTS) : Object.keys(Object.assign({}, bought, innate));
    const out = {};
    ids.forEach((id) => { out[id] = Math.min(3, (bought[id] || 0) + (innate[id] || 0)); });
    return out;
  }

  A.playerStats = function (creature, sp) {
    const st = STAT_DEFAULT();
    const innate = (A.SPECIES && A.SPECIES[sp] && A.SPECIES[sp].innate) || {};
    const bought = (creature && creature.parts) || {};
    if (A.Parts && A.Parts.stats) {
      try { return Object.assign(st, A.Parts.stats(bought, innate)); } catch (err) { report('Parts.stats', err); }
    }
    // Fallback: derive from A.PARTS effects.
    const lv = effectiveLevels(creature, sp);
    for (const id in lv) {
      const level = lv[id], part = A.PARTS && A.PARTS[id];
      if (!level || !part || !part.effect) continue;
      for (const k in part.effect) {
        const per = part.effect[k];
        if (k === 'eatRatio') st.eatRatio += per * level;
        else if (k === 'armorMax') st.armorMax = Math.max(st.armorMax, per || 1);
        else if (k === 'armorRecharge') st.armorRecharge = cf('ARMOR_RECHARGE')[level] || 0;
        else st[k] += per * level;
      }
    }
    return st;
  };

  // ---------- modes ----------
  A.setMode = function (m) {
    const from = G.mode;
    if (from === m) return;
    G.prevMode = from;
    G.mode = m;
    G.transT = 0;
    G.timeScale = m === 'evolveChoice' ? SLOWMO : 1;
    A.emit('modeChange', { from, to: m });
  };
  const setMode = A.setMode;

  A.togglePause = function () {
    if (G.mode === 'paused') {
      const saved = G.pausedTransT || 0;
      setMode(G.prevMode || 'play');
      G.transT = saved;
      A.emit('pause', { paused: false });
    } else if (G.mode === 'play' || G.mode === 'intro' || G.mode === 'evolveChoice') {
      G.pausedTransT = G.transT;
      setMode('paused');
      A.emit('pause', { paused: true });
    }
  };

  // ---------- run lifecycle ----------
  function resetRunState(keepCreature) {
    G.pending = null;
    G.score = 0; G.combo = 0; G.comboT = 0; G.deaths = 0;
    G.dna = cf('START_DNA');
    G.time = 0; G.tierTime = 0; G.path = null; G.final = false; G.finalHold = 0;
    G.lineage = []; G.stats = newStats(); G.choices = []; G.deathInfo = null; G.hitstopT = 0; G.deathTier = null; G.tierDeaths = 0;
    if (!keepCreature) G.creature = newCreature();
  }

  A.newRun = function (opts) {
    const keep = !!(opts && opts.keepCreature);
    resetRunState(keep);
    const sp = 'ant', tierId = A.TIER_START || 't1_litter';
    G.pending = { tierId, sp, growth: 0 };
    A.emit('runStart');
    if (keep || G.flags.skipEditor) beginPending();
    else A.openEditor({ sp, tierId, firstTime: true });
  };

  A.restart = function () {
    A.emit('restart');
    A.newRun({ keepCreature: true });
  };

  function beginPending() {
    const pd = G.pending;
    G.pending = null;
    if (!pd) return;
    startTier(pd.tierId, pd.sp, { growth: pd.growth });
    setMode('intro');
    maybeStartTutorial(true);
  }

  // The guided first minute: only on a fresh t1_litter run, unless it was finished before (or ?tutorial=1 / 0).
  function tutorialAllowed(fresh) {
    const F = G.flags;
    if (G.tierId !== 't1_litter' || simMode || F.tutorial === '0' || !(A.Tutorial && A.Tutorial.start)) return false;
    if (F.tutorial === '1') return true;
    return !!fresh && !F.autoplay && !F.headless && lsGet('apex.tutorial') !== 'done';
  }

  function maybeStartTutorial(fresh) {
    if (tutorialAllowed(fresh)) mod('Tutorial', 'start', G);
  }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (err) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (err) { /* storage unavailable */ } }

  A.openEditor = function (opts) {
    setMode('editor');
    A.emit('editorOpen');
    if (G.flags.skipEditor || !(A.Editor && A.Editor.open)) { A.closeEditor(); return; }
    try { A.Editor.open(G, opts || {}); } catch (err) { report('Editor.open', err); A.closeEditor(); }
  };

  A.closeEditor = function () {
    if (G.mode !== 'editor') return;
    A.emit('editorDone');
    if (G.pending) beginPending();
    else setMode(G.prevMode && G.prevMode !== 'editor' ? G.prevMode : 'play');
  };

  // Builds the tier world and the player. Returns the player.
  function startTier(tierId, sp, opts) {
    const tier = tiersOf()[tierId];
    if (!tier) { report('startTier', 'unknown tier ' + tierId); return null; }
    if (!sp) sp = playersOf(tier)[0] || 'ant';
    if (G.tutorial && G.tutorial.active) mod('Tutorial', 'stop', G);   // a new tier or restart ends any running tutorial
    G.tierId = tierId; G.tier = tier; G.tierTime = 0; G.zones = [];
    G.world = tier.world || cf('WORLD');
    G.path = !tier.path || tier.path === 'shared' ? null : tier.path;
    G.entities.length = 0;
    needCompact = false;
    G.eco = newEco();
    G.final = false; G.finalHold = 0; G.combo = 0; G.comboT = 0; G.choices = []; G.deathInfo = null;
    buildGrid();
    const p = spawnPlayer(sp, opts && opts.growth);
    G.player = p;
    mod('World', 'build', tier);
    snapCamera();   // Eco places the opening hunters just outside this view
    mod('Eco', 'initTier', G);
    buildGrid();
    snapCamera();
    A.emit('tierStart', { tierId, sp });
    return p;
  }
  A.startTier = startTier;

  function spawnPlayer(sp, growth) {
    const ro = { sp, role: 'player', beh: 'player', r: cf('PLAYER_BASE_R'), n0: 0, speed: cf('PLAYER_SPEED') };
    const w = G.world;
    const p = A.spawn(sp, ro, w / 2, w / 2, { isPlayer: true, angle: 0 });
    p.stats = A.playerStats(G.creature, sp);
    p.pal = G.creature.pal || null;
    p.parts = effectiveLevels(G.creature, sp);
    p.growth = clamp(growth || 0, 0, 1);
    p.growthStep = Math.floor(p.growth / 0.05);
    p.energy = cf('ENERGY_MAX');
    p.dna = G.dna;
    p.armor = p.stats.armorMax; p.armorT = 0;
    p.dashT = 0; p.dashCdT = 0; p.dashDX = 1; p.dashDY = 0;
    p.invulnT = cf('GRACE'); p.poisonT = 0; p.starveT = 0; p.starveEmitT = 0; p.grazeCd = 0;
    p.alt = G.tier.habitat === 'air' ? cf('AIR_ALT') : 0;
    p.r = playerRadius(p);
    p.mass = p.r * p.r / 16;
    p.maxHp = p.hp = cf('HP_PER_MASS') * p.mass;
    p.biteCdT = 0; p.snapT = 0; p.sinceHurt = 99; p.stunT = 0; p.slowT = 0; p.slowMul = 1;
    const ab = (A.SPECIES && A.SPECIES[sp] && A.SPECIES[sp].ability) || null;
    p.ability = { id: ab ? ab.id : null, cd: ab ? ab.cd : 1, cdT: 0, activeT: 0 };
    return p;
  }

  function playerRadius(p) {
    const maxScale = (G.tier && G.tier.maxScale) || 1.7;
    return cf('PLAYER_BASE_R') * (1 + (maxScale - 1) * clamp(p.growth, 0, 1));
  }

  // ---------- player death, rebirth, evolve, victory ----------
  function killPlayer(p, cause, killer) {
    if (G.mode === 'title' || G.mode === 'dying') return;
    p.alive = false;
    needCompact = true;
    G.deaths++;
    if (G.deathTier !== G.tierId) { G.deathTier = G.tierId; G.tierDeaths = 0; }
    G.tierDeaths++;
    if (killer) { killer.lastAte = G.time; killer.biteT = 0.25; killer.hungerT = 0; }
    G.deathInfo = {
      cause, killerSp: killer ? killer.sp : null, x: p.x, y: p.y, sp: p.sp, r: p.r,
      pal: G.creature.pal, parts: p.parts, habitat: (G.tier && G.tier.habitat) || 'land', angle: p.angle,
    };
    G.lineage.push({ sp: p.sp, tierId: G.tierId, pal: G.creature.pal, parts: p.parts, outcome: 'died' });
    setMode('dying');
    A.emit('playerDeath', { cause, killer: killer || null });
    mod('Eco', 'onDeath', p, cause);
  }

  function finishDecompose() {
    A.emit('decomposeDone');
    G.choices = rebirthChoices();
    setMode('rebirthChoice');
  }

  function skipDecompose() {
    if (G.mode === 'dying' && G.transT >= cf('DECOMPOSE_SKIP')) finishDecompose();
  }

  function onFullGrowth(p) {
    p.growth = 1;
    const next = G.tier.next;
    if (G.tier.final || !next || !next.length) {
      if (!G.final) { G.final = true; A.emit('finalStart'); }
      return;
    }
    G.choices = A.nextChoices(G.tierId);
    if (!G.choices.length) { G.final = true; A.emit('finalStart'); return; }
    setMode('evolveChoice');
    A.emit('evolveReady', { choices: G.choices });
  }

  function checkProgress(p, dt) {
    if (p.growth >= 1 && !G.final) onFullGrowth(p);
    if (G.final && G.mode === 'play') {
      if (G.eco.harmony >= cf('FINAL_HARMONY')) G.finalHold += dt;
      if (G.finalHold >= cf('FINAL_HOLD')) victory();
    }
  }

  function victory() {
    if (G.mode === 'victory') return;
    setMode('victory');
    saveBest();
    A.emit('victory', { path: G.path });
  }

  function saveBest() {
    try {
      const raw = localStorage.getItem('apex.best');
      const all = raw ? JSON.parse(raw) : {};
      const key = G.path || 'shared';
      const s = G.stats;
      const rec = {
        time: Math.round(G.time * 10) / 10, score: Math.round(G.score), deaths: G.deaths,
        harmony: s.harmonyN ? Math.round(s.harmonySum / s.harmonyN) : 0, name: G.creature.name || '',
      };
      if (!all[key] || rec.time < all[key].time) all[key] = rec;
      localStorage.setItem('apex.best', JSON.stringify(all));
    } catch (err) { /* storage unavailable: skip */ }
  }

  A.choose = function (sp) {
    const mode = G.mode;
    if (mode !== 'evolveChoice' && mode !== 'rebirthChoice') return;
    const c = G.choices.find((x) => x.sp === sp);
    if (!c) return;
    const p = G.player;
    if (mode === 'evolveChoice') {
      G.lineage.push({ sp: p.sp, tierId: G.tierId, pal: G.creature.pal, parts: p.parts, outcome: 'evolved' });
      if (c.path && c.path !== 'shared') G.path = c.path;
      G.deathTier = null; G.tierDeaths = 0;   // a new tier: its first death is forgiven again
      G.pending = { tierId: c.tierId, sp: c.sp, growth: 0 };
      const from = G.tierId;
      setMode('evolving');
      A.emit('evolve', { from, to: c.tierId, path: G.path });
    } else {
      const tid = c.tierId || A.lowerTier(G.tierId);
      startTier(tid, sp, { growth: c.growth != null ? c.growth : cf('RESPAWN_GROWTH') });
      setMode('intro');
      A.emit('rebirth', { sp, tierId: tid });
    }
  };

  function finishEvolve() {
    G.dna += cf('EVOLVE_DNA');
    const pd = G.pending || {};
    A.openEditor({ sp: pd.sp, tierId: pd.tierId, firstTime: false });
  }

  function autoPick() {
    const list = G.choices;
    if (!list.length) return;
    const want = G.flags.path;
    let c = null;
    if (G.mode === 'evolveChoice' && want) c = list.find((x) => x.path === want) || null;
    A.choose((c || A.pick(list)).sp);
  }

  // ---------- input ----------
  const keys = {};
  const pointer = { id: null };

  function isTyping(t) {
    if (!t || !t.tagName) return false;
    const n = t.tagName;
    return n === 'INPUT' || n === 'TEXTAREA' || n === 'SELECT' || !!t.isContentEditable;
  }

  function isUiTarget(t) {
    return !!(t && t.closest && t.closest('button, a, input, textarea, select, label, [role="button"], .card, [data-ui]'));
  }

  function updateDirKeys() {
    const I = A.input;
    I.dirX = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    I.dirY = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  }

  const KEY_DIR = {
    ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down',
  };

  function unlockAudio() { mod('Audio', 'unlock'); }

  function onKeyDown(ev) {
    if (isTyping(ev.target)) return;
    unlockAudio();
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    const onButton = ev.target && ev.target.tagName === 'BUTTON';
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (KEY_DIR[k]) { keys[KEY_DIR[k]] = true; updateDirKeys(); ev.preventDefault(); return; }
    if (k === 'r') {   // in play, hold R (it sits beside E, the ability key); elsewhere it restarts at once
      if (ev.repeat) return;
      if (G.mode === 'play' || G.mode === 'intro') { G.restartHold = 0.001; return; }
      A.restart(); return;
    }
    if (k === 'Escape' || k === 'p') { if (!ev.repeat) A.togglePause(); return; }
    if (k === 'm') { if (!ev.repeat) mod('Audio', 'toggleMute'); return; }
    if (G.mode === 'dying') { skipDecompose(); return; }
    // Controls: Space bite, Shift dash, E / Q ability, Tab (hold) ecosystem view.
    if (k === ' ') {
      // While playing, a button left focused by the UI must not swallow the bite key.
      const playing = G.mode === 'play' || G.mode === 'intro';
      if (!onButton || playing) {
        if (onButton && ev.target.blur) ev.target.blur();
        ev.preventDefault();
        if (!ev.repeat) A.input.biteQueued = true;
      }
      return;
    }
    if (k === 'Shift') { if (!ev.repeat) A.input.dashQueued = true; return; }
    if (k === 'e' || k === 'q') { if (!ev.repeat) A.input.abilityQueued = true; return; }
    if (k === 'Tab') {
      if (G.mode === 'play' || G.mode === 'intro') { ev.preventDefault(); A.input.ecoView = true; }
      return;
    }
    if (k >= '1' && k <= '9' && (G.mode === 'evolveChoice' || G.mode === 'rebirthChoice')) {
      const c = G.choices[+k - 1];
      if (c) A.choose(c.sp);
    }
  }

  function onKeyUp(ev) {
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    if (KEY_DIR[k]) { keys[KEY_DIR[k]] = false; updateDirKeys(); }
    if (k === 'Tab') A.input.ecoView = false;
    if (k === 'r') G.restartHold = 0;
  }

  function setPointer(ev) {
    const I = A.input;
    I.x = ev.clientX; I.y = ev.clientY;
    I.active = true;
  }

  function onPointerDown(ev) {
    unlockAudio();
    if (isUiTarget(ev.target)) return;
    const I = A.input;
    I.touch = ev.pointerType === 'touch';
    setPointer(ev);
    if (G.mode === 'dying') { skipDecompose(); return; }
    if (I.touch) {
      if (pointer.id === null) { pointer.id = ev.pointerId; I.pointerDown = true; }
    } else if (ev.button === 0) {          // mouse or pen contact: left click bites
      I.pointerDown = true;
      I.biteQueued = true;
    } else if (ev.button === 2) {          // right click dashes
      I.dashQueued = true;
    }
  }

  function onPointerMove(ev) {
    const I = A.input;
    if (ev.pointerType === 'touch') {
      if (ev.pointerId !== pointer.id) return;
      I.touch = true;
    } else {
      I.touch = false;
    }
    setPointer(ev);
  }

  function onPointerUp(ev) {
    const I = A.input;
    if (ev.pointerType === 'touch') {
      if (ev.pointerId === pointer.id) { pointer.id = null; I.pointerDown = false; }
    } else if (ev.button === 0) {
      I.pointerDown = false;
    }
  }

  function onBlur() {
    for (const k in keys) keys[k] = false;
    updateDirKeys();
    A.input.ecoView = false;
    if (G.mode === 'play' && !G.flags.autoplay && !G.flags.headless) A.togglePause();
  }

  function bindInput() {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('blur', onBlur);
    // Right click is dash, so the browser menu must never open over the game.
    if (A.canvas && A.canvas.addEventListener) A.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('contextmenu', (e) => { if (G.mode === 'play' && !isUiTarget(e.target)) e.preventDefault(); });
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => { if (document.hidden) onBlur(); });
    }
  }

  // ---------- camera ----------
  // Portrait screens see a narrow slice, so widen the view there to keep a few creatures in sight.
  function viewHeight(p) {
    const aspect = A.W > 0 && A.H > 0 ? A.W / A.H : 1.6;
    const portrait = 1 + clamp(0.8 - aspect, 0, 0.5) * 1.1;
    return cf('VIEW_R_MULT') * (12 + (p.r - 12) * 0.55) * (p.stats ? p.stats.visionMul : 1) * portrait;
  }

  A.worldToScreen = function (x, y) {
    const c = G.cam;
    return { x: (x - c.x) * c.zoom + A.W / 2 + c.shakeX, y: (y - c.y) * c.zoom + A.H / 2 + c.shakeY };
  };
  A.screenToWorld = function (sx, sy) {
    const c = G.cam;
    return { x: (sx - A.W / 2 - c.shakeX) / c.zoom + c.x, y: (sy - A.H / 2 - c.shakeY) / c.zoom + c.y };
  };

  A.applyCam = function (ctx, cam) {
    const D = A.DPR, z = cam.zoom;
    ctx.setTransform(D * z, 0, 0, D * z, D * (A.W / 2 - cam.x * z + cam.shakeX), D * (A.H / 2 - cam.y * z + cam.shakeY));
  };

  function snapCamera() {
    const p = G.player, c = G.cam;
    if (!p) return;
    c.x = p.x; c.y = p.y;
    c.vh = viewHeight(p);
    c.dashZ = 1;
    c.zoom = A.H / c.vh;
  }

  function updateCamera(dt) {
    const p = G.player, c = G.cam;
    if (!p || !G.tier) return;
    let tx = p.x, ty = p.y;
    if (G.mode === 'dying' && G.deathInfo) {
      tx = G.deathInfo.x; ty = G.deathInfo.y;
    } else if (p.alive) {
      tx += p.vx * 0.15; ty += p.vy * 0.15;
    }
    const kp = 1 - Math.exp(-dt * 9);
    c.x += (tx - c.x) * kp;
    c.y += (ty - c.y) * kp;
    c.x = clamp(c.x, 0, G.world); c.y = clamp(c.y, 0, G.world);
    const target = viewHeight(p);
    c.vh += (target - c.vh) * (1 - Math.exp(-dt * 4));
    c.dashZ += ((p.dashT > 0 ? 1.05 : 1) - c.dashZ) * (1 - Math.exp(-dt * 6));
    let evo = 1;
    if (G.mode === 'evolving') evo = 1 + 2 * easeInOut(clamp(G.transT / cf('EVOLVE_TIME'), 0, 1));
    c.zoom = A.H / (c.vh * c.dashZ * evo);
    // screen shake (decays ~6/s)
    c.shake *= Math.exp(-6 * dt);
    if (c.shake < 0.05) c.shake = 0;
    c.shakeX = c.shake ? (Math.random() * 2 - 1) * c.shake : 0;
    c.shakeY = c.shake ? (Math.random() * 2 - 1) * c.shake : 0;
  }

  // ---------- player control ----------
  const steer = { dx: 0, dy: 0, mag: 0, dash: false, bite: false, ability: false, aim: false, ax: 0, ay: 0 };
  const botFallbackOut = { dx: 0, dy: 0, dash: false };

  // Minimal stand-in used only when ai.js is missing.
  function fallbackBot(p) {
    const n = gather(p.x, p.y, 420);
    let prey = null, pd = 1e12, threat = null, td = 1e12;
    for (let i = 0; i < n; i++) {
      const o = near[i];
      if (o === p) continue;
      const d = (o.x - p.x) * (o.x - p.x) + (o.y - p.y) * (o.y - p.y);
      if (o.role === 'hunter' && o.r * cf('EAT_RATIO') > p.r) { if (d < td) { td = d; threat = o; } }
      else if (o.role !== 'producer' && canEat(p, o) && d < pd) { pd = d; prey = o; }
    }
    const out = botFallbackOut;
    out.dash = false; out.dx = 0; out.dy = 0;
    if (threat && td < Math.pow(p.r * 7, 2)) {
      out.dx = p.x - threat.x; out.dy = p.y - threat.y; out.dash = td < Math.pow(p.r * 4, 2);
    } else if (prey) {
      out.dx = prey.x - p.x; out.dy = prey.y - p.y;
    }
    return out;
  }

  function botSteer(p, dt) {
    let b = null;
    if (A.AI && A.AI.bot) { try { b = A.AI.bot(G, dt); } catch (err) { report('AI.bot', err); } }
    if (!b) b = fallbackBot(p);
    const len = Math.sqrt(b.dx * b.dx + b.dy * b.dy);
    if (len > 0.01) { steer.dx = b.dx / len; steer.dy = b.dy / len; steer.mag = 1; }
    if (b.dash) steer.dash = true;
    if (b.bite) steer.bite = true;
    if (b.ability) steer.ability = true;
    if (isFinite(b.ax) && isFinite(b.ay) && (b.bite || b.ability)) { steer.aim = true; steer.ax = b.ax; steer.ay = b.ay; }
  }

  function readSteer(p, dt) {
    const I = A.input;
    steer.dx = 0; steer.dy = 0; steer.mag = 0; steer.dash = false;
    steer.bite = false; steer.ability = false; steer.aim = false;
    const human = G.mode !== 'title' && !G.flags.autoplay;
    if (!human) {
      botSteer(p, dt);
    } else if (I.dirX || I.dirY) {
      const l = Math.sqrt(I.dirX * I.dirX + I.dirY * I.dirY);
      steer.dx = I.dirX / l; steer.dy = I.dirY / l; steer.mag = 1;
    } else if (I.touch ? I.pointerDown : I.active) {
      steerToPointer(p);
    }
    if (I.dashQueued) { if (human) steer.dash = true; I.dashQueued = false; }
    if (I.biteQueued) { if (human) steer.bite = true; I.biteQueued = false; }
    if (I.abilityQueued) {
      if (human) {
        steer.ability = true;
        if (I.active && !I.touch) {   // web throw aims at the pointer
          steer.aim = true;
          steer.ax = (I.x - A.W / 2) / G.cam.zoom + G.cam.x; steer.ay = (I.y - A.H / 2) / G.cam.zoom + G.cam.y;
        }
      }
      I.abilityQueued = false;
    }
  }

  function steerToPointer(p) {
    const I = A.input, c = G.cam;
    // World position recomputed from the screen position because the camera moves (shake excluded).
    I.wx = (I.x - A.W / 2) / c.zoom + c.x;
    I.wy = (I.y - A.H / 2) / c.zoom + c.y;
    let dx = I.wx - p.x, dy = I.wy - p.y;
    let d = Math.sqrt(dx * dx + dy * dy);
    if (I.touch) {
      // Touch: direction from the player's screen position to the finger.
      dx = I.x - ((p.x - c.x) * c.zoom + A.W / 2);
      dy = I.y - ((p.y - c.y) * c.zoom + A.H / 2);
      d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1) return;
      steer.mag = clamp(d / 36, 0, 1);
    } else {
      if (d < 0.5) return;
      steer.mag = d < p.r ? d / p.r : 1;
    }
    steer.dx = dx / d; steer.dy = dy / d;
  }

  function tryDash(p) {
    if (p.dashCdT > 0 || p.dashT > 0 || p.energy <= 0) return;
    const st = p.stats;
    let dx = steer.dx, dy = steer.dy;
    if (steer.mag < 0.05) { dx = Math.cos(p.angle); dy = Math.sin(p.angle); }
    p.dashDX = dx; p.dashDY = dy;
    p.dashT = cf('DASH_TIME') * st.dashDistMul;
    p.dashCdT = cf('DASH_CD') * st.dashCdMul;
    p.energy = Math.max(0, p.energy - cf('DASH_COST'));
    A.emit('dash', { e: p });
  }

  const botControlled = () => G.mode === 'title' || !!G.flags.autoplay;

  function controlPlayer(p, dt) {
    const st = p.stats, mode = G.mode, ab = p.ability;
    readSteer(p, dt);
    const stunned = p.stunT > 0;
    if (stunned) { steer.mag = 0; steer.dash = steer.bite = steer.ability = false; }
    const acting = mode === 'play' || mode === 'intro' || mode === 'title';
    if (acting && steer.dash) tryDash(p);
    if (acting && steer.bite) tryBite(p);
    if (acting && steer.ability) tryAbility(p);
    const rolling = ab.id === 'roll' && ab.activeT > 0, charging = ab.id === 'charge' && ab.activeT > 0;
    const def = abilityDef(p);
    let mul = (p.poisonT > 0 ? 0.75 : 1) * (p.slowT > 0 ? p.slowMul : 1);
    if (rolling) mul *= def.speedMul;
    else if (ab.id === 'tail' && ab.activeT > 0) mul *= def.speedMul;
    const maxSp = cf('PLAYER_SPEED') * st.speedMul * (1 + 0.25 * p.growth) * mul;
    let tvx, tvy, k, faceDX = steer.dx, faceDY = steer.dy, facing = steer.mag > 0.05;
    if (charging) {
      tvx = p.chargeDX * maxSp * def.speedMul; tvy = p.chargeDY * maxSp * def.speedMul;
      k = 1 - Math.exp(-dt / 0.012);
      faceDX = p.chargeDX; faceDY = p.chargeDY; facing = true;
      chargeContacts(p, def);
    } else if (p.dashT > 0) {
      p.dashT -= dt;
      tvx = p.dashDX * maxSp * cf('DASH_MULT'); tvy = p.dashDY * maxSp * cf('DASH_MULT');
      k = 1 - Math.exp(-dt / 0.012);
      faceDX = p.dashDX; faceDY = p.dashDY; facing = true;
    } else if (p.snapT > 0) {
      // the bite snap: a short forward lunge at BITE_SNAP_MUL x speed
      p.snapT -= dt;
      tvx = Math.cos(p.angle) * maxSp * cf('BITE_SNAP_MUL'); tvy = Math.sin(p.angle) * maxSp * cf('BITE_SNAP_MUL');
      k = 1 - Math.exp(-dt / 0.02);
      facing = false;
    } else {
      tvx = steer.dx * maxSp * steer.mag; tvy = steer.dy * maxSp * steer.mag;
      k = 1 - Math.exp(-dt / 0.04);
    }
    p.vx += (tvx - p.vx) * k;
    p.vy += (tvy - p.vy) * k;
    if (!facing && p.snapT <= 0 && p.vx * p.vx + p.vy * p.vy > 225) { faceDX = p.vx; faceDY = p.vy; facing = true; }
    if (facing) p.angle += wrapAngle(Math.atan2(faceDY, faceDX) - p.angle) * Math.min(1, dt * 14);
    p.state = p.dashT > 0 ? 'dash' : (steer.mag > 0.05 ? 'move' : 'idle');
    updatePlayerVitals(p, dt, mode);
    // radius follows growth with a quick ease so eating feels like a swell
    const rt = playerRadius(p);
    p.r += (rt - p.r) * Math.min(1, dt * 8);
    p.mass = p.r * p.r / 16;
    // health scales with body mass; the damaged fraction is kept
    const mh = cf('HP_PER_MASS') * p.mass;
    if (p.maxHp > 0 && Math.abs(mh - p.maxHp) > 1e-6) { p.hp *= mh / p.maxHp; p.maxHp = mh; }
    p.dna = G.dna;
  }

  function updatePlayerVitals(p, dt, mode) {
    const st = p.stats;
    p.dashCdT = Math.max(0, p.dashCdT - dt);
    p.biteCdT = Math.max(0, p.biteCdT - dt);
    p.ability.cdT = Math.max(0, p.ability.cdT - dt);
    p.ability.activeT = Math.max(0, p.ability.activeT - dt);
    p.invulnT = Math.max(0, p.invulnT - dt);
    if (p.ability.id === 'roll' && p.ability.activeT > 0) p.invulnT = Math.max(p.invulnT, 0.08);   // rolled up: untouchable
    p.poisonT = Math.max(0, p.poisonT - dt);
    p.grazeCd = Math.max(0, p.grazeCd - dt);
    if (G.comboT > 0) { G.comboT -= dt; if (G.comboT <= 0) G.combo = 0; }
    if (p.armor < st.armorMax && st.armorRecharge > 0) {
      p.armorT += dt;
      if (p.armorT >= st.armorRecharge) { p.armor++; p.armorT = 0; }
    }
    if (mode === 'title') { p.energy = cf('ENERGY_MAX'); return; }
    if (mode !== 'play' && mode !== 'intro') return;
    const flags = G.eco.flags || {};
    const drain = ((G.tier && G.tier.drain) || 1.4) * st.drainMul * (flags.famine ? 1.4 : 1) * (p.poisonT > 0 ? 3 : 1);
    if (mode === 'play') {
      p.energy = Math.max(0, p.energy - drain * dt);
      if (p.sinceHurt >= cf('REGEN_DELAY') && p.hp < p.maxHp && p.energy > cf('ENERGY_MAX') * cf('REGEN_ENERGY')) {
        p.hp = Math.min(p.maxHp, p.hp + cf('REGEN') * p.maxHp * dt);
      }
    }
    if (p.energy <= 0 && mode === 'play') {
      p.starveT += dt;
      if (p.starveT >= cf('STARVE_GRACE')) { A.kill(p, 'starved'); return; }
    } else {
      p.starveT = 0;
    }
    p.starveEmitT -= dt;
    if (p.energy < cf('ENERGY_MAX') * 0.2 && p.starveEmitT <= 0) { p.starveEmitT = 3; A.emit('starving'); }
  }

  // ---------- AI, integration ----------
  function runAI(dt) {
    if (!A.AI || !A.AI.update) return;
    const list = G.entities;
    for (let i = 0, n = list.length; i < n; i++) {
      const e = list[i];
      if (e.isPlayer || !e.alive) continue;
      try { A.AI.update(e, dt, G); } catch (err) { report('AI.update', err); }
    }
  }

  function integrate(dt) {
    const list = G.entities, world = G.world;
    const decay = Math.exp(-8 * dt);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      e.age += dt; e.stateT += dt;
      if (e.biteT > 0) e.biteT = Math.max(0, e.biteT - dt);
      if (e.hurtT > 0) e.hurtT = Math.max(0, e.hurtT - dt);
      if (e.maxHp > 0) {
        if (e.stunT > 0) e.stunT = Math.max(0, e.stunT - dt);
        if (e.flinchT > 0) e.flinchT = Math.max(0, e.flinchT - dt);
        if (e.angryT > 0) e.angryT = Math.max(0, e.angryT - dt);
        if (e.nipCd > 0) e.nipCd = Math.max(0, e.nipCd - dt);
        if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) { e.slowT = 0; e.slowMul = 1; } }
        if (e.dmgAcc > 0) { e.dmgAccT -= dt; if (e.dmgAccT <= 0) e.dmgAcc = 0; }
        e.sinceHurt += dt;
        if (!e.isPlayer && e.hp < e.maxHp && e.sinceHurt > cf('NPC_REGEN_DELAY')) {
          e.hp = Math.min(e.maxHp, e.hp + cf('NPC_REGEN') * e.maxHp * dt);
        }
      } else if (e.sp === 'carcass') {
        if (e.age > cf('CARCASS_TIME')) { A.kill(e, 'decayed'); continue; }
      }
      if (e.lifeT !== undefined) {          // short-lived entities (the skink's tail decoy)
        e.lifeT -= dt;
        e.phase += dt * 16;
        if (e.lifeT <= 0) { A.kill(e, 'decayed'); continue; }
      }
      let vx = e.vx, vy = e.vy;
      if (e.kx || e.ky) {
        vx += e.kx; vy += e.ky;
        e.kx *= decay; e.ky *= decay;
        if (Math.abs(e.kx) < 1 && Math.abs(e.ky) < 1) { e.kx = 0; e.ky = 0; }
      }
      if (vx || vy) {
        e.x += vx * dt; e.y += vy * dt;
        e.phase += Math.sqrt(e.vx * e.vx + e.vy * e.vy) * dt / e.r;
        const lim = world - e.r;
        if (e.x < e.r) e.x = e.r; else if (e.x > lim) e.x = lim;
        if (e.y < e.r) e.y = e.r; else if (e.y > lim) e.y = lim;
      }
    }
  }

  // ---------- collisions and eating ----------
  function knock(e, from, power) {
    let dx = e.x - from.x, dy = e.y - from.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    e.kx += dx / d * power; e.ky += dy / d * power;
  }

  // Difficulty: Easy / Normal / Scary (CFG.DIFFICULTY), chosen on the title screen and remembered.
  A.difficulty = function () {
    const t = cf('DIFFICULTY') || {};
    return t[G.difficulty] || t.normal || { growth: 1, playerDmg: 1, enemyDmg: 1 };
  };
  A.setDifficulty = function (d) {
    if (!(cf('DIFFICULTY') || {})[d]) return;
    G.difficulty = d;
    lsSet('apex.difficulty', d);
  };

  function growthGain(p, amount) {
    amount *= A.difficulty().growth;
    p.growth = Math.min(1, p.growth + amount);
    const step = Math.floor(p.growth / 0.05);
    if (step > p.growthStep) { p.growthStep = step; A.emit('growth', { growth: p.growth }); }
  }

  function playerEats(p, food) {
    const mass = food.mass, st = p.stats;
    const hm = (A.Eco && A.Eco.harmonyMult && A.Eco.harmonyMult()) || 1;
    const points = mass * 10 * (1 + G.combo * 0.1) * hm;
    const dna = mass * cf('DNA_PER_MASS') * st.dnaMul;
    G.score += points;
    G.dna += dna;
    p.energy = Math.min(cf('ENERGY_MAX'), p.energy + Math.min(30, mass * 2.5 + 3));
    const share = food.sp === 'carcass' ? cf('CARCASS_GROWTH') : 1;   // a kill feeds you, but slower than its size
    growthGain(p, mass * share / G.tier.growthNeeded);
    G.combo++; G.comboT = cf('COMBO_WINDOW');
    const s = G.stats;
    const kind = food.fromSp || food.sp;   // a carcass counts as the animal it came from
    s.eaten++; s.bySp[kind] = (s.bySp[kind] || 0) + 1;
    if (G.combo > s.maxCombo) s.maxCombo = G.combo;
    p.biteT = 0.25;
    if (food.mass > p.mass * 0.5) G.hitstopT = 0.04;
    if (food.sick) { p.poisonT = cf('POISON_TIME'); A.emit('poisoned'); }
    A.emit('playerEat', { food, points, dna, combo: G.combo });
    A.emit('eat', { eater: p, food });
    mod('Eco', 'onEat', p, food);
    A.kill(food, 'eaten', p);
  }

  // Omnivore bite from a producer: it is not killed, just thinned out.
  function playerGrazes(p, producer) {
    if (p.grazeCd > 0 || producer.amount < 0.25) return;
    p.grazeCd = 0.5;
    p.energy = Math.min(cf('ENERGY_MAX'), p.energy + 8);
    growthGain(p, 0.3 * producer.mass / G.tier.growthNeeded);
    producer.amount = Math.max(0, producer.amount - 0.5);
    p.biteT = 0.25;
    A.emit('graze', { e: p, producer });
  }

  // ---------- combat: health, bites, predator hits, carcasses, abilities ----------
  const hitBuf = [];
  const angDiff = (a, b) => Math.abs(wrapAngle(a - b));
  const isAnimal = (o) => o.role !== 'producer' && o.sp !== 'decoy' && o.maxHp > 0;
  const abilityDef = (p) => (A.SPECIES && A.SPECIES[p.sp] && A.SPECIES[p.sp].ability) || {};

  function biteDamage(p) {
    const jaws = (p.parts && p.parts.jaws) || 0;
    return cf('BITE_DMG') * Math.sqrt(p.mass) * (1 + cf('BITE_JAWS_BONUS') * jaws) * (p.isPlayer ? A.difficulty().playerDmg : 1);
  }

  // Neutral: an animal that is neither food for the player nor able to eat the player.
  function isNeutral(p, o) {
    if (!isAnimal(o) || canEat(p, o)) return false;
    return !(o.role === 'hunter' && o.r * cf('EAT_RATIO') > p.r);   // by size, so a hunter is no neutral while the player is briefly invulnerable
  }

  function makeAngry(e) {
    if (e.isPlayer || !isAnimal(e) || e.alt > 0.5) return;
    const fresh = e.angryT <= 0;
    e.angryT = cf('ANGRY_TIME');
    if (fresh) A.emit('angry', { e });
  }

  function spawnCarcass(e) {
    if (e.sp === 'decoy' || G.entities.length >= cf('MAX_ENTITIES', 230) + 30) return null;
    const ro = { sp: 'carcass', role: 'producer', beh: 'static', r: Math.max(3, e.r * 0.8), n0: 0, speed: 0 };
    const c = A.spawn('carcass', ro, e.x, e.y, { amount: e.mass, mass: e.mass, fromSp: e.sp, fromR: e.r, src: e, angle: e.angle, alt: 0 });
    // the dead body is drawn, muted and still, as the carcass
    e.state = 'idle'; e.biteT = 0; e.hurtT = 0; e.vx = e.vy = 0; e.kx = e.ky = 0; e.alt = 0;
    A.emit('carcass', { e: c });
    return c;
  }

  // Damages any animal (or the player). Returns the damage dealt.
  function damageEntity(e, amount, by, opts) {
    if (!e || !e.alive || !(amount > 0)) return 0;
    if (e.isPlayer) return hurtPlayer(e, amount, by, opts);
    if (!(e.maxHp > 0)) return 0;
    e.hp -= amount; e.hurtT = 0.3; e.sinceHurt = 0; e.hurtBy = by || null;
    e.dmgAcc += amount; e.dmgAccT = cf('FLINCH_WINDOW');
    if (e.hp > 0 && e.flinchT <= 0 && e.dmgAcc >= cf('FLINCH_FRAC') * e.maxHp) {
      e.flinchT = cf('FLINCH_TIME'); e.stunT = Math.max(e.stunT, cf('FLINCH_TIME')); e.dmgAcc = 0;
      A.emit('flinch', { e });
    }
    A.emit('damage', { target: e, amount, by: by || null });
    if (e.hp <= 0) {
      e.hp = 0;
      A.kill(e, 'killed', by);
      spawnCarcass(e);
    }
    return amount;
  }
  A.damageEntity = damageEntity;

  function tutorialDmgMul() {
    const t = G.tutorial;
    return t && t.active && t.dmgMul != null ? t.dmgMul : 1;
  }

  // kind: 'lunge' (hunter attack, armor can absorb it), 'nip' (angry neutral)
  function hurtPlayer(p, amount, by, opts) {
    if (!p.alive || p.invulnT > 0 || G.final) return 0;
    const kind = (opts && opts.kind) || 'lunge';
    amount *= tutorialDmgMul();
    if (by) by.biteT = 0.25;
    if (kind === 'lunge' && p.armor > 0 && amount > 0) {      // spikes absorb one hit, as before
      p.armor--; p.armorT = 0; p.invulnT = 1; p.hurtT = 0.4;
      if (by) { knock(p, by, 380); knock(by, p, 200); }
      A.emit('playerHit', { by: by || null });
      return 0;
    }
    p.invulnT = kind === 'nip' ? cf('NIP_INVULN') : cf('PRED_INVULN');
    p.hurtT = 0.4; p.sinceHurt = 0;
    if (by) { knock(p, by, kind === 'nip' ? 140 : 300); if (kind !== 'nip') knock(by, p, 150); }
    G.cam.shake = Math.max(G.cam.shake, kind === 'nip' ? 3 : 7);
    if (kind !== 'nip') G.hitstopT = Math.max(G.hitstopT, 0.05);
    if (amount > 0) { p.hp -= amount; A.emit('damage', { target: p, amount, by: by || null }); }
    A.emit('playerHit', { by: by || null });
    if (p.hp <= 0) {
      p.hp = 0;
      if (by) A.emit('eat', { eater: by, food: p });
      A.kill(p, 'eaten', by);
    }
    return amount;
  }

  // A hunter's lunge connected.
  function hitPlayer(p, h) {
    h.lungeEnd = true;
    hurtPlayer(p, cf('PRED_DMG') * A.difficulty().enemyDmg * Math.sqrt(h.mass), h, { kind: 'lunge' });
  }

  // The bite: a short snap at the arc in front of the mouth. Anything edible is eaten, the rest is damaged.
  function tryBite(p) {
    if (p.biteCdT > 0 || (p.ability.id === 'roll' && p.ability.activeT > 0)) return false;
    if (steer.aim && botControlled()) p.angle = Math.atan2(steer.ay - p.y, steer.ax - p.x);
    p.biteCdT = cf('BITE_CD'); p.snapT = cf('BITE_SNAP'); p.biteT = 0.22;
    const reach = p.r * cf('BITE_REACH') + 10, arc = cf('BITE_ARC') * Math.PI / 360;
    const dmg = biteDamage(p), fight = cf('FIGHT_RATIO');
    const hits = [];
    hitBuf.length = 0;
    scan(p.x, p.y, reach + maxR + 4, hitBuf);
    for (let i = 0; i < hitBuf.length; i++) {
      const o = hitBuf[i];
      if (o === p || !o.alive || !isAnimal(o) || (o.alt > 0.5) !== (p.alt > 0.5)) continue;
      const dx = o.x - p.x, dy = o.y - p.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d - o.r * 0.7 > reach) continue;
      if (angDiff(Math.atan2(dy, dx), p.angle) > arc + Math.atan2(o.r * 0.8, Math.max(d, 1))) continue;
      hits.push(o);
      if (canEat(p, o)) { playerEats(p, o); continue; }
      const big = o.r > p.r * fight;
      damageEntity(o, dmg * (big ? cf('BIG_DMG_FRAC') : 1), p, { kind: 'bite' });
      if (o.alive) { knock(o, p, big ? 60 : 110); if (isNeutral(p, o)) makeAngry(o); }
      if (big) knock(p, o, 260);       // too big to hurt: you bounce off
    }
    A.emit('bite', { e: p, hits });
    return true;
  }

  // ---- abilities (one per playable species; SPECIES[sp].ability holds the numbers) ----
  const ABILITY = {};

  ABILITY.spray = function (p, def) {
    if (steer.aim && botControlled()) p.angle = Math.atan2(steer.ay - p.y, steer.ax - p.x);
    const range = def.range * p.r, half = def.arc * Math.PI / 360, dmg = biteDamage(p) * def.dmgMul, fight = cf('FIGHT_RATIO');
    const hits = [];
    hitBuf.length = 0;
    scan(p.x, p.y, range + maxR + 4, hitBuf);
    for (let i = 0; i < hitBuf.length; i++) {
      const o = hitBuf[i];
      if (o === p || !o.alive || !isAnimal(o) || (o.alt > 0.5) !== (p.alt > 0.5) || canEat(p, o)) continue;
      const dx = o.x - p.x, dy = o.y - p.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d - o.r * 0.5 > range) continue;
      if (angDiff(Math.atan2(dy, dx), p.angle) > half + Math.atan2(o.r * 0.8, Math.max(d, 1))) continue;
      hits.push(o);
      o.slowT = Math.max(o.slowT, def.slowT); o.slowMul = Math.min(o.slowMul, def.slowMul);
      damageEntity(o, dmg * (o.r > p.r * fight ? cf('BIG_DMG_FRAC') : 1), p, { kind: 'spray' });
      if (o.alive && isNeutral(p, o)) makeAngry(o);
    }
    p.ability.activeT = 0.35;
    return { hits, range, arc: def.arc, angle: p.angle };
  };

  ABILITY.roll = function (p, def) {
    p.ability.activeT = def.dur;
    p.invulnT = Math.max(p.invulnT, def.dur);
    return { dur: def.dur };
  };

  ABILITY.web = function (p, def) {
    let x, y;
    if (steer.aim) { x = steer.ax; y = steer.ay; } else { x = p.x + Math.cos(p.angle) * p.r * 4; y = p.y + Math.sin(p.angle) * p.r * 4; }
    const dx = x - p.x, dy = y - p.y, d = Math.sqrt(dx * dx + dy * dy), lim = def.range * p.r;
    if (d > lim) { x = p.x + dx / d * lim; y = p.y + dy / d * lim; }
    x = clamp(x, 0, G.world); y = clamp(y, 0, G.world);
    const z = { type: 'web', x, y, r: def.r * p.r, t: def.dur, dur: def.dur, slowMul: def.slowMul, by: p };
    G.zones.push(z);
    p.ability.activeT = 0.3;
    return { x, y, r: z.r, zone: z };
  };

  ABILITY.charge = function (p, def) {
    if (steer.aim && botControlled()) p.angle = Math.atan2(steer.ay - p.y, steer.ax - p.x);
    p.chargeDX = Math.cos(p.angle); p.chargeDY = Math.sin(p.angle); p.chargeHit = [];
    p.ability.activeT = def.dur;
    return { dur: def.dur, angle: p.angle };
  };

  // Ram contact (each step while charging): stun and damage whatever the horns meet.
  function chargeContacts(p, def) {
    hitBuf.length = 0;
    scan(p.x, p.y, p.r + maxR + 4, hitBuf);
    for (let i = 0; i < hitBuf.length; i++) {
      const o = hitBuf[i];
      if (o === p || !o.alive || !isAnimal(o) || (o.alt > 0.5) !== (p.alt > 0.5) || p.chargeHit.indexOf(o) >= 0) continue;
      const dx = o.x - p.x, dy = o.y - p.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d > (p.r + o.r) * 0.9 + 4 || canEat(p, o)) continue;
      p.chargeHit.push(o);
      o.stunT = Math.max(o.stunT, def.stunT);
      knock(o, p, 380);
      damageEntity(o, biteDamage(p) * def.dmgMul * (o.r > p.r * cf('FIGHT_RATIO') ? cf('BIG_DMG_FRAC') : 1), p, { kind: 'charge' });
      if (o.alive && isNeutral(p, o)) makeAngry(o);
      A.emit('abilityHit', { e: p, id: 'charge', target: o });
    }
  }

  ABILITY.tongue = function (p, def) {
    const range = def.range * p.r;
    let food = null, fd = 1e12, foe = null, ed = 1e12;
    hitBuf.length = 0;
    scan(p.x, p.y, range + maxR + 4, hitBuf);
    for (let i = 0; i < hitBuf.length; i++) {
      const o = hitBuf[i];
      if (o === p || !o.alive || !isAnimal(o) || (o.alt > 0.5) !== (p.alt > 0.5)) continue;
      const dx = o.x - p.x, dy = o.y - p.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d - o.r > range) continue;
      if (canEat(p, o)) { if (d < fd) { fd = d; food = o; } } else if (d < ed) { ed = d; foe = o; }
    }
    if (food) {
      const out = { target: food, x: food.x, y: food.y, eaten: true };
      p.ability.activeT = 0.3;
      playerEats(p, food);
      return out;
    }
    if (foe) {
      foe.stunT = Math.max(foe.stunT, def.stunT);
      p.ability.activeT = 0.3;
      return { target: foe, x: foe.x, y: foe.y, stunned: true };
    }
    return { miss: true };
  };

  ABILITY.tail = function (p, def) {
    const ro = { sp: 'decoy', role: 'grazer', beh: 'decoy', r: p.r * 0.8, n0: 0, speed: 50 };
    const c = A.spawn('decoy', ro, p.x - Math.cos(p.angle) * p.r * 1.6, p.y - Math.sin(p.angle) * p.r * 1.6,
      { lifeT: def.decoyT, fromSp: p.sp, pal: p.pal, angle: p.angle + Math.PI, alt: p.alt });
    p.ability.activeT = def.speedT;
    return { decoy: c, x: c.x, y: c.y };
  };

  function tryAbility(p) {
    const ab = p.ability, def = abilityDef(p), fn = def.id && ABILITY[def.id];
    if (!fn || ab.cdT > 0 || ab.activeT > 0) return false;
    const out = fn(p, def) || {};
    ab.cd = def.cd;
    ab.cdT = out.miss ? (def.missCd || 0.6) : def.cd;
    const payload = Object.assign({ e: p, id: def.id }, out);
    A.emit('abilityUse', payload);
    return true;
  }

  // Ground effects (web discs): slow every animal inside except the caster.
  function updateZones(dt) {
    const zs = G.zones;
    if (!zs.length) return;
    for (let i = zs.length - 1; i >= 0; i--) {
      const z = zs[i];
      z.t -= dt;
      if (z.t <= 0) { zs.splice(i, 1); continue; }
      if (z.type !== 'web') continue;
      const inside = A.query(z.x, z.y, z.r + maxR * 0.5, (o) => !o.isPlayer && isAnimal(o) && o.alt < 0.5);
      for (let j = 0; j < inside.length; j++) {
        const o = inside[j];
        o.slowT = Math.max(o.slowT, 0.25); o.slowMul = Math.min(o.slowMul, z.slowMul);
      }
    }
  }

  function playerContacts(p) {
    const mode = G.mode;
    if (mode !== 'play' && mode !== 'intro' && mode !== 'title') return;
    const n = gather(p.x, p.y, p.r + maxR + 2);
    for (let i = 0; i < n && p.alive; i++) {
      const o = near[i];
      if (o === p || !o.alive) continue;
      const dx = o.x - p.x, dy = o.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (canEat(p, o)) {
        if (d < p.r + o.r * 0.8) { if (o.role === 'producer' && o.sp !== 'carcass') playerGrazes(p, o); else playerEats(p, o); }
        continue;
      }
      if (o.role === 'producer' || (o.alt > 0.5) !== (p.alt > 0.5) || o.sp === 'decoy') continue;
      const touch = (p.r + o.r) * 0.8;
      if (p.ability.id === 'roll' && p.ability.activeT > 0 && d < touch * 1.1 && isAnimal(o) && o.stunT <= 0) {
        const def = abilityDef(p);   // rolled up: whatever bumps you is thrown back
        knock(o, p, def.knock); o.stunT = Math.max(o.stunT, def.stunT);
      }
      if (o.role === 'hunter' && mode === 'play' && d < o.r + p.r * 0.8 && o.stunT <= 0 &&
          (o.state === 'lunge' || o.state === 'dive') && canEat(o, p)) {
        hitPlayer(p, o);   // only a committed lunge or dive hurts; plain contact does not
        continue;
      }
      if (d < touch && d > 0.001) {
        const push = (touch - d) * 0.35 / d;
        p.x -= dx * push; p.y -= dy * push;
        o.x += dx * push; o.y += dy * push;
        // ramming a neutral animal (moving into it at speed) makes it angry; brushing past or being walked into does not
        if (mode === 'play' && o.angryT <= 0 && (p.vx * dx + p.vy * dy) / d > cf('ANGRY_BUMP_SPEED') && isNeutral(p, o)) makeAngry(o);
      }
    }
  }

  function hunterContacts() {
    const list = G.entities, time = G.time, sat = cf('SATIATED_TIME');
    for (let i = 0, len = list.length; i < len; i++) {
      const h = list[i];
      if (h.role !== 'hunter' || !h.alive || h.isPlayer || h.stunT > 0 || time - h.lastAte < sat) continue;
      const n = gather(h.x, h.y, h.r + maxR + 2);
      for (let j = 0; j < n; j++) {
        const o = near[j];
        if (o === h || !o.alive || o.isPlayer || o.role === 'producer' || !canEat(h, o)) continue;
        const dx = o.x - h.x, dy = o.y - h.y;
        if (dx * dx + dy * dy < (h.r + o.r * 0.8) * (h.r + o.r * 0.8)) {
          if (o.sp === 'decoy') {          // snapped up the skink's tail: nothing to eat, and the hunter is confused
            A.kill(o, 'decayed');
            h.biteT = 0.25; h.stunT = Math.max(h.stunT, 0.8);
            break;
          }
          A.kill(o, 'eaten', h);
          h.lastAte = time; h.biteT = 0.25;
          A.emit('eat', { eater: h, food: o });
          mod('Eco', 'onEat', h, o);
          break;
        }
      }
    }
  }

  function threatCheck(p, dt) {
    threatT -= dt;
    if (threatT > 0) return;
    const range = viewHeight(p) * 0.6;
    let best = null, bd = range * range;
    const list = G.entities;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.role !== 'hunter' || !e.alive) continue;
      const d2 = (e.x - p.x) * (e.x - p.x) + (e.y - p.y) * (e.y - p.y);
      if (d2 < bd && (e.target === p || canEat(e, p))) { best = e; bd = d2; }
    }
    if (best) { A.emit('threatNear', { e: best, dist: Math.sqrt(bd) }); threatT = 1; }
  }

  // ---------- simulation step ----------
  function autoplayHooks() {
    if (!G.flags.autoplay) return;
    if (G.mode === 'editor' && G.transT > 0.6) A.closeEditor();
    else if ((G.mode === 'evolveChoice' || G.mode === 'rebirthChoice') && G.transT > 0.6 * G.timeScale) autoPick();
  }

  function modeTimers(p, dt) {
    switch (G.mode) {
      case 'intro': if (G.transT >= cf('INTRO_TIME')) setMode('play'); break;
      case 'play': if (p && p.alive) checkProgress(p, dt); break;
      case 'evolving': if (G.transT >= cf('EVOLVE_TIME')) finishEvolve(); break;
      case 'dying': if (G.transT >= cf('DECOMPOSE_TIME')) finishDecompose(); break;
      default: break;
    }
  }

  function stepWorld(dt) {
    G.time += dt; G.tierTime += dt;
    const p = G.player, alive = !!(p && p.alive);
    if (alive) controlPlayer(p, dt);
    if (alive && G.tutorial.active && (G.mode === 'play' || G.mode === 'intro')) mod('Tutorial', 'update', G, dt);
    runAI(dt);
    integrate(dt);
    updateZones(dt);
    buildGrid();
    if (alive && p.alive) playerContacts(p);
    hunterContacts();
    if (alive && p.alive && G.mode === 'play') {
      threatCheck(p, dt);
      const s = G.stats;
      s.harmonySum += G.eco.harmony; s.harmonyN++;
    }
    mod('Eco', 'tick', G, dt);
    modeTimers(p, dt);
    if (!simMode) mod('FX', 'update', dt);
    compactEntities();
  }

  // One-time contextual tips (after the tutorial): G.tip = {id, text, t (seconds left), dur}.
  const TIP_TEXT = {
    mishap: 'The food web slipped out of balance. Hold Tab to see which species is off.',
    death: 'Hunters hit hard. Dash (Shift) when one flashes, and bite back when it is weakened.',
    evolve: 'Ready to evolve. Pick a new body: bigger prey to eat, bigger hunters to fear.',
    angry: 'That animal is angry. Bumping neutrals makes them mad: bite it back or outrun it.',
  };
  let tipsShown = null;

  function showTip(id) {
    if (simMode || (G.tutorial && G.tutorial.active) || !TIP_TEXT[id]) return;
    if (!tipsShown) { try { tipsShown = JSON.parse(lsGet('apex.tips') || '{}') || {}; } catch (err) { tipsShown = {}; } }
    if (tipsShown[id]) return;
    tipsShown[id] = 1;
    lsSet('apex.tips', JSON.stringify(tipsShown));
    G.tip = { id, text: TIP_TEXT[id], t: cf('TIP_TIME'), dur: cf('TIP_TIME') };
  }
  A.showTip = showTip;

  const TIP_MODES = { play: 1, intro: 1, evolveChoice: 1, rebirthChoice: 1 };
  function tickTip(dt) {
    const tip = G.tip;
    if (!tip || !TIP_MODES[G.mode]) return;
    tip.t -= dt;
    if (tip.t <= 0) G.tip = null;
  }

  A.update = function (dt) {
    G.transT += dt;
    autoplayHooks();
    tickTip(dt);
    if (!SIM_MODES[G.mode]) { const I = A.input; I.dashQueued = I.biteQueued = I.abilityQueued = false; return; }
    stepWorld(dt);
  };

  // ---------- rendering ----------
  let shadowSprite = null;
  function getShadowSprite() {
    if (shadowSprite) return shadowSprite;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(0,0,0,0.6)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.3)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    shadowSprite = c;
    return c;
  }

  function drawShadow(ctx, e, look) {
    const alt = e.alt || 0;
    const fill = e.role === 'producer' ? 0.5 + 0.5 * clamp(e.amount == null ? 1 : e.amount, 0, 1) : 1;
    const sx = (look.len || 1.2) * e.r * fill * (1 - alt * 0.25);
    const sy = (look.wid || 0.8) * e.r * fill * (1 - alt * 0.25);
    ctx.save();
    ctx.globalAlpha *= 0.55 * (1 - alt * 0.45);
    ctx.translate(e.x + e.r * (0.1 + alt * 0.8), e.y + e.r * (0.16 + alt * 1.3));
    ctx.rotate(e.angle);
    ctx.drawImage(getShadowSprite(), -sx * 1.15, -sy * 1.15, sx * 2.3, sy * 2.3);
    ctx.restore();
  }

  // Fallback body for species with no registered look or plan.
  function drawBlob(ctx, e, look) {
    const fill = e.role === 'producer' ? 0.5 + 0.5 * clamp(e.amount == null ? 1 : e.amount, 0, 1) : 1;
    const r = e.r * fill;
    const body = (e.pal && e.pal.body) || (look && look.pal && look.pal.body) || ROLE_COLOR[e.role] || '#aaaaaa';
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.15, r * 0.85, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = Math.max(0.5, r * 0.08);
    ctx.stroke();
    if (e.role === 'producer') return;
    const pupil = e.role === 'hunter' ? '#d3182f' : '#161616';
    for (let s = -1; s <= 1; s += 2) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(r * 0.5, s * r * 0.34, r * 0.24, 0, TAU); ctx.fill();
      ctx.fillStyle = pupil;
      ctx.beginPath(); ctx.arc(r * 0.57, s * r * 0.34, r * 0.12, 0, TAU); ctx.fill();
    }
  }

  function drawBody(ctx, e, look, plan, t) {
    if (!plan) { drawBlob(ctx, e, look); return; }
    if (!look.noShadow) drawShadow(ctx, e, look);
    try {
      if (plan.worldSpace) {
        plan(ctx, e, t, look);
        if (e.parts) { ctx.translate(e.x, e.y); ctx.rotate(e.angle); mod('Parts', 'draw', ctx, e, look, t); }
      } else {
        ctx.translate(e.x, e.y);
        ctx.rotate(e.angle);
        plan(ctx, e, t, look);
        if (e.parts) mod('Parts', 'draw', ctx, e, look, t);
      }
    } catch (err) { report('Shapes.' + look.plan, err); }
  }

  // The dead body rendered once into a small sprite (world-space plans draw their chain at the body's last position).
  function carcassSprite(e, look, plan) {
    if (e.sprite !== undefined) return e.sprite;
    e.sprite = null;
    if (typeof document === 'undefined') return null;
    try {
      const src = e.src, ext = Math.max(look.len || 1.2, look.wid || 0.8, 1) * src.r * (plan.worldSpace ? 2.2 : 1.5), S = 4;
      const size = Math.min(512, Math.ceil(ext * 2 * S));
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      g.translate(size / 2, size / 2);
      g.scale(size / (ext * 2), size / (ext * 2));
      if (plan.worldSpace) g.translate(-src.x, -src.y); else g.rotate(src.angle);
      plan(g, src, 0, Object.assign({}, look, { noShadow: true }));
      e.sprite = { c, ext };
    } catch (err) { report('carcassSprite', err); }
    return e.sprite;
  }

  // A carcass: the dead animal's own look, lying still, washed out and fading before it decays.
  function drawCarcass(ctx, e) {
    const src = e.src, look = src && A.LOOKS && A.LOOKS[src.sp];
    const plan = look && A.Shapes && A.Shapes[look.plan];
    const left = cf('CARCASS_TIME') - e.age;
    ctx.globalAlpha = 0.85 * clamp(left / 4, 0, 1);
    if (!plan) {   // no look registered: a simple muted blob
      ctx.translate(e.x, e.y); ctx.rotate(e.angle);
      ctx.fillStyle = '#6b6258';
      ctx.beginPath(); ctx.ellipse(0, 0, e.r * 1.15, e.r * 0.8, 0, 0, TAU); ctx.fill();
      return;
    }
    const spr = carcassSprite(e, look, plan);
    if (spr) {
      ctx.translate(e.x, e.y);
      ctx.filter = 'grayscale(0.8) brightness(0.72)';   // browsers without canvas filters simply show it un-muted
      ctx.drawImage(spr.c, -spr.ext, -spr.ext, spr.ext * 2, spr.ext * 2);
      return;
    }
    drawBody(ctx, src, Object.assign({}, look, { noShadow: true }), plan, 0);
    ctx.translate(e.x, e.y); ctx.rotate(e.angle);
    ctx.fillStyle = 'rgba(78,72,64,0.55)';   // desaturating wash over the body
    ctx.beginPath(); ctx.ellipse(0, 0, (look.len || 1.2) * src.r * 0.9, (look.wid || 0.8) * src.r * 0.9, 0, 0, TAU); ctx.fill();
  }

  // ctx must already be in world space (A.applyCam).
  A.drawCreature = function (ctx, e, t) {
    ctx.save();
    if (e.sp === 'carcass') {
      drawCarcass(ctx, e);
      ctx.restore();
      return;
    }
    // the skink's tail decoy wriggles with the owner's look
    const look = A.LOOKS && (A.LOOKS[e.sp] || (e.sp === 'decoy' ? A.LOOKS[e.fromSp] : null));
    const plan = look && A.Shapes && A.Shapes[look.plan];
    const rolling = e.isPlayer && e.ability && e.ability.id === 'roll' && e.ability.activeT > 0;
    if (e.isPlayer && e.invulnT > 0 && e.invulnT < 50 && !rolling) ctx.globalAlpha = 0.65 + 0.35 * Math.sin(t * 28);
    else if (e.sp === 'decoy') ctx.globalAlpha = 0.8;
    drawBody(ctx, e, look, plan, t);
    ctx.restore();
  };

  // Draws a species into the box [0,size]x[0,size] of the current ctx transform.
  A.drawPortrait = function (ctx, sp, size, o) {
    o = o || {};
    const look = A.LOOKS && A.LOOKS[sp];
    const plan = look && A.Shapes && A.Shapes[look.plan];
    const t = o.t || 0, r = 10;
    const ro = { sp, role: 'grazer', beh: 'wander', r, n0: 0, speed: 0 };
    const e = {
      id: 0, sp, def: (A.SPECIES && A.SPECIES[sp]) || {}, ro, role: 'grazer', beh: 'wander', x: 0, y: 0, vx: 0, vy: 0,
      angle: -0.2, r, mass: r * r / 16, speed: 0, state: 'idle', stateT: 0, alive: true, age: t, phase: t * 3,
      biteT: 0, hurtT: 0, alt: 0, amount: 1, isPlayer: false, pal: o.pal || null, parts: o.parts || null, rs: {},
    };
    const ext = look ? Math.max(look.len || 1, look.wid || 0.7, 0.6) : 1.1;
    const s = (size * 0.46) / (ext * r);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.scale(s, s);
    try {
      if (!plan) {
        drawBlob(ctx, e, look);
      } else if (plan.worldSpace) {
        plan(ctx, e, t, look);
      } else {
        ctx.rotate(e.angle);
        plan(ctx, e, t, look);
        if (e.parts) mod('Parts', 'draw', ctx, e, look, t);
      }
    } catch (err) { report('drawPortrait', err); }
    ctx.restore();
  };

  const drawList = [];
  function cmpDraw(a, b) {
    const pa = a.role === 'producer' ? 0 : 1, pb = b.role === 'producer' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (a.alt !== b.alt) return a.alt - b.alt;
    return a.r - b.r;
  }

  function resetCtx(ctx) {
    ctx.setTransform(A.DPR, 0, 0, A.DPR, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // Run a module's screen-space draw function with a clean context before and after.
  function drawMod(ctx, name, fn, a, b, c, d) {
    resetCtx(ctx);
    mod(name, fn, ctx, a, b, c, d);
    resetCtx(ctx);
  }

  function drawEntities(ctx, t) {
    const cam = G.cam, hw = A.W / 2 / cam.zoom, hh = A.H / 2 / cam.zoom;
    const list = G.entities, dying = G.mode === 'dying';
    drawList.length = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || (dying && e.isPlayer)) continue;
      const pad = e.r * 3 + 30;
      if (Math.abs(e.x - cam.x) > hw + pad || Math.abs(e.y - cam.y) > hh + pad) continue;
      drawList.push(e);
    }
    drawList.sort(cmpDraw);
    A.applyCam(ctx, cam);
    for (let i = 0; i < drawList.length; i++) A.drawCreature(ctx, drawList[i], t);
    const FX = A.FX;
    if (FX && FX.drawOverlay) {
      for (let i = 0; i < drawList.length; i++) {
        const e = drawList[i];
        ctx.save();
        ctx.translate(e.x, e.y);
        try { FX.drawOverlay(ctx, e, t); } catch (err) { report('FX.drawOverlay', err); }
        ctx.restore();
      }
    }
    resetCtx(ctx);
  }

  function drawDebug(ctx) {
    const lines = [
      'fps ' + fps.toFixed(0) + '  mode ' + G.mode + '  entities ' + G.entities.length + '  time ' + G.time.toFixed(1),
      'harmony ' + Math.round(G.eco.harmony) + '  producers ' + (+G.eco.producerLevel).toFixed(2) + '  growth ' +
        (G.player ? G.player.growth.toFixed(2) : '-') + '  energy ' + (G.player ? Math.round(G.player.energy) : '-'),
      'pops ' + Object.keys(G.eco.pops || {}).map((k) => k + ':' + Math.round(G.eco.pops[k])).join(' '),
    ];
    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const x = Math.max(6, A.W / 2 - 320), y = A.H - lines.length * 16 - 14;
    ctx.fillRect(x, y, 640, lines.length * 16 + 6);
    ctx.fillStyle = '#d6ffe8';
    lines.forEach((l, i) => ctx.fillText(l, x + 4, y + 3 + i * 16));
  }

  A.render = function () {
    const ctx = A.ctx;
    if (!ctx) return;
    const t = renderT, cam = G.cam, tier = G.tier;
    resetCtx(ctx);
    const biome = tier && A.Biomes && A.Biomes[tier.biome];
    ctx.fillStyle = (biome && biome.palette && biome.palette.bg) || '#1b140e';
    ctx.fillRect(0, 0, A.W, A.H);
    if (!tier) return;
    drawMod(ctx, 'World', 'drawDepthBelow', cam, t);
    drawMod(ctx, 'World', 'drawBack', cam, t);
    drawEntities(ctx, t);
    if (G.mode === 'dying') {
      drawMod(ctx, 'FX', 'drawDecompose', cam, t, G.deathInfo, clamp(G.transT / cf('DECOMPOSE_TIME'), 0, 1));
    }
    drawMod(ctx, 'FX', 'drawWorld', cam, t);
    drawMod(ctx, 'World', 'drawFront', cam, t);
    drawMod(ctx, 'World', 'drawDepthAbove', cam, t);
    drawMod(ctx, 'FX', 'drawScreen', t);
    if (G.mode === 'evolving') drawMod(ctx, 'FX', 'drawEvolve', clamp(G.transT / cf('EVOLVE_TIME'), 0, 1));
    if (G.flags.debug) drawDebug(ctx);
  };

  // ---------- frame loop ----------
  function frame(ts) {
    requestAnimationFrame(frame);
    const now = ts / 1000;
    let dt = Math.min(0.1, now - lastFrame);
    lastFrame = now;
    if (!(dt > 0)) dt = STEP;
    try { runFrame(dt); } catch (err) { report('frame', err); }
  }

  function runFrame(dt) {
    renderT += dt;
    if (G.restartHold > 0) {   // real time, so slow-mo does not stretch the hold
      if (G.mode !== 'play' && G.mode !== 'intro') G.restartHold = 0;
      else if ((G.restartHold += dt) >= cf('RESTART_HOLD')) { G.restartHold = 0; A.restart(); }
    }
    fps += (1 / dt - fps) * 0.05;
    if (G.hitstopT > 0) {
      G.hitstopT -= dt;
    } else {
      const speed = G.flags.speed || 1;
      const maxSteps = Math.max(5, Math.ceil(5 * speed));
      accum += dt * speed;
      let n = 0;
      while (accum >= STEP && n < maxSteps) {
        A.update(STEP * G.timeScale);
        accum -= STEP;
        n++;
        if (G.hitstopT > 0) { accum = 0; break; }
      }
      if (n >= maxSteps) accum = 0;
    }
    updateCamera(dt);
    A.render();
    mod('UI', 'update', G, dt);
  }

  // ---------- canvas and boot ----------
  function resize() {
    const D = Math.min(2, window.devicePixelRatio || 1);
    A.DPR = D;
    A.W = window.innerWidth;
    A.H = window.innerHeight;
    const c = A.canvas;
    if (!c) return;
    c.width = Math.round(A.W * D);
    c.height = Math.round(A.H * D);
    if (c.style) { c.style.width = A.W + 'px'; c.style.height = A.H + 'px'; }
    if (G.player) snapCamera();
  }

  function parseFlags(over) {
    const F = G.flags;
    let q = null;
    try { q = new URLSearchParams(window.location.search || ''); } catch (err) { q = new URLSearchParams(''); }
    const bool = (k) => q.has(k) && q.get(k) !== '0' && q.get(k) !== 'false';
    F.autoplay = bool('autoplay'); F.debug = bool('debug'); F.headless = bool('headless');
    F.skipEditor = bool('skipEditor'); F.mute = bool('mute');
    G.difficulty = q.get('diff') || lsGet('apex.difficulty') || 'normal';
    if (!(cf('DIFFICULTY') || {})[G.difficulty]) G.difficulty = 'normal';
    F.bot = q.get('bot') || 'balanced';
    F.speed = q.has('speed') ? Math.max(0.1, Math.min(20, +q.get('speed') || 1)) : 1;
    F.seed = q.has('seed') ? (+q.get('seed') >>> 0) : (Math.random() * 4294967296) >>> 0;
    F.tier = q.get('tier'); F.sp = q.get('sp'); F.path = q.get('path');
    F.tutorial = q.has('tutorial') ? (q.get('tutorial') === '0' || q.get('tutorial') === 'false' ? '0' : '1') : null;
    if (over) Object.assign(F, over);
  }

  function startAttract() {
    resetRunState(false);
    startTier(A.TIER_START || 't1_litter', 'ant', { growth: 0 });
    const p = G.player;
    if (p) { p.invulnT = 1e9; p.attract = true; }
    setMode('title');
  }

  function startAtTier(id, sp) {
    resetRunState(false);
    startTier(id, sp, { growth: 0 });
    setMode('play');
    A.emit('runStart');
    maybeStartTutorial(false);
  }

  A.boot = function (over) {
    if (booted) return;
    booted = true;
    parseFlags(over);
    A.setSeed(G.flags.seed);
    A.canvas = document.getElementById('game');
    A.ctx = A.canvas && A.canvas.getContext ? A.canvas.getContext('2d', { alpha: false }) : null;
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    bindInput();
    ['World', 'FX', 'Audio', 'UI', 'Editor'].forEach((n) => mod(n, 'init'));
    A.on('mishapStart', () => { G.stats.mishaps++; showTip('mishap'); });
    A.on('playerDeath', () => showTip('death'));
    A.on('evolveReady', () => showTip('evolve'));
    A.on('angry', () => showTip('angry'));
    G.tutorial.done = lsGet('apex.tutorial') === 'done';
    const F = G.flags;
    if (F.tier && tiersOf()[F.tier]) startAtTier(F.tier, F.sp);
    else { startAttract(); if (F.autoplay) A.newRun(); }
    if (!F.headless && typeof requestAnimationFrame === 'function') {
      lastFrame = performance.now() / 1000;
      requestAnimationFrame(frame);
    }
  };

  // ---------- debug and simulation ----------
  function simulate(maxSec, opts) {
    opts = opts || {};
    const F = G.flags;
    const saved = { autoplay: F.autoplay, bot: F.bot, path: F.path, skipEditor: F.skipEditor, tutorial: F.tutorial };
    F.autoplay = true; F.bot = opts.bot || 'balanced'; F.path = opts.path || null; F.skipEditor = true; F.tutorial = '0';
    if (G.tutorial.active) mod('Tutorial', 'stop', G);
    if (opts.seed !== undefined && opts.seed !== null) A.setSeed(opts.seed);
    const rep = { victory: false, time: 0, path: null, deaths: [], tierTimes: {}, clearTimes: {}, mishaps: [], harmonyAvg: 0, score: 0, lineage: [] };
    const subs = [];
    const sub = (name, fn) => { A.on(name, fn); subs.push([name, fn]); };
    const lap = () => { (rep.tierTimes[G.tierId] = rep.tierTimes[G.tierId] || []).push(Math.round(G.tierTime * 10) / 10); };
    sub('playerDeath', (d) => {
      rep.deaths.push({ tierId: G.tierId, cause: d.cause, killerSp: d.killer ? d.killer.sp : null, t: Math.round(G.time * 10) / 10 });
      lap();
    });
    sub('evolve', lap);
    sub('victory', lap);
    // First time each tier reaches full growth from a fresh (growth 0) start: the pacing the targets are about.
    let reborn = false;
    const clear = () => { if (!reborn && rep.clearTimes[G.tierId] === undefined) rep.clearTimes[G.tierId] = Math.round(G.tierTime * 10) / 10; };
    sub('rebirth', () => { reborn = true; });
    sub('evolveReady', clear);
    sub('finalStart', clear);
    sub('evolve', () => { reborn = false; });
    sub('mishapStart', (d) => rep.mishaps.push({ tierId: G.tierId, type: d.type, t: Math.round(G.time * 10) / 10 }));
    simMode = true;
    rep.harmonyTrace = [];
    try {
      A.newRun();
      if (opts.tier && tiersOf()[opts.tier]) {   // start in one tier (eco tests)
        startTier(opts.tier, opts.sp || tiersOf()[opts.tier].players[0], { growth: 0 });
        setMode('play');
      }
      const dt = 1 / 30;
      let t = 0, guard = 0, nextTrace = 0;
      const maxIter = Math.ceil(maxSec / dt) * 3 + 100;
      while (t < maxSec && guard++ < maxIter) {
        if (opts.botAfter && t >= opts.botAfter.t) F.bot = opts.botAfter.bot;   // e.g. greedy first, then balanced
        if (t >= nextTrace) { nextTrace += 10; rep.harmonyTrace.push(Math.round(G.eco.harmony)); }
        const m = G.mode;
        if (m === 'victory' || m === 'title') break;
        if (m === 'editor') { A.closeEditor(); continue; }
        if (m === 'evolveChoice' || m === 'rebirthChoice') { autoPick(); if (G.mode === m) break; continue; }
        if (m === 'paused') { A.togglePause(); continue; }
        A.update(dt);
        updateCamera(dt);   // eco spawns births out of view, so the camera must follow the player here too
        t += dt;
      }
    } finally {
      simMode = false;
      subs.forEach((s) => A.off(s[0], s[1]));
      Object.assign(F, saved);
    }
    const s = G.stats;
    rep.victory = G.mode === 'victory';
    rep.time = Math.round(G.time * 10) / 10;
    rep.path = G.path;
    rep.harmonyAvg = s.harmonyN ? Math.round(s.harmonySum / s.harmonyN * 10) / 10 : 0;
    rep.score = Math.round(G.score);
    rep.lineage = G.lineage.map((l) => ({ sp: l.sp, tierId: l.tierId, outcome: l.outcome }));
    return rep;
  }

  const MISHAP_FLAG = { famine: 'famine', barren: 'barren', surge: 'surge' };

  function forceMishapFallback(type) {
    const eco = G.eco, def = (A.MISHAP_DEFAULTS && A.MISHAP_DEFAULTS[type]) || { title: type, text: '' };
    const over = (G.tier && G.tier.mishaps && G.tier.mishaps[type]) || def;
    let sp = null;
    if (type === 'boom' || type === 'disease') {
      const g = (G.tier.roster || []).find((r) => (ROLE_ALIAS[r.role] || r.role) === 'grazer');
      sp = g ? g.sp : null;
      eco.flags[type === 'boom' ? 'boomSp' : 'diseaseSp'] = sp;
    } else if (MISHAP_FLAG[type]) {
      eco.flags[MISHAP_FLAG[type]] = true;
    }
    eco.mishaps.push({ type, sp, t: G.time, title: over.title, text: over.text });
    A.emit('mishapStart', { type, title: over.title, text: over.text, sp });
  }

  A.debug = {
    setTier(id, sp) {
      if (!tiersOf()[id]) return false;
      if (G.mode === 'title' || G.mode === 'victory' || G.mode === null) resetRunState(false);
      G.deathTier = null; G.tierDeaths = 0;
      startTier(id, sp, { growth: 0 });
      setMode('play');
      return true;
    },
    killPlayer() {
      const p = G.player;
      if (!p || !p.alive) return;
      let h = null, bd = 1e12;
      G.entities.forEach((e) => {
        const d = (e.x - p.x) * (e.x - p.x) + (e.y - p.y) * (e.y - p.y);
        if (e.role === 'hunter' && e.alive && d < bd) { h = e; bd = d; }
      });
      const wasTitle = G.mode === 'title';
      if (wasTitle) setMode('play');
      A.kill(p, h ? 'eaten' : 'starved', h);
    },
    fillGrowth() { if (G.player) G.player.growth = 1; },
    // Tutorial drivers: start it on a fresh t1_litter, then move one step at a time.
    tutorialStart() {
      if (G.tierId !== 't1_litter' || !G.player || !G.player.alive) { resetRunState(false); startTier('t1_litter', 'ant', { growth: 0 }); setMode('play'); }
      mod('Tutorial', 'start', G);
      return G.tutorial.id;
    },
    tutorialAdvance() { mod('Tutorial', 'advance', G); return G.tutorial.id; },
    showTip,
    forceMishap(type) {
      if (A.Eco && A.Eco.forceMishap) { try { A.Eco.forceMishap(type); return; } catch (err) { report('Eco.forceMishap', err); } }
      forceMishapFallback(type);
    },
    win() {
      if (G.player) G.player.growth = 1;
      G.final = true; G.finalHold = cf('FINAL_HOLD');
      victory();
    },
    simulate,
  };
})();
