// fx.js - game feel layer: particles, floating text, overlays, threat arrows,
// and the two signature sequences (decomposition after death, evolve transition).
(function () {
  'use strict';
  const A = window.Apex = window.Apex || {};

  // ---------------------------------------------------------------- constants
  const TAU = Math.PI * 2;
  // Meaning-bound palette (docs/DESIGN.md, M1.5): leaf = food/growth, venom = danger/damage,
  // spore = harmony/DNA, pollen = score/combo/ability ready, bone = text over the world.
  const COL = {
    grow: '#8FD14F', danger: '#FF5A5F', dna: '#7FE8D4', warn: '#F2D94E',
    ink: '#14261D', text: '#EFE8DA', harmony: '#7FE8D4', white: '#FFFFFF',
    poison: '#8FD14F', shard: '#DDF6FF', bone: '#EFE8DA', soil: '#1B1612', tongue: '#F29AA6',
  };
  const FONT_NUM = '800 {s}px "Bricolage Grotesque", "Segoe UI", system-ui, sans-serif';
  const FONT_TXT = '700 {s}px "Atkinson Hyperlegible", "Segoe UI", system-ui, sans-serif';
  const MISHAP_TINT = {
    famine: '#FF5A4E', boom: '#7DB82F', disease: '#5FA32B', barren: '#9A8E6C', surge: '#B3151F',
  };
  const MAX_PARTICLES = 600;
  const MAX_TEXTS = 24;
  const K = { DOT: 0, RING: 1, SHARD: 2, BUBBLE: 3, STREAK: 4, CRUMB: 5, STAR: 6 };

  // ---------------------------------------------------------------- state
  const S = {
    t: 0,
    pool: [], cur: 0, active: 0,
    texts: [], dives: [], dashes: [], pulses: [], flashes: [],
    glows: {}, rgb: {},
    growthStep: 0, evolveGlow: false, sparkT: 0, bubbleT: 0, migrations: [],
    deco: null, layer: null, evoSparks: null, warned: {},
    casts: [], bites: [], orb: { x: 0, y: 0, t: 0, on: false, ready: null },
    hpSeen: new WeakMap(), zoneSeen: new WeakMap(), hpFullT: 9, hlSrc: null, hlSet: null,
  };
  for (let i = 0; i < MAX_PARTICLES; i++) {
    S.pool.push({ kind: 0, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, size1: 1, c: '#fff',
      grav: 0, drag: 0, add: false, rot: 0, vr: 0, a0: 1, lw: 2 });
  }

  // ---------------------------------------------------------------- small helpers
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const rr = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const cfg = (k, d) => { const c = A.CFG; return c && c[k] != null ? c[k] : d; };
  const viewW = () => A.W || 1280;
  const viewH = () => A.H || 800;
  const dpr = () => A.DPR || 1;
  const player = () => (A.G && A.G.player) || null;

  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // '#rrggbb' -> 'rgba(r,g,b,a)'
  function rgba(hex, a) {
    let c = S.rgb[hex];
    if (!c) {
      let h = String(hex).replace('#', '');
      if (h.length === 3) h = h.split('').map((x) => x + x).join('');
      const n = parseInt(h, 16) || 0;
      c = S.rgb[hex] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + clamp(a, 0, 1).toFixed(3) + ')';
  }
  function normColor(c, fallback) {
    if (typeof c === 'string' && c.charAt(0) === '#') return c;
    if (c === 'red') return COL.danger;
    if (c === 'white') return COL.white;
    return fallback || COL.white;
  }

  function makeCanvas(w, h) {
    try {
      if (typeof document !== 'undefined' && document.createElement) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        return c;
      }
    } catch (e) { /* no canvas available */ }
    return null;
  }

  // Soft round glow sprite per colour; drawn with drawImage (no per-frame gradients or blur).
  function glowSprite(color) {
    let c = S.glows[color];
    if (c !== undefined) return c;
    c = makeCanvas(64, 64);
    const g = c && c.getContext && c.getContext('2d');
    if (g) {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, rgba(color, 1));
      gr.addColorStop(0.35, rgba(color, 0.4));
      gr.addColorStop(1, rgba(color, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
    } else c = null;
    S.glows[color] = c;
    return c;
  }
  function glowAt(ctx, color, x, y, r, a) {
    if (a <= 0.003 || r <= 0) return;
    const s = glowSprite(color);
    ctx.globalAlpha = Math.min(1, a);
    if (s) ctx.drawImage(s, x - r, y - r, 2 * r, 2 * r);
    else {
      ctx.fillStyle = color;
      ctx.globalAlpha = Math.min(1, a) * 0.4;
      ctx.beginPath(); ctx.arc(x, y, r * 0.6, 0, TAU); ctx.fill();
    }
  }

  // World -> screen (Appendix D). Result in px/py to avoid allocations.
  let px = 0, py = 0;
  function proj(x, y, cam) {
    cam = cam || (A.G && A.G.cam);
    const z = (cam && cam.zoom) || 1;
    px = (x - ((cam && cam.x) || 0)) * z + viewW() / 2 + ((cam && cam.shakeX) || 0);
    py = (y - ((cam && cam.y) || 0)) * z + viewH() / 2 + ((cam && cam.shakeY) || 0);
  }
  function onScreen(x, y, pad) {
    proj(x, y);
    return px > -pad && px < viewW() + pad && py > -pad && py < viewH() + pad;
  }
  function setWorld(ctx, cam) {
    if (A.applyCam) { A.applyCam(ctx, cam); return; }
    const D = dpr(), z = cam.zoom || 1;
    ctx.setTransform(D * z, 0, 0, D * z,
      D * (viewW() / 2 - cam.x * z + (cam.shakeX || 0)),
      D * (viewH() / 2 - cam.y * z + (cam.shakeY || 0)));
  }
  function setScreen(ctx) { const D = dpr(); ctx.setTransform(D, 0, 0, D, 0, 0); }

  function canEatFn(a, b) {
    if (A.canEat) return !!A.canEat(a, b);
    const ratio = (a.stats && a.stats.eatRatio) || cfg('EAT_RATIO', 0.92);
    return b.r < a.r * ratio;
  }
  function colorsOf(sp, pal) {
    const look = A.LOOKS && A.LOOKS[sp];
    const lp = look && look.pal;
    const out = [];
    const body = (pal && pal.body) || (lp && lp.body);
    const acc = (pal && pal.accent) || (lp && lp.accent);
    if (body) out.push(body);
    if (acc) out.push(acc);
    if (lp && lp.belly) out.push(lp.belly);
    if (!out.length) out.push('#8BD36B', COL.grow);
    return out;
  }

  // ---------------------------------------------------------------- particles
  function emit(kind, x, y, vx, vy, life, size, color, o) {
    const p = S.pool[S.cur];
    S.cur = (S.cur + 1) % MAX_PARTICLES;
    p.kind = kind; p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = p.max = life; p.size = size;
    p.size1 = o && o.size1 != null ? o.size1 : size;
    p.c = color;
    p.grav = (o && o.grav) || 0; p.drag = (o && o.drag) || 0;
    p.add = !!(o && o.add);
    p.rot = (o && o.rot) || 0; p.vr = (o && o.vr) || 0;
    p.a0 = o && o.a0 != null ? o.a0 : 1;
    p.lw = (o && o.lw) || 2;
  }

  function burst(x, y, o) {
    o = o || {};
    const pl = player();
    const sc = o.r || (pl && pl.r) || 12;
    const cols = o.colors && o.colors.length ? o.colors : [o.color || COL.grow];
    const n = o.n != null ? o.n : 12;
    const speed = (o.speed || 6) * sc, size = (o.size || 0.22) * sc, life = o.life || 0.6;
    const a0 = o.angle || 0, arc = o.arc != null ? o.arc : TAU;
    const kind = o.kind != null ? o.kind : K.DOT;
    const drag = o.drag != null ? o.drag : 2.4;
    for (let i = 0; i < n; i++) {
      const a = arc >= TAU ? Math.random() * TAU : a0 + (Math.random() - 0.5) * arc;
      const s = speed * rr(0.35, 1);
      emit(kind, x, y, Math.cos(a) * s, Math.sin(a) * s, life * rr(0.6, 1.1), size * rr(0.6, 1.25), pick(cols),
        { drag, grav: (o.grav || 0) * sc, add: o.add !== false && kind !== K.SHARD, size1: size * 0.25,
          rot: Math.random() * TAU, vr: rr(-9, 9) });
    }
    if (o.crumbs) {
      for (let i = 0; i < o.crumbs; i++) {
        const a = Math.random() * TAU, s = speed * rr(0.2, 0.7);
        emit(K.CRUMB, x, y, Math.cos(a) * s, Math.sin(a) * s, life * rr(0.8, 1.4), size * rr(0.5, 0.9), pick(cols),
          { drag: 2.2, grav: 3 * sc, size1: size * 0.3, rot: Math.random() * TAU, vr: rr(-12, 12) });
      }
    }
    if (o.ring) ring(x, y, o.ringColor || cols[0], sc * (o.ringR || 2.6), o.ringLife || 0.45, 0.35 * sc, o.ringW || 3);
  }

  function ring(x, y, color, r1, life, r0, lw) {
    emit(K.RING, x, y, 0, 0, life || 0.5, r0 != null ? r0 : r1 * 0.2, color, { size1: r1, add: true, lw: lw || 2.5 });
  }

  function text(x, y, s, o) {
    o = o || {};
    if (S.texts.length >= MAX_TEXTS) S.texts.shift();
    S.texts.push({
      x, y, s: String(s), c: normColor(o.color, COL.grow), size: o.size || 18,
      life: o.life || 0.95, age: 0, dy: o.dy || 0, rise: o.rise != null ? o.rise : 44, num: !!o.num,
    });
  }

  function reduced() {
    if (S.reduce == null) {
      try { S.reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { S.reduce = false; }
    }
    return S.reduce;
  }
  function shake(a) {
    if (reduced()) return;
    const g = A.G;
    if (g && g.cam) g.cam.shake = Math.max(g.cam.shake || 0, a);
  }
  function flash(color, a) {
    const c = normColor(color, COL.white);
    a = (a == null ? 0.3 : a) * (reduced() ? 0.4 : 1);
    if (S.flashes.length >= 3) S.flashes.shift();
    S.flashes.push({ c, a, t: 0, dur: 0.35 });
  }

  // ---------------------------------------------------------------- event reactions
  function onPlayerEat(d) {
    const f = d && d.food;
    const pl = player();
    if (!f) return;
    const cols = colorsOf(f.sp, f.pal);
    const sc = Math.max(f.r || 6, ((pl && pl.r) || 12) * 0.5);
    burst(f.x, f.y, { colors: cols, n: clamp(8 + sc * 0.8, 8, 22), r: sc, speed: 5, crumbs: 5, ring: true, ringR: 1.8, ringLife: 0.3, ringW: 2 });
    if (pl) { // a few motes get pulled into the eater
      for (let i = 0; i < 4; i++) {
        emit(K.STAR, f.x + rr(-sc, sc) * 0.4, f.y + rr(-sc, sc) * 0.4, (pl.x - f.x) * 4, (pl.y - f.y) * 4, 0.35,
          sc * 0.35, COL.grow, { add: true, drag: 3, size1: sc * 0.1, rot: Math.random() * TAU });
      }
    }
    const pts = Math.round(d.points || 0);
    if (pts > 0) text(f.x, f.y, '+' + pts, { color: COL.grow, size: clamp(16 + Math.sqrt(pts) * 1.2, 16, 34) });
    if (d.dna >= 1) text(f.x, f.y, '+' + Math.round(d.dna) + ' DNA', { color: COL.dna, size: 13, dy: 20, life: 0.8 });
    if (d.combo >= 3) {
      text(f.x, f.y, '×' + d.combo + ' combo', { color: COL.warn, size: clamp(15 + d.combo, 16, 30), dy: -24, life: 1.05 });
    }
    const big = pl && (f.r || 0) >= pl.r * 0.7;
    if (big) shake(clamp(2 + (f.r || 0) * 0.2, 2, 6));
    else if (d.combo >= 6) shake(1.5);
  }

  function onEat(d) {
    const eater = d && d.eater, f = d && d.food;
    if (!eater || !f || eater.isPlayer) return;
    if (!onScreen(f.x, f.y, 60)) return;
    const sc = Math.max(f.r || 4, 4);
    burst(f.x, f.y, { colors: colorsOf(f.sp, f.pal), n: 5, r: sc, speed: 4, size: 0.2, life: 0.4 });
  }

  function onPlayerHit() {
    const pl = player();
    if (!pl) return;
    burst(pl.x, pl.y, { colors: [COL.shard, COL.dna, COL.white], n: 10, r: pl.r, speed: 7, size: 0.28, life: 0.55,
      kind: K.SHARD, ring: true, ringColor: COL.white, ringR: 2.2, ringLife: 0.3 });
    flash(COL.white, 0.32);
    shake(9);
  }

  function onPlayerDeath() {
    const g = A.G, pl = player();
    const di = g && g.deathInfo;
    const x = pl ? pl.x : di ? di.x : 0, y = pl ? pl.y : di ? di.y : 0;
    const r = pl ? pl.r : di ? di.r : 12;
    const cols = pl ? colorsOf(pl.sp, pl.pal) : [COL.danger];
    cols.push(COL.danger);
    burst(x, y, { colors: cols, n: 34, r, speed: 8, size: 0.3, life: 0.9, crumbs: 10, ring: true, ringR: 4, ringLife: 0.6 });
    ring(x, y, COL.danger, r * 6, 0.8, r, 4);
    flash(COL.danger, 0.5);
    shake(16);
  }

  function onDive(d) {
    if (!d || !d.e) return;
    if (S.dives.length >= 12) S.dives.shift();
    S.dives.push({ x: d.tx, y: d.ty, r: Math.max(d.e.r * 1.5, 8), t: 0, dur: 0.9 });
  }

  function onDash(d) {
    if (!d || !d.e) return;
    if (S.dashes.length >= 10) S.dashes.shift();
    S.dashes.push({ e: d.e, t: 0, dur: cfg('DASH_TIME', 0.25) + 0.05 });
  }

  function onGrowth(d) {
    const step = Math.floor(((d && d.growth) || 0) / 0.25);
    const pl = player();
    if (step > S.growthStep && pl) {
      ring(pl.x, pl.y, COL.grow, pl.r * 2.8, 0.7, pl.r * 1.1, 3);
      burst(pl.x, pl.y, { color: COL.grow, n: 8, r: pl.r, speed: 3.5, size: 0.16, life: 0.6 });
    }
    S.growthStep = step;
  }

  function onEvolveReady() {
    S.evolveGlow = true;
    const pl = player();
    if (!pl) return;
    ring(pl.x, pl.y, COL.grow, pl.r * 5, 0.9, pl.r, 4);
    ring(pl.x, pl.y, COL.dna, pl.r * 3.4, 0.7, pl.r, 3);
  }

  function onMishapStart(d) {
    const c = MISHAP_TINT[d && d.type] || COL.warn;
    S.pulses.push({ c, t: 0, dur: 2.6 });
    if (S.pulses.length > 4) S.pulses.shift();
  }

  function onPoisoned() {
    const pl = player();
    if (!pl) return;
    burst(pl.x, pl.y, { color: COL.poison, n: 10, r: pl.r, speed: 2.5, size: 0.2, life: 0.9, kind: K.BUBBLE, grav: -1.5, drag: 1.2 });
  }

  function onRebirth() {
    const pl = player();
    if (!pl) return;
    const cols = [COL.grow, COL.dna, '#F4FFD8'];
    burst(pl.x, pl.y, { colors: cols, n: 26, r: pl.r, speed: 7, size: 0.26, life: 0.85, ring: true, ringR: 5, ringLife: 0.7 });
    burst(pl.x, pl.y, { colors: ['#E9FFD0', '#BFF6FF'], n: 9, r: pl.r, speed: 5, size: 0.35, life: 0.7, kind: K.SHARD });
    ring(pl.x, pl.y, COL.dna, pl.r * 3.2, 0.9, pl.r * 0.5, 3);
    flash(COL.grow, 0.2);
    shake(4);
    S.growthStep = Math.floor((pl.growth || 0) / 0.25);
  }

  function onBirth(d) {
    const e = d && d.e;
    if (!e || !onScreen(e.x, e.y, 20)) return;
    const r = Math.max(e.r || 4, 3);
    for (let i = 0; i < 3; i++) {
      emit(K.STAR, e.x + rr(-r, r), e.y + rr(-r, r), rr(-r, r) * 0.6, rr(-r, r) * 0.6 - r * 0.6, 0.55,
        r * 0.35, pick([COL.dna, COL.white, COL.grow]), { add: true, drag: 1.5, size1: 0, rot: Math.random() * TAU });
    }
  }

  // ---- combat and ability events (all fields are optional; nothing throws when one is missing)
  function hitSpark(x, y, r, colors, n) {
    burst(x, y, { colors, n: n || 7, r: Math.max(4, r), speed: 4.5, size: 0.16, life: 0.4, kind: K.SHARD,
      ring: true, ringColor: COL.bone, ringR: 1.5, ringLife: 0.22, ringW: 2 });
  }

  function onBite(d) {
    const e = d && d.e;
    if (!e || !(onScreen(e.x, e.y, 80))) return;
    const hits = (d.hits || []).map((h) => (h && h.target) || h).filter((h) => h && typeof h === 'object' && h.x != null);
    if (S.bites.length >= 8) S.bites.shift();
    S.bites.push({ e, t: 0, dur: e.isPlayer ? 0.2 : 0.16, a: e.angle || 0, x: e.x, y: e.y, hit: hits.length > 0 });
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      hitSpark(h.x, h.y, h.r * 0.6, [COL.bone, COL.white, COL.danger], 8);
    }
  }

  function onDamage(d) {
    const tg = d && d.target;
    if (!tg || !onScreen(tg.x, tg.y, 80)) return;
    const amt = Math.max(0, +d.amount || 0);
    const maxHp = nz(tg.maxHp);
    const val = Math.max(1, Math.round(amt));
    if (tg.isPlayer) {
      text(tg.x, tg.y - tg.r * 0.9, '-' + val, { color: COL.danger, size: clamp(17 + (maxHp ? 16 * amt / maxHp : 0), 17, 30), life: 0.9, rise: 38, num: true });
      burst(tg.x, tg.y, { colors: [COL.danger, COL.bone], n: 8, r: tg.r, speed: 4, size: 0.18, life: 0.45 });
      flash(COL.danger, clamp(maxHp ? 0.5 * amt / maxHp : 0.12, 0.08, 0.3));
      shake(clamp(3 + (maxHp ? 10 * amt / maxHp : 0), 3, 9));
    } else if (d.by && d.by.isPlayer && (!maxHp || amt >= maxHp * 0.12)) {
      text(tg.x, tg.y - tg.r * 0.9, String(val), { color: COL.danger, size: 15, life: 0.8, rise: 30, num: true });
    }
  }

  function onAbilityUse(d) {
    const e = d && d.e;
    if (!e) return;
    const kind = abilityKindOf(d.id || (e.ability && e.ability.id), e.sp);
    if (!kind) return;
    const c = { kind, e, t: 0, dur: CAST_DUR[kind] || 0.5, a: e.angle || 0, x: e.x, y: e.y, tx: e.x, ty: e.y, target: null };
    const r = e.r, g = A.G;
    if (kind === 'spray' && e.sp === 'wolf') {
      // a howl: no droplets, drawCast shows the sound arcs
    } else if (kind === 'spray') {
      const m = mouthOf(e, 0.7);
      burst(m[0], m[1], { colors: [COL.bone, '#E9F6C8', COL.grow], n: 18, r, speed: 8, size: 0.2, life: 0.5, angle: e.angle || 0,
        arc: Math.PI / 2, drag: 2.6, add: false });
    } else if (kind === 'roll') {
      ring(e.x, e.y, COL.bone, r * 2.4, 0.5, r, 3);
    } else if (kind === 'web') {
      const I = A.input || {};
      let tx = I.wx, ty = I.wy;
      if (!(isFinite(tx) && isFinite(ty))) { tx = e.x + Math.cos(c.a) * r * 4; ty = e.y + Math.sin(c.a) * r * 4; }
      c.tx = tx; c.ty = ty;
    } else if (kind === 'tongue') {
      const list = (g && g.entities) || [];
      let best = null, bd = r * 6;
      for (let pass = 0; pass < 2 && !best; pass++) {
        for (let i = 0; i < list.length; i++) {
          const o = list[i];
          if (o === e || o.alive === false || o.role === 'producer') continue;
          if (pass === 0 && !canEatFn(e, o)) continue;
          const dd = Math.hypot(o.x - e.x, o.y - e.y);
          if (dd < bd) { bd = dd; best = o; }
        }
      }
      if (best) { c.target = best; c.tx = best.x; c.ty = best.y; }
      else { const m = mouthOf(e, 0.85); c.tx = m[0] + Math.cos(c.a) * r * 3; c.ty = m[1] + Math.sin(c.a) * r * 3; }
    } else if (kind === 'tail') {
      burst(e.x, e.y, { colors: ['#C9B89A', COL.bone, COL.grow], n: 9, r, speed: 3, size: 0.2, life: 0.5, add: false });
    }
    if (S.casts.length >= 12) S.casts.shift();
    S.casts.push(c);
  }

  function onAngry(d) {
    const e = d && d.e;
    if (!e || !onScreen(e.x, e.y, 60)) return;
    ring(e.x, e.y, COL.danger, e.r * 2.2, 0.4, e.r * 0.9, 2.5);
  }

  function onFlinch(d) {
    const e = d && d.e;
    if (!e || !onScreen(e.x, e.y, 60)) return;
    burst(e.x, e.y, { colors: [COL.bone, COL.white], n: 6, r: e.r, speed: 3.5, size: 0.15, life: 0.35, kind: K.SHARD });
  }

  function onCarcass(d) {
    const e = d && d.e;
    if (!e || !onScreen(e.x, e.y, 60)) return;
    burst(e.x, e.y, { colors: ['#C9B89A', COL.bone, '#8A7A60'], n: 10, r: Math.max(4, e.r), speed: 3, size: 0.18, life: 0.6, add: false, crumbs: 4 });
  }

  function onReset() {
    for (let i = 0; i < MAX_PARTICLES; i++) S.pool[i].life = 0;
    S.texts.length = 0; S.dives.length = 0; S.dashes.length = 0; S.casts.length = 0; S.bites.length = 0;
    S.orb.on = false; S.orb.ready = null; S.hpFullT = 9;
    S.pulses.length = 0; S.flashes.length = 0; S.migrations.length = 0;
    S.evolveGlow = false; S.deco = null;
    const pl = player();
    S.growthStep = pl ? Math.floor((pl.growth || 0) / 0.25) : 0;
  }

  function init() {
    if (!A.on) return;
    const on = A.on;
    on('playerEat', onPlayerEat);
    on('eat', onEat);
    on('playerHit', onPlayerHit);
    on('playerDeath', onPlayerDeath);
    on('dive', onDive);
    on('dash', onDash);
    on('growth', onGrowth);
    on('evolveReady', onEvolveReady);
    on('mishapStart', onMishapStart);
    on('poisoned', onPoisoned);
    on('rebirth', onRebirth);
    on('birth', onBirth);
    on('bite', onBite);
    on('damage', onDamage);
    on('abilityUse', onAbilityUse);
    on('angry', onAngry);
    on('flinch', onFlinch);
    on('carcass', onCarcass);
    on('migration', (d) => { if (d && d.sp) S.migrations.push({ sp: d.sp, t: 0.35 }); });
    on('evolve', () => { S.evolveGlow = false; });
    on('tierStart', onReset);
    on('runStart', onReset);
    on('restart', onReset);
    on('decomposeDone', () => { S.deco = null; });
    on('modeChange', (d) => { if (d && d.to === 'dying') S.deco = null; });
  }

  // ---------------------------------------------------------------- update
  function update(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    S.t += dt;
    updateParticles(dt);
    updateTexts(dt);
    S.flashes = S.flashes.filter((f) => (f.t += dt) < f.dur);
    S.pulses = S.pulses.filter((p) => (p.t += dt) < p.dur);
    S.dives = S.dives.filter((d) => (d.t += dt) < d.dur + 0.12);
    updateDashes(dt);
    updateAmbient(dt);
    updateActions(dt);
  }

  function updateActions(dt) {
    for (let i = S.casts.length - 1; i >= 0; i--) {
      const c = S.casts[i], e = c.e;
      c.t += dt;
      if (c.t >= c.dur || !e || e.alive === false) { S.casts.splice(i, 1); continue; }
      if (c.kind === 'spray' && c.t < 0.32) {
        const m = mouthOf(e, 0.7), a = e.angle || c.a, r = e.r;
        for (let k = 0; k < 2; k++) {
          const an = a + rr(-0.78, 0.78), sp = r * rr(6, 10);
          emit(K.DOT, m[0], m[1], Math.cos(an) * sp, Math.sin(an) * sp, rr(0.3, 0.5), r * rr(0.12, 0.22), pick([COL.bone, '#E9F6C8', COL.grow]),
            { drag: 2.6, size1: r * 0.04, a0: 0.8 });
        }
      } else if (c.kind === 'horn') {
        const a = e.angle || c.a, r = e.r, nx = -Math.sin(a), ny = Math.cos(a);
        for (let k = 0; k < 2; k++) {
          const side = rr(-0.7, 0.7) * r;
          emit(K.STREAK, e.x - Math.cos(a) * r * rr(0.5, 1.1) + nx * side, e.y - Math.sin(a) * r * rr(0.5, 1.1) + ny * side,
            -Math.cos(a) * r * 2, -Math.sin(a) * r * 2, 0.26, r * rr(1.2, 2.4), COL.bone, { add: true, rot: a, lw: 2, a0: 0.7, size1: r * 0.4 });
        }
      }
    }
    for (let i = S.bites.length - 1; i >= 0; i--) {
      S.bites[i].t += dt;
      if (S.bites[i].t >= S.bites[i].dur) S.bites.splice(i, 1);
    }
    const pl = player();
    if (pl && pl.hp != null && nz(pl.maxHp) > 0 && pl.hp >= pl.maxHp - 1e-6) S.hpFullT += dt; else S.hpFullT = 0;
    const ab = pl && pl.ability;
    if (ab && nz(ab.cd) > 0) {
      const ready = !(nz(ab.cdT) > 0);
      if (S.orb.ready === false && ready && S.orb.on) {
        ring(S.orb.x, S.orb.y, COL.warn, pl.r * 1.1, 0.45, pl.r * 0.2, 2.5);
        burst(S.orb.x, S.orb.y, { colors: [COL.warn, '#FFF6C4'], n: 7, r: pl.r * 0.4, speed: 3.5, size: 0.2, life: 0.5 });
      }
      S.orb.ready = ready;
    } else { S.orb.ready = null; S.orb.on = false; }
  }

  function updateParticles(dt) {
    let n = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = S.pool[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) continue;
      n++;
      if (p.drag) { const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy *= k; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    S.active = n;
  }

  function updateTexts(dt) {
    for (let i = S.texts.length - 1; i >= 0; i--) {
      const t = S.texts[i];
      t.age += dt;
      if (t.age >= t.life) S.texts.splice(i, 1);
    }
  }

  function updateDashes(dt) {
    for (let i = S.dashes.length - 1; i >= 0; i--) {
      const d = S.dashes[i], e = d.e;
      d.t += dt;
      if (d.t >= d.dur || !e || e.alive === false) { S.dashes.splice(i, 1); continue; }
      const sp = Math.hypot(e.vx || 0, e.vy || 0);
      const a = sp > 1 ? Math.atan2(e.vy, e.vx) : e.angle || 0;
      const nx = -Math.sin(a), ny = Math.cos(a);
      const col = e.isPlayer ? COL.grow : COL.text;
      for (let k = 0; k < 2; k++) {
        const side = rr(-0.7, 0.7) * e.r;
        emit(K.STREAK, e.x - Math.cos(a) * e.r * rr(0.4, 1.0) + nx * side, e.y - Math.sin(a) * e.r * rr(0.4, 1.0) + ny * side,
          -Math.cos(a) * e.r * 1.5, -Math.sin(a) * e.r * 1.5, 0.28, e.r * rr(1.2, 2.2), col,
          { add: true, rot: a, lw: 2, a0: 0.7, size1: e.r * 0.4 });
      }
    }
  }

  // Poison bubbles, evolve sparkle and migration arrivals.
  function updateAmbient(dt) {
    const pl = player();
    if (pl && pl.poisonT > 0) {
      S.bubbleT -= dt;
      if (S.bubbleT <= 0) {
        S.bubbleT = 0.09;
        const a = Math.random() * TAU, d = pl.r * rr(0.6, 1.3);
        emit(K.BUBBLE, pl.x + Math.cos(a) * d, pl.y + Math.sin(a) * d, rr(-1, 1) * pl.r * 0.3, -pl.r * rr(1.2, 2.2),
          rr(0.6, 1.1), pl.r * rr(0.1, 0.22), COL.poison, { drag: 0.4, size1: pl.r * 0.28 });
      }
    }
    if (S.evolveGlow && pl && A.G && A.G.mode !== 'dying') {
      S.sparkT -= dt;
      if (S.sparkT <= 0) {
        S.sparkT = 0.12;
        const a = Math.random() * TAU, d = pl.r * rr(1.1, 1.8);
        emit(K.STAR, pl.x + Math.cos(a) * d, pl.y + Math.sin(a) * d, 0, -pl.r * 1.2, 0.7, pl.r * 0.3,
          pick([COL.grow, COL.dna, COL.white]), { add: true, size1: 0, rot: Math.random() * TAU, vr: 3 });
      }
    }
    if (S.migrations.length) updateMigrations(dt);
  }

  function updateMigrations(dt) {
    const g = A.G;
    for (let i = S.migrations.length - 1; i >= 0; i--) {
      const m = S.migrations[i];
      m.t -= dt;
      if (m.t > 0) continue;
      S.migrations.splice(i, 1);
      const list = (g && g.entities) || [];
      for (let k = 0; k < list.length; k++) {
        const e = list[k];
        if (e.sp === m.sp && e.alive !== false && e.age < 1.5) onBirth({ e });
      }
    }
  }

  // ---------------------------------------------------------------- drawWorld
  function drawWorld(ctx, cam, t) {
    cam = cam || (A.G && A.G.cam);
    if (!cam) return;
    ctx.save();
    drawDives(ctx, cam);
    drawActions(ctx, cam);
    drawParticles(ctx, cam);
    drawTexts(ctx, cam);
    ctx.restore();
  }

  function drawDives(ctx, cam) {
    const z = cam.zoom || 1;
    for (let i = 0; i < S.dives.length; i++) {
      const d = S.dives[i];
      const k = clamp(d.t / d.dur, 0, 1);
      const fade = d.t > d.dur ? 1 - (d.t - d.dur) / 0.12 : 1;
      proj(d.x, d.y, cam);
      const r = d.r * z;
      ctx.globalAlpha = fade;
      ctx.fillStyle = 'rgba(0,0,0,' + (0.1 + 0.22 * k).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill();
      ctx.fillStyle = rgba(COL.danger, 0.1 + 0.25 * k);
      ctx.beginPath(); ctx.arc(px, py, r * Math.pow(k, 0.8), 0, TAU); ctx.fill();
      ctx.strokeStyle = rgba(COL.danger, 0.35 + 0.5 * k);
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 6]);
      ctx.lineDashOffset = -k * 40;
      ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }

  function drawParticles(ctx, cam) {
    const z = cam.zoom || 1, W = viewW(), H = viewH();
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      const add = pass === 1;
      ctx.globalCompositeOperation = add ? 'lighter' : 'source-over';
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const p = S.pool[i];
        if (p.life <= 0 || p.add !== add) continue;
        proj(p.x, p.y, cam);
        if (px < -60 || px > W + 60 || py < -60 || py > H + 60) continue;
        const k = p.life / p.max;
        const s = (p.size + (p.size1 - p.size) * (1 - k)) * z;
        if (s <= 0.05) continue;
        const alpha = p.a0 * (p.kind === K.RING ? k : Math.min(1, k * 2.2));
        ctx.globalAlpha = alpha;
        drawParticle(ctx, p, s);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawParticle(ctx, p, s) {
    switch (p.kind) {
      case K.DOT:
        ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.arc(px, py, s, 0, TAU); ctx.fill();
        break;
      case K.RING:
        ctx.strokeStyle = p.c; ctx.lineWidth = p.lw * Math.max(0.4, p.life / p.max + 0.3);
        ctx.beginPath(); ctx.arc(px, py, s, 0, TAU); ctx.stroke();
        break;
      case K.SHARD: {
        const c = Math.cos(p.rot), n = Math.sin(p.rot);
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.moveTo(px + c * s, py + n * s);
        ctx.lineTo(px - c * s * 0.6 - n * s * 0.5, py - n * s * 0.6 + c * s * 0.5);
        ctx.lineTo(px - c * s * 0.6 + n * s * 0.5, py - n * s * 0.6 - c * s * 0.5);
        ctx.closePath(); ctx.fill();
        break;
      }
      case K.BUBBLE:
        ctx.strokeStyle = p.c; ctx.lineWidth = Math.max(1, s * 0.16);
        ctx.beginPath(); ctx.arc(px, py, s, 0, TAU); ctx.stroke();
        ctx.fillStyle = rgba(p.c, 0.18);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha *= 0.7;
        ctx.beginPath(); ctx.arc(px - s * 0.35, py - s * 0.35, Math.max(0.8, s * 0.2), 0, TAU); ctx.fill();
        break;
      case K.STREAK: {
        ctx.strokeStyle = p.c; ctx.lineWidth = p.lw;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - Math.cos(p.rot) * s, py - Math.sin(p.rot) * s);
        ctx.stroke();
        break;
      }
      case K.CRUMB: {
        ctx.save();
        ctx.translate(px, py); ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.fillRect(-s * 0.6, -s * 0.4, s * 1.2, s * 0.8);
        ctx.restore();
        break;
      }
      case K.STAR: {
        ctx.fillStyle = p.c;
        const c = Math.cos(p.rot), n = Math.sin(p.rot), w = s * 0.28;
        ctx.beginPath();
        ctx.moveTo(px + c * s, py + n * s); ctx.lineTo(px - n * w, py + c * w);
        ctx.lineTo(px - c * s, py - n * s); ctx.lineTo(px + n * w, py - c * w);
        ctx.closePath();
        ctx.moveTo(px - n * s, py + c * s); ctx.lineTo(px - c * w, py - n * w);
        ctx.lineTo(px + n * s, py - c * s); ctx.lineTo(px + c * w, py + n * w);
        ctx.closePath();
        ctx.fill();
        break;
      }
    }
  }

  function drawTexts(ctx, cam) {
    if (!S.texts.length || (A.G && A.G.mode === 'title')) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (let i = 0; i < S.texts.length; i++) {
      const t = S.texts[i];
      const k = t.age / t.life;
      const rise = t.rise * (1 - Math.pow(1 - Math.min(1, k * 1.3), 2));
      proj(t.x, t.y, cam);
      const pop = k < 0.15 ? 1 + 0.45 * Math.sin((k / 0.15) * Math.PI * 0.9) : 1;
      const size = t.size * pop;
      ctx.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      ctx.font = (t.num ? FONT_NUM : FONT_TXT).replace('{s}', size.toFixed(1));
      const y = py - rise + t.dy;
      ctx.lineWidth = Math.max(3, size * 0.22);
      ctx.strokeStyle = 'rgba(27,22,18,0.82)';
      ctx.strokeText(t.s, px, y);
      ctx.fillStyle = t.c;
      ctx.fillText(t.s, px, y);
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- in-world HUD
  // The creature is the interface. drawOverlay runs once per entity with the origin at the entity
  // centre, unrotated, in world units, so every ring below scales with the creature.
  // Combat fields (hp, maxHp, stunT, angryT, flinchT, ability...) are read defensively: when the
  // combat module has not provided one, that cue is simply skipped.
  const nz = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const lookOf = (e) => (A.LOOKS && A.LOOKS[e.sp]) || null;
  const ABILITY_BY_SP = { ant: 'spray', pillbug: 'roll', spider: 'web', beetle: 'horn', frog: 'tongue', skink: 'tail' };
  function abilityKindOf(id, sp) {
    const s = String(id || '').toLowerCase();
    if (/formic|spray|acid/.test(s)) return 'spray';
    if (/roll|shell|ball/.test(s)) return 'roll';
    if (/web|silk/.test(s)) return 'web';
    if (/horn|charge|ram/.test(s)) return 'horn';
    if (/tongue|snatch|lick/.test(s)) return 'tongue';
    if (/tail|decoy|drop/.test(s)) return 'tail';
    return ABILITY_BY_SP[sp] || null;
  }
  const CAST_DUR = { spray: 0.55, roll: 2.0, web: 0.3, horn: 0.45, tongue: 0.4, tail: 0.5 };

  function bodyAxes(e) {
    const l = lookOf(e);
    return { a: ((l && l.len) || 1.15) * e.r, b: ((l && l.wid) || 0.8) * e.r };
  }
  function bodyPath(ctx, e, pad) {
    const ax = bodyAxes(e);
    ctx.beginPath();
    ctx.ellipse(0, 0, ax.a + pad, ax.b + pad, e.angle || 0, 0, TAU);
  }
  function activeCast(e, kind) {
    for (let i = 0; i < S.casts.length; i++) if (S.casts[i].e === e && S.casts[i].kind === kind) return S.casts[i];
    return null;
  }
  function hlSet(g) {
    const tu = g && g.tutorial;
    if (!tu || !tu.active || !tu.highlight || !tu.highlight.length) return null;
    if (S.hlSrc !== tu.highlight) {
      S.hlSrc = tu.highlight;
      S.hlSet = {};
      for (let i = 0; i < tu.highlight.length; i++) S.hlSet[String(tu.highlight[i])] = 1;
    }
    return S.hlSet;
  }
  function isHighlighted(e, set) {
    return !!(set && (set[String(e.id)] || set[e.sp] || (e.tag && set[e.tag]) || (e.tutorialId && set[e.tutorialId])));
  }

  function drawOverlay(ctx, e, t) {
    if (!e || e.alive === false) return;
    const g = A.G;
    const z = (g && g.cam && g.cam.zoom) || 1;
    if (e.isPlayer) { if (g && g.mode !== 'dying' && g.mode !== 'title' && !e.attract) playerOverlay(ctx, e, t, z); return; }
    npcOverlay(ctx, e, t, z, g);
  }

  function playerOverlay(ctx, e, t, z) {
    const r = e.r;
    const look = lookOf(e);
    const R = r * (1.12 + 0.28 * (((look && look.len) || 1.1) - 1));
    const lw = Math.max(2.1 / z, r * 0.055);
    ctx.save();
    if (e.hurtT > 0) hurtFlash(ctx, e);
    if (S.evolveGlow) evolveGlow(ctx, e, t);
    if (e.invulnT > 0) shimmer(ctx, e, t, z);
    if (e.poisonT > 0) {
      ctx.globalCompositeOperation = 'lighter';
      glowAt(ctx, COL.poison, 0, 0, r * 1.7, 0.35 + 0.1 * Math.sin(t * 6));
      ctx.globalCompositeOperation = 'source-over';
    }
    const er = e.energy != null ? clamp(e.energy / cfg('ENERGY_MAX', 100), 0, 1) : 1;
    hungerDim(ctx, e, t, er);
    rollGlint(ctx, e, t, z);
    growthRing(ctx, e, t, R, lw, er);
    healthArc(ctx, e, t, R - lw * 2.0, lw);
    armorArcs(ctx, e, z, R + lw * 2.4);
    stateMarks(ctx, e, t, z);
    abilityArc(ctx, e, t, z, R, lw);
    ctx.restore();
  }

  // Thin leaf arc that fills with growth. Pulses when full; a slow pollen pulse when hungry.
  function growthRing(ctx, e, t, R, lw, er) {
    const gr = clamp(nz(e.growth), 0, 1);
    const full = gr >= 0.999;
    ctx.lineCap = 'round';
    ctx.lineWidth = lw + 2 / ((A.G && A.G.cam && A.G.cam.zoom) || 1);
    ctx.strokeStyle = rgba(COL.soil, 0.4);
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
    ctx.lineWidth = lw;
    ctx.strokeStyle = rgba(COL.grow, 0.28);
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
    if (er < 0.3) {
      const p = 0.5 + 0.5 * Math.sin(t * 2.4);
      ctx.strokeStyle = rgba(COL.warn, (0.22 + 0.5 * p) * (1 - er / 0.3 * 0.4));
      ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
    }
    if (gr > 0.004) {
      const pulse = full ? 0.5 + 0.5 * Math.sin(t * 5) : 0;
      ctx.lineWidth = lw * (1 + 0.55 * pulse);
      ctx.strokeStyle = rgba(COL.grow, 0.82 + 0.18 * pulse);
      ctx.beginPath(); ctx.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + TAU * gr); ctx.stroke();
      if (!full) {
        const a = -Math.PI / 2 + TAU * gr;
        ctx.fillStyle = '#DDF5B8';
        ctx.beginPath(); ctx.arc(Math.cos(a) * R, Math.sin(a) * R, lw * 0.95, 0, TAU); ctx.fill();
      }
    }
    if (full) {
      ctx.globalCompositeOperation = 'lighter';
      glowAt(ctx, COL.grow, 0, 0, R * (1.5 + 0.15 * Math.sin(t * 5)), 0.2 + 0.14 * Math.sin(t * 5));
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    if (er < 0.15) { // soft heartbeat glow
      const b = Math.pow(Math.max(0, Math.sin(t * 7)), 8) + 0.6 * Math.pow(Math.max(0, Math.sin(t * 7 - 1.1)), 8);
      ctx.globalCompositeOperation = 'lighter';
      glowAt(ctx, COL.danger, 0, 0, R * (1.6 + 0.35 * b), 0.12 + 0.3 * b);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }

  // The creature itself dims when it is starving (a soft darkening over the body ellipse).
  function hungerDim(ctx, e, t, er) {
    if (er >= 0.3) return;
    const k = (0.3 - er) / 0.3;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = rgba('#5B5144', 0.1 + 0.34 * k);
    bodyPath(ctx, e, e.r * 0.05);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // Venom inner arc, only while damaged; lingers 3s after health is full again.
  function healthArc(ctx, e, t, R, lw) {
    const maxHp = nz(e.maxHp);
    if (!(maxHp > 0) || e.hp == null) return;
    const f = clamp(e.hp / maxHp, 0, 1);
    const fade = f < 0.999 ? 1 : clamp(1 - (S.hpFullT - 0.4) / 2.6, 0, 1);
    if (fade <= 0.01) return;
    ctx.globalAlpha = fade;
    ctx.lineCap = 'round';
    ctx.lineWidth = lw * 1.15 + 2 / ((A.G && A.G.cam && A.G.cam.zoom) || 1);
    ctx.strokeStyle = rgba(COL.soil, 0.4);
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
    ctx.lineWidth = lw * 1.15;
    ctx.strokeStyle = rgba(COL.danger, 0.28);
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
    if (f > 0.004) {
      const low = f < 0.3 ? 0.5 + 0.5 * Math.sin(t * 9) : 0;
      ctx.strokeStyle = low ? rgba('#FF8A8E', 0.8 + 0.2 * low) : COL.danger;
      ctx.beginPath(); ctx.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + TAU * f); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function armorArcs(ctx, e, z, R) {
    const max = (e.stats && e.stats.armorMax) || 0;
    if (!max) return;
    const have = Math.max(0, Math.min(max, Math.round(e.armor || 0)));
    const span = max === 1 ? 2.0 : (TAU / max) * 0.78;
    const a0 = e.angle || 0;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2.6 / z, e.r * 0.07);
    for (let i = 0; i < max; i++) {
      const mid = max === 1 ? a0 : a0 + (i / max) * TAU;
      ctx.strokeStyle = i < have ? rgba(COL.bone, 0.9) : rgba(COL.bone, 0.16);
      ctx.beginPath();
      ctx.arc(0, 0, R, mid - span / 2, mid + span / 2);
      ctx.stroke();
    }
  }

  // Short pollen arc outside the growth ring, behind the creature. It grows from its middle as the ability
  // recovers, glows when ready (update() pings it), and flares while the ability is active.
  function abilityArc(ctx, e, t, z, R, lw) {
    const ab = e.ability;
    if (!ab || !(nz(ab.cd) > 0)) return;
    const ready = !(nz(ab.cdT) > 0);
    const frac = ready ? 1 : clamp(1 - ab.cdT / ab.cd, 0, 1);
    const Ra = R + lw * 2.4, half = 0.46;
    const c = (e.angle || 0) + Math.PI;
    const w = lw * 1.5;
    S.orb.x = e.x + Math.cos(c) * Ra; S.orb.y = e.y + Math.sin(c) * Ra; S.orb.on = true;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = w + 2 / z;
    ctx.strokeStyle = rgba(COL.soil, 0.45);
    ctx.beginPath(); ctx.arc(0, 0, Ra, c - half, c + half); ctx.stroke();
    ctx.lineWidth = w;
    ctx.strokeStyle = rgba(COL.warn, 0.22);
    ctx.beginPath(); ctx.arc(0, 0, Ra, c - half, c + half); ctx.stroke();
    if (ready) {
      const p = 0.5 + 0.5 * Math.sin(t * 4);
      ctx.globalCompositeOperation = 'lighter';
      glowAt(ctx, COL.warn, S.orb.x - e.x, S.orb.y - e.y, e.r * (0.9 + 0.15 * p), 0.3 + 0.15 * p);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    if (nz(ab.activeT) > 0) { // the cooldown restarts on use, so the flare spans the whole arc
      ctx.lineWidth = w * 1.5;
      ctx.strokeStyle = '#FFF6C4';
      ctx.beginPath(); ctx.arc(0, 0, Ra, c - half, c + half); ctx.stroke();
    } else if (frac > 0.01) {
      ctx.lineWidth = w;
      ctx.strokeStyle = ready ? COL.warn : rgba(COL.warn, 0.7);
      ctx.beginPath(); ctx.arc(0, 0, Ra, c - half * frac, c + half * frac); ctx.stroke();
    }
    ctx.restore();
  }

  // Roll up: a bright glint sweeping a rounded shell.
  function rollGlint(ctx, e, t, z) {
    const ab = e.ability;
    const on = (ab && nz(ab.activeT) > 0 && abilityKindOf(ab.id, e.sp) === 'roll') || activeCast(e, 'roll');
    if (!on) return;
    const r = e.r;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(COL.bone, 0.85);
    ctx.lineWidth = Math.max(2.4 / z, r * 0.09);
    ctx.beginPath(); ctx.arc(0, 0, r * 1.02, 0, TAU); ctx.stroke();
    const a = t * 3.2;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.max(3.4 / z, r * 0.14);
    ctx.beginPath(); ctx.arc(0, 0, r * 0.82, a, a + 0.9); ctx.stroke();
    ctx.lineWidth = Math.max(1.8 / z, r * 0.07);
    ctx.beginPath(); ctx.arc(0, 0, r * 0.82, a + 1.15, a + 1.4); ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    glowAt(ctx, COL.bone, 0, 0, r * 1.7, 0.18 + 0.08 * Math.sin(t * 8));
    ctx.restore();
  }

  // Stun stars, angry mark and flinch flash: shown on any animal.
  function stateMarks(ctx, e, t, z) {
    const r = e.r;
    const ax = bodyAxes(e);
    const top = -Math.max(ax.b, r) * 1.2;
    if (nz(e.stunT) > 0) {
      const s = Math.max(r * 0.24, 4.5 / z);
      ctx.fillStyle = COL.warn;
      ctx.strokeStyle = rgba(COL.soil, 0.6);
      ctx.lineWidth = 1 / z;
      for (let i = 0; i < 3; i++) {
        const a = t * 4.2 + (i * TAU) / 3;
        const x = Math.cos(a) * r * 0.8, y = top - s * 0.4 + Math.sin(a) * r * 0.2;
        starPath(ctx, x, y, s, a * 0.5);
        ctx.fill(); ctx.stroke();
      }
    }
    if (nz(e.angryT) > 0 || e.state === 'angry') {
      const s = Math.max(r * 0.3, 6.5 / z) * (1 + 0.14 * Math.sin(t * 11));
      const cx = ax.a * 0.55, cy = top - s * 0.55;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(s * 0.26, 1.6 / z);
      ctx.strokeStyle = COL.danger;
      for (let i = 0; i < 4; i++) {
        const sx = i & 1 ? 1 : -1, sy = i & 2 ? 1 : -1;
        const ang = Math.atan2(-sy, -sx);
        ctx.beginPath();
        ctx.arc(cx + sx * s * 0.62, cy + sy * s * 0.62, s * 0.62, ang - 0.8, ang + 0.8);
        ctx.stroke();
      }
    }
    if (nz(e.flinchT) > 0) {
      const k = clamp(e.flinchT / 0.5, 0, 1);
      ctx.strokeStyle = rgba(COL.bone, 0.3 + 0.6 * k);
      ctx.lineWidth = Math.max(2.4 / z, r * 0.08);
      bodyPath(ctx, e, r * 0.14); ctx.stroke();
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.6 / z, r * 0.05);
      for (let i = -1; i <= 1; i += 2) {
        const sx = i * (ax.a + r * 0.35);
        ctx.beginPath(); ctx.moveTo(sx, -r * 0.25); ctx.lineTo(sx + i * r * 0.32, -r * 0.4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sx, r * 0.25); ctx.lineTo(sx + i * r * 0.32, r * 0.4); ctx.stroke();
      }
    }
  }

  function shimmer(ctx, e, t, z) {
    const r = e.r;
    const wave = 0.5 + 0.5 * Math.sin(t * 14);
    ctx.strokeStyle = rgba(COL.white, 0.25 + 0.5 * wave);
    ctx.lineWidth = 2 / z;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.5, 0, TAU); ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    glowAt(ctx, COL.white, 0, 0, r * 1.6, 0.06 + 0.1 * wave);
    ctx.fillStyle = COL.white;
    for (let i = 0; i < 5; i++) {
      const a = t * 2.2 + (i / 5) * TAU, d = r * 1.5;
      ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(t * 7 + i * 1.7));
      starPath(ctx, Math.cos(a) * d, Math.sin(a) * d, r * 0.16, a);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function starPath(ctx, x, y, s, rot) {
    const c = Math.cos(rot), n = Math.sin(rot), w = s * 0.28;
    ctx.beginPath();
    ctx.moveTo(x + c * s, y + n * s); ctx.lineTo(x - n * w, y + c * w);
    ctx.lineTo(x - c * s, y - n * s); ctx.lineTo(x + n * w, y - c * w);
    ctx.closePath();
    ctx.moveTo(x - n * s, y + c * s); ctx.lineTo(x - c * w, y - n * w);
    ctx.lineTo(x + n * s, y - c * s); ctx.lineTo(x + c * w, y + n * w);
    ctx.closePath();
  }

  function evolveGlow(ctx, e, t) {
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    glowAt(ctx, COL.grow, 0, 0, e.r * (2.4 + 0.5 * pulse), 0.4 + 0.2 * pulse);
    glowAt(ctx, COL.white, 0, 0, e.r * 1.4, 0.18);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function hurtFlash(ctx, e) {
    ctx.globalCompositeOperation = 'lighter';
    glowAt(ctx, COL.white, 0, 0, e.r * 1.35, clamp(e.hurtT * 5, 0, 0.75));
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function npcOverlay(ctx, e, t, z, g) {
    const pl = g && g.player;
    const playing = g && (g.mode === 'play' || g.mode === 'intro');
    const live = pl && pl.alive !== false && playing;
    const hl = isHighlighted(e, hlSet(g));
    const hasStatus = e.sick || e.desperate || e.hurtT > 0 || nz(e.stunT) > 0 || nz(e.angryT) > 0 || e.state === 'angry' || nz(e.flinchT) > 0;
    const dmg = playing ? npcDamaged(e) : 0; // the decomposition and choice screens stay clean
    const isDecoy = e.sp === 'decoy';
    if (e.boss) { if (nz(e.stunT) > 0) { ctx.save(); stateMarks(ctx, e, t, z); ctx.restore(); } return; }   // the boss has its own health bar and telegraphs
    let cue = 0; // 1 edible, 2 danger
    let near = 0;
    if (live && !isDecoy) {
      const d = Math.hypot(e.x - pl.x, e.y - pl.y);
      const reach = (viewH() / z) * 0.6;
      const angry = nz(e.angryT) > 0 || e.state === 'angry';
      if ((e.role === 'hunter' && canEatFn(e, pl) || angry) && !(pl.invulnT > 0)) cue = 2;
      else if (e.sp === 'carcass' ? d < reach : (d < reach * (e.role === 'producer' ? 0.5 : 1) && canEatFn(pl, e))) { cue = 1; near = 1 - d / reach; }
    }
    if (!cue && !hasStatus && !hl && !dmg && !isDecoy) return;
    ctx.save();
    if (hl) highlightRing(ctx, e, t, z);
    if (cue === 2) dangerCue(ctx, e, t, z, g);
    else if (cue === 1) edibleCue(ctx, e, t, z, near);
    if (isDecoy) decoyTail(ctx, e, t, z);
    if (e.desperate) {
      ctx.globalCompositeOperation = 'lighter';
      glowAt(ctx, COL.danger, 0, 0, e.r * 1.9, 0.22 + 0.08 * Math.sin(t * 5 + e.id));
      ctx.globalCompositeOperation = 'source-over';
    }
    if (e.sick) sickTint(ctx, e, t);
    if (e.hurtT > 0) hurtFlash(ctx, e);
    if (dmg) npcHealthArc(ctx, e, t, z, dmg);
    stateMarks(ctx, e, t, z);
    ctx.restore();
  }

  // Damaged animals show a thin venom arc for a moment after each hit. Returns the arc's 0..1 visibility.
  function npcDamaged(e) {
    if (e.hp == null || !(nz(e.maxHp) > 0) || e.role === 'producer') return 0;
    let rec = S.hpSeen.get(e);
    if (!rec) { rec = { hp: e.hp, t: -99 }; S.hpSeen.set(e, rec); }
    if (e.hp < rec.hp - 1e-6) rec.t = S.t;
    rec.hp = e.hp;
    if (e.hp >= e.maxHp - 1e-6) return 0;
    return clamp(1 - (S.t - rec.t - 2.5) / 1.5, 0, 1);
  }
  function npcHealthArc(ctx, e, t, z, vis) {
    const f = clamp(e.hp / e.maxHp, 0, 1);
    const R = Math.max(bodyAxes(e).a, e.r) * 1.2 + 2 / z;
    ctx.globalAlpha = vis;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2.2 / z, e.r * 0.07);
    ctx.strokeStyle = rgba(COL.danger, 0.22);
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
    if (f > 0.004) {
      ctx.strokeStyle = COL.danger;
      ctx.beginPath(); ctx.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + TAU * f); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Leaf outline hugging the body of anything you can eat.
  function edibleCue(ctx, e, t, z, near) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 4 + (e.id || 0) * 1.7);
    const prod = e.role === 'producer' && e.sp !== 'carcass' ? 0.55 : 1;
    ctx.strokeStyle = rgba(COL.grow, (0.28 + 0.5 * near) * (0.6 + 0.4 * pulse) * prod);
    ctx.lineWidth = Math.max(1.7 / z, e.r * 0.05);
    bodyPath(ctx, e, e.r * 0.12 + 1.5 / z + e.r * 0.05 * pulse);
    ctx.stroke();
  }

  // Venom outline on anything that can eat you; a pulsing rim while it winds up.
  function dangerCue(ctx, e, t, z, g) {
    const satiated = g.time - (e.lastAte != null ? e.lastAte : -999) < cfg('SATIATED_TIME', 6);
    const base = satiated ? 0.4 : 1;
    const pulse = 0.5 + 0.5 * Math.sin(t * 5 + (e.id || 0));
    ctx.strokeStyle = rgba(COL.danger, (0.5 + 0.2 * pulse) * base);
    ctx.lineWidth = Math.max(2.2 / z, e.r * 0.06);
    bodyPath(ctx, e, e.r * 0.1 + 1.5 / z);
    ctx.stroke();
    if (e.state === 'windup') windupCue(ctx, e, t, z);
    else if (e.state === 'lunge') lungeSmear(ctx, e, z);
  }

  function windupCue(ctx, e, t, z) {
    const r = e.r;
    const k = clamp((e.stateT || 0) / cfg('WINDUP', 0.35), 0, 1);
    const flick = 0.55 + 0.45 * Math.abs(Math.sin(t * 22));
    ctx.strokeStyle = rgba(COL.danger, (0.55 + 0.45 * k) * flick);
    ctx.lineWidth = Math.max(3.6 / z, r * 0.1) * (1 + 0.4 * k);
    bodyPath(ctx, e, r * (0.14 + 0.1 * k) + 2 / z);
    ctx.stroke();
    const f = (k * 1.4) % 1;
    ctx.strokeStyle = rgba(COL.danger, (1 - f) * 0.8);
    ctx.lineWidth = Math.max(2.2 / z, r * 0.07) * (1 - 0.5 * f);
    ctx.beginPath(); ctx.arc(0, 0, r * (1.2 + 1.3 * f), 0, TAU); ctx.stroke();
  }

  function lungeSmear(ctx, e, z) {
    const a = e.angle || 0, r = e.r;
    const c = Math.cos(a), s = Math.sin(a);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 1; i <= 4; i++) {
      ctx.fillStyle = rgba(COL.danger, 0.26 / i);
      ctx.beginPath();
      ctx.ellipse(-c * r * 0.65 * i, -s * r * 0.65 * i, r * (1.15 - 0.1 * i), r * (0.8 - 0.1 * i), a, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = rgba(COL.white, 0.5);
    ctx.lineWidth = 1.6 / z;
    ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      const ox = -s * r * 0.5 * i, oy = c * r * 0.5 * i;
      ctx.beginPath();
      ctx.moveTo(ox - c * r * 0.8, oy - s * r * 0.8);
      ctx.lineTo(ox - c * r * 2.6, oy - s * r * 2.6);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // Tutorial: a soft, breathing bone ring around the thing the hint is about.
  function highlightRing(ctx, e, t, z) {
    const R = Math.max(bodyAxes(e).a, e.r) * 1.35 + 5 / z;
    const p = 0.5 + 0.5 * Math.sin(t * 3.2);
    ctx.globalCompositeOperation = 'lighter';
    glowAt(ctx, COL.bone, 0, 0, R * 1.5, 0.16 + 0.12 * p);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.strokeStyle = rgba(COL.bone, 0.55 + 0.35 * p);
    ctx.lineWidth = Math.max(2.4 / z, e.r * 0.06);
    ctx.beginPath(); ctx.arc(0, 0, R * (1 + 0.06 * p), 0, TAU); ctx.stroke();
    const f = (t * 0.8) % 1;
    ctx.strokeStyle = rgba(COL.bone, (1 - f) * 0.45);
    ctx.lineWidth = Math.max(1.6 / z, e.r * 0.04);
    ctx.beginPath(); ctx.arc(0, 0, R * (1 + 0.5 * f), 0, TAU); ctx.stroke();
  }

  // A dropped, wriggling skink tail (only drawn when the shapes module has no look of its own).
  function decoyTail(ctx, e, t, z) {
    if (A.LOOKS && A.LOOKS.decoy) return;
    const r = Math.max(e.r, 4);
    const lk = A.LOOKS && A.LOOKS.skink;
    const col = (lk && lk.pal && lk.pal.body) || '#7FA24A';
    const a = e.angle || 0, c = Math.cos(a), s = Math.sin(a);
    const wig = t * 17 + (e.id || 0);
    const N = 9, len = r * 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? col : rgba(COL.soil, 0.55);
      for (let i = 0; i < N; i++) {
        const u0 = i / N, u1 = (i + 1) / N;
        const pt = (u) => {
          const w = Math.sin(wig + u * 5.2) * r * 0.55 * (0.3 + u);
          return [(u - 0.5) * len * c - w * s, (u - 0.5) * len * s + w * c];
        };
        const p0 = pt(u0), p1 = pt(u1);
        ctx.lineWidth = r * (pass ? 0.62 : 0.8) * (1 - u0 * 0.8);
        ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
      }
    }
  }

  function sickTint(ctx, e, t) {
    const r = e.r, id = e.id || 0;
    ctx.globalCompositeOperation = 'lighter';
    glowAt(ctx, COL.poison, 0, 0, r * 1.5, 0.42);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.strokeStyle = rgba(COL.poison, 0.7);
    ctx.lineWidth = Math.max(0.3, r * 0.06);
    for (let i = 0; i < 3; i++) {
      const ph = (t * 0.55 + i / 3 + id * 0.37) % 1;
      const bx = Math.sin(ph * 7 + i * 2 + id) * r * 0.5;
      ctx.globalAlpha = (1 - ph) * 0.9;
      ctx.beginPath();
      ctx.arc(bx, r * 0.3 - ph * r * 1.7, r * (0.12 + 0.08 * ph), 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- ability and bite visuals (world space)
  function drawActions(ctx, cam) {
    const g = A.G;
    setWorld(ctx, cam);
    const z = cam.zoom || 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // web discs
    const zones = g && g.zones;
    if (zones && zones.length) for (let i = 0; i < zones.length; i++) if (zones[i] && zones[i].type === 'web') drawWeb(ctx, zones[i], z);
    // casts
    for (let i = 0; i < S.casts.length; i++) drawCast(ctx, S.casts[i], z);
    // bite crescents
    for (let i = 0; i < S.bites.length; i++) drawBite(ctx, S.bites[i], z);
    // tutorial anchor
    const tu = g && g.tutorial;
    if (tu && tu.active && tu.target && nz(tu.target.x) === tu.target.x) drawAnchor(ctx, tu.target, z);
    setScreen(ctx);
  }

  function drawWeb(ctx, w, z) {
    let rec = S.zoneSeen.get(w);
    if (!rec) { rec = { t0: S.t, last: w.t, dir: 0 }; S.zoneSeen.set(w, rec); }
    if (w.t !== rec.last) { rec.dir = w.t < rec.last ? -1 : 1; rec.last = w.t; }
    const born = clamp((S.t - rec.t0) / 0.25, 0, 1);
    const fade = rec.dir < 0 ? clamp(w.t / 0.8, 0, 1) : 1;
    const a = born * fade;
    if (a <= 0.01) return;
    const R = nz(w.r) * (0.7 + 0.3 * born);
    ctx.save();
    ctx.translate(w.x, w.y);
    ctx.fillStyle = rgba(COL.bone, 0.09 * a);
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba(COL.bone, 0.62 * a);
    ctx.lineWidth = Math.max(1.3 / z, R * 0.012);
    const N = 10;
    for (let i = 0; i < N; i++) {
      const an = (i / N) * TAU + 0.3;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(an) * R, Math.sin(an) * R); ctx.stroke();
    }
    for (let k = 1; k <= 4; k++) {
      const rk = R * (k / 4);
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const an = (i / N) * TAU + 0.3, am = ((i - 0.5) / N) * TAU + 0.3;
        const x = Math.cos(an) * rk, y = Math.sin(an) * rk;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.quadraticCurveTo(Math.cos(am) * rk * 0.9, Math.sin(am) * rk * 0.9, x, y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(COL.bone, 0.38 * a);
    ctx.lineWidth = Math.max(2.6 / z, R * 0.02);
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  function mouthOf(e, k) {
    const a = e.angle || 0, d = bodyAxes(e).a * (k == null ? 0.85 : k);
    return [e.x + Math.cos(a) * d, e.y + Math.sin(a) * d];
  }

  function drawCast(ctx, c, z) {
    const e = c.e;
    if (!e) return;
    const k = clamp(c.t / c.dur, 0, 1);
    const r = e.r;
    if (c.kind === 'spray' && e.sp === 'wolf') { // howl: sound arcs rolling out in front
      const a = e.angle || c.a, m = mouthOf(e, 0.8);
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const q = k * 1.4 - i * 0.2;
        if (q <= 0 || q >= 1) continue;
        const lw = Math.max(2 / z, r * 0.08) * (1 - q * 0.5), rr = r * (0.8 + 3.4 * q);
        ctx.strokeStyle = rgba(COL.soil, 0.45 * (1 - q));   // dark under-stroke so it reads on snow
        ctx.lineWidth = lw + 2.5 / z;
        ctx.beginPath(); ctx.arc(m[0], m[1], rr, a - 1.1, a + 1.1); ctx.stroke();
        ctx.strokeStyle = rgba(COL.bone, 0.8 * (1 - q));
        ctx.lineWidth = lw;
        ctx.beginPath(); ctx.arc(m[0], m[1], rr, a - 1.1, a + 1.1); ctx.stroke();
      }
      ctx.restore();
    } else if (c.kind === 'spray') {   // a cone of spray: solid enough to read on any ground, fading as it drifts
      const a = e.angle || c.a, reach = r * 3;
      const f = Math.pow(1 - k, 0.9);
      const m = mouthOf(e, 0.7);
      const musk = e.sp === 'snake';   // garter snake musk: ochre, so it shows on green grass
      const rad = reach * (0.55 + 0.45 * Math.min(1, k * 3)), half = Math.PI / 4;
      ctx.save();
      ctx.translate(m[0], m[1]);
      ctx.rotate(a);
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
      gr.addColorStop(0, rgba(musk ? '#F6E39A' : '#F2FBD8', 0.85 * f));
      gr.addColorStop(0.6, rgba(musk ? '#D9B44E' : '#B9E07A', 0.5 * f));
      gr.addColorStop(1, rgba(musk ? '#B8862E' : COL.grow, 0.15 * f));
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, rad, -half, half); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgba(COL.soil, 0.35 * f);
      ctx.lineWidth = Math.max(1.6 / z, r * 0.05) + 2 / z;
      ctx.beginPath(); ctx.arc(0, 0, rad, -half, half); ctx.stroke();
      ctx.strokeStyle = rgba(COL.bone, 0.85 * f);
      ctx.lineWidth = Math.max(1.6 / z, r * 0.05);
      ctx.beginPath(); ctx.arc(0, 0, rad, -half, half); ctx.stroke();
      ctx.restore();
    } else if (c.kind === 'horn') {
      const a = e.angle || c.a, ca = Math.cos(a), sa = Math.sin(a);
      const f = 1 - k;
      ctx.strokeStyle = rgba(COL.bone, 0.75 * f);
      ctx.lineWidth = Math.max(2.2 / z, r * 0.08);
      for (let i = -1; i <= 1; i++) {
        const ox = -sa * r * 0.55 * i, oy = ca * r * 0.55 * i;
        ctx.beginPath();
        ctx.moveTo(e.x + ox - ca * r * 0.9, e.y + oy - sa * r * 0.9);
        ctx.lineTo(e.x + ox - ca * r * (2.4 + 1.2 * k), e.y + oy - sa * r * (2.4 + 1.2 * k));
        ctx.stroke();
      }
      const m = mouthOf(e, 1.05);
      ctx.strokeStyle = rgba('#FFFFFF', 0.85 * f);
      ctx.lineWidth = Math.max(2.6 / z, r * 0.1);
      ctx.beginPath(); ctx.arc(m[0], m[1], r * 0.8, a - 0.9, a + 0.9); ctx.stroke();
    } else if (c.kind === 'tongue' && e.sp !== 'frog') { // a pounce: speed lines toward the target, then a landing arc
      const m = mouthOf(e, 0.85), tg = c.target;
      if (tg && tg.alive !== false) { c.tx = tg.x; c.ty = tg.y; }
      const dx = c.tx - m[0], dy = c.ty - m[1], d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
      const f = 1 - k;
      ctx.strokeStyle = rgba(COL.bone, 0.7 * f);
      ctx.lineWidth = Math.max(1.8 / z, r * 0.06);
      ctx.lineCap = 'round';
      for (let i = -1; i <= 1; i++) {
        const ox = -uy * r * 0.4 * i, oy = ux * r * 0.4 * i, s0 = Math.min(1, k * 2.2) * d;
        ctx.beginPath(); ctx.moveTo(m[0] + ox + ux * s0 * 0.3, m[1] + oy + uy * s0 * 0.3); ctx.lineTo(m[0] + ox + ux * s0, m[1] + oy + uy * s0); ctx.stroke();
      }
      if (k > 0.35) {
        ctx.strokeStyle = rgba('#FFFFFF', 0.8 * f);
        ctx.beginPath(); ctx.arc(c.tx, c.ty, r * (0.5 + 0.6 * k), Math.atan2(uy, ux) - 1, Math.atan2(uy, ux) + 1); ctx.stroke();
      }
    } else if (c.kind === 'tongue') {
      const m = mouthOf(e, 0.85);
      let tx = c.tx, ty = c.ty;
      const tg = c.target;
      if (tg && tg.alive !== false) { tx = tg.x; ty = tg.y; c.tx = tx; c.ty = ty; }
      const ext = k < 0.4 ? k / 0.4 : 1 - (k - 0.4) / 0.6;
      const ex = m[0] + (tx - m[0]) * ext, ey = m[1] + (ty - m[1]) * ext;
      ctx.strokeStyle = rgba(COL.soil, 0.45);
      ctx.lineWidth = Math.max(r * 0.2, 2.6 / z) + 1.4 / z;
      ctx.beginPath(); ctx.moveTo(m[0], m[1]); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.strokeStyle = COL.tongue;
      ctx.lineWidth = Math.max(r * 0.2, 2.6 / z);
      ctx.beginPath(); ctx.moveTo(m[0], m[1]); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = '#F7B9C1';
      ctx.beginPath(); ctx.arc(ex, ey, Math.max(r * 0.17, 2.4 / z), 0, TAU); ctx.fill();
    } else if (c.kind === 'web') {
      // thread flying from the spider to the pointer
      const m = mouthOf(e, 0.8);
      const ex = m[0] + (c.tx - m[0]) * Math.min(1, k * 1.6), ey = m[1] + (c.ty - m[1]) * Math.min(1, k * 1.6);
      ctx.strokeStyle = rgba(COL.bone, 0.8 * (1 - k * 0.6));
      ctx.lineWidth = Math.max(1.6 / z, r * 0.05);
      ctx.beginPath(); ctx.moveTo(m[0], m[1]); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = COL.bone;
      ctx.beginPath(); ctx.arc(ex, ey, Math.max(2.4 / z, r * 0.12), 0, TAU); ctx.fill();
    } else if (c.kind === 'tail') {
      const f = 1 - k;
      ctx.strokeStyle = rgba(COL.bone, 0.6 * f);
      ctx.lineWidth = Math.max(2 / z, r * 0.06);
      ctx.beginPath(); ctx.arc(c.x, c.y, r * (0.6 + 1.2 * k), 0, TAU); ctx.stroke();
    }
  }

  function drawBite(ctx, b, z) {
    const e = b.e;
    if (!e) return;
    const k = clamp(b.t / b.dur, 0, 1);
    const a = (e.alive !== false ? e.angle : b.a) || 0;
    const x = e.alive !== false ? e.x : b.x, y = e.alive !== false ? e.y : b.y;
    const reach = e.r * 1.4 * (0.82 + 0.3 * k);
    const f = Math.pow(1 - k, 1.5);
    const half = Math.PI / 6; // 60 degrees in total
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.arc(0, 0, reach, -half, half);
    ctx.arc(-reach * 0.34, 0, reach * 0.9, half * 1.05, -half * 1.05, true);
    ctx.closePath();
    ctx.fillStyle = rgba(b.hit ? '#FFFFFF' : COL.bone, 0.9 * f);
    ctx.fill();
    ctx.strokeStyle = rgba(COL.soil, 0.25 * f);
    ctx.lineWidth = 1 / z;
    ctx.stroke();
    ctx.restore();
  }

  function drawAnchor(ctx, an, z) {
    const R = Math.max(nz(an.r) || ((player() || {}).r || 12) * 1.7, 12);
    const t = S.t;
    const p = 0.5 + 0.5 * Math.sin(t * 3.2);
    ctx.save();
    ctx.translate(an.x, an.y);
    ctx.globalCompositeOperation = 'lighter';
    glowAt(ctx, COL.bone, 0, 0, R * 2.2, 0.16 + 0.12 * p);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.strokeStyle = rgba(COL.bone, 0.6 + 0.3 * p);
    ctx.lineWidth = Math.max(2.6 / z, R * 0.06);
    ctx.beginPath(); ctx.arc(0, 0, R * (1 + 0.05 * p), 0, TAU); ctx.stroke();
    const f = (t * 0.8) % 1;
    ctx.strokeStyle = rgba(COL.bone, (1 - f) * 0.5);
    ctx.lineWidth = Math.max(1.8 / z, R * 0.04);
    ctx.beginPath(); ctx.arc(0, 0, R * (1 + 0.7 * f), 0, TAU); ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- drawScreen
  function drawScreen(ctx, t) {
    const g = A.G;
    ctx.save();
    drawPoison(ctx, g);
    drawPulses(ctx);
    drawFlashes(ctx);
    drawThreatArrows(ctx, g, t);
    drawAnchorPointer(ctx, g, t);
    ctx.restore();
  }

  function edgeGradient(ctx, color, a, inner) {
    const W = viewW(), H = viewH();
    const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * inner, W / 2, H / 2, Math.hypot(W, H) * 0.5);
    gr.addColorStop(0, rgba(color, 0));
    gr.addColorStop(0.55, rgba(color, a * 0.16));
    gr.addColorStop(1, rgba(color, a));
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
  }

  function drawPoison(ctx, g) {
    const pl = g && g.player;
    if (!pl || !(pl.poisonT > 0) || g.mode === 'dying') return;
    const fade = Math.min(1, pl.poisonT * 1.5);
    const w = 0.5 + 0.5 * Math.sin(S.t * 3);
    ctx.fillStyle = rgba('#3E8F1E', (0.05 + 0.03 * w) * fade);
    ctx.fillRect(0, 0, viewW(), viewH());
    edgeGradient(ctx, '#3E8F1E', (0.26 + 0.08 * w) * fade, 0.3);
  }

  function drawPulses(ctx) {
    for (let i = 0; i < S.pulses.length; i++) {
      const p = S.pulses[i], ph = p.t / p.dur;
      const env = (1 - ph) * (0.55 + 0.45 * Math.cos(ph * TAU * 2.2));
      edgeGradient(ctx, p.c, 0.42 * Math.max(0, env), 0.3);
    }
  }

  function drawFlashes(ctx) {
    for (let i = 0; i < S.flashes.length; i++) {
      const f = S.flashes[i];
      const a = f.a * Math.pow(1 - f.t / f.dur, 1.6);
      ctx.fillStyle = rgba(f.c, a);
      ctx.fillRect(0, 0, viewW(), viewH());
    }
  }

  const arrowList = [];
  function drawThreatArrows(ctx, g, t) {
    const pl = g && g.player;
    if (!pl || g.mode !== 'play' || pl.alive === false || pl.invulnT > 0 || !g.cam) return;
    const cam = g.cam, z = cam.zoom || 1, W = viewW(), H = viewH();
    const reach = (H / z) * 1.5;
    arrowList.length = 0;
    const list = g.entities || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.role !== 'hunter' || e.alive === false || e.isPlayer) continue;
      const dist = Math.hypot(e.x - pl.x, e.y - pl.y);
      if (e.target !== pl && dist > reach) continue;
      proj(e.x, e.y, cam);
      const pad = e.r * z;
      if (px > -pad && px < W + pad && py > -pad && py < H + pad) continue; // visible, ring cue handles it
      if (!canEatFn(e, pl)) continue;
      const prox = clamp(1 - dist / (reach * 1.6), 0, 1);
      const size = clamp(e.r / pl.r, 0.5, 3);
      arrowList.push({ sx: px, sy: py, threat: clamp(0.65 * prox + 0.35 * (size - 0.5) / 2.5, 0, 1), wind: e.state === 'windup', targeting: e.target === pl });
    }
    if (!arrowList.length) return;
    arrowList.sort((a, b) => b.threat - a.threat);
    const n = Math.min(arrowList.length, 6);
    for (let i = 0; i < n; i++) drawArrow(ctx, arrowList[i], t, W, H);
  }

  // Screen-edge position for a direction from the view centre, pulled in along the same line until it clears the
  // HUD boxes ui.js reports (ribbon, score, dial, pause and touch buttons, banners).
  function edgePoint(dx, dy, W, H, out) {
    const cx = W / 2, cy = H / 2;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const m = 34;
    let k = Math.min((cx - m) / Math.max(Math.abs(ux), 1e-4), (cy - m) / Math.max(Math.abs(uy), 1e-4));
    const rects = (A.UI && A.UI.hudRects && A.UI.hudRects()) || [];
    for (let i = 0; i < 24 && k > 60 && hitsRects(cx + ux * k, cy + uy * k, 28, rects); i++) k -= 14;
    out.x = cx + ux * k; out.y = cy + uy * k; out.ux = ux; out.uy = uy;
  }
  function hitsRects(x, y, rad, rects) {
    for (let i = 0; i < rects.length; i++) {
      const q = rects[i];
      if (x + rad > q.l && x - rad < q.r && y + rad > q.t && y - rad < q.b) return true;
    }
    return false;
  }
  const edgeOut = { x: 0, y: 0, ux: 1, uy: 0 };

  // Offscreen threat: a slim venom chevron on the screen edge, bigger and brighter as the threat gets closer.
  function drawArrow(ctx, a, t, W, H) {
    edgePoint(a.sx - W / 2, a.sy - H / 2, W, H, edgeOut);
    const pulse = a.wind ? 1 + 0.3 * Math.abs(Math.sin(t * 14)) : 1 + 0.06 * Math.sin(t * 4);
    const s = (11 + 14 * a.threat) * pulse;
    const alpha = a.wind ? 1 : a.targeting ? 0.9 : 0.6;
    ctx.save();
    ctx.translate(edgeOut.x, edgeOut.y);
    ctx.rotate(Math.atan2(edgeOut.uy, edgeOut.ux));
    ctx.globalAlpha = alpha;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s, 0); ctx.lineTo(-s * 0.55, s * 0.8); ctx.lineTo(-s * 0.15, 0); ctx.lineTo(-s * 0.55, -s * 0.8);
    ctx.closePath();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(27,22,18,0.55)';
    ctx.stroke();
    ctx.fillStyle = a.wind ? '#FF8A8E' : COL.danger;
    ctx.fill();
    if (a.wind) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgba(COL.danger, 0.7);
      ctx.beginPath(); ctx.arc(0, 0, s * (1.5 + 0.5 * Math.abs(Math.sin(t * 14))), 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  // Tutorial: a bone chevron when the anchor point is off the screen.
  function drawAnchorPointer(ctx, g, t) {
    const tu = g && g.tutorial;
    if (!tu || !tu.active || !tu.target || !g.cam || g.mode !== 'play') return;
    proj(tu.target.x, tu.target.y, g.cam);
    const W = viewW(), H = viewH();
    if (px > 24 && px < W - 24 && py > 100 && py < H - 90) return;
    edgePoint(px - W / 2, py - H / 2, W, H, edgeOut);
    const s = 13 + 2 * Math.sin(t * 5);
    ctx.save();
    ctx.translate(edgeOut.x, edgeOut.y);
    ctx.rotate(Math.atan2(edgeOut.uy, edgeOut.ux));
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(s, 0); ctx.lineTo(-s * 0.55, s * 0.8); ctx.lineTo(-s * 0.15, 0); ctx.lineTo(-s * 0.55, -s * 0.8);
    ctx.closePath();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(27,22,18,0.55)';
    ctx.stroke();
    ctx.fillStyle = COL.bone;
    ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------- decomposition
  const LAND_CRITTERS = ['worm', 'springtail', 'beetle', 'mite', 'pillbug'];
  const WATER_CRITTERS = ['crab', 'crayfish', 'urchin', 'mite'];

  function drawDecompose(ctx, cam, t, di, p) {
    if (!di || !cam) return;
    p = clamp(p || 0, 0, 1);
    const sc = decoScene(di, cam);
    const z = (cam.zoom || 1) * sc.boost;
    let q = p, fall = 1;
    if (sc.hab === 'air') {
      const F = 0.2;
      fall = clamp(p / F, 0, 1);
      q = clamp((p - F) / (1 - F), 0, 1);
      if (fall >= 1 && !sc.landed) { sc.landed = true; shake(5); }
    }
    ctx.save();
    setScreen(ctx);
    dimBackdrop(ctx, cam, sc, p);
    setWorld(ctx, cam);
    ctx.translate(sc.x, sc.y); ctx.scale(sc.boost, sc.boost); ctx.translate(-sc.x, -sc.y); // cinematic focus on the corpse
    decoGround(ctx, sc, q, t, z);
    if (q > 0 || sc.hab === 'air') decoBody(ctx, sc, q, fall, t, cam);
    decoHyphae(ctx, sc, q, t, z);
    decoSpecks(ctx, sc, q, t, z);
    decoFlow(ctx, sc, q, t, z);
    decoCritters(ctx, sc, q, t, z);
    if (sc.hab === 'water') decoBubbles(ctx, sc, q, z);
    decoMotes(ctx, sc, q, t, z);
    decoEgg(ctx, sc, q, t, z);
    ctx.restore();
    setScreen(ctx);
  }

  function dimBackdrop(ctx, cam, sc, p) {
    proj(sc.x, sc.y, cam);
    const a = 0.66 * smooth(p / 0.12) * (1 - 0.5 * smooth((p - 0.94) / 0.06));
    const W = viewW(), H = viewH();
    const gr = ctx.createRadialGradient(px, py, Math.min(W, H) * 0.08, px, py, Math.hypot(W, H) * 0.55);
    gr.addColorStop(0, 'rgba(3,9,7,0)');
    gr.addColorStop(0.3, 'rgba(3,9,7,' + (a * 0.5).toFixed(3) + ')');
    gr.addColorStop(1, 'rgba(3,9,7,' + a.toFixed(3) + ')');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
  }

  // ---- scene construction (deterministic per death)
  function decoScene(di, cam) {
    const key = [di.sp, di.cause, Math.round(di.x || 0), Math.round(di.y || 0), Math.round(di.r || 0)].join('|');
    if (S.deco && S.deco.key === key) return S.deco;
    S.deco = buildDeco(di, key, cam);
    return S.deco;
  }

  function buildDeco(di, key, cam) {
    const rng = mulberry(hashStr(key));
    const R = Math.max(4, di.r || 12);
    const look = A.LOOKS && A.LOOKS[di.sp];
    const g = A.G;
    const sc = {
      key, rng, R, landed: false,
      x: di.x != null ? di.x : cam.x, y: di.y != null ? di.y : cam.y,
      sp: di.sp, di,
      hab: di.habitat || (look && look.habitat) || (g && g.tier && g.tier.habitat) || 'land',
      len: (look && look.len) || 1.35, wid: (look && look.wid) || 0.8,
      ang: di.angle != null ? di.angle : rng() * TAU, hasLook: !!look,
    };
    // Enlarge the whole scene so the corpse reads at about 72px radius whatever the camera zoom.
    sc.boost = clamp(72 / (R * (cam.zoom || 1)), 1, 2.4);
    if (sc.hab !== 'water' && sc.hab !== 'air') sc.hab = 'land';
    sc.half = R * (Math.max(sc.len, sc.wid) * 1.3 + 0.9);
    sc.variant = sc.hab === 'water' ? 'egg' : rng() < 0.5 ? 'egg' : 'sprout';
    sc.body = makeFake(sc, di.sp, di.pal, di.parts, R);
    sc.hyphae = genHyphae(sc);
    sc.specks = genSpecks(sc);
    sc.critters = genCritters(sc);
    sc.targets = genTargets(sc);
    sc.motes = genMotes(sc);
    sc.ash = genAsh(sc);
    sc.drift = genDrift(sc);
    sc.bubbles = sc.hab === 'water' ? genBubbles(sc) : [];
    sc.soil = genSoil(sc);
    sc.zig = genZig(sc);
    return sc;
  }

  function makeFake(sc, sp, pal, parts, r) {
    return {
      id: -1, sp, def: A.SPECIES && A.SPECIES[sp], ro: null, role: 'grazer', beh: 'static',
      x: sc.x, y: sc.y, vx: 0, vy: 0, angle: 0, r, mass: r * r / 16, speed: 0,
      state: 'idle', stateT: 0, target: null, tx: sc.x, ty: sc.y, hungerT: 0, fed: 0, sick: false, desperate: false,
      alive: true, age: 0, phase: 0, biteT: 0, hurtT: 0, alt: 0, amount: 1, isPlayer: false,
      pal: pal || null, parts: parts || null, rs: {}, lastAte: -999,
    };
  }

  function rot2(x, y, a) { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; }

  function bodyPoint(sc, rng, spread) {
    const u = Math.sqrt(rng()) * spread, v = rng() * TAU;
    return rot2(Math.cos(v) * u * sc.len * sc.R, Math.sin(v) * u * sc.wid * sc.R, sc.ang);
  }

  function genHyphae(sc) {
    const rng = sc.rng, out = [], step = sc.R * 0.075, n = 12;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * TAU + rng() * 0.5, d0 = sc.R * (2.1 + rng() * 0.9);
      const tgt = bodyPoint(sc, rng, 0.6);
      const x = Math.cos(th) * d0, y = Math.sin(th) * d0;
      walk(out, rng, {
        x, y, h: Math.atan2(tgt[1] - y, tgt[0] - x), steps: Math.ceil(Math.hypot(tgt[0] - x, tgt[1] - y) / step) + 2 + ((rng() * 3) | 0),
        step, tx: tgt[0], ty: tgt[1], pull: 0.2, delay: rng() * 0.3, dur: 0.45 + rng() * 0.3, w: 1, depth: 0,
      });
    }
    return out;
  }

  // Random-walk polyline; side branches start where the parent has already grown to.
  function walk(out, rng, o) {
    const pts = [o.x, o.y];
    let x = o.x, y = o.y, h = o.h, wob = 0;
    const seg = { pts, delay: o.delay, dur: o.dur, w: o.w };
    out.push(seg);
    for (let k = 0; k < o.steps; k++) {
      wob = wob * 0.9 + (rng() - 0.5) * 0.7;
      if (o.pull) {
        const near = Math.hypot(o.tx - x, o.ty - y) < o.step * 1.5;
        let da = Math.atan2(o.ty - y, o.tx - x) - h;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        h += near ? 0 : da * o.pull;
      }
      h += wob * 0.45;
      x += Math.cos(h) * o.step; y += Math.sin(h) * o.step;
      pts.push(x, y);
      if (o.depth < 2 && k > 3 && rng() < 0.18) {
        walk(out, rng, {
          x, y, h: h + (rng() < 0.5 ? -1 : 1) * (0.6 + rng() * 0.6), steps: 5 + ((rng() * 6) | 0), step: o.step * 0.9,
          pull: 0, delay: o.delay + o.dur * (k / o.steps), dur: o.dur * 0.5, w: o.w * 0.65, depth: o.depth + 1,
        });
      }
    }
  }

  function genSpecks(sc) {
    const rng = sc.rng, out = [];
    for (let i = 0; i < 44; i++) {
      const a = rng() * TAU, d = sc.R * (0.2 + 1.9 * Math.sqrt(rng()));
      out.push({
        x: Math.cos(a) * d, y: Math.sin(a) * d, ph: rng() * TAU, ph2: rng() * TAU, f: 3 + rng() * 5, amp: 0.05 + rng() * 0.1,
        a0: 0.12 + rng() * 0.4, a1: 0.8 + rng() * 0.12, size: 0.025 + rng() * 0.035, c: rng() < 0.6 ? 0 : 1,
      });
    }
    return out;
  }

  function genCritters(sc) {
    const rng = sc.rng, list = sc.hab === 'water' ? WATER_CRITTERS : LAND_CRITTERS;
    const n = 3 + ((rng() * 4) | 0), out = [];
    for (let i = 0; i < n; i++) {
      const sp = list[(i + ((rng() * list.length) | 0)) % list.length];
      const th = (i / n) * TAU + rng() * 0.8;
      const r = sc.R * (0.2 + rng() * 0.12);
      const [ax, ay] = rot2(Math.cos(th) * sc.len * sc.R * 1.0, Math.sin(th) * sc.wid * sc.R * 1.0, sc.ang);
      const dist = sc.R * (4.2 + rng() * 1.4);
      const t0 = 0.06 + rng() * 0.18;
      out.push({
        sp, r, ax, ay, sx: Math.cos(th) * dist, sy: Math.sin(th) * dist, th,
        t0, wd: 0.12 + rng() * 0.06, t1: 0.78 + rng() * 0.08, ld: 0.12,
        curve: (rng() - 0.5) * sc.R * 1.6, f: 4 + rng() * 4, ph: rng() * TAU,
        e: makeFake(sc, sp, null, null, r),
        hasLook: !!(A.LOOKS && A.LOOKS[sp]),
        trail: [],
      });
    }
    return out;
  }

  // Where the nutrients go: nearby producers, otherwise points in the soil around the body.
  function genTargets(sc) {
    const g = A.G, rng = sc.rng, out = [];
    const reach = 300 * Math.max(1, sc.R / 12);
    const list = (g && g.entities) || [];
    const cands = [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.role !== 'producer' || e.alive === false || e.sp === 'carrion') continue;
      const d = Math.hypot(e.x - sc.x, e.y - sc.y);
      if (d < reach && d > sc.R * 1.2) cands.push({ e, d });
    }
    cands.sort((a, b) => a.d - b.d);
    for (let i = 0; i < Math.min(6, cands.length); i++) {
      const e = cands[i].e;
      // stored pre-boost so they land on the real producers once the scene is scaled
      out.push({ x: (e.x - sc.x) / sc.boost, y: (e.y - sc.y) / sc.boost, r: Math.max(e.r || 8, 6) / sc.boost, prod: true, hits: [] });
    }
    if (!out.length) {
      for (let i = 0; i < 5; i++) {
        const a = rng() * TAU, d = sc.R * (1.3 + rng() * 0.9);
        out.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: sc.R * 0.5, prod: false, hits: [] });
      }
    }
    return out;
  }

  function genMotes(sc) {
    const rng = sc.rng, out = [];
    for (let i = 0; i < 56; i++) {
      const ti = i % sc.targets.length, tg = sc.targets[ti];
      const o = bodyPoint(sc, rng, 0.9);
      const birth = 0.5 + rng() * 0.22, life = 0.18 + rng() * 0.1;
      const tx = tg.x + (rng() - 0.5) * tg.r * 0.6, ty = tg.y + (rng() - 0.5) * tg.r * 0.6;
      const mx = (o[0] + tx) / 2, my = (o[1] + ty) / 2;
      const len = Math.hypot(tx - o[0], ty - o[1]) || 1;
      const off = (rng() - 0.5) * len * 0.7;
      out.push({
        x0: o[0], y0: o[1], x2: tx, y2: ty,
        x1: mx - ((ty - o[1]) / len) * off, y1: my + ((tx - o[0]) / len) * off - len * 0.12,
        birth, life, size: 0.05 + rng() * 0.05, ti,
      });
      tg.hits.push(birth + life);
    }
    return out;
  }

  function genAsh(sc) {
    const rng = sc.rng, out = [];
    for (let i = 0; i < 40; i++) {
      const o = bodyPoint(sc, rng, 0.95);
      out.push({ x: o[0], y: o[1], b: 0.5 + rng() * 0.32, life: 0.16 + rng() * 0.1, dx: (rng() - 0.5) * sc.R * 0.9,
        dy: -sc.R * (0.5 + rng() * 1.1), size: 0.03 + rng() * 0.05, c: rng() < 0.5 ? 0 : 1 });
    }
    return out;
  }

  // Slow floating specks: marine snow (water) or fungal spores (land).
  function genDrift(sc) {
    const rng = sc.rng, out = [], box = sc.R * 11;
    for (let i = 0; i < 40; i++) {
      out.push({ x: (rng() - 0.5) * box, y: rng() * box, ph: rng() * TAU, size: 0.03 + rng() * 0.05, spd: 0.3 + rng() * 0.5, box });
    }
    return out;
  }

  function genBubbles(sc) {
    const rng = sc.rng, out = [];
    for (let i = 0; i < 16; i++) {
      const o = bodyPoint(sc, rng, 0.8);
      out.push({ x: o[0], y: o[1], b: rng() * 0.55, rise: sc.R * (1.8 + rng() * 2), size: 0.07 + rng() * 0.11, ph: rng() * TAU });
    }
    return out;
  }

  function genSoil(sc) {
    const rng = sc.rng, blobs = [], clods = [];
    for (let i = 0; i < 5; i++) {
      const a = rng() * TAU, d = sc.R * rng() * 0.8;
      blobs.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: sc.R * (1.3 + rng() * 0.8) });
    }
    for (let i = 0; i < 18; i++) {
      const a = rng() * TAU, d = sc.R * (0.9 + rng() * 1.5);
      clods.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: sc.R * (0.03 + rng() * 0.05) });
    }
    return { blobs, clods };
  }

  function genZig(sc) {
    const rng = sc.rng, zig = [];
    for (let i = 0; i < 7; i++) zig.push({ x: -1.15 + (i / 6) * 2.3, y: (i % 2 ? 0.17 : -0.13) + (rng() - 0.5) * 0.08 });
    return zig;
  }

  // ---- ground (soil patch / seabed)
  function decoGround(ctx, sc, q, t, z) {
    const R = sc.R, fade = smooth(q / 0.2);
    // dust ring where an airborne body lands
    if (sc.hab === 'air' && q < 0.14) {
      const k = q / 0.14;
      ctx.strokeStyle = 'rgba(190,175,140,' + (0.45 * (1 - k)).toFixed(3) + ')';
      ctx.lineWidth = Math.max(R * 0.18 * (1 - k), 1 / z);
      ctx.beginPath(); ctx.arc(sc.x, sc.y, R * (0.9 + 2.4 * k), 0, TAU); ctx.stroke();
    }
    if (fade <= 0) return;
    const water = sc.hab === 'water';
    const inner = water ? '8,40,54' : '28,18,11', mid = water ? '6,30,42' : '22,14,9';
    const outA = (water ? 0.62 : 0.6) * fade * (1 - smooth((q - 0.9) / 0.1) * 0.4);
    ctx.globalAlpha = 1;
    for (const b of sc.soil.blobs) {
      const gr = ctx.createRadialGradient(sc.x + b.x, sc.y + b.y, 0, sc.x + b.x, sc.y + b.y, b.r);
      gr.addColorStop(0, 'rgba(' + inner + ',' + (outA * 0.7).toFixed(3) + ')');
      gr.addColorStop(0.6, 'rgba(' + mid + ',' + (outA * 0.4).toFixed(3) + ')');
      gr.addColorStop(1, 'rgba(' + mid + ',0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(sc.x + b.x, sc.y + b.y, b.r, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = water ? 'rgba(130,170,170,' + (0.2 * fade).toFixed(3) + ')' : 'rgba(10,6,3,' + (0.55 * fade).toFixed(3) + ')';
    for (const c of sc.soil.clods) {
      ctx.beginPath(); ctx.arc(sc.x + c.x, sc.y + c.y, c.r, 0, TAU); ctx.fill();
    }
    // slow underglow from the fungal network
    const cover = smooth((q - 0.2) / 0.45) * (1 - smooth((q - 0.8) / 0.12));
    if (cover > 0) {
      ctx.globalCompositeOperation = 'lighter';
      glowAt(ctx, '#7FDDEB', sc.x, sc.y, R * 3.6, 0.34 * cover * (0.85 + 0.15 * Math.sin(t * 2.1)));
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }

  // ---- the corpse
  function decoBody(ctx, sc, q, fall, t, cam) {
    const R = sc.R;
    const fallE = 1 - Math.pow(1 - fall, 2);
    const air = sc.hab === 'air';
    const water = sc.hab === 'water';
    const dissolve = smooth((q - 0.5) / 0.35);
    const alpha = 1 - dissolve;
    if (alpha <= 0.01) return;
    const settle = q < 0.15 ? Math.sin(smooth(q / 0.15) * Math.PI) * 0.035 : 0;
    const depth = water ? smooth(q / 0.5) : 0;
    let scale = 1 + settle - 0.55 * dissolve - 0.2 * depth;
    if (air) scale *= 1 + 0.55 * (1 - fallE);
    const grey = 0.6 * smooth(q / 0.15) + 0.15 * smooth((q - 0.15) / 0.35);
    const wash = water ? rgba('#2E5A6E', grey * 0.9 + 0.2 * depth) : rgba('#6C685E', grey);
    const e = sc.body;
    e.x = sc.x; e.y = sc.y;
    e.angle = sc.ang + (air ? (1 - fallE) * 1.6 : 0);
    e.alt = air ? cfg('AIR_ALT', 0.35) * (1 - fallE) : 0;
    e.r = R;
    const layer = bodyLayer(sc, cam, e, wash);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (layer) {
      const h = sc.half * scale;
      ctx.drawImage(layer, sc.x - h, sc.y - h, 2 * h, 2 * h);
    } else {
      drawCorpseInto(ctx, sc, e);
      ctx.globalAlpha = alpha * grey * 0.8;
      ctx.fillStyle = water ? '#2E5A6E' : '#6C685E';
      ctx.beginPath(); ctx.ellipse(sc.x, sc.y, sc.len * R * scale, sc.wid * R * scale, sc.ang, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // Render the corpse offscreen (so a grey wash can be clipped to its pixels), return the canvas.
  function bodyLayer(sc, cam, e, wash) {
    const D = dpr(), z = (cam.zoom || 1) * sc.boost;
    const px2 = clamp(Math.ceil(2 * sc.half * z * D), 32, 1024);
    let lc = S.layer;
    if (!lc || lc.width !== px2) lc = S.layer = makeCanvas(px2, px2);
    const lx = lc && lc.getContext && lc.getContext('2d');
    if (!lx) return null;
    const k = px2 / (2 * sc.half);
    lx.setTransform(1, 0, 0, 1, 0, 0);
    lx.globalCompositeOperation = 'source-over';
    lx.globalAlpha = 1;
    lx.clearRect(0, 0, px2, px2);
    lx.setTransform(k, 0, 0, k, px2 / 2 - sc.x * k, px2 / 2 - sc.y * k);
    drawCorpseInto(lx, sc, e);
    lx.setTransform(1, 0, 0, 1, 0, 0);
    lx.globalCompositeOperation = 'source-atop';
    lx.fillStyle = wash;
    lx.fillRect(0, 0, px2, px2);
    lx.globalCompositeOperation = 'source-over';
    return lc;
  }

  function drawCorpseInto(ctx, sc, e) {
    if (sc.hasLook && A.drawCreature) {
      try { A.drawCreature(ctx, e, 1.7); return; } catch (err) { warnOnce('corpse', err); }
    }
    drawBlob(ctx, e.x, e.y, e.r, e.angle, sc.len, sc.wid, e.pal, e.sp);
  }

  function warnOnce(key, err) {
    if (S.warned[key]) return;
    S.warned[key] = true;
    if (typeof console !== 'undefined') console.warn('[fx] ' + key + ' fallback: ' + (err && err.message));
  }

  // Fallback creature when shapes are unavailable: shaded ellipse with a head and an eye.
  function drawBlob(ctx, x, y, r, ang, len, wid, pal, sp) {
    const look = A.LOOKS && A.LOOKS[sp];
    const body = (pal && pal.body) || (look && look.pal && look.pal.body) || '#7FA86B';
    const belly = (look && look.pal && look.pal.belly) || '#C9D8A5';
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(r * 0.1, r * 0.2, len * r, wid * r, 0, 0, TAU); ctx.fill();
    const gr = ctx.createRadialGradient(-r * 0.2, -wid * r * 0.35, r * 0.1, 0, 0, len * r);
    gr.addColorStop(0, belly); gr.addColorStop(1, body);
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.ellipse(0, 0, len * r, wid * r, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(len * r * 0.8, 0, wid * r * 0.6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(len * r * 0.95, -wid * r * 0.25, r * 0.17, 0, TAU); ctx.fill();
    ctx.fillStyle = '#122';
    ctx.beginPath(); ctx.arc(len * r * 0.98, -wid * r * 0.25, r * 0.08, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // ---- fungal hyphae
  function decoHyphae(ctx, sc, q, t, z) {
    const u = (q - 0.15) / 0.55;
    const fade = 1 - smooth((q - 0.84) / 0.1);
    const ret = 1 - smooth((q - 0.76) / 0.18); // strands wither back once the body is gone
    if (u <= 0 || fade <= 0) return;
    const lw = Math.max(sc.R * 0.05, 1.3 / z);
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.globalCompositeOperation = pass === 0 ? 'lighter' : 'source-over'; // core pass must not saturate to white
      ctx.strokeStyle = pass === 0 ? 'rgba(120,225,245,' + (0.1 * fade).toFixed(3) + ')' : 'rgba(191,246,255,' + (0.42 * fade).toFixed(3) + ')';
      for (const s of sc.hyphae) {
        const f = clamp((u - s.delay) / s.dur, 0, 1) * ret;
        if (f <= 0) continue;
        ctx.lineWidth = lw * s.w * (pass === 0 ? 4 : 1);
        strokeStrand(ctx, s, f, sc.x, sc.y);
      }
    }
    // glowing growth tips
    ctx.globalCompositeOperation = 'lighter';
    for (const s of sc.hyphae) {
      const f = clamp((u - s.delay) / s.dur, 0, 1);
      if (f <= 0 || f >= 1 || ret < 1) continue;
      strandTip(s, f);
      glowAt(ctx, COL.dna, sc.x + tipX, sc.y + tipY, lw * 3.4, 0.7 * fade);
    }
    ctx.restore();
  }

  let tipX = 0, tipY = 0;
  function strandTip(s, f) {
    const n = s.pts.length / 2 - 1, m = f * n, i = Math.min(n - 1, Math.floor(m)), fr = m - i;
    tipX = lerp(s.pts[i * 2], s.pts[i * 2 + 2], fr);
    tipY = lerp(s.pts[i * 2 + 1], s.pts[i * 2 + 3], fr);
  }
  function strokeStrand(ctx, s, f, ox, oy) {
    const pts = s.pts, n = pts.length / 2 - 1, m = f * n, i = Math.min(n - 1, Math.floor(m));
    ctx.beginPath();
    ctx.moveTo(ox + pts[0], oy + pts[1]);
    for (let k = 1; k <= i; k++) ctx.lineTo(ox + pts[k * 2], oy + pts[k * 2 + 1]);
    strandTip(s, f);
    ctx.lineTo(ox + tipX, oy + tipY);
    ctx.stroke();
  }

  // ---- bacteria specks
  function decoSpecks(ctx, sc, q, t, z) {
    if (q < 0.12) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of sc.specks) {
      const env = smooth((q - s.a0) / 0.08) * (1 - smooth((q - s.a1) / 0.08));
      if (env <= 0.01) continue;
      const x = sc.x + s.x + Math.sin(t * s.f + s.ph) * sc.R * s.amp;
      const y = sc.y + s.y + Math.cos(t * s.f * 0.8 + s.ph2) * sc.R * s.amp;
      ctx.globalAlpha = env * 0.6 * (0.55 + 0.45 * Math.sin(t * 6 + s.ph));
      ctx.fillStyle = s.c ? COL.grow : COL.dna;
      ctx.beginPath(); ctx.arc(x, y, Math.max(sc.R * s.size, 0.9 / z), 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // ---- marine snow / spores drifting through the scene
  function decoFlow(ctx, sc, q, t, z) {
    const water = sc.hab === 'water';
    const env = smooth((q - 0.03) / 0.12) * (water ? 1 : smooth((q - 0.2) / 0.2)) * (1 - smooth((q - 0.9) / 0.1));
    if (env <= 0.01) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = water ? '#DDF6FF' : COL.dna;
    for (const d of sc.drift) {
      const dir = water ? 1 : -1;
      let yy = (d.y + dir * t * d.spd * sc.R * 0.5) % d.box;
      if (yy < 0) yy += d.box;
      const x = sc.x + d.x + Math.sin(t * 0.6 + d.ph) * sc.R * 0.4;
      const y = sc.y + yy - d.box / 2;
      ctx.globalAlpha = env * (water ? 0.5 : 0.35) * (0.6 + 0.4 * Math.sin(t * 2 + d.ph));
      ctx.beginPath(); ctx.arc(x, y, Math.max(sc.R * d.size, 0.9 / z), 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // ---- decomposer critters
  function decoCritters(ctx, sc, q, t, z) {
    for (const c of sc.critters) {
      const walkP = clamp((q - c.t0) / c.wd, 0, 1);
      const leaveP = clamp((q - c.t1) / c.ld, 0, 1);
      if (q < c.t0 || leaveP >= 1) continue;
      critterPose(sc, c, walkP, leaveP, t);
      const alpha = smooth(walkP / 0.3) * (1 - smooth((leaveP - 0.4) / 0.6));
      if (alpha <= 0.01) continue;
      ctx.save();
      ctx.globalAlpha = alpha;
      drawCritter(ctx, c, t);
      ctx.restore();
    }
  }

  function critterPoint(sc, c, walkP, leaveP) {
    if (leaveP > 0) {
      const k = 1 - Math.pow(1 - leaveP, 2);
      return [lerp(c.ax, c.sx * 1.2, k), lerp(c.ay, c.sy * 1.2, k)];
    }
    const k = 1 - Math.pow(1 - walkP, 2), bend = Math.sin(k * Math.PI) * c.curve;
    const nx = -Math.sin(c.th), ny = Math.cos(c.th);
    return [lerp(c.sx, c.ax, k) + nx * bend, lerp(c.sy, c.ay, k) + ny * bend];
  }

  function critterPose(sc, c, walkP, leaveP, t) {
    const e = c.e;
    const p0 = critterPoint(sc, c, walkP, leaveP);
    const p1 = critterPoint(sc, c, Math.min(1, walkP + 0.01), Math.min(1, leaveP + (leaveP > 0 ? 0.01 : 0)));
    const feeding = walkP >= 1 && leaveP === 0;
    let x = p0[0], y = p0[1];
    if (feeding) {
      x += Math.cos(t * c.f + c.ph) * sc.R * 0.035;
      y += Math.sin(t * c.f * 1.3 + c.ph) * sc.R * 0.035;
      e.angle = Math.atan2(-c.ay, -c.ax) + Math.sin(t * 5 + c.ph) * 0.2;
      e.phase = c.ph + t * 1.6;
      e.biteT = 0.1 * Math.max(0, Math.sin(t * 9 + c.ph));
    } else {
      e.angle = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
      e.phase = (walkP + leaveP) * 22 + c.ph;
      e.biteT = 0;
    }
    e.x = sc.x + x; e.y = sc.y + y;
    e.tx = e.x; e.ty = e.y;
    // best-effort trail for chained (world-space) body plans
    const tr = c.trail, last = tr[0];
    if (!last || Math.hypot(last.x - e.x, last.y - e.y) > c.r * 0.5) {
      tr.unshift({ x: e.x, y: e.y });
      if (tr.length > 10) tr.pop();
    }
    e.rs.trail = tr;
  }

  function drawCritter(ctx, c, t) {
    const e = c.e;
    if (c.hasLook && A.drawCreature) {
      try { A.drawCreature(ctx, e, t); return; } catch (err) { warnOnce('critter', err); }
    }
    drawBug(ctx, e, c.sp);
  }

  // Fallback decomposer: dark glossy bug (or crab) with animated legs.
  function drawBug(ctx, e, sp) {
    const r = e.r, crab = sp === 'crab' || sp === 'crayfish' || sp === 'urchin';
    ctx.save();
    ctx.translate(e.x, e.y); ctx.rotate(e.angle);
    ctx.strokeStyle = crab ? '#C8604E' : '#3A3226';
    ctx.lineWidth = Math.max(r * 0.12, 0.2);
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const x = r * (0.4 - i * 0.45), sw = Math.sin(e.phase * 2 + i * 2.1) * r * 0.35;
      ctx.beginPath();
      ctx.moveTo(x, 0); ctx.lineTo(x + sw, r * 1.1); ctx.moveTo(x, 0); ctx.lineTo(x - sw, -r * 1.1);
      ctx.stroke();
    }
    const gr = ctx.createRadialGradient(-r * 0.2, -r * 0.3, r * 0.1, 0, 0, r * 1.2);
    gr.addColorStop(0, crab ? '#F08A70' : '#6A5E4A');
    gr.addColorStop(1, crab ? '#B04A3E' : '#2A241A');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.ellipse(0, 0, r * (crab ? 0.95 : 1.1), r * (crab ? 0.8 : 0.62), 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.ellipse(-r * 0.15, -r * 0.2, r * 0.45, r * 0.18, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // ---- water bubbles rising off the sinking body
  function decoBubbles(ctx, sc, q, z) {
    ctx.save();
    ctx.lineWidth = Math.max(0.8 / z, sc.R * 0.02);
    for (const b of sc.bubbles) {
      const a = (q - b.b) / 0.28;
      if (a <= 0 || a >= 1) continue;
      const x = sc.x + b.x + Math.sin(a * 8 + b.ph) * sc.R * 0.2;
      const y = sc.y + b.y - a * b.rise;
      const r = sc.R * b.size * (1 + 0.5 * a);
      ctx.globalAlpha = (1 - a) * 0.85;
      ctx.strokeStyle = '#CFF6FF';
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(207,246,255,0.14)';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.35, Math.max(r * 0.2, 0.3), 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // ---- dissolving ash + nutrient motes flowing to producers
  function decoMotes(ctx, sc, q, t, z) {
    if (q < 0.5) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const a of sc.ash) {
      const k = (q - a.b) / a.life;
      if (k <= 0 || k >= 1) continue;
      ctx.globalAlpha = (1 - k) * 0.4;
      ctx.fillStyle = a.c ? COL.grow : COL.dna;
      ctx.beginPath();
      ctx.arc(sc.x + a.x + a.dx * k, sc.y + a.y + a.dy * k, Math.max(sc.R * a.size * (1 - 0.5 * k), 0.9 / z), 0, TAU);
      ctx.fill();
    }
    for (const m of sc.motes) {
      const k = (q - m.birth) / m.life;
      if (k <= 0 || k >= 1) continue;
      const size = Math.max(sc.R * m.size, 1.4 / z);
      const col = k < 0.5 ? COL.dna : COL.grow;
      const lead = smooth(k / 0.2) * (1 - smooth((k - 0.88) / 0.12)); // fade in at the body, out on arrival
      for (let tr = 3; tr >= 0; tr--) {
        bez(m, smooth(Math.max(0, k - tr * 0.04)));
        glowAt(ctx, col, sc.x + bx, sc.y + by, size * (2.8 - tr * 0.5), 0.65 * (1 - tr * 0.25) * lead);
      }
    }
    // each producer lights up as nutrients arrive
    for (const tg of sc.targets) {
      let g = 0;
      for (const arr of tg.hits) {
        const d = q - arr;
        if (d > 0 && d < 0.22) g += Math.exp(-d / 0.07);
      }
      if (g > 0.01) glowAt(ctx, COL.grow, sc.x + tg.x, sc.y + tg.y, Math.max(tg.r * 1.8, 10), Math.min(0.8, g * 0.2));
    }
    ctx.restore();
  }

  let bx = 0, by = 0;
  function bez(m, k) {
    const i = 1 - k;
    bx = i * i * m.x0 + 2 * i * k * m.x1 + k * k * m.x2;
    by = i * i * m.y0 + 2 * i * k * m.y1 + k * k * m.y2;
  }

  // ---- soil glow, egg / sprout, hatch
  function decoEgg(ctx, sc, q, t, z) {
    const R = sc.R;
    const glow = smooth((q - 0.78) / 0.2);
    if (glow <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gc = sc.hab === 'water' ? COL.dna : COL.grow;
    glowAt(ctx, gc, sc.x, sc.y, R * 2.6, 0.5 * glow * (0.85 + 0.15 * Math.sin(t * 3)));
    glowAt(ctx, COL.dna, sc.x, sc.y, R * 1.2, 0.35 * glow);
    ctx.restore();
    const e = (q - 0.8) / 0.2;
    if (e <= 0) return;
    ctx.save();
    ctx.translate(sc.x, sc.y);
    if (sc.variant === 'egg') drawEgg(ctx, sc, e, t, z);
    else drawSprout(ctx, sc, e, t, z);
    ctx.restore();
    // hatch light
    const b = clamp((q - 0.94) / 0.06, 0, 1);
    if (b > 0) hatchLight(ctx, sc, b, z);
  }

  function eggPath(ctx, w, h) {
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.bezierCurveTo(w * 0.75, -h, w, -h * 0.1, w, h * 0.2);
    ctx.bezierCurveTo(w, h * 0.75, w * 0.55, h, 0, h);
    ctx.bezierCurveTo(-w * 0.55, h, -w, h * 0.75, -w, h * 0.2);
    ctx.bezierCurveTo(-w, -h * 0.1, -w * 0.75, -h, 0, -h);
    ctx.closePath();
  }

  function drawEgg(ctx, sc, e, t, z) {
    const R = sc.R, w = R * 0.62, h = R * 0.84;
    const water = sc.hab === 'water';
    const pop = e < 0.3 ? 1 + 0.18 * Math.sin((e / 0.3) * Math.PI) : 1;
    const grow = 1 - Math.pow(1 - clamp(e / 0.3, 0, 1), 3);
    const wob = smooth((e - 0.35) / 0.2) * Math.sin(t * 38) * 0.1 * (1 - smooth((e - 0.9) / 0.1));
    const crack = clamp((e - 0.5) / 0.4, 0, 1);
    const split = clamp((e - 0.7) / 0.3, 0, 1);
    ctx.scale(grow * pop, grow * pop);
    ctx.rotate(wob);
    ctx.globalAlpha = 1 - smooth((split - 0.55) / 0.45);
    const halves = split > 0 ? [-1, 1] : [0];
    for (const side of halves) {
      ctx.save();
      if (side) { // the two shell halves tumble apart
        ctx.translate(side * split * R * 0.5, side * split * R * 0.35 + (side > 0 ? split * split * R * 0.3 : 0));
        ctx.rotate(side * split * 0.5);
        clipHalf(ctx, sc.zig, w, h, side);
      }
      eggBody(ctx, w, h, water);
      ctx.restore();
    }
    if (crack > 0) {
      ctx.globalAlpha = 1 - smooth((split - 0.3) / 0.4);
      drawCrack(ctx, sc.zig, w, h, crack, z);
    }
    ctx.globalAlpha = 1;
  }

  function clipHalf(ctx, zig, w, h, side) {
    ctx.beginPath();
    const big = Math.max(w, h) * 3;
    const ys = zig.map((p) => p.y * h * 1.0);
    if (side < 0) { // upper half
      ctx.moveTo(-big, -big); ctx.lineTo(big, -big); ctx.lineTo(big, ys[ys.length - 1]);
      for (let i = zig.length - 1; i >= 0; i--) ctx.lineTo(zig[i].x * w, ys[i]);
      ctx.lineTo(-big, ys[0]);
    } else { // lower half
      ctx.moveTo(-big, big); ctx.lineTo(big, big); ctx.lineTo(big, ys[ys.length - 1]);
      for (let i = zig.length - 1; i >= 0; i--) ctx.lineTo(zig[i].x * w, ys[i]);
      ctx.lineTo(-big, ys[0]);
    }
    ctx.closePath();
    ctx.clip();
  }

  function eggBody(ctx, w, h, water) {
    const gr = ctx.createRadialGradient(-w * 0.3, -h * 0.35, w * 0.1, 0, 0, h * 1.1);
    if (water) { gr.addColorStop(0, '#F2FDFF'); gr.addColorStop(0.55, '#9FE6F2'); gr.addColorStop(1, '#4BB5CF'); }
    else { gr.addColorStop(0, '#F7FFE0'); gr.addColorStop(0.5, '#C6F25A'); gr.addColorStop(1, '#58B866'); }
    eggPath(ctx, w, h);
    ctx.fillStyle = gr; ctx.fill();
    ctx.fillStyle = water ? 'rgba(255,255,255,0.45)' : 'rgba(40,110,60,0.22)';
    const dots = [[0.3, 0.3, 0.14], [-0.35, 0.5, 0.1], [0.1, -0.35, 0.09], [-0.15, 0.05, 0.07]];
    for (const d of dots) { ctx.beginPath(); ctx.ellipse(d[0] * w, d[1] * h, d[2] * w, d[2] * h * 0.8, 0.5, 0, TAU); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.ellipse(-w * 0.38, -h * 0.4, w * 0.16, h * 0.22, -0.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(7,17,13,0.28)'; ctx.lineWidth = 0.6; eggPath(ctx, w, h); ctx.stroke();
  }

  function drawCrack(ctx, zig, w, h, k, z) {
    const mid = (zig.length - 1) >> 1, reach = k * mid;
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.globalCompositeOperation = pass ? 'lighter' : 'source-over';
      ctx.strokeStyle = pass ? 'rgba(235,255,200,0.95)' : 'rgba(12,50,28,0.75)';
      ctx.lineWidth = pass ? Math.max(0.6 / z, w * 0.05) * (1 + 1.5 * k) : Math.max(1.1 / z, w * 0.07);
      ctx.beginPath();
      for (let side = -1; side <= 1; side += 2) {
        ctx.moveTo(zig[mid].x * w, zig[mid].y * h);
        for (let i = 1; i <= Math.ceil(reach); i++) {
          const a = zig[mid + side * (i - 1)], b = zig[mid + side * i], f = Math.min(1, reach - (i - 1));
          ctx.lineTo(lerp(a.x, b.x, f) * w, lerp(a.y, b.y, f) * h);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSprout(ctx, sc, e, t, z) {
    const R = sc.R;
    const seedK = 1 - Math.pow(1 - clamp(e / 0.25, 0, 1), 3);
    const crack = smooth((e - 0.3) / 0.25);
    const stem = smooth((e - 0.5) / 0.4);
    const leaf = smooth((e - 0.72) / 0.28);
    const sway = Math.sin(t * 2.4) * 0.06 * stem;
    ctx.scale(seedK, seedK);
    // seed pod, opening at the top
    const w = R * 0.46, h = R * 0.32;
    const gr = ctx.createRadialGradient(-w * 0.3, -h * 0.4, w * 0.1, 0, 0, w * 1.2);
    gr.addColorStop(0, '#8E7A4E'); gr.addColorStop(1, '#3E3320');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.ellipse(0, 0, w, h, 0, 0, TAU); ctx.fill();
    if (crack > 0) {
      ctx.strokeStyle = 'rgba(235,255,190,' + (0.9 * crack).toFixed(3) + ')';
      ctx.lineWidth = Math.max(0.8 / z, w * 0.12);
      ctx.beginPath(); ctx.moveTo(-w * 0.5, -h * 0.2); ctx.lineTo(0, -h * 0.5); ctx.lineTo(w * 0.5, -h * 0.2); ctx.stroke();
    }
    if (stem <= 0) return;
    const H = R * 1.9 * stem;
    ctx.rotate(sway);
    ctx.strokeStyle = '#7FD66A'; ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.4 / z, R * 0.09);
    ctx.beginPath(); ctx.moveTo(0, -h * 0.3);
    ctx.quadraticCurveTo(R * 0.25, -H * 0.5, 0, -H);
    ctx.stroke();
    if (leaf > 0) {
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(0, -H);
        ctx.rotate(side * (0.4 + 0.9 * (1 - leaf)) - Math.PI / 2 + (side > 0 ? 0 : Math.PI));
        const lg = ctx.createLinearGradient(0, 0, R * 0.7 * leaf, 0);
        lg.addColorStop(0, '#4FBF6F'); lg.addColorStop(1, '#C6F25A');
        ctx.fillStyle = lg;
        ctx.beginPath(); ctx.ellipse(R * 0.36 * leaf, 0, R * 0.38 * leaf, R * 0.17 * leaf, 0, 0, TAU); ctx.fill();
        ctx.restore();
      }
      ctx.globalCompositeOperation = 'lighter';
      glowAt(ctx, COL.grow, 0, -H, R * 0.9 * leaf, 0.35);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }

  function hatchLight(ctx, sc, b, z) {
    const R = sc.R, env = Math.sin(b * Math.PI) * 0.9 + 0.1 * b;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(sc.x, sc.y);
    glowAt(ctx, COL.white, 0, 0, R * (1.2 + 2.2 * b), 0.5 * env);
    ctx.strokeStyle = rgba('#F4FFD8', 0.7 * (1 - b));
    ctx.lineWidth = Math.max(1 / z, R * 0.12 * (1 - b));
    ctx.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + sc.ang, r0 = R * (0.6 + 0.8 * b), r1 = R * (1.2 + 3 * b);
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- drawEvolve
  function evoSparks() {
    if (S.evoSparks) return S.evoSparks;
    const rng = mulberry(0xE701);
    const out = [];
    for (let i = 0; i < 72; i++) out.push({ a: rng() * TAU, r: 0.35 + rng() * 0.65, s: 0.7 + rng() * 1.1, ph: rng(), c: i % 3 });
    S.evoSparks = out;
    return out;
  }

  function drawEvolve(ctx, p) {
    p = clamp(p || 0, 0, 1);
    const g = A.G, W = viewW(), H = viewH();
    let cx = W / 2, cy = H / 2;
    if (g && g.player && g.cam) { proj(g.player.x, g.player.y, g.cam); cx = px; cy = py; }
    const maxR = Math.hypot(W, H) * 0.62;
    const unit = Math.min(W, H) / 800;
    ctx.save();
    setScreen(ctx);
    // darken the world so the light reads
    const dark = 0.55 * smooth(p / 0.25) * (1 - smooth((p - 0.7) / 0.25));
    ctx.fillStyle = 'rgba(3,8,6,' + dark.toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    evoRays(ctx, cx, cy, p, maxR);
    evoCore(ctx, cx, cy, p, unit);
    evoRings(ctx, cx, cy, p, maxR);
    evoHelix(ctx, cx, cy, p, unit, H);
    evoSwirl(ctx, cx, cy, p, unit);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const white = smooth((p - 0.78) / 0.22);
    if (white > 0) { ctx.fillStyle = 'rgba(255,255,255,' + white.toFixed(4) + ')'; ctx.fillRect(-2, -2, W + 4, H + 4); }
    ctx.restore();
  }

  function evoRays(ctx, cx, cy, p, maxR) {
    const k = smooth((p - 0.15) / 0.4) * (1 - smooth((p - 0.8) / 0.15));
    if (k <= 0.01) return;
    const n = 18, rot = p * 1.3, L = maxR * 1.4;
    const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, L);
    gr.addColorStop(0, 'rgba(255,255,225,0.9)');
    gr.addColorStop(0.5, 'rgba(198,242,90,0.28)');
    gr.addColorStop(1, 'rgba(198,242,90,0)');
    ctx.fillStyle = gr;
    for (let pass = 0; pass < 2; pass++) { // wide soft pass, then crisp core of each ray
      ctx.globalAlpha = k * (pass ? 0.65 : 0.3);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = rot + (i / n) * TAU, hw = (0.035 + 0.03 * Math.sin(i * 3.1 + 1)) * (pass ? 1 : 2.2);
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a - hw) * L, cy + Math.sin(a - hw) * L);
        ctx.lineTo(cx + Math.cos(a + hw) * L, cy + Math.sin(a + hw) * L);
        ctx.closePath();
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function evoCore(ctx, cx, cy, p, unit) {
    const r = lerp(40, 520, smooth(p / 0.9)) * unit;
    glowAt(ctx, COL.grow, cx, cy, r, 0.55 + 0.4 * smooth(p / 0.6));
    glowAt(ctx, COL.white, cx, cy, r * 0.45, 0.5 + 0.5 * smooth((p - 0.2) / 0.5));
    ctx.globalAlpha = 1;
  }

  function evoRings(ctx, cx, cy, p, maxR) {
    const births = [0.18, 0.36, 0.54];
    for (let i = 0; i < births.length; i++) {
      const k = (p - births[i]) / 0.45;
      if (k <= 0 || k >= 1) continue;
      const r = Math.pow(k, 0.6) * maxR;
      const a = Math.pow(1 - k, 1.5);
      const col = i % 2 ? COL.dna : COL.grow;
      ctx.strokeStyle = rgba(col, a * 0.25);
      ctx.lineWidth = 34 * (1 - k) + 6;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
      ctx.strokeStyle = rgba(COL.white, a * 0.9);
      ctx.lineWidth = 3 + 7 * (1 - k);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
    }
  }

  // Double helix of glowing beads rising through the player's position.
  function evoHelix(ctx, cx, cy, p, unit, H) {
    const fade = 1 - smooth((p - 0.68) / 0.18);
    const reveal = smooth(p / 0.25);
    if (fade <= 0 || reveal <= 0) return;
    const N = 30, turns = 2.6;
    const span = H * 0.95 * reveal;
    const Rh = lerp(95, 175, smooth(p / 0.5)) * unit;
    const spin = p * 14;
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1);
      const y = cy + (0.5 - s) * span;
      const taper = Math.pow(Math.sin(Math.PI * s), 0.5);
      const phi = s * turns * TAU + spin;
      const x0 = Math.sin(phi) * Rh * taper, d0 = Math.cos(phi);
      const x1 = -x0, d1 = -d0;
      if (i % 2 === 0) {
        ctx.strokeStyle = rgba(COL.white, 0.4 * fade);
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(cx + x0, y); ctx.lineTo(cx + x1, y); ctx.stroke();
      }
      bead(ctx, cx + x0, y, d0, COL.dna, fade, unit);
      bead(ctx, cx + x1, y, d1, COL.grow, fade, unit);
    }
  }

  function bead(ctx, x, y, depth, color, fade, unit) {
    const s = (8 + 5 * depth) * unit;
    glowAt(ctx, color, x, y, s * 2.6, (0.55 + 0.4 * depth) * fade);
    glowAt(ctx, COL.white, x, y, s * 0.9, (0.6 + 0.4 * depth) * fade);
  }

  // Sparks spiral into the player, then fly outward with the burst.
  function evoSwirl(ctx, cx, cy, p, unit) {
    const list = evoSparks();
    const fade = 1 - smooth((p - 0.75) / 0.15);
    if (fade <= 0) return;
    for (const s of list) {
      let d;
      if (p < 0.5) d = s.r * 360 * unit * (1 - 0.88 * smooth(p / 0.5));
      else d = s.r * 360 * unit * 0.12 + (p - 0.5) * 1300 * unit * s.s;
      const a = s.a + p * 5 * s.s * (p < 0.5 ? 1 : 0.3);
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      const tw = 0.6 + 0.4 * Math.sin((p * 9 + s.ph) * TAU);
      const col = s.c === 0 ? COL.dna : s.c === 1 ? COL.grow : COL.white;
      glowAt(ctx, col, x, y, (5 + 4 * s.s) * unit * 1.6, 0.85 * tw * fade);
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- export
  A.FX = {
    init, update, drawWorld, drawScreen, drawOverlay, drawDecompose, drawEvolve,
    burst, text, shake, flash,
    stats() { return { particles: S.active, texts: S.texts.length, dives: S.dives.length, casts: S.casts.map((c) => c.kind + ":" + c.t.toFixed(2) + "/" + c.dur) }; },
  };
})();
