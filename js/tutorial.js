// tutorial.js: the guided first minute in t1_litter (gameplay side). ui.js draws G.tutorial: hint bubble, target ring, highlights.
// Steps advance on actions, never on timers alone: move, eat, grow, bite, danger, ability, harmony.
(function () {
  'use strict';
  const A = window.Apex = window.Apex || {};

  const TAU = Math.PI * 2;
  const STEPS = ['move', 'eat', 'grow', 'bite', 'danger', 'ability', 'harmony'];
  const HARMONY_SHOW = 9;            // seconds the harmony hint stays up
  const DONE_KEY = 'apex.tutorial';

  const cfg = (k, d) => (A.CFG && typeof A.CFG[k] === 'number' ? A.CFG[k] : d);
  const touch = () => !!(A.input && A.input.touch);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const alive = (e) => !!e && e.alive !== false;
  const emit = (n, p) => { if (A.emit) A.emit(n, p); };

  let T = null;   // runtime state of the running tutorial (null when idle)

  // ------------------------------------------------------------ helpers
  function listen(name, fn) {
    A.on(name, fn);
    T.handlers.push([name, fn]);
  }

  function cleanup() {
    if (!T) return;
    T.handlers.forEach((h) => A.off(h[0], h[1]));
    const b = T.beetle;
    if (b) b.tutorial = false;
    T = null;
  }

  function persistDone() {
    try { localStorage.setItem(DONE_KEY, 'done'); } catch (err) { /* storage unavailable */ }
  }

  function reset(G, active) {
    const t = G.tutorial;
    t.active = active; t.id = active ? t.id : null; t.text = ''; t.anchor = null; t.highlight = [];
    t.target = null; t.canSkip = active; t.dmgMul = 1; t.calm = false;
  }

  // Spawn n small animals of species sp around the player (inside the view), slow so the first catches are easy.
  function spawnProps(G, sp, n, d0, d1, speed) {
    const p = G.player, w = G.world, out = [];
    const base = (G.tier.roster || []).find((r) => r.sp === sp) || { sp, role: 'grazer', beh: 'wander', r: 6, n0: 0, speed: 30 };
    for (let i = 0; i < n; i++) {
      const ang = A.rand() * TAU, d = d0 + A.rand() * (d1 - d0);
      const ro = Object.assign({}, base, { n0: 0 });
      if (speed != null) { ro.speed = speed; ro.beh = 'wander'; }
      const e = A.spawn(sp, ro, clamp(p.x + Math.cos(ang) * d, 40, w - 40), clamp(p.y + Math.sin(ang) * d, 40, w - 40), { tutorialProp: true });
      out.push(e);
    }
    return out;
  }

  const liveIds = (list) => list.filter(alive).map((e) => e.id);

  // ------------------------------------------------------------ steps
  // enter(G): set up the step; check(G, dt): true when the player has done what the step teaches.
  const STEP_DEF = {
    move: {
      text: () => (touch() ? 'Drag to steer. Move into the glowing ring.' : 'Steer with the mouse or WASD. Move into the glowing ring.'),
      enter(G) {
        const p = G.player, ang = A.rand() * TAU;
        G.tutorial.target = {
          x: clamp(p.x + Math.cos(ang) * 130, 60, G.world - 60), y: clamp(p.y + Math.sin(ang) * 130, 60, G.world - 60), r: 26,
        };
      },
      check(G) { const t = G.tutorial.target; return !!t && dist(G.player, t) < t.r; },
    },
    eat: {
      text: () => 'Glowing outline = food. Run into the small bugs to eat them.',
      enter(G) { T.eats = 0; T.props = spawnProps(G, 'mite', 4, 55, 100, 20); G.tutorial.highlight = liveIds(T.props); },
      check(G) {
        const need = 2 - T.eats;
        if (liveIds(T.props).length < need) T.props = T.props.concat(spawnProps(G, 'mite', 1, 60, 100, 20));
        G.tutorial.highlight = liveIds(T.props);
        return T.eats >= 2;
      },
    },
    grow: {
      text: () => 'Every meal fills your growth ring. Keep eating to grow.',
      enter(G) { T.e0 = T.eats; T.props = spawnProps(G, 'aphid', 3, 60, 110, 20); G.tutorial.highlight = liveIds(T.props); },
      check(G) {
        const left = 3 - (T.eats - T.e0);   // three meals, whatever the tier's growthNeeded
        if (left > 0 && liveIds(T.props).length < left) T.props = T.props.concat(spawnProps(G, 'aphid', 1, 60, 110, 20));
        G.tutorial.highlight = liveIds(T.props);
        return left <= 0;
      },
    },
    bite: {
      text: () => (touch() ? 'Too big to swallow? Tap Bite until it drops, then eat the carcass.'
        : 'Too big to swallow? Bite it (click or Space) until it drops, then eat the carcass.'),
      enter(G) { T.carcassEaten = false; T.carcass = null; T.cat = spawnProps(G, 'caterpillar', 1, 90, 120, null)[0]; G.tutorial.highlight = [T.cat.id]; },
      check(G) {
        if (T.carcassEaten) return true;
        if (T.carcass && alive(T.carcass)) { G.tutorial.highlight = [T.carcass.id]; return false; }
        if (!alive(T.cat)) {          // the caterpillar is gone and left nothing: bring another
          T.carcass = null;
          T.cat = spawnProps(G, 'caterpillar', 1, 90, 120, null)[0];
          G.tutorial.highlight = [T.cat.id];
        }
        return false;
      },
    },
    danger: {
      text: () => (touch() ? 'Red outline can eat you. When it flashes, tap Dash to get away.'
        : 'Red outline can eat you. When it flashes, dash away (Shift).'),
      enter(G) {
        const p = G.player, ang = A.rand() * TAU, base = (G.tier.roster || []).find((r) => r.sp === 'beetle');
        const ro = Object.assign({}, base || { sp: 'beetle', role: 'hunter', beh: 'chase', r: 20, speed: 120 }, { n0: 0 });
        const e = A.spawn('beetle', ro, clamp(p.x + Math.cos(ang) * 170, 60, G.world - 60), clamp(p.y + Math.sin(ang) * 170, 60, G.world - 60),
          { tutorial: true, tutorialProp: true, lastAte: G.time - 12 });
        T.beetle = e; T.dodged = false; T.hitT = -1;
        G.tutorial.highlight = [e.id];
        G.tutorial.dmgMul = cfg('TUT_BEETLE_DMG', 0.35);   // the beetle bites, but gently
      },
      check(G, dt) {
        const b = T.beetle;
        if (!alive(b) || T.dodged) return true;
        if (T.hitT >= 0) { T.hitT += dt; if (T.hitT > 1.2) return true; }
        return false;
      },
    },
    ability: {
      text() {
        const p = A.G && A.G.player, def = p && A.SPECIES && A.SPECIES[p.sp] && A.SPECIES[p.sp].ability;
        if (!def) return 'Press E to use your ability.';
        return touch() ? 'Tap the ability button: ' + def.name + '. ' + def.blurb : 'Press E: ' + def.name + '. ' + def.blurb;
      },
      enter(G) { T.abilityUsed = false; G.tutorial.highlight = []; },
      check() { return T.abilityUsed; },
    },
    harmony: {
      text: () => '',
      enter(G) { T.harmonyT = -1; G.tutorial.highlight = []; },
      // waits for the first species to leave its healthy band, then shows the hint for a few seconds
      check(G, dt) {
        if (T.harmonyT < 0) {
          T.scanT = (T.scanT || 0) - dt;
          if (T.scanT > 0) return false;
          T.scanT = 0.5;
          if (offBand(G)) showHarmony(G);
          return false;
        }
        T.harmonyT += dt;
        return T.harmonyT > HARMONY_SHOW;
      },
    },
  };

  function offBand(G) {
    const ro = (G.tier && G.tier.roster) || [];
    if (!A.Eco || !A.Eco.statusOf) return false;
    for (let i = 0; i < ro.length; i++) if (A.Eco.statusOf(ro[i].sp) !== 'ok') return true;
    return false;
  }

  function showHarmony(G) {
    T.harmonyT = 0;
    G.tutorial.text = 'Wiping out one species starves its predators. They\'ll come for you.';
  }

  // ------------------------------------------------------------ flow
  function enter(G, i) {
    const id = STEPS[i], def = STEP_DEF[id], t = G.tutorial;
    T.i = i;
    t.id = id; t.step = i + 1; t.total = STEPS.length;
    t.text = def.text();
    t.highlight = []; t.target = null;
    // predators cannot kill during steps 1-4 (and stay calm until the beetle of step 5)
    t.dmgMul = i < 4 ? 0 : 1;
    t.calm = i < 6;   // hunters stay calm until the ability step is done (the step-5 beetle is exempt)
    if (i > 4 && T.beetle) { T.beetle.tutorial = false; T.beetle = null; }   // the tutorial beetle becomes an ordinary hunter
    def.enter(G);
    emit('tutorialStep', { id });
  }

  function finish(G, skipped) {
    persistDone();
    cleanup();
    reset(G, false);
    G.tutorial.done = true;
    G.tutorial.id = 'done';
    emit('tutorialStep', { id: 'done', skipped: !!skipped });
  }

  function next(G) {
    const i = T.i;
    if (i === STEPS.length - 1) return finish(G, false);
    enter(G, i + 1);
  }

  function start(G) {
    G = G || A.G;
    if (!G || !G.player || !G.tier) return;
    cleanup();
    reset(G, true);
    G.tutorial.done = false;
    T = { i: -1, handlers: [], eats: 0, props: [], cat: null, carcass: null, carcassEaten: false, beetle: null, dodged: false, hitT: -1, abilityUsed: false };
    listen('playerEat', (d) => {
      T.eats++;
      if (d && d.food && d.food.sp === 'carcass') T.carcassEaten = true;
    });
    listen('carcass', (d) => { if (d && d.e) T.carcass = d.e; });
    listen('dash', (d) => {
      const b = T.beetle, p = A.G.player;
      if (d && d.e === p && alive(b) && dist(b, p) < 260 && (b.state === 'chase' || b.state === 'windup' || b.state === 'lunge')) T.dodged = true;
    });
    listen('damage', (d) => { if (d && d.target === A.G.player && d.by === T.beetle && T.hitT < 0) T.hitT = 0; });
    listen('playerHit', (d) => { if (d && d.by && d.by === T.beetle && T.hitT < 0) T.hitT = 0; });
    listen('abilityUse', (d) => { if (d && d.e === A.G.player && !d.miss) T.abilityUsed = true; });
    listen('playerDeath', () => stop(A.G));
    enter(G, 0);
  }

  function update(G, dt) {
    G = G || A.G;
    if (!T || !G || !G.tutorial.active) return;
    const p = G.player;
    if (!p || p.alive === false) return stop(G);
    if (G.tierId !== 't1_litter') return stop(G);
    const t = G.tutorial;
    t.anchor = t.text ? { x: p.x, y: p.y - p.r * 2.4 } : null;
    if (T.i >= 0 && STEP_DEF[STEPS[T.i]].check(G, dt)) next(G);
  }

  // Esc menu "Skip tutorial": remember it as done and release everything the tutorial held.
  function skip() {
    const G = A.G;
    if (!G) return;
    if (!T) { persistDone(); G.tutorial.done = true; return; }
    finish(G, true);
  }

  // Ends the tutorial without recording it as finished (a death, or leaving the tier). Leaving during the
  // harmony step counts as finished.
  function stop(G) {
    G = G || A.G;
    if (!G) return;
    if (T && T.i === STEPS.length - 1) { finish(G, false); return; }
    cleanup();
    reset(G, false);
  }

  // Debug / test driver: jump to the next step, as if the player had done what it asks.
  function advance(G) {
    G = G || A.G;
    if (!T || !G || !G.tutorial.active) return;
    if (T.i === STEPS.length - 1 && T.harmonyT < 0) { showHarmony(G); return; }
    next(G);
  }

  A.Tutorial = { start, update, skip, stop, advance, STEPS };
})();
