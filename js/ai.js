(function () {
  'use strict';
  const A = window.Apex = window.Apex || {};

  // ---------------------------------------------------------------- helpers
  const TAU = Math.PI * 2;
  const EDGE = 100;        // world-edge avoidance margin
  const SCAN_EVERY = 0.14; // perception refresh (staggered per entity)
  const MAX_NB = 8;        // neighbors kept for boids

  const rnd = () => (A.rand ? A.rand() : Math.random());
  const rr = (a, b) => a + (b - a) * rnd();
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const cfg = (k, d) => { const c = A.CFG; return c && typeof c[k] === 'number' ? c[k] : d; };
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  function wrap(a) {
    if (!isFinite(a)) return 0;
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
  }

  function hashAngle(s) {
    let h = 0;
    s = String(s);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return ((h >>> 0) % 1000) / 1000 * TAU;
  }

  // stunT freezes an animal and slowT scales its speed by slowMul (set by sprays, webs and the like)
  const speedMul = (e) => (e.stunT > 0 ? 0 : (e.slowT > 0 ? num(e.slowMul, 1) : 1));
  const baseSpeed = (e) => (e.speed > 0 ? e.speed : 60) * speedMul(e);
  const isDead = (o) => !o || o.alive === false;

  function worldSize(G) {
    const w = G && G.tier && G.tier.world;
    return num(w, cfg('WORLD', 2600));
  }

  // Dive hunters hover at alt 1 where canEat would say no; treat them by their ground state.
  function canEat(a, b) {
    if (!A.canEat) return a.r * cfg('EAT_RATIO', 0.92) > b.r;
    if (a.beh === 'dive' && a.alt > 0.5) {
      const saved = a.alt;
      a.alt = 0;
      const ok = A.canEat(a, b);
      a.alt = saved;
      return ok;
    }
    return A.canEat(a, b);
  }

  function emit(name, payload) { if (A.emit) A.emit(name, payload); }

  // module scratch, set at the start of each public call
  let _G = null;
  let _W = 2600;
  let _se = null;           // entity being scanned for (shared with query filters)
  const EP = { x: 0, y: 0, m: 0 };  // world-edge push (points inward)
  const FD = { x: 0, y: 0 };        // flee direction scratch
  const BV = { cx: 0, cy: 0, ax: 0, ay: 0, sx: 0, sy: 0, n: 0 };  // boid vectors

  function edgePush(x, y) {
    const W = _W;
    let px = 0, py = 0;
    if (x < EDGE) px = Math.min(1, 1 - x / EDGE); else if (x > W - EDGE) px = -Math.min(1, 1 - (W - x) / EDGE);
    if (y < EDGE) py = Math.min(1, 1 - y / EDGE); else if (y > W - EDGE) py = -Math.min(1, 1 - (W - y) / EDGE);
    EP.x = px; EP.y = py; EP.m = Math.hypot(px, py);
    return EP;
  }

  // ---------------------------------------------------------------- per-entity state
  function getAI(e) {
    let ai = e.ai;
    if (!ai) {
      if (!isFinite(e.angle)) e.angle = rnd() * TAU;
      ai = e.ai = {
        ph: rnd() * TAU, sph: hashAngle(e.sp), h: e.angle, clock: 0, st: 0,
        scanT: rnd() * SCAN_EVERY, threats: [], nb: [], tgt: null,
        fleeing: false, fleeUntil: 0, fleeX: 1, fleeY: 0, urg: 0, panic: 0,
        side: rnd() < 0.5 ? -1 : 1, pauseT: rr(0, 1.2), moving: false, burstT: 0, turnT: 0,
        dirx: 1, diry: 0, noHunt: 0, chaseT: 0, idleT: 0, cd: 0, gp: null, gpPrev: null, findT: 0,
        wp: null, lx: 0, ly: 0, ateMark: -999, flyT: 0, grazeCd: 0, sp: 1,
      };
    }
    return ai;
  }

  function setState(e, ai, s) {
    if (e.state !== s) { e.state = s; e.stateT = 0; ai.st = 0; }
  }

  // ---------------------------------------------------------------- movement primitives
  const turnRate = (e) => clamp(16 / (1 + e.r / 14), 2.2, 14);

  function turnToward(e, target, dt, boost) {
    const d = wrap(target - e.angle);
    const step = turnRate(e) * (boost || 1) * dt;
    e.angle = wrap(e.angle + clamp(d, -step, step));
  }

  // Steer toward direction (dx,dy) at speed spd; adds world-edge avoidance, smooths velocity, turns to face.
  function drive(e, dt, dx, dy, spd, accel) {
    let len = Math.hypot(dx, dy);
    if (len > 1e-6) { dx /= len; dy /= len; } else { dx = 0; dy = 0; }
    if (spd > 0) {
      edgePush(e.x, e.y);
      if (EP.m > 0) {
        dx += EP.x * 2.2; dy += EP.y * 2.2;
        len = Math.hypot(dx, dy);
        if (len > 1) { dx /= len; dy /= len; }
      }
    }
    const k = 1 - Math.exp(-(accel || clamp(10 / (1 + e.r / 25), 3, 10)) * dt);
    e.vx += (dx * spd - e.vx) * k;
    e.vy += (dy * spd - e.vy) * k;
    if (spd > 0 && (dx !== 0 || dy !== 0)) turnToward(e, Math.atan2(dy, dx), dt);
  }

  // Wander heading with smooth noise; bends away from walls.
  function wander(e, dt, ai, speed, state) {
    ai.h += (Math.sin(ai.clock * 0.9 + ai.ph) * 0.8 + Math.sin(ai.clock * 2.3 + ai.ph * 1.7) * 0.5) * dt * 1.5;
    bendFromEdge(e, ai, dt);
    setState(e, ai, state);
    drive(e, dt, Math.cos(ai.h), Math.sin(ai.h), speed);
  }

  function bendFromEdge(e, ai, dt) {
    edgePush(e.x, e.y);
    if (EP.m > 0.25) ai.h = wrap(ai.h + wrap(Math.atan2(EP.y, EP.x) - ai.h) * Math.min(1, dt * 3) * EP.m);
  }

  // Shared slow flow field so groups drift coherently.
  function fieldAngle(e, ai) {
    return Math.sin(ai.clock * 0.25 + ai.sph + e.x * 0.0013) * 1.6 + Math.cos(ai.clock * 0.19 + ai.sph * 2 + e.y * 0.0013) * 1.6;
  }

  function stand(e, dt, ai, state) {
    setState(e, ai, state);
    drive(e, dt, 0, 0, 0, 7);
  }

  // ---------------------------------------------------------------- perception
  let _maxR = { id: null, v: 80 };
  function tierMaxR(G) {
    const t = G && G.tier;
    if (!t) return 80;
    if (_maxR.id === t.id) return _maxR.v;
    let m = cfg('PLAYER_BASE_R', 12) * num(t.maxScale, 1.7);  // the player is the only entity that grows past its roster radius
    for (const r of t.roster || []) m = Math.max(m, num(r.r, 0));
    _maxR = { id: t.id, v: m };
    return _maxR.v;
  }

  function playerThreatens(e, G) {
    const p = G.player;
    if (!p || p.alive === false || !isFinite(p.x)) return false;
    if (G.mode === 'dying' || G.mode === 'rebirthChoice' || G.mode === 'victory') return false;
    return canEat(p, e);
  }

  // Can this hunter currently target the player?
  function playerTargetable(e, G) {
    const p = G.player;
    if (!p || p.alive === false || !isFinite(p.x)) return false;
    if (G.mode !== 'play' || G.final || num(p.invulnT, 0) > 0) return false;
    return canEat(e, p);
  }

  function threatFilter(o) {
    if (o === _se || o.isPlayer || isDead(o) || o.role === 'producer') return false;
    if (o.beh === 'dive' && o.state === 'circle') return false;  // circling overhead is not yet a threat
    return canEat(o, _se);
  }

  const threatRange = (e, o) => (e.r * 8 + o.r * 4) * (e.r >= 13 ? 1.3 : 1) * (o.state === 'rest' ? 0.5 : 1);

  function scanThreats(e, ai, G) {
    const list = ai.threats;
    list.length = 0;
    _se = e;
    const near = A.query ? A.query(e.x, e.y, e.r * 10 + tierMaxR(G) * 4, threatFilter) : [];
    for (const o of near) {
      if (Math.hypot(o.x - e.x, o.y - e.y) < threatRange(e, o)) list.push(o);
    }
    if (playerThreatens(e, G)) list.push(G.player);
  }

  function nbFilter(o) { return o !== _se && !o.isPlayer && o.sp === _se.sp && !isDead(o); }

  function scanNeighbors(e, ai, radius) {
    const list = ai.nb;
    list.length = 0;
    _se = e;
    const near = A.query ? A.query(e.x, e.y, radius, nbFilter) : [];
    for (let i = 0; i < near.length && list.length < MAX_NB; i++) list.push(near[i]);
  }

  // Refresh cached perception when due; always refresh flee state. Returns true on a fresh scan.
  function perceive(e, G, ai, threatScale, nbR) {
    let fresh = false;
    if (ai.scanT <= 0) {
      ai.scanT = SCAN_EVERY + rnd() * 0.08;
      scanThreats(e, ai, G);
      if (nbR) scanNeighbors(e, ai, nbR);
      fresh = true;
    }
    updateFlee(e, ai, threatScale, !!nbR);
    return fresh;
  }

  function updateFlee(e, ai, scale, groupAlert) {
    let x = 0, y = 0, n = 0, best = 1;
    for (const o of ai.threats) {
      if (isDead(o)) continue;
      const dx = e.x - o.x, dy = e.y - o.y;
      const d = Math.hypot(dx, dy) || 1;
      const lim = threatRange(e, o) * scale;
      if (d > lim) continue;
      const w = 1.2 - d / lim;
      x += dx / d * w; y += dy / d * w; n++;
      best = Math.min(best, d / lim);
    }
    if (n) {
      const len = Math.hypot(x, y) || 1;
      ai.fleeX = x / len; ai.fleeY = y / len;
      ai.urg = 1 - best; ai.panic = 1;
      ai.fleeUntil = ai.clock + 0.6;
    } else if (groupAlert && ai.clock >= ai.fleeUntil) {
      // alert spreads through the group, fading each hop so it cannot echo forever
      for (const nb of ai.nb) {
        const na = nb.ai;
        if (!na || isDead(nb) || na.panic * 0.7 < 0.3 || na.clock >= na.fleeUntil) continue;
        ai.fleeX = na.fleeX; ai.fleeY = na.fleeY; ai.urg = 0.5; ai.panic = na.panic * 0.7;
        ai.fleeUntil = ai.clock + 0.4;
        break;
      }
    }
    ai.fleeing = ai.clock < ai.fleeUntil;
    if (!ai.fleeing) ai.panic = 0;
  }

  // Flee direction into FD: away from threats, sliding along walls instead of pinning into them.
  function fleeDir(e, ai, jitter) {
    let x = ai.fleeX, y = ai.fleeY;
    edgePush(e.x, e.y);
    if (EP.m > 0.25) {
      const ex = EP.x / EP.m, ey = EP.y / EP.m;
      const dot = x * ex + y * ey;
      if (dot < 0.1) { x -= ex * dot * 1.1; y -= ey * dot * 1.1; x += ex * 0.3; y += ey * 0.3; }
    }
    if (jitter) {
      const a = Math.sin(ai.clock * 5 + ai.ph) * jitter, c = Math.cos(a), s = Math.sin(a);
      const nx = x * c - y * s;
      y = x * s + y * c; x = nx;
    }
    const len = Math.hypot(x, y) || 1;
    FD.x = x / len; FD.y = y / len;
    return FD;
  }

  const fleeSpeed = (e, ai) => baseSpeed(e) * (e.r >= 13 ? 1.12 : 1) * (0.72 + 0.28 * ai.urg);

  // Flee drive used by simple grazers.
  function fleeStep(e, dt, ai, state, speedMul) {
    fleeDir(e, ai, e.r >= 13 ? 0.45 : 0.2);
    setState(e, ai, state || 'flee');
    drive(e, dt, FD.x, FD.y, fleeSpeed(e, ai) * (speedMul || 1), 12);
  }

  // ---------------------------------------------------------------- boids
  function boid(e, ai, sepR) {
    BV.cx = BV.cy = BV.ax = BV.ay = BV.sx = BV.sy = 0;
    let n = 0;
    for (const o of ai.nb) {
      if (isDead(o)) continue;
      const dx = o.x - e.x, dy = o.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      BV.cx += dx; BV.cy += dy;
      BV.ax += num(o.vx, 0); BV.ay += num(o.vy, 0);
      if (d < sepR) { const w = (sepR - d) / sepR; BV.sx -= dx / d * w; BV.sy -= dy / d * w; }
      n++;
    }
    BV.n = n;
    if (!n) return false;
    unit(BV, 'cx', 'cy', n);
    unit(BV, 'ax', 'ay', 1);
    return true;
  }

  function unit(o, kx, ky, div) {
    const x = o[kx] / div, y = o[ky] / div, l = Math.hypot(x, y);
    o[kx] = l > 1e-6 ? x / l : 0; o[ky] = l > 1e-6 ? y / l : 0;
  }

  const GROUP = {
    swarm:  { R: 80,  c: 0.6, a: 0.8, s: 1.4, sp: 0.7,  noise: 0.55, accel: 6 },
    school: { R: 90,  c: 0.7, a: 1.7, s: 1.0, sp: 0.65, noise: 0.35, accel: 5 },
    herd:   { R: 140, c: 0.6, a: 0.7, s: 1.0, sp: 0.45, noise: 0.4,  accel: 3 },
  };

  function groupBeh(e, dt, G, ai, kind) {
    const K = GROUP[kind];
    perceive(e, G, ai, 1, K.R);
    const has = boid(e, ai, e.r * 3 + 6);
    if (ai.fleeing) {
      fleeDir(e, ai, 0);
      let x = FD.x, y = FD.y;
      if (has) { x += BV.ax * 0.9 + BV.cx * 0.3 + BV.sx * 0.8; y += BV.ay * 0.9 + BV.cy * 0.3 + BV.sy * 0.8; }
      setState(e, ai, 'flee');
      drive(e, dt, x, y, fleeSpeed(e, ai) * (kind === 'herd' ? 1.1 : 1), 10);
      return;
    }
    if (kind === 'herd' && herdPause(e, dt, ai)) return;
    const f = fieldAngle(e, ai);
    let x = Math.cos(f) * K.noise, y = Math.sin(f) * K.noise;
    if (has) {
      x += BV.cx * K.c + BV.ax * K.a + BV.sx * K.s;
      y += BV.cy * K.c + BV.ay * K.a + BV.sy * K.s;
    }
    setState(e, ai, kind);
    drive(e, dt, x, y, baseSpeed(e) * K.sp, K.accel);
  }

  // Herds alternate between moving and grazing pauses.
  function herdPause(e, dt, ai) {
    ai.grazeCd -= dt;
    if (ai.pauseT > 0) {
      ai.pauseT -= dt;
      stand(e, dt, ai, 'graze');
      if (ai.pauseT <= 0) ai.grazeCd = rr(6, 12);
      return true;
    }
    if (ai.grazeCd <= 0) { ai.pauseT = rr(3, 6); return true; }
    return false;
  }

  // ---------------------------------------------------------------- simple grazer behaviors
  function producerFilter(o) {
    return o.role === 'producer' && o.sp !== 'carrion' && o.sp !== 'carcass' && !isDead(o) && num(o.amount, 0) > 0.2 && o !== _se.ai.gpPrev;
  }

  function findProducer(e, ai, radius) {
    _se = e;
    const near = A.query ? A.query(e.x, e.y, radius, producerFilter) : [];
    if (!near.length) return null;
    near.sort((a, b) => Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(b.x - e.x, b.y - e.y));
    return near[Math.floor(rnd() * Math.min(3, near.length))];
  }

  function grazeBeh(e, dt, G, ai) {
    perceive(e, G, ai, 1, 0);
    if (ai.fleeing) { ai.pauseT = 0; return fleeStep(e, dt, ai); }
    if (ai.pauseT > 0) {
      ai.pauseT -= dt;
      stand(e, dt, ai, 'graze');
      if (ai.pauseT <= 0) { ai.gpPrev = ai.gp; ai.gp = null; }
      return;
    }
    ai.findT -= dt;
    if (isDead(ai.gp) || num(ai.gp.amount, 0) <= 0.2) ai.gp = null;
    if (!ai.gp && ai.findT <= 0) {
      ai.gp = findProducer(e, ai, 450);
      if (!ai.gp) { ai.gpPrev = null; ai.findT = 1.5; }
    }
    const p = ai.gp;
    if (!p) return wander(e, dt, ai, baseSpeed(e) * 0.5, 'wander');
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy);
    if (d < (p.r || 8) * 0.6 + e.r) { ai.pauseT = rr(3, 7); return; }
    setState(e, ai, 'wander');
    drive(e, dt, dx, dy, baseSpeed(e) * 0.7);
  }

  function wanderBeh(e, dt, G, ai) {
    perceive(e, G, ai, 1, 0);
    if (ai.fleeing) return fleeStep(e, dt, ai);
    wander(e, dt, ai, baseSpeed(e) * 0.5, 'wander');
  }

  function crawlBeh(e, dt, G, ai) {
    perceive(e, G, ai, 1, 0);
    if (ai.fleeing) return fleeStep(e, dt, ai, 'flee', 0.75);  // weak flee: slower than other grazers
    // occasionally steer toward a nearby producer so bottom grazers actually graze
    ai.findT -= dt;
    if (ai.findT <= 0) {
      ai.findT = rr(4, 8);
      ai.gp = rnd() < 0.5 ? findProducer(e, ai, 300) : null;
    }
    if (ai.gp && !isDead(ai.gp)) {
      const dx = ai.gp.x - e.x, dy = ai.gp.y - e.y;
      if (Math.hypot(dx, dy) > e.r + 6) {
        setState(e, ai, 'crawl');
        return drive(e, dt, dx, dy, baseSpeed(e) * 0.35);
      }
    }
    wander(e, dt, ai, baseSpeed(e) * 0.35, 'crawl');
  }

  function driftBeh(e, dt, G, ai) {
    if (e.role !== 'producer') perceive(e, G, ai, 1, 0);
    const s = (e.speed > 0 ? e.speed : 20) * 0.3 * (0.65 + 0.35 * Math.sin(ai.clock * 0.8 + ai.ph));
    const h = ai.h + Math.sin(ai.clock * 0.3 + ai.ph) * 1.0;
    setState(e, ai, 'drift');
    drive(e, dt, Math.cos(h), Math.sin(h), s, 1.5);
  }

  // Burst movers: pause, then a short fast burst (hop 0.25s, scurry ~0.5s).
  const BURST = {
    hop:    { pause: [0.4, 1.0],  dur: [0.25, 0.25], state: 'hop',    idle: 'idle' },
    scurry: { pause: [0.5, 1.4],  dur: [0.3, 0.6],   state: 'scurry', idle: 'idle' },
  };

  function burstBeh(e, dt, G, ai, kind) {
    const B = BURST[kind];
    perceive(e, G, ai, 1, 0);
    if (ai.moving) {
      ai.burstT -= dt;
      const u = clamp(1 - ai.burstT / ai.burstDur, 0, 1);
      const v = baseSpeed(e) * (ai.fleeBurst ? 1 : 0.8) * (kind === 'hop' ? 0.55 + 0.45 * Math.sin(Math.PI * u) : 1);
      e.vx = ai.dirx * v; e.vy = ai.diry * v;
      turnToward(e, Math.atan2(ai.diry, ai.dirx), dt, 2);
      if (ai.burstT <= 0) {
        ai.moving = false;
        ai.pauseT = ai.fleeing ? rr(0.08, 0.2) : rr(B.pause[0], B.pause[1]);
        e.vx = e.vy = 0;
      }
      return;
    }
    setState(e, ai, B.idle);
    e.vx = e.vy = 0;
    ai.pauseT -= dt;
    turnToward(e, ai.h, dt);
    if (ai.fleeing && ai.pauseT > 0.2) ai.pauseT = 0.2;
    if (ai.pauseT > 0) return;
    // start a burst
    if (ai.fleeing) {
      fleeDir(e, ai, 0.5);
      ai.h = Math.atan2(FD.y, FD.x);
    } else {
      ai.h += rr(-1.2, 1.2);
      bendFromEdge(e, ai, 1);
    }
    ai.dirx = Math.cos(ai.h); ai.diry = Math.sin(ai.h);
    ai.fleeBurst = ai.fleeing;
    ai.burstDur = rr(B.dur[0], B.dur[1]);
    ai.burstT = ai.burstDur;
    ai.moving = true;
    setState(e, ai, B.state);
  }

  function flitBeh(e, dt, G, ai) {
    perceive(e, G, ai, 1, 0);
    ai.turnT -= dt;
    if (ai.turnT <= 0) {
      ai.turnT = rr(0.12, 0.35);
      ai.h += rr(0.5, 1.4) * (rnd() < 0.5 ? -1 : 1);
      ai.sp = rr(0.7, 1);
    }
    bendFromEdge(e, ai, dt);
    setState(e, ai, 'flit');
    if (ai.fleeing) {
      fleeDir(e, ai, 0);
      const a = Math.atan2(FD.y, FD.x) + Math.sin(ai.h * 3) * 0.8;
      return drive(e, dt, Math.cos(a), Math.sin(a), baseSpeed(e) * 1.05, 16);
    }
    drive(e, dt, Math.cos(ai.h), Math.sin(ai.h), baseSpeed(e) * ai.sp, 14);
  }

  // Ground birds: forage, then take off when threatened (alt > 0.5 = untouchable), fly away, land.
  function flockBeh(e, dt, G, ai) {
    perceive(e, G, ai, 1, 0);
    e.alt = clamp(num(e.alt, 0), 0, 1);
    const s = e.state;
    if (s === 'takeoff' || s === 'fly' || s === 'land') return flightStep(e, dt, ai, s);
    if (ai.fleeing && ai.urg > 0.1 && ai.cd <= 0) {
      fleeDir(e, ai, 0);
      const a = Math.atan2(FD.y, FD.x) + rr(-0.4, 0.4);
      ai.dirx = Math.cos(a); ai.diry = Math.sin(a);
      ai.flyT = rr(2, 3);
      return setState(e, ai, 'takeoff');
    }
    ai.cd -= dt;
    forage(e, dt, ai);
  }

  function forage(e, dt, ai) {
    if (ai.pauseT > 0) {
      ai.pauseT -= dt;
      return stand(e, dt, ai, 'graze');
    }
    ai.grazeCd -= dt;
    if (ai.grazeCd <= 0) { ai.pauseT = rr(1, 3); ai.grazeCd = rr(2, 5); return; }
    wander(e, dt, ai, baseSpeed(e) * 0.35, 'wander');
  }

  function flightStep(e, dt, ai, s) {
    const sp = baseSpeed(e);
    if (s === 'takeoff') {
      e.alt = Math.min(1, e.alt + dt / 0.4);
      drive(e, dt, ai.dirx, ai.diry, sp * 1.5, 10);
      if (e.alt >= 1) setState(e, ai, 'fly');
    } else if (s === 'fly') {
      e.alt = 1;
      ai.flyT -= dt;
      const a = Math.atan2(ai.diry, ai.dirx) + Math.sin(ai.clock * 1.3 + ai.ph) * 0.25 * dt;
      ai.dirx = Math.cos(a); ai.diry = Math.sin(a);
      bendDir(e, ai, dt);
      drive(e, dt, ai.dirx, ai.diry, sp * 1.8, 8);
      if (ai.flyT <= 0) setState(e, ai, 'land');
    } else {
      e.alt = Math.max(0, e.alt - dt / 0.4);
      drive(e, dt, ai.dirx, ai.diry, sp * 0.5, 6);
      if (e.alt <= 0) { ai.cd = 0.8; ai.h = Math.atan2(ai.diry, ai.dirx); setState(e, ai, 'wander'); }
    }
  }

  // Turn a stored direction (dirx,diry) away from walls.
  function bendDir(e, ai, dt) {
    edgePush(e.x, e.y);
    if (EP.m < 0.25) return;
    const a = Math.atan2(ai.diry, ai.dirx);
    const b = a + wrap(Math.atan2(EP.y, EP.x) - a) * Math.min(1, dt * 3) * EP.m;
    ai.dirx = Math.cos(b); ai.diry = Math.sin(b);
  }

  // ---------------------------------------------------------------- hunters
  const HUNT = {
    chase:  { roam: 0.6, approach: 1.0 },
    stalk:  { roam: 0.5, approach: 0.45, triggerR: 2.5 },
    ambush: { still: true, triggerR: 2.2, windup: 0.25 },
    pack:   { roam: 0.6, approach: 1.0, pack: true },
    charge: { roam: 0.4, approach: 0.6, windup: 0.5, mult: 2.5, lunge: 0.6, recover: 1.2 },
  };

  const satiated = (e, G) => G.time - num(e.lastAte, -999) < cfg('SATIATED_TIME', 6);

  function detectRadius(e, P) {
    if (P.still) return e.r * P.triggerR + 70;
    return e.r * 10 * (e.desperate ? 1.5 : 1);
  }

  function preyFilter(o) {
    return o !== _se && !o.isPlayer && !isDead(o) && o.role !== 'producer' && canEat(_se, o);
  }

  // Pick the best target: the player when desperate, else the closest (slightly favoring bigger) prey.
  function acquire(e, G, ai, P) {
    const detect = detectRadius(e, P);
    const p = G.player;
    let playerD = Infinity;
    if (playerTargetable(e, G)) {
      const stealth = num(p.stats && p.stats.stealthMul, 1);
      playerD = Math.hypot(p.x - e.x, p.y - e.y);
      if (playerD < detect * stealth && (e.desperate || e.tutorial)) return p;
      if (playerD >= detect * stealth) playerD = Infinity;
    }
    _se = e;
    const near = A.query ? A.query(e.x, e.y, detect, preyFilter) : [];
    let best = null, bestS = playerD + (p ? -p.r * 1.5 : 0);
    for (const o of near) {
      const s = Math.hypot(o.x - e.x, o.y - e.y) - o.r * 1.5;
      if (s < bestS) { bestS = s; best = o; }
    }
    if (!best && playerD < Infinity) best = p;
    if (best && P.pack) best = packTarget(e, ai, best);
    return best;
  }

  // Packmates converge on a target one of them already has.
  function packTarget(e, ai, own) {
    for (const nb of ai.nb) {
      const t = nb.ai && nb.ai.tgt;
      if (t && !isDead(t) && !isDead(nb) && Math.hypot(t.x - e.x, t.y - e.y) < e.r * 12) return t;
    }
    return own;
  }

  // A skink's tail decoy beats any other target.
  function decoyFilter(o) { return o.sp === 'decoy' && !isDead(o) && canEat(_se, o); }

  function findDecoy(e, P) {
    _se = e;
    const near = A.query ? A.query(e.x, e.y, detectRadius(e, P), decoyFilter) : [];
    let best = null, bd = Infinity;
    for (const o of near) {
      const d = Math.hypot(o.x - e.x, o.y - e.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  function validTarget(e, G, ai, P) {
    const t = ai.tgt;
    if (isDead(t)) return false;
    if (t.isPlayer && !playerTargetable(e, G)) return false;
    return Math.hypot(t.x - e.x, t.y - e.y) < detectRadius(e, P) * 1.4 + t.r;
  }

  function triggerDist(e, P, t, spd) {
    if (P.triggerR) return e.r * P.triggerR + t.r;
    const reach = spd * (P.mult || cfg('LUNGE_MULT', 2.3)) * (P.lunge || cfg('LUNGE_TIME', 0.35));
    return reach * 0.8 + e.r * 0.5 + t.r;
  }

  function runHunter(e, dt, G, ai, P) {
    const spd = baseSpeed(e) * (e.desperate ? 1.25 : 1);
    const fresh = perceive(e, G, ai, 0.6, P.pack ? 250 : 0);
    ai.noHunt -= dt;
    if (e.state === 'windup') return windupStep(e, dt, G, ai, P, spd);
    if (e.state === 'lunge') return lungeStep(e, dt, G, ai, P);
    if (e.state === 'recover') return recoverStep(e, dt, ai, P, spd);

    if (satiated(e, G)) {
      ai.tgt = e.target = null;
      return P.still ? stand(e, dt, ai, 'ambush') : wander(e, dt, ai, spd * 0.25, 'rest');
    }
    // hunters can be prey too: bigger things make them run (ambushers hold still)
    if (!P.still && ai.fleeing && ai.urg > 0.25) return fleeStep(e, dt, ai, 'flee', 1);

    if (fresh || ai.tgt) {
      if (!validTarget(e, G, ai, P)) ai.tgt = null;
      if (!ai.tgt && fresh && ai.noHunt <= 0) ai.tgt = acquire(e, G, ai, P);
    }
    if (fresh && !(ai.tgt && ai.tgt.sp === 'decoy')) {
      const dc = findDecoy(e, P);
      if (dc) { ai.tgt = dc; ai.chaseT = 0; }
    }
    e.target = ai.tgt;
    if (!ai.tgt) { ai.chaseT = 0; return roam(e, dt, G, ai, P, spd); }

    const t = ai.tgt;
    const d = Math.hypot(t.x - e.x, t.y - e.y);
    if (d < triggerDist(e, P, t, spd)) return startWindup(e, ai, t);
    if (P.still) return roam(e, dt, G, ai, P, spd);
    ai.chaseT += dt;
    if (ai.chaseT > 7) { ai.noHunt = 2.5; ai.tgt = e.target = null; ai.chaseT = 0; return; }
    approach(e, dt, ai, P, t, d, spd);
  }

  function approach(e, dt, ai, P, t, d, spd) {
    // aim a little ahead of a moving target; stalkers speed up once prey has noticed them
    let mul = P.approach;
    if (P.approach < 0.6 && !t.isPlayer && t.ai && t.ai.fleeing) mul = 0.9;
    const lead = 0.25;
    let ax = t.x + num(t.vx, 0) * lead - e.x, ay = t.y + num(t.vy, 0) * lead - e.y;
    if (P.pack && d > e.r * 5) {
      // flank: swing wide to one side, closing in as the distance shrinks
      const off = clamp(d * 0.35, 0, e.r * 5) * ai.side / (d || 1);
      ax += -(t.y - e.y) * off; ay += (t.x - e.x) * off;
      if (boid(e, ai, e.r * 3)) { ax += BV.sx * 40; ay += BV.sy * 40; }
    }
    setState(e, ai, P.approach < 0.6 ? 'stalk' : 'chase');
    drive(e, dt, ax, ay, spd * mul, 8);
  }

  function roam(e, dt, G, ai, P, spd) {
    if (P.still) return ambushRoam(e, dt, ai, spd);
    if (P.pack && boid(e, ai, e.r * 3)) {
      ai.h += (Math.sin(ai.clock * 0.9 + ai.ph) * 0.8) * dt;
      bendFromEdge(e, ai, dt);
      setState(e, ai, 'wander');
      const x = Math.cos(ai.h) * 0.5 + BV.cx * 0.6 + BV.ax * 0.5 + BV.sx * 1.0;
      const y = Math.sin(ai.h) * 0.5 + BV.cy * 0.6 + BV.ay * 0.5 + BV.sy * 1.0;
      ai.h = Math.atan2(y, x);
      return drive(e, dt, x, y, spd * P.roam);
    }
    wander(e, dt, ai, spd * P.roam, 'wander');
  }

  // Ambushers sit still, relocating after ~20s without prey.
  function ambushRoam(e, dt, ai, spd) {
    if (ai.wp) {
      const dx = ai.wp.x - e.x, dy = ai.wp.y - e.y;
      ai.idleT += dt;
      if (Math.hypot(dx, dy) < 30 || ai.idleT > 10) { ai.wp = null; ai.idleT = 0; return stand(e, dt, ai, 'ambush'); }
      setState(e, ai, 'wander');
      return drive(e, dt, dx, dy, spd * 0.5);
    }
    ai.idleT += dt;
    if (ai.idleT > 20 + ai.ph) {
      ai.idleT = 0;
      const m = 160;
      ai.wp = { x: rr(m, _W - m), y: rr(m, _W - m) };
    }
    stand(e, dt, ai, 'ambush');
  }

  function startWindup(e, ai, t) {
    ai.tgt = e.target = t;
    setState(e, ai, 'windup');
    emit('windup', { e: e, target: t });
  }

  function windupStep(e, dt, G, ai, P, spd) {
    const t = ai.tgt;
    if (isDead(t) || (t.isPlayer && !playerTargetable(e, G))) {
      ai.tgt = e.target = null;
      return setState(e, ai, P.still ? 'ambush' : 'wander');
    }
    const dx = t.x - e.x, dy = t.y - e.y;
    drive(e, dt, dx, dy, P.still ? 0 : spd * 0.12, 12);
    turnToward(e, Math.atan2(dy, dx), dt, 2);
    if (ai.st >= (P.windup || cfg('WINDUP', 0.35))) startLunge(e, ai, P, t, spd);
  }

  function startLunge(e, ai, P, t, spd) {
    const mult = P.mult || cfg('LUNGE_MULT', 2.3);
    const lt = P.lunge || cfg('LUNGE_TIME', 0.35);
    const speed = spd * mult;
    const d = Math.hypot(t.x - e.x, t.y - e.y);
    const tl = clamp(d / speed, 0, lt);
    const ax = t.x + num(t.vx, 0) * tl * 0.9 - e.x, ay = t.y + num(t.vy, 0) * tl * 0.9 - e.y;
    const len = Math.hypot(ax, ay) || 1;
    ai.lx = ax / len * speed; ai.ly = ay / len * speed;
    ai.ateMark = num(e.lastAte, -999);
    e.lungeEnd = false;
    e.angle = Math.atan2(ay, ax);
    setState(e, ai, 'lunge');
    emit('lunge', { e: e });
  }

  function lungeStep(e, dt, G, ai, P) {
    e.vx = ai.lx; e.vy = ai.ly;
    const ate = num(e.lastAte, -999) !== ai.ateMark;
    // core sets lungeEnd when the lunge connects with the player: the attack is spent
    if (ai.st >= (P.lunge || cfg('LUNGE_TIME', 0.35)) || (ate && ai.st > 0.05) || e.lungeEnd) {
      e.lungeEnd = false;
      ai.chaseT = 0;
      setState(e, ai, 'recover');
    }
  }

  function recoverStep(e, dt, ai, P, spd) {
    drive(e, dt, ai.lx, ai.ly, spd * 0.15, 4);
    if (ai.st >= (P.recover || cfg('RECOVER', 0.8))) {
      ai.tgt = e.target = null;
      ai.idleT = 0;
      setState(e, ai, P.still ? 'ambush' : 'wander');
    }
  }

  // ---------------------------------------------------------------- dive (hawks, eagles)
  // circle (alt 1) -> diveWindup 0.9s over the marked point -> dive (alt 0 over 0.35s) -> climb 1s
  const DIVE = { windup: 0.9, down: 0.35, hold: 0.25, climb: 1.0, coolDown: 2.5 };

  function runDive(e, dt, G, ai) {
    const spd = baseSpeed(e) * (e.desperate ? 1.25 : 1);
    const fresh = perceive(e, G, ai, 0.6, 0);
    ai.cd -= dt;
    if (e.alt == null || !isFinite(e.alt)) e.alt = 1;
    switch (e.state) {
      case 'diveWindup': return diveWindupStep(e, dt, ai, spd);
      case 'dive': return diveDownStep(e, dt, ai, spd);
      case 'climb': return diveClimbStep(e, dt, ai, spd);
    }
    e.alt = Math.min(1, e.alt + dt / 0.35);
    circle(e, dt, ai, spd);
    if (!fresh || ai.cd > 0 || satiated(e, G)) return;
    const t = acquire(e, G, ai, HUNT.chase);
    if (!t) return;
    // mark the ground point slightly ahead of the target: moving players can slip away, still ones cannot
    ai.tgt = e.target = t;
    e.tx = t.x + num(t.vx, 0) * 0.45; e.ty = t.y + num(t.vy, 0) * 0.45;
    setState(e, ai, 'diveWindup');
    emit('dive', { e: e, tx: e.tx, ty: e.ty });
  }

  function circle(e, dt, ai, spd) {
    if (!ai.orbit || ai.clock > ai.orbit.until) {
      const m = 350;
      ai.orbit = { x: clamp(e.x + rr(-500, 500), m, _W - m), y: clamp(e.y + rr(-500, 500), m, _W - m), until: ai.clock + rr(10, 18), R: rr(180, 260) };
    }
    const o = ai.orbit;
    ai.h += (spd * 0.8 / o.R) * dt * ai.side;
    const px = o.x + Math.cos(ai.h) * o.R, py = o.y + Math.sin(ai.h) * o.R;
    setState(e, ai, 'circle');
    drive(e, dt, px - e.x, py - e.y, spd * 0.8, 3);
  }

  function diveWindupStep(e, dt, ai, spd) {
    e.alt = 1;
    const dx = e.tx - e.x, dy = e.ty - e.y, d = Math.hypot(dx, dy);
    drive(e, dt, dx, dy, Math.min(spd * 0.9, d * 4), 8);
    if (ai.st >= DIVE.windup) { ai.ateMark = num(e.lastAte, -999); setState(e, ai, 'dive'); }
  }

  function diveDownStep(e, dt, ai, spd) {
    e.alt = Math.max(0, e.alt - dt / DIVE.down);
    const dx = e.tx - e.x, dy = e.ty - e.y, d = Math.hypot(dx, dy);
    drive(e, dt, dx, dy, Math.min(spd * cfg('LUNGE_MULT', 2.3), d / Math.max(dt, 1e-3) * 0.5), 20);
    const ate = num(e.lastAte, -999) !== ai.ateMark;
    if (ai.st >= DIVE.down + DIVE.hold || (ate && ai.st > DIVE.down)) setState(e, ai, 'climb');
  }

  function diveClimbStep(e, dt, ai, spd) {
    e.alt = Math.min(1, e.alt + dt / DIVE.climb);
    drive(e, dt, Math.cos(e.angle), Math.sin(e.angle), spd * 0.6, 3);
    if (e.alt >= 1) {
      ai.cd = DIVE.coolDown; ai.tgt = e.target = null;
      setState(e, ai, 'circle');
    }
  }

  // ---------------------------------------------------------------- dispatch
  const HUNTER_BEH = { chase: 1, stalk: 1, ambush: 1, pack: 1, charge: 1, dive: 1 };

  function update(e, dt, G) {
    if (!e || e.alive === false || !(dt > 0) || e.isPlayer) return;
    if (!G) G = A.G;
    if (!G || !isFinite(e.x) || !isFinite(e.y)) return;
    _G = G; _W = worldSize(G);
    if (!isFinite(e.vx)) e.vx = 0;
    if (!isFinite(e.vy)) e.vy = 0;

    let beh = e.beh || 'wander';
    if (e.role === 'producer') {
      if (beh !== 'drift') { e.vx = e.vy = 0; return; }
    } else if (e.role === 'hunter') {
      if (!HUNTER_BEH[beh]) beh = 'chase';
    } else {
      if (HUNTER_BEH[beh]) beh = 'wander';
      const flags = G.eco && G.eco.flags;
      if (flags && flags.boomSp && flags.boomSp === e.sp && beh !== 'static' && beh !== 'drift') beh = 'swarm';
    }

    const ai = getAI(e);
    ai.clock += dt; ai.st += dt; ai.scanT -= dt;
    if (e.role === 'producer' || !combatOverride(e, beh, dt, G, ai)) run(beh, e, dt, G, ai);
    sanitize(e);
  }

  // ---------------------------------------------------------------- combat states
  // The skink's tail: wriggles around where it fell until core removes it.
  function decoyBeh(e, dt, ai) {
    ai.h += Math.sin(ai.clock * 11 + ai.ph) * dt * 9;
    setState(e, ai, 'wander');
    drive(e, dt, Math.cos(ai.h), Math.sin(ai.h), baseSpeed(e) * (0.55 + 0.45 * Math.sin(ai.clock * 7)), 14);
    e.angle = wrap(ai.h + Math.sin(ai.clock * 17) * 0.5);
  }

  // Stun, angry chase, wounded flight and the tutorial's calm hunters take over from the species behavior.
  // Returns true when it drove the entity this step.
  function combatOverride(e, beh, dt, G, ai) {
    if (e.maxHp > 0 && e.role === 'hunter') {
      const f = e.hp / e.maxHp;
      if (!e.woundFlee && f < cfg('WOUND_FLEE', 0.3)) e.woundFlee = true;
      else if (e.woundFlee && f >= cfg('WOUND_RECOVER', 0.5)) e.woundFlee = false;
    }
    if (e.stunT > 0) {
      if (e.state === 'windup' || e.state === 'lunge') { ai.tgt = e.target = null; setState(e, ai, 'recover'); ai.st = 0; }
      if (e.state !== 'recover') setState(e, ai, 'stun');
      drive(e, dt, 0, 0, 0, 20);
      return true;
    }
    if (e.woundFlee) return woundedStep(e, dt, G, ai);
    if (e.angryT > 0 && e.alt < 0.5 && angryStep(e, dt, G, ai)) return true;
    const tut = G.tutorial;
    if (tut && tut.active && tut.calm && e.role === 'hunter' && !e.tutorial && e.state !== 'windup' && e.state !== 'lunge') {
      ai.tgt = e.target = null;
      wander(e, dt, ai, baseSpeed(e) * 0.2, 'rest');
      return true;
    }
    return false;
  }

  // Below 30% hp a hunter runs from whoever hurt it, and rests until it has healed back to 50%.
  function woundedStep(e, dt, G, ai) {
    const src = e.hurtBy && !isDead(e.hurtBy) ? e.hurtBy : G.player;
    ai.tgt = e.target = null;
    if (e.beh === 'dive') e.alt = Math.min(1, num(e.alt, 1) + dt / 0.35);
    if (!src || !isFinite(src.x)) { wander(e, dt, ai, baseSpeed(e) * 0.3, 'rest'); return true; }
    const dx = e.x - src.x, dy = e.y - src.y, d = Math.hypot(dx, dy) || 1;
    if (d > 520) { wander(e, dt, ai, baseSpeed(e) * 0.3, 'rest'); return true; }
    ai.fleeX = dx / d; ai.fleeY = dy / d; ai.urg = 1;
    fleeDir(e, ai, 0.2);
    setState(e, ai, 'flee');
    drive(e, dt, FD.x, FD.y, baseSpeed(e) * 1.1, 12);
    return true;
  }

  // An angry neutral chases the player and nips (NIP_DMG x sqrt(tier depth): every tier starts the player at the same size). Returns false when it lost interest.
  function angryStep(e, dt, G, ai) {
    const p = G.player;
    if (!p || p.alive === false || !isFinite(p.x) || G.mode !== 'play') { e.angryT = 0; return false; }
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy);
    if (d > cfg('ANGRY_LEASH', 400)) { e.angryT = 0; return false; }
    setState(e, ai, 'angry');
    const touch = (e.r + p.r) * 0.95;
    drive(e, dt, dx, dy, baseSpeed(e) * cfg('ANGRY_SPEED', 1.15) * (d < touch * 0.7 ? 0.3 : 1), 10);
    if (d < touch && e.nipCd <= 0 && num(p.invulnT, 0) <= 0 && A.damageEntity) {
      e.nipCd = cfg('NIP_CD', 1.1);
      e.biteT = 0.25;
      A.damageEntity(p, cfg('NIP_DMG', 4) * Math.sqrt(Math.max(1, num(G.tier && G.tier.depth, 1))), e, { kind: 'nip' });
    }
    return true;
  }

  function run(beh, e, dt, G, ai) {
    switch (beh) {
      case 'static': e.vx = e.vy = 0; return;
      case 'drift': return driftBeh(e, dt, G, ai);
      case 'graze': return grazeBeh(e, dt, G, ai);
      case 'hop': return burstBeh(e, dt, G, ai, 'hop');
      case 'scurry': return burstBeh(e, dt, G, ai, 'scurry');
      case 'flit': return flitBeh(e, dt, G, ai);
      case 'swarm': case 'school': case 'herd': return groupBeh(e, dt, G, ai, beh);
      case 'flock': return flockBeh(e, dt, G, ai);
      case 'crawl': return crawlBeh(e, dt, G, ai);
      case 'decoy': return decoyBeh(e, dt, ai);
      case 'dive': return runDive(e, dt, G, ai);
      case 'chase': case 'stalk': case 'ambush': case 'pack': case 'charge':
        return runHunter(e, dt, G, ai, HUNT[beh]);
      default: return wanderBeh(e, dt, G, ai);
    }
  }

  function sanitize(e) {
    if (!isFinite(e.vx)) e.vx = 0;
    if (!isFinite(e.vy)) e.vy = 0;
    if (!isFinite(e.angle)) e.angle = 0;
    if (e.alt != null && !isFinite(e.alt)) e.alt = 0;
  }

  // ---------------------------------------------------------------- player bots
  const BOT = {
    p: null, clock: 0, scanT: 0, threats: [], foods: [], target: null, h: 0,
    dashHold: 0, hungry: false, near: false,
    allThreats: [], finish: null, fight: false,
  };

  const botSpeed = (p) => num(p.speed, 0) > 0 ? p.speed : cfg('PLAYER_SPEED', 150) * num(p.stats && p.stats.speedMul, 1);
  const dashReach = (p) => botSpeed(p) * cfg('DASH_MULT', 2.6) * cfg('DASH_TIME', 0.25) * num(p.stats && p.stats.dashDistMul, 1);

  let _botMode = 'balanced';
  function botThreatFilter(o) {
    if (o.isPlayer || isDead(o) || o.role === 'producer') return false;
    if (o.beh === 'dive' && o.state === 'circle') return false;
    // bots that do not fight (greedy, passive) run from angry neutrals too; the balanced bot bites them instead
    if (_botMode !== 'balanced' && num(o.angryT, 0) > 0 && o.sp !== 'decoy') return true;
    return canEat(o, _se);
  }

  function botFoodFilter(o) {
    if (o === _se || isDead(o)) return false;
    if (o.role === 'producer' && num(o.amount, 1) <= 0.2) return false;
    return canEat(_se, o);
  }

  function scanBot(G, p, mode) {
    const B = BOT;
    _se = p; _botMode = mode;
    B.threats = A.query ? A.query(p.x, p.y, p.r * 9 + tierMaxR(G) * 3, botThreatFilter) : [];
    B.allThreats = B.threats;
    B.finish = null; B.fight = false;
    if (mode === 'balanced') findFinish(p);
    const energy = num(p.energy, 100);
    if (mode === 'passive') {
      if (energy < 30) B.hungry = true; else if (energy > 45) B.hungry = false;
    } else B.hungry = true;
    B.foods.length = 0;
    if (!B.hungry) { B.target = null; return; }
    let cand = A.query ? A.query(p.x, p.y, p.r * 14 + 60, botFoodFilter) : [];
    if (!cand.length && A.query) cand = A.query(p.x, p.y, 700, botFoodFilter);
    pickFood(G, p, mode, cand, energy);
    if (mode === 'balanced') pickFight(G, p);
    if (B.finish) { B.target = B.finish; B.fight = true; }
  }

  // ---- combat (balanced bot only): bite mid-size prey, finish weakened hunters, use the ability ----
  const hpFrac = (o) => (o.maxHp > 0 ? o.hp / o.maxHp : 1);
  const fightRatio = () => cfg('FIGHT_RATIO', 1.35);

  function botFightFilter(o) {
    if (o === _se || isDead(o) || o.role === 'producer' || o.sp === 'decoy' || !(o.maxHp > 0) || o.sick) return false;
    if (num(o.alt, 0) > 0.5 || canEat(_se, o) || o.r > _se.r * fightRatio()) return false;
    return !(o.role === 'hunter' && canEat(o, _se));      // hunters that can eat the player are handled by findFinish
  }

  // Hunters worth biting back: weakened, stunned, or recovering from a missed lunge right beside the player.
  function findFinish(p) {
    const B = BOT;
    if (hpFrac(p) < 0.4) return;
    let best = null, bd = Infinity;
    for (const t of B.threats) {
      if (isDead(t) || t.r > p.r * fightRatio()) continue;
      const d = Math.hypot(t.x - p.x, t.y - p.y);
      const weak = hpFrac(t) < 0.5 || t.woundFlee || (num(t.stunT, 0) > 0 && d < p.r * 6 + t.r) ||
        (t.state === 'recover' && d < p.r * 3 + t.r);
      if (weak && d < bd) { bd = d; best = t; }
    }
    if (best) { B.finish = best; B.threats = B.threats.filter((t) => t !== best); }
  }

  // Non-edible mid-size animals are worth the bites; value is mass over distance plus the time the fight takes.
  function pickFight(G, p) {
    const B = BOT;
    B.fight = false;
    if (!A.query || hpFrac(p) < 0.45) return;
    _se = p;
    const cand = A.query(p.x, p.y, p.r * 10 + 60, botFightFilter);
    if (!cand.length) return;
    const dmg = cfg('BITE_DMG', 9) * Math.sqrt(num(p.mass, 9)) * (1 + cfg('BITE_JAWS_BONUS', 0.25) * num(p.parts && p.parts.jaws, 0));
    let best = null, bestS = B.target ? num(B.targetScore, 0) : 0;
    for (const o of cand) {
      const gap = Math.max(Math.hypot(o.x - p.x, o.y - p.y) - p.r - o.r, 0);
      const bites = Math.max(1, Math.ceil(o.hp / dmg));
      const extra = bites * cfg('BITE_CD', 0.45) * botSpeed(p) * 0.5;
      const status = statusOf(o.sp);
      let s = (num(o.mass, o.r * o.r / 16) + 0.3) / (gap + 40 + p.r * 2 + extra) * 0.8;
      if (status === 'high') s *= 1.6; else if (status === 'low') s *= 0.35;
      s *= dangerNear(o);
      if (o === B.target) s *= 1.25;
      if (s > bestS) { bestS = s; best = o; }
    }
    if (best) { B.target = best; B.fight = true; }
  }

  // The one animal in reach worth biting this step (or null).
  const BITE_Q = [];
  function biteTarget(p) {
    const B = BOT;
    const reach = p.r * cfg('BITE_REACH', 1.4) + 10 - 2;
    _se = p;
    const near = A.query ? A.query(p.x, p.y, reach + tierMaxR(_G) + 4, botBiteFilter) : BITE_Q;
    let best = null, bd = Infinity;
    for (const o of near) {
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d - o.r * 0.7 > reach) continue;
      const want = o === B.target || o === B.finish || num(o.angryT, 0) > 0;
      if (want && d < bd) { bd = d; best = o; }
    }
    return best;
  }

  function botBiteFilter(o) {
    if (o === _se || isDead(o) || o.role === 'producer' || o.sp === 'decoy' || !(o.maxHp > 0) || num(o.alt, 0) > 0.5) return false;
    if (o.r > _se.r * fightRatio()) return false;
    return !canEat(_se, o);      // edible animals are simply eaten on contact
  }

  // Ability by species, used when it will matter. Returns true and sets out.ax/ay (aim) when it fires.
  function botAbility(p, out) {
    const B = BOT, ab = p.ability;
    if (!ab || !ab.id || num(ab.cdT, 0) > 0 || num(ab.activeT, 0) > 0 || num(p.stunT, 0) > 0) return false;
    const def = (A.SPECIES && A.SPECIES[p.sp] && A.SPECIES[p.sp].ability) || {};
    let aimed = null, ad = Infinity;
    for (const t of B.allThreats) {
      if (isDead(t) || (t.target && t.target !== p)) continue;
      const hot = t.state === 'windup' || t.state === 'lunge' || t.state === 'chase' || t.state === 'stalk';
      if (!hot) continue;
      const d = Math.hypot(t.x - p.x, t.y - p.y);
      if (d < ad) { ad = d; aimed = t; }
    }
    const striking = aimed && (aimed.state === 'windup' || aimed.state === 'lunge');
    const aim = (o) => { out.ax = o.x + num(o.vx, 0) * 0.15; out.ay = o.y + num(o.vy, 0) * 0.15; return true; };
    switch (ab.id) {
      case 'roll': return striking && ad < aimed.r + p.r * 3 + 40 ? aim(aimed) : false;
      case 'tail': return striking && ad < aimed.r + p.r * 4 + 70 ? aim(aimed) : false;
      case 'web': return aimed && ad < p.r * 9 && ad > p.r * 1.5 ? aim(aimed) : false;
      case 'charge':
        if (striking && ad < p.r * 7 + aimed.r) return aim(aimed);
        return B.fight && B.target && !isDead(B.target) && Math.hypot(B.target.x - p.x, B.target.y - p.y) < p.r * 5 ? aim(B.target) : false;
      case 'spray': {
        const range = (def.range || 3) * p.r;
        if (aimed && ad < range + aimed.r * 0.5) return aim(aimed);
        const t = B.target;
        return B.fight && t && !isDead(t) && Math.hypot(t.x - p.x, t.y - p.y) < range * 0.8 + t.r * 0.5 ? aim(t) : false;
      }
      case 'tongue': {
        const range = (def.range || 6) * p.r, t = B.target;
        if (t && !isDead(t) && t.role !== 'producer' && !B.fight && canEat(p, t)) {
          const d = Math.hypot(t.x - p.x, t.y - p.y);
          if (d > p.r * 1.8 && d - t.r < range) return aim(t);
        }
        return striking && ad < range ? aim(aimed) : false;
      }
      default: return false;
    }
  }

  function statusOf(sp) {
    return A.Eco && A.Eco.statusOf ? A.Eco.statusOf(sp) : 'ok';
  }

  function pickFood(G, p, mode, cand, energy) {
    const B = BOT;
    const smart = mode !== 'greedy';
    const pSpd = botSpeed(p);
    let best = null, bestS = 0;
    for (const o of cand) {
      const status = smart ? statusOf(o.sp) : 'ok';
      if (smart && mode === 'balanced' && G.final && energy >= 40 && status !== 'high') continue;
      if (smart && mode === 'balanced' && energy >= 35 && status === 'low') continue;   // let a scarce species recover
      const gap = Math.max(Math.hypot(o.x - p.x, o.y - p.y) - p.r - o.r, 0);
      const val = num(o.mass, o.r * o.r / 16) + 0.3;
      let s = val / (gap + 40 + p.r * 2);
      if (o.role === 'producer' && o.sp !== 'carcass') s *= 0.5;
      if (num(o.speed, 0) >= pSpd * 0.85 && o.state === 'flee') s *= 0.5;
      if (smart) {
        if (status === 'high') s *= 1.6; else if (status === 'low') s *= 0.35;
        if (o.sick) s *= 0.15;
      }
      s *= dangerNear(o);
      if (o === B.target) s *= 1.25;
      if (s > bestS) { bestS = s; best = o; }
    }
    B.target = best; B.targetScore = bestS;
  }

  // Foods sitting beside a hunter that can eat the player are not worth it.
  function dangerNear(o) {
    let m = 1;
    for (const t of BOT.threats) {
      const d = Math.hypot(t.x - o.x, t.y - o.y);
      if (d < t.r * 3.5 + o.r) m = Math.min(m, d < t.r * 2 ? 0.05 : 0.25);
    }
    return m;
  }

  // Repulsion from threats into R; flags a dodge when a hunter is committing to the player.
  const BR = { x: 0, y: 0, mag: 0, dash: false, dodgeX: 0, dodgeY: 0, dodge: false };

  function botThreats(p) {
    BR.x = BR.y = BR.mag = 0; BR.dash = false; BR.dodge = false;
    const dashDist = (o) => o.r + p.r * 3 + 50;
    for (const o of BOT.threats) {
      if (isDead(o)) continue;
      let ox = o.x, oy = o.y, range = p.r * 7 + o.r * 2.5;
      const diving = o.beh === 'dive' && (o.state === 'diveWindup' || o.state === 'dive');
      if (diving && isFinite(o.tx)) { ox = o.tx; oy = o.ty; range = 70 + p.r * 2; }
      else if (o.beh === 'ambush') range = o.r * 2.2 + p.r + 45;
      const dx = p.x - ox, dy = p.y - oy;
      const d = Math.hypot(dx, dy) || 1;
      const gap = Math.max(d - (diving ? 0 : o.r + p.r), 0);
      let w = clamp(1 - gap / range, 0, 1);
      if (!w) continue;
      const aimed = !o.target || o.target === p;
      if (o.state === 'windup' && aimed) w *= 2;
      else if (o.state === 'lunge' && aimed) w *= 3;
      else if (o.state === 'rest' || satiated(o, _G)) w *= 0.25;
      BR.x += dx / d * w * 1.8; BR.y += dy / d * w * 1.8;
      botDodge(p, o, dx / d, dy / d, d, aimed, diving, dashDist(o));
    }
    BR.mag = Math.hypot(BR.x, BR.y);
  }

  function botDodge(p, o, ax, ay, d, aimed, diving, dashDist) {
    const lunging = o.state === 'lunge' && aimed;
    const winding = o.state === 'windup' && aimed && num(o.stateT, 1) > 0.08;  // human-ish reaction delay
    const close = d < dashDist || (diving && d < 90 + p.r * 2);
    if (!(close && (lunging || winding || (diving && o.state === 'diveWindup')))) return;
    BR.dash = true;
    if (lunging) {
      // sidestep the committed straight line
      const vl = Math.hypot(o.vx, o.vy) || 1;
      let px = -o.vy / vl, py = o.vx / vl;
      if (px * ax + py * ay < 0) { px = -px; py = -py; }
      BR.dodge = true; BR.dodgeX = px + ax * 0.4; BR.dodgeY = py + ay * 0.4;
    }
  }

  function bot(G, dt) {
    const out = { dx: 0, dy: 0, dash: false, bite: false, ability: false, ax: NaN, ay: NaN };
    const p = G && G.player;
    if (!p || !isFinite(p.x) || !isFinite(p.y)) return out;
    _G = G; _W = worldSize(G);
    const B = BOT;
    if (B.p !== p) {
      B.p = p; B.clock = 0; B.scanT = 0; B.threats = []; B.target = null; B.dashHold = 0; B.h = rnd() * TAU; B.hungry = false;
    }
    dt = dt > 0 ? dt : 1 / 60;
    B.clock += dt; B.dashHold -= dt; B.scanT -= dt;
    const mode = (G.flags && G.flags.bot) || 'balanced';
    if (B.scanT <= 0) { B.scanT = 0.09; scanBot(G, p, mode); }

    botThreats(p);
    edgePush(p.x, p.y);
    const food = botFoodDir(p, mode);
    const wf = 1 - clamp(BR.mag, 0, 1);
    let x = food.x * wf + BR.x + EP.x * 2;
    let y = food.y * wf + BR.y + EP.y * 2;
    if (BR.dodge) { x = BR.dodgeX * 1.5 + EP.x * 2; y = BR.dodgeY * 1.5 + EP.y * 2; }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    if (isFinite(x) && isFinite(y)) { out.dx = x; out.dy = y; }
    out.dash = botWantsDash(p, food, BR.mag);
    if (out.dash) B.dashHold = 0.9;
    if (mode === 'balanced') {
      if (botAbility(p, out)) out.ability = true;
      else if (num(p.biteCdT, 0) <= 0) {
        const t = biteTarget(p);
        if (t) { out.bite = true; out.ax = t.x; out.ay = t.y; }
      }
    }
    return out;
  }

  // Direction toward the chosen food (with lead on moving prey), or a gentle wander. Sets .dist/.gap.
  const FOOD = { x: 0, y: 0, gap: Infinity, moving: false };
  function botFoodDir(p, mode) {
    const B = BOT, t = B.target;
    FOOD.x = FOOD.y = 0; FOOD.gap = Infinity; FOOD.moving = false;
    if (t && !isDead(t) && B.hungry) {
      const d = Math.hypot(t.x - p.x, t.y - p.y);
      const lead = clamp(d / Math.max(botSpeed(p), 1), 0, 0.5) * 0.8;
      let dx = t.x + num(t.vx, 0) * lead - p.x, dy = t.y + num(t.vy, 0) * lead - p.y;
      const l = Math.hypot(dx, dy) || 1;
      FOOD.x = dx / l; FOOD.y = dy / l;
      FOOD.gap = Math.max(d - p.r - t.r, 0);
      FOOD.moving = Math.hypot(num(t.vx, 0), num(t.vy, 0)) > 20;
      return FOOD;
    }
    // nothing to eat: wander (passive when full: barely move)
    B.h += (Math.sin(B.clock * 0.7) * 0.8 + Math.sin(B.clock * 1.9) * 0.4) * (1 / 60) * 1.5;
    const k = mode === 'passive' && !B.hungry ? 0.25 : 0.7;
    FOOD.x = Math.cos(B.h) * k; FOOD.y = Math.sin(B.h) * k;
    return FOOD;
  }

  function botWantsDash(p, food, danger) {
    const B = BOT;
    if (num(p.dashCdT, 0) > 0) return false;
    const energy = num(p.energy, 100);
    if (BR.dash) return energy >= cfg('DASH_COST', 4);
    if (B.dashHold > 0 || danger > 0.25 || energy <= 30 || !B.target) return false;
    const reach = dashReach(p);
    // dash only to close the last stretch on food that is just out of easy reach
    return food.gap < reach * 0.8 && food.gap > p.r * 1.5 && (FOOD.moving || food.gap > p.r * 3.5);
  }

  A.AI = { update: update, bot: bot };
})();
