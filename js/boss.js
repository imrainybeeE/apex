/* Apex boss: the legend beast of the final tier (tier.boss in config). It crashes in during the final hold as a
   surprise: the sky darkens, a horn sounds and an ancient cave bear arrives. Three phases of telegraphed attacks:
     1 (100-66%) stalk, charge down a marked lane (stunned if it misses), swipe up close
     2 (66-33%)  adds a rearing ground slam (dash out of the ring) and a roar shockwave that slows you
     3 (<33%)    enraged: blood-dark sky, thunder, chained charges, more slams
   Beating it ends the game. Dying to it brings you back at full size for another try (core's rebirth handles that).
   G.boss is the fight state; the UI reads it for the health bar. Events: bossArrive, bossPhase, bossWindup{kind},
   bossAttack{kind}, bossHit, bossStun, bossDeath, thunder. */
(function () {
  'use strict';
  const A = window.Apex = window.Apex || {};
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = () => (A.rand ? A.rand() : Math.random());
  const emit = (n, d) => { if (A.emit) A.emit(n, d || {}); };
  const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

  // Telegraph and attack timings (seconds); phase 3 shortens windups.
  const T = { arrive: 3.2, stalk: [1.2, 2.2], chargeWind: 0.95, charge: 0.8, chain: 0.45, stun: 1.7, swipeWind: 0.55,
    recover: 0.75, slamWind: 1.15, slamRecover: 1.1, roarWind: 0.7, phaseRoar: 1.4, death: 3.2 };

  let fight = null;   // internal state; mirrored to G.boss for the UI and core
  const vis = { dark: 0, red: 0, flash: 0, light: 0, thunderT: 0 };

  function cfgOf(G) { return G && G.tier && G.tier.boss; }
  function diff() { return (A.difficulty && A.difficulty()) || { enemyDmg: 1, bossHp: 1 }; }

  function reset() {
    fight = null;
    vis.dark = vis.red = vis.flash = vis.light = 0;
    if (A.G) A.G.boss = null;
  }

  function init() {
    if (A.on) A.on('tierStart', () => { const G = A.G; const retry = G && G.bossRetry; reset(); if (G) G.bossRetry = retry; });
    if (A.on) A.on('restart', reset);
  }

  function active() { return !!(fight && fight.e && fight.state !== 'done' && A.G && A.G.mode === 'play'); }

  // ---------------------------------------------------------------- start
  function maybeStart(G) {
    const B = cfgOf(G);
    if (!B || fight || !G.final || G.mode !== 'play' || G.bossDone) return;
    const at = G.bossRetry ? 2 : B.at;
    if ((G.finalHold || 0) < at && !(G.bossRetry && G.tierTime > 4)) return;
    G.bossRetry = false;
    fight = { B, state: 'arrive', t: 0, phase: 1, e: null, chain: 0, lane: null, ring: 0, swipeA: 0, hitDone: false, enraged: false };
    G.boss = { name: (A.SPECIES[B.sp] && A.SPECIES[B.sp].name) || 'The beast', title: 'Ancient cave bear', hp: 1, maxHp: 1, phase: 1, shown: 0 };
    emit('bossArrive', {});
    if (A.G.cam) A.G.cam.shake = Math.max(A.G.cam.shake || 0, 10);
  }

  function spawnBeast(G) {
    const B = fight.B, p = G.player, world = G.world || 1200;
    // burst in from off-screen on the far side of the player
    const a = Math.atan2(world / 2 - p.y, world / 2 - p.x) + (rand() - 0.5);
    const d = (G.cam ? (A.H || 800) / G.cam.zoom : 600) * 0.75;
    const x = clamp(p.x + Math.cos(a) * d, B.r, world - B.r), y = clamp(p.y + Math.sin(a) * d, B.r, world - B.r);
    const ro = { sp: B.sp, role: 'boss', beh: 'boss', r: B.r, n0: 0, speed: B.speed };
    const e = A.spawn(B.sp, ro, x, y, {});
    if (!e) return;
    e.boss = true;
    e.maxHp = e.hp = B.hp * (diff().bossHp || 1);
    e.angle = Math.atan2(p.y - y, p.x - x);
    fight.e = e;
    G.boss.maxHp = e.maxHp; G.boss.hp = e.hp;
  }

  // ---------------------------------------------------------------- update
  function update(G, dt) {
    tickVisuals(dt);
    if (!G || G.mode !== 'play') return;
    maybeStart(G);
    if (!fight) return;
    const p = G.player;
    fight.t += dt;
    if (fight.state === 'arrive') { arrive(G, dt); return; }
    const e = fight.e;
    if (!e) return;
    if (fight.state === 'dying') { dying(G, dt); return; }
    G.boss.hp = Math.max(0, e.hp); G.boss.shown = Math.min(1, G.boss.shown + dt * 2);
    if (!e.alive || e.hp <= 0) { startDeath(G); return; }
    if (!p || !p.alive) { e.vx *= 0.9; e.vy *= 0.9; return; }

    // phases at 66% and 33%
    const frac = e.hp / e.maxHp, want = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3;
    if (want > fight.phase && fight.state !== 'charge') {
      fight.phase = want; G.boss.phase = want;
      if (want === 3) { fight.enraged = true; vis.thunderT = 0.6; emit('bossEnrage', {}); }
      emit('bossPhase', { phase: want });
      go('phaseRoar');
    }

    // player abilities can interrupt briefly, never lock it down
    if (e.stunT > 0.6) e.stunT = 0.6;
    if (e.stunT > 0 && fight.state !== 'stunned') { e.vx *= 0.8; e.vy *= 0.8; return; }

    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1, toP = Math.atan2(dy, dx);
    const spd = fight.B.speed * (fight.enraged ? 1.18 : 1) * (e.slowT > 0 ? (e.slowMul || 0.6) : 1);
    const st = fight.state;

    if (st === 'stalk') {
      // circle at a distance, facing the player, then pick an attack
      const want = p.r * 2 + e.r * 2.2, side = fight.side || (fight.side = rand() < 0.5 ? 1 : -1);
      const radial = (d - want) / want, tang = toP + side * Math.PI / 2;
      move(e, Math.cos(toP) * radial * 1.6 + Math.cos(tang) * 0.7, Math.sin(toP) * radial * 1.6 + Math.sin(tang) * 0.7, spd * 0.8, dt);
      face(e, toP, dt, 6);
      if (fight.t >= fight.wait) pickAttack(d, e, p);
    } else if (st === 'chargeWind') {
      if (fight.t < 0.45) fight.lane.a = toP;   // tracks you briefly, then commits
      setLane(e);
      face(e, fight.lane.a, dt, 14);
      e.vx *= 0.85; e.vy *= 0.85;
      if (fight.t >= windOf('chargeWind')) { go('charge'); emit('bossAttack', { kind: 'charge' }); }
    } else if (st === 'charge') {
      const a = fight.lane.a;
      e.vx = Math.cos(a) * spd * 3.4; e.vy = Math.sin(a) * spd * 3.4; e.angle = a;
      if (!fight.hitDone && d < (e.r + p.r) * 0.85) { fight.hitDone = true; hurt(p, e, fight.B.charge, 'charge'); }
      const hitWall = e.x <= e.r + 2 || e.y <= e.r + 2 || e.x >= (G.world || 1200) - e.r - 2 || e.y >= (G.world || 1200) - e.r - 2;
      if (fight.t >= T.charge || hitWall) {
        if (fight.phase === 3 && fight.chain < 2) { fight.chain++; fight.lane = { a: toP }; go('chargeWind', T.chain); }
        else if (!fight.hitDone) { go('stunned'); emit('bossStun', {}); }
        else go('recover');
      }
    } else if (st === 'swipeWind') {
      fight.swipeA = toP; face(e, toP, dt, 10); e.vx *= 0.8; e.vy *= 0.8;
      if (fight.t >= windOf('swipeWind')) {
        emit('bossAttack', { kind: 'swipe' });
        if (d < e.r * 1.9 + p.r && angDiff(toP, e.angle) < 1.15) hurt(p, e, fight.B.swipe, 'swipe');
        go('recover');
      }
    } else if (st === 'slamWind') {
      e.vx *= 0.8; e.vy *= 0.8; face(e, toP, dt, 4);
      fight.ring = clamp(fight.t / windOf('slamWind'), 0, 1);
      if (fight.t >= windOf('slamWind')) {
        emit('bossAttack', { kind: 'slam' });
        if (A.G.cam) A.G.cam.shake = Math.max(A.G.cam.shake || 0, 16);
        if (A.FX && A.FX.burst) A.FX.burst(e.x, e.y, { colors: ['#F4F8FF', '#DCE6F2', '#9AA8B6'], n: 40, r: e.r * 1.2, speed: 14, size: 0.3, life: 0.9 });
        if (d < slamR(e) + p.r * 0.5) hurt(p, e, fight.B.slam, 'slam');
        go('slamRecover');
      }
    } else if (st === 'roarWind') {
      e.vx *= 0.8; e.vy *= 0.8; face(e, toP, dt, 8);
      if (fight.t >= windOf('roarWind')) {
        emit('bossAttack', { kind: 'roar' });
        if (A.G.cam) A.G.cam.shake = Math.max(A.G.cam.shake || 0, 8);
        if (d < e.r * 5 && angDiff(toP, e.angle) < 0.85) {
          hurt(p, e, fight.B.roar, 'roar');
          p.slowT = Math.max(p.slowT || 0, 2); p.slowMul = 0.5;
        }
        fight.roarT = 0;
        go('recover');
      }
    } else if (st === 'phaseRoar') {
      e.vx *= 0.85; e.vy *= 0.85; face(e, toP, dt, 6);
      if (fight.t >= T.phaseRoar) go('stalk');
    } else if (st === 'stunned' || st === 'recover' || st === 'slamRecover') {
      e.vx *= 0.82; e.vy *= 0.82;
      if (st === 'stunned') e.stunT = Math.max(e.stunT, 0.05);
      const len = st === 'stunned' ? T.stun : st === 'slamRecover' ? T.slamRecover : T.recover;
      if (fight.t >= len) go('stalk');
    }
    if (fight.roarT != null) fight.roarT += dt;
    G.boss.state = fight.state;
  }

  function windOf(k) { return T[k] * (fight.enraged ? 0.72 : 1); }
  function slamR(e) { return e.r * 3.2; }
  function setLane(e) { fight.lane.x = e.x; fight.lane.y = e.y; fight.lane.len = fight.B.speed * 3.4 * T.charge + e.r; fight.lane.w = e.r * 1.9; }

  function go(state, wait) {
    fight.state = state; fight.t = 0; fight.hitDone = false;
    if (state === 'stalk') { fight.wait = T.stalk[0] + rand() * (T.stalk[1] - T.stalk[0]) * (fight.enraged ? 0.5 : 1); fight.side = 0; fight.chain = 0; }
    if (state === 'chargeWind' && wait != null) fight.t = windOf('chargeWind') - wait;
    if (state.endsWith('Wind') || state === 'phaseRoar') emit('bossWindup', { kind: state.replace('Wind', '') });
  }

  function pickAttack(d, e, p) {
    const ph = fight.phase, r = rand();
    if (d < e.r * 1.9 + p.r && r < 0.7) { go('swipeWind'); return; }
    if (ph >= 2 && r < (ph === 3 ? 0.4 : 0.3)) { fight.ring = 0; go('slamWind'); return; }
    if (ph >= 2 && r < (ph === 3 ? 0.55 : 0.45) && (fight.roarT == null || fight.roarT > 6)) { go('roarWind'); return; }
    fight.lane = { a: Math.atan2(p.y - e.y, p.x - e.x) };
    go('chargeWind');
  }

  function move(e, dx, dy, spd, dt) {
    const len = Math.hypot(dx, dy) || 1, k = 1 - Math.exp(-dt * 4);
    e.vx += (dx / len * spd * Math.min(1, len) - e.vx) * k;
    e.vy += (dy / len * spd * Math.min(1, len) - e.vy) * k;
  }
  function face(e, a, dt, rate) {
    const d = Math.atan2(Math.sin(a - e.angle), Math.cos(a - e.angle));
    e.angle += d * Math.min(1, dt * rate);
  }

  // Boss damage is a share of the player's full health, scaled by difficulty.
  function hurt(p, e, share, kind) {
    if (!A.damageEntity) return;
    const amount = (p.maxHp || 100) * share * (diff().enemyDmg || 1);
    const dealt = A.damageEntity(p, amount, e, { kind: 'lunge', boss: true });
    if (dealt > 0) emit('bossHit', { kind });
  }

  // ---------------------------------------------------------------- arrival and death
  function arrive(G, dt) {
    if (!fight.e && fight.t >= 1.4) spawnBeast(G);
    const e = fight.e, p = G.player;
    if (e && p) {   // it charges in toward you
      const a = Math.atan2(p.y - e.y, p.x - e.x);
      move(e, Math.cos(a), Math.sin(a), fight.B.speed * 1.6, dt);
      face(e, a, dt, 8);
      G.boss.shown = Math.min(1, G.boss.shown + dt);
    }
    if (fight.t >= T.arrive && e) go('stalk');
  }

  function startDeath(G) {
    fight.state = 'dying'; fight.t = 0;
    G.timeScale = 0.35;
    emit('bossDeath', {});
    if (G.cam) G.cam.shake = Math.max(G.cam.shake || 0, 18);
  }
  function dying(G, dt) {
    G.boss.hp = 0;
    if (fight.t >= T.death * 0.35) {   // timeScale is slowed, so this is about 3s of real time
      G.timeScale = 1; G.bossDone = true; fight.state = 'done';
      G.boss = null;
      if (A.victory) A.victory();
    }
  }

  // ---------------------------------------------------------------- visuals
  function tickVisuals(dt) {
    const G = A.G, on = !!(fight && fight.state !== 'done' && G && (G.mode === 'play' || G.mode === 'dying' || G.mode === 'paused'));
    const dying = fight && fight.state === 'dying';
    vis.dark += ((on && !dying ? 1 : 0) - vis.dark) * Math.min(1, dt * (on ? 0.8 : 1.5));
    vis.red += ((fight && fight.enraged && !dying ? 1 : 0) - vis.red) * Math.min(1, dt * 0.7);
    vis.light += ((dying || (G && G.mode === 'victory' && G.bossDone) ? 1 : 0) - vis.light) * Math.min(1, dt * 0.9);
    vis.flash = Math.max(0, vis.flash - dt * 2.2);
    if (fight && fight.enraged && G && G.mode === 'play' && !dying) {
      vis.thunderT -= dt;
      if (vis.thunderT <= 0) { vis.flash = 1; vis.thunderT = 3.5 + Math.random() * 4; emit('thunder', {}); if (G.cam) G.cam.shake = Math.max(G.cam.shake || 0, 5); }
    }
  }

  const X = (x, cam) => (x - cam.x) * cam.zoom + (A.W || 0) / 2 + (cam.shakeX || 0);
  const Y = (y, cam) => (y - cam.y) * cam.zoom + (A.H || 0) / 2 + (cam.shakeY || 0);

  // Telegraphs on the ground (screen space): charge lane, slam ring, swipe arc, roar cone.
  function drawGround(ctx, cam, t) {
    if (!fight || !fight.e || !cam || fight.state === 'dying') return;
    const e = fight.e, z = cam.zoom, st = fight.state, pulse = 0.5 + 0.5 * Math.sin(t * 14);
    ctx.save();
    if (st === 'chargeWind' && fight.lane) {
      const L = fight.lane, k = clamp(fight.t / windOf('chargeWind'), 0, 1);
      ctx.translate(X(e.x, cam), Y(e.y, cam)); ctx.rotate(L.a);
      const w = L.w * z, len = L.len * z;
      const g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, 'rgba(255,90,95,' + (0.18 + 0.25 * k) + ')'); g.addColorStop(1, 'rgba(255,90,95,0.05)');
      ctx.fillStyle = g; ctx.fillRect(0, -w / 2, len, w);
      ctx.strokeStyle = 'rgba(255,120,120,' + (0.45 + 0.4 * pulse * k) + ')'; ctx.lineWidth = 3;
      ctx.strokeRect(0, -w / 2, len, w);
      for (let i = 1; i <= 4; i++) {   // chevrons showing the direction
        const x = len * (i / 5) * Math.min(1, k * 1.4);
        ctx.beginPath(); ctx.moveTo(x - w * 0.18, -w * 0.28); ctx.lineTo(x, 0); ctx.lineTo(x - w * 0.18, w * 0.28); ctx.stroke();
      }
    } else if (st === 'slamWind') {
      const R = slamR(e) * z, k = fight.ring;
      ctx.translate(X(e.x, cam), Y(e.y, cam));
      ctx.fillStyle = 'rgba(255,90,95,' + (0.08 + 0.14 * k) + ')';
      ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,110,110,' + (0.6 + 0.4 * pulse) + ')'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,230,230,0.85)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, R * k, 0, TAU); ctx.stroke();   // the closing ring: be out before it reaches the edge
    } else if (st === 'swipeWind') {
      const R = (e.r * 1.9) * z, k = clamp(fight.t / windOf('swipeWind'), 0, 1);
      ctx.translate(X(e.x, cam), Y(e.y, cam));
      ctx.fillStyle = 'rgba(255,90,95,' + (0.12 + 0.25 * k) + ')';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, e.angle - 1.15, e.angle + 1.15); ctx.closePath(); ctx.fill();
    } else if (st === 'roarWind') {
      const R = e.r * 5 * z, k = clamp(fight.t / windOf('roarWind'), 0, 1);
      ctx.translate(X(e.x, cam), Y(e.y, cam));
      ctx.fillStyle = 'rgba(127,232,212,' + (0.08 + 0.16 * k) + ')';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, e.angle - 0.85, e.angle + 0.85); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(127,232,212,' + (0.5 + 0.4 * pulse) + ')'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, R * k, e.angle - 0.85, e.angle + 0.85); ctx.stroke();
    } else if (st === 'stunned') {   // stars over its head: hit it now
      ctx.translate(X(e.x, cam), Y(e.y, cam));
      ctx.fillStyle = '#F2D94E';
      for (let i = 0; i < 4; i++) {
        const a = t * 4 + i * TAU / 4, rr = e.r * 0.9 * z;
        ctx.beginPath(); ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr * 0.4 - e.r * 0.6 * z, Math.max(3, e.r * 0.12 * z), 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }

  // Sky: darkens on arrival, blood-dark when enraged, thunder flashes; light breaks through when it falls.
  function drawScreen(ctx, t) {
    const W = A.W || 0, H = A.H || 0;
    if (vis.dark < 0.01 && vis.light < 0.01 && vis.flash < 0.01) return;
    ctx.save();
    if (vis.dark > 0.01) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgba(' + Math.round(70 + 60 * vis.red) + ',' + Math.round(76 - 40 * vis.red) + ',' + Math.round(110 - 60 * vis.red) + ',' + (0.55 * vis.dark).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(' + Math.round(20 + 40 * vis.red) + ',4,10,' + (0.6 * vis.dark).toFixed(3) + ')');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    if (vis.flash > 0.01) { ctx.fillStyle = 'rgba(235,240,255,' + (0.55 * vis.flash * vis.flash).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }
    if (vis.light > 0.01) {   // the clouds break
      ctx.globalCompositeOperation = 'screen';
      const g = ctx.createRadialGradient(W * 0.5, -H * 0.2, 0, W * 0.5, -H * 0.2, H * 1.3);
      g.addColorStop(0, 'rgba(255,236,190,' + (0.55 * vis.light).toFixed(3) + ')'); g.addColorStop(1, 'rgba(255,236,190,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- autoplay bot (sims and smoke tests)
  function bot(G, dt) {
    const out = { dx: 0, dy: 0, dash: false, bite: false, ability: false };
    const p = G.player, e = fight && fight.e;
    if (!p || !e) return out;
    const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d, st = fight.state;
    const away = () => { out.dx = -ux; out.dy = -uy; };
    if (st === 'chargeWind' || st === 'charge') {
      // step out of the lane sideways
      const a = fight.lane ? fight.lane.a : Math.atan2(-dy, -dx), nx = -Math.sin(a), ny = Math.cos(a);
      const side = ((p.x - e.x) * nx + (p.y - e.y) * ny) >= 0 ? 1 : -1;
      out.dx = nx * side; out.dy = ny * side;
      const off = Math.abs((p.x - e.x) * nx + (p.y - e.y) * ny);
      if (off < (fight.lane ? fight.lane.w : e.r * 2) * 0.7 && (st === 'charge' || fight.t > windOf('chargeWind') * 0.6)) out.dash = true;
    } else if (st === 'slamWind') {
      away(); if (d < slamR(e) + p.r && fight.ring > 0.45) out.dash = true;
    } else if (st === 'swipeWind' || st === 'roarWind' || st === 'phaseRoar') {
      away(); if (d < e.r * 2.4 && fight.t > 0.25) out.dash = true;
      if (st === 'roarWind') { out.dx = -uy; out.dy = ux; }
    } else if (st === 'stunned' || st === 'recover' || st === 'slamRecover') {
      out.dx = ux; out.dy = uy; if (d < e.r + p.r * 1.6) out.bite = true;
      if (st === 'stunned' && p.ability && !(p.ability.cdT > 0)) out.ability = true;
    } else {   // stalking: keep some distance, nip in when close
      const want = e.r * 2.6;
      out.dx = ux * (d - want) / want - uy * 0.6; out.dy = uy * (d - want) / want + ux * 0.6;
      if (d < e.r + p.r * 1.5) out.bite = true;
    }
    return out;
  }

  A.Boss = { init, update, drawGround, drawScreen, bot, active, stats() { return fight ? { state: fight.state, phase: fight.phase, hp: fight.e ? Math.round(fight.e.hp) : null } : null; } };
})();
