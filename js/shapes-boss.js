/* Apex boss art: The Old One, an Ice Age cave bear (LOOKS.cavebear, plan 'cavebear').
   Top-down, entity-local, facing +x, like every other shape. A massive hunched body with a shoulder hump, a heavy
   wedge skull and a long fanged snout, thick clawed forelimbs and a matted, jagged fur outline, frost on the back.
   Poses follow G.boss.state (boss.js mirrors it every update) and the entity:
     arrive/stalk/idle  rolling walk                    chargeWind  crouch, rakes the snow    charge  stretched lunge
     slamWind           rears onto its hind legs        roarWind/phaseRoar  head up, jaws open
     swipeWind/recover  cocked paw, then follow-through  stunned  stagger           slamRecover  planted, flattened
     phase 3            raised hackles and a red glow    dead (carcass)  slumped, scars dimmed
   Glowing cyan claw scars brighten and crack as hp falls. Fur noise is deterministic per entity (never A.rand()). */
(function () {
  'use strict';
  const A = window.Apex = window.Apex || {};
  A.Shapes = A.Shapes || {};

  const PI = Math.PI, TAU = PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sat = (v) => clamp(v, 0, 1);
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => t * t * (3 - 2 * t);
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const bump = (u, c, w) => { const d = (u - c) / w; return Math.exp(-d * d); };

  // ---------------------------------------------------------------- deterministic noise
  function hash(n) {
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    return (n ^ (n >>> 16)) >>> 0;
  }
  let SEED = 0;
  const nz = (k) => hash((SEED + Math.imul(k + 1, 0x9e3779b1)) >>> 0) / 4294967296;
  function seedOf(e) {
    const rs = e.rs;
    if (rs.bseed === undefined) {
      const s = String(e.id === undefined ? 0 : e.id);
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      rs.bseed = h >>> 0;
    }
    return rs.bseed;
  }

  // ---------------------------------------------------------------- color
  const mixCache = new Map();
  function rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) {
    const q = Math.round(sat(t) * 24), key = a + b + q;
    let c = mixCache.get(key);
    if (c) return c;
    const x = rgb(a), y = rgb(b);
    c = '#';
    for (let i = 0; i < 3; i++) c += Math.round(x[i] + (y[i] - x[i]) * q / 24).toString(16).padStart(2, '0');
    if (mixCache.size > 2000) mixCache.clear();
    mixCache.set(key, c);
    return c;
  }
  const rgbaCache = new Map();
  function rgba(h, a) {
    const q = Math.round(sat(a) * 100), key = h + q;
    let s = rgbaCache.get(key);
    if (!s) {
      const c = rgb(h);
      s = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (q / 100) + ')';
      if (rgbaCache.size > 3000) rgbaCache.clear();
      rgbaCache.set(key, s);
    }
    return s;
  }

  // Glow colors reuse the UI tokens: --spore #7FE8D4 (scars), --danger #FF4F64 family (rage).
  const SCAR = '#7FE8D4', SCAR_CORE = '#E6FFFA', EMBER = '#FF6A2A', EMBER_CORE = '#FFD9A6', RAGE = '#FF3B2F';
  const PAL = { deep: '#1d1510', mid: '#36291f', top: '#554030', tip: '#8f7860', frost: '#e6eff7', muzzle: '#4f4036', nose: '#0a0807',
    claw: '#ece4d2', clawLo: '#5d5346', fang: '#f4eddd', mouth: '#2b070c', gum: '#7c1c27', tongue: '#94303b' };
  const PAL_KEYS = ['deep', 'mid', 'top', 'muzzle', 'tip'];
  // Variants of the plan, picked by look.variant. The grizzly (LOOKS.bear) shares the body but has no scars or ember
  // eyes; its 'frost' colour becomes the silver guard-hair tips that give the grizzly its name.
  const VARIANTS = {
    boss: { scars: true, ember: true, closedFangs: true, crust: 1, hack: 1, scale: 1.08, rim: 1, flow: 1 },
    grizzly: { scars: false, ember: false, closedFangs: false, crust: 0.4, hack: 0.5, scale: 1, rim: 0.45, flow: 0.45 },
  };
  let V = VARIANTS.boss;
  function palOf(look) {
    if (!look || !look.bpal) return PAL;
    return look._bpal || (look._bpal = Object.assign({}, PAL, look.bpal));
  }
  // spine (units of r), rear -> front, and its half-width profile: narrow waist, massive shoulder hump
  const SPX = [-1.28, -1.12, -0.9, -0.56, -0.22, 0.08, 0.3, 0.48, 0.62];
  const SPW = [0.4, 0.66, 0.72, 0.62, 0.7, 0.98, 1.05, 0.8, 0.5];
  const FUR = 0.15;

  // ---------------------------------------------------------------- pose (smoothed, per entity)
  const KEYS = ['crouch', 'paw', 'lunge', 'rear', 'roar', 'swipe', 'follow', 'stun', 'slam', 'rage', 'move', 'yaw', 'turn'];
  const GOAL = {};
  function pose(e, t) {
    const rs = e.rs, G = A.G, B = e.boss && G && G.boss ? G.boss : null;
    const dead = e.alive === false || (!!e.boss && e.maxHp > 0 && e.hp <= 0);
    const st = dead ? 'dead' : B ? (B.state || 'arrive') : 'idle';
    if (rs.bst !== st) { rs.bprev = rs.bst; rs.bst = st; rs.bst0 = t; }
    const sT = Math.max(0, t - rs.bst0);
    const first = rs.blt === undefined;
    const dt = first ? 1 : clamp(t - rs.blt, 0, 0.1);
    rs.blt = t;
    const p = rs.bp || (rs.bp = { dead: 0, st: '', sT: 0, ss: 1, hurt: 0, flash: 0, hack: 0 });
    for (let i = 0; i < KEYS.length; i++) GOAL[KEYS[i]] = 0;
    GOAL.crouch = st === 'chargeWind' ? 1 : st === 'slamRecover' ? 0.55 : st === 'recover' ? 0.2 : 0;
    GOAL.paw = st === 'chargeWind' ? 1 : 0;
    GOAL.lunge = st === 'charge' ? 1 : 0;
    GOAL.rear = st === 'slamWind' ? ease(sat(sT / 0.45)) : 0;
    GOAL.roar = st === 'roarWind' || st === 'phaseRoar' ? 1 : 0;
    GOAL.swipe = st === 'swipeWind' ? 1 : 0;
    GOAL.follow = st === 'recover' && rs.bprev === 'swipeWind' && sT < 0.45 ? 1 : 0;
    GOAL.stun = st === 'stunned' ? 1 : 0;
    GOAL.slam = st === 'slamRecover' ? 1 : 0;
    GOAL.rage = B && B.phase >= 3 ? 1 : 0;
    if (!B && !dead) {   // not the boss: hunter windup/lunge, the player's bite and Brace drive the same poses
      const ab = e.ability, brace = !!ab && ab.id === 'roll' && ab.activeT > 0;
      GOAL.crouch = e.state === 'windup' ? 1 : brace ? 0.6 : 0;
      GOAL.lunge = e.state === 'lunge' ? 1 : 0;
      GOAL.roar = e.biteT > 0 || brace ? 1 : 0;
    }
    GOAL.move = clamp(Math.hypot(e.vx || 0, e.vy || 0) / ((e.r || 50) * 1.3), 0, 1);
    // the head tracks the player, lolls when stunned
    let yaw = Math.sin(t * 0.6 + (SEED % 100)) * 0.08;
    const pl = G && G.player;
    if (B && pl && typeof pl.x === 'number') yaw = clamp(wrap(Math.atan2(pl.y - e.y, pl.x - e.x) - (e.angle || 0)), -0.5, 0.5) * 0.7;
    if (st === 'stunned') yaw = Math.sin(t * 2.3) * 0.55;
    GOAL.yaw = yaw;
    const ang = e.angle || 0;
    if (!first && dt > 0) GOAL.turn = clamp(wrap(ang - (rs.bla === undefined ? ang : rs.bla)) / dt * 0.3, -1, 1);
    rs.bla = ang;
    if (st === 'swipeWind' && rs.bswipe !== rs.bst0) { rs.bswipe = rs.bst0; p.ss = yaw >= 0 ? 1 : -1; }   // the paw on the player's side
    const k = first ? 1 : 1 - Math.exp(-dt * 10), kr = first ? 1 : 1 - Math.exp(-dt * 16);
    for (let i = 0; i < KEYS.length; i++) {
      const n = KEYS[i], kk = n === 'rear' || n === 'lunge' || n === 'slam' ? kr : n === 'rage' ? k * 0.3 : k;
      p[n] = (p[n] || 0) + (GOAL[n] - (p[n] || 0)) * kk;
    }
    p.dead = dead ? 1 : 0; p.st = st; p.sT = sT;
    if (dead) { for (let i = 0; i < KEYS.length; i++) p[KEYS[i]] = 0; p.yaw = 0.6; }
    p.hurt = e.maxHp > 0 ? sat(1 - e.hp / e.maxHp) : 0;
    p.flash = e.hurtT > 0 ? sat(e.hurtT / 0.3) : 0;
    p.hack = Math.max(p.rage, p.roar * 0.7, p.crouch * 0.4) * V.hack;
    return p;
  }

  // ---------------------------------------------------------------- spine and mapping
  const N = 9;
  const SX = new Float64Array(N), SY = new Float64Array(N), SW = new Float64Array(N);
  function buildSpine(r, p, t, cyc) {
    const hip = -0.9, rr = p.rear + 0.2 * p.roar;
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1), hump = bump(u, 0.75, 0.16);
      let x = SPX[i], w = SPW[i], y = 0;
      x = x * (1 + 0.16 * p.lunge) + 0.12 * p.lunge;                                   // lunge: stretched long
      w *= 1 - 0.1 * p.lunge * (u > 0.15 && u < 0.85 ? 1 : 0.4);
      x = x * (1 - 0.1 * p.crouch) - 0.05 * p.crouch;                                  // crouch: bunched, shoulders spread
      w *= 1 + 0.06 * p.crouch + 0.08 * p.crouch * hump + 0.06 * p.slam;
      if (x > hip) { const f = sat((x - hip) / 1.5); x = hip + (x - hip) * (1 - 0.45 * rr); w *= 1 + 0.36 * rr * f; }   // rearing: the front rises toward the camera
      y += Math.sin(cyc - u * 2.2) * 0.035 * p.move * u + Math.sin(cyc) * 0.06 * p.move * hump;   // rolling shoulders
      y -= p.turn * (1 - u) * (1 - u) * 0.32;
      y += Math.sin(t * 2.6 + u * 2.4) * 0.14 * p.stun;                                 // stagger
      y += p.dead * Math.sin(u * 2.6) * 0.14;
      w *= 1 + Math.sin(t * 1.9 + SEED % 7) * 0.014 * (u > 0.3 ? 1 : 0.4) + 0.06 * p.dead;
      SX[i] = x * r; SY[i] = y * r; SW[i] = w * r;
    }
  }
  const Q = { x: 0, y: 0, w: 0, tx: 1, ty: 0 };
  function at(u) {
    const f = sat(u) * (N - 1), i = Math.min(N - 2, Math.floor(f)), k = f - i;
    Q.x = lerp(SX[i], SX[i + 1], k); Q.y = lerp(SY[i], SY[i + 1], k); Q.w = lerp(SW[i], SW[i + 1], k);
    const dx = SX[i + 1] - SX[i], dy = SY[i + 1] - SY[i], d = Math.hypot(dx, dy) || 1;
    Q.tx = dx / d; Q.ty = dy / d;
    return Q;
  }
  // body point at spine position u and side offset v (-1..1 of half width); n = (-ty, tx)
  const MP = { x: 0, y: 0, tx: 1, ty: 0, nx: 0, ny: 1 };
  function map(u, v) {
    const q = at(u);
    MP.tx = q.tx; MP.ty = q.ty; MP.nx = -q.ty; MP.ny = q.tx;
    MP.x = q.x + MP.nx * v * q.w; MP.y = q.y + MP.ny * v * q.w;
    return MP;
  }

  // ---------------------------------------------------------------- jagged fur contour
  const CB = [];
  for (let i = 0; i < 80; i++) CB.push({ x: 0, y: 0, nx: 0, ny: 0, fx: 0, fy: 0, u: 0 });
  let CN = 0;
  function put(x, y, nx, ny, fx, fy, u) { const c = CB[CN++]; c.x = x; c.y = y; c.nx = nx; c.ny = ny; c.fx = fx; c.fy = fy; c.u = u; }
  // inset: fraction of the half width (number or fn(u)); ox, oy: shift toward the light for upper layers
  function contour(inset, ox, oy) {
    CN = 0;
    const SIDE = 22, CAP = 6;
    const ins = typeof inset === 'function' ? inset : () => inset;
    for (let i = 0; i <= SIDE; i++) {             // left side (+n), rear -> front
      const u = i / SIDE, q = at(u), k = ins(u), nx = -q.ty, ny = q.tx;
      put(q.x + nx * q.w * k + ox, q.y + ny * q.w * k + oy, nx, ny, -q.tx, -q.ty, u);
    }
    { const q = at(1), k = ins(1), a0 = Math.atan2(q.tx, -q.ty);   // chest, under the head
      for (let j = 1; j < CAP; j++) {
        const a = a0 - PI * j / CAP, nx = Math.cos(a), ny = Math.sin(a);
        put(q.x + nx * q.w * k * 0.9 + ox, q.y + ny * q.w * k * 0.9 + oy, nx, ny, -q.tx, -q.ty, 1);
      } }
    for (let i = SIDE; i >= 0; i--) {             // right side (-n), front -> rear
      const u = i / SIDE, q = at(u), k = ins(u), nx = q.ty, ny = -q.tx;
      put(q.x + nx * q.w * k + ox, q.y + ny * q.w * k + oy, nx, ny, -q.tx, -q.ty, u);
    }
    { const q = at(0), k = ins(0), a0 = Math.atan2(-q.tx, q.ty);   // rump
      for (let j = 1; j < CAP; j++) {
        const a = a0 - PI * j / CAP, nx = Math.cos(a), ny = Math.sin(a);
        put(q.x + nx * q.w * k * 1.05 + ox, q.y + ny * q.w * k * 1.05 + oy, nx, ny, nx * 0.5 - q.tx * 0.5, ny * 0.5 - q.ty * 0.5, 0);
      } }
  }
  // tuft length by region: shaggy shoulder mane, shorter on the rump; hackles rise over the shoulders
  const region = (u) => 0.75 + 0.65 * bump(u, 0.78, 0.18) + 0.2 * bump(u, 0.05, 0.08);
  const hackle = (u) => bump(u, 0.72, 0.22);
  function furPath(ctx, r, len, hack, salt) {
    ctx.beginPath();
    ctx.moveTo(CB[0].x, CB[0].y);
    for (let i = 0; i < CN; i++) {
      const a = CB[i], b = CB[(i + 1) % CN];
      const u = (a.u + b.u) / 2, nx = (a.nx + b.nx) / 2, ny = (a.ny + b.ny) / 2, fx = (a.fx + b.fx) / 2, fy = (a.fy + b.fy) / 2;
      const hk = hack * hackle(u);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, seg = Math.hypot(b.x - a.x, b.y - a.y);
      // tufts never outgrow their base (no stray needles where the outline bunches up)
      const L = Math.min(len * r * region(u) * (0.45 + 1.0 * nz(i * 7 + salt)) * (1 + 0.8 * hk), seg * 1.5 + 0.03 * r);
      const out = 0.7 + 0.45 * hk, sw = 0.75 * (1 - 0.5 * hk);
      const tx = mx + nx * L * out + fx * L * sw, ty = my + ny * L * out + fy * L * sw;
      // hooked clump: bulge out to the tip, then tuck back in
      ctx.quadraticCurveTo(a.x + nx * L * 0.55, a.y + ny * L * 0.55, tx, ty);
      ctx.quadraticCurveTo(lerp(tx, b.x, 0.6) - nx * L * 0.15, lerp(ty, b.y, 0.6) - ny * L * 0.15, b.x, b.y);
    }
    ctx.closePath();
  }

  // ---------------------------------------------------------------- limbs, paws, claws
  function claws(ctx, r, x, y, a, s, spread, len, P, curlSide) {
    ctx.lineCap = 'round';
    for (let k = 0; k < 5; k++) {
      const ca = a + (k - 2) * 0.26 * spread, c = Math.cos(ca), sn = Math.sin(ca);
      const bx = x + c * 0.15 * r * s, by = y + sn * 0.15 * r * s;
      const L = len * r * s * (k === 0 || k === 4 ? 0.75 : 1), w = 0.045 * r * s;
      const curl = curlSide * 0.3 * L;                     // claws hook toward the midline
      const tx = bx + c * L - sn * curl * 0.3, ty = by + sn * L + c * curl * 0.3;
      ctx.fillStyle = P.clawLo;
      ctx.beginPath();
      ctx.moveTo(bx - sn * w, by + c * w);
      ctx.quadraticCurveTo(bx + c * L * 0.6 - sn * (w * 0.5 - curl * 0.3), by + sn * L * 0.6 + c * (w * 0.5 - curl * 0.3), tx, ty);
      ctx.quadraticCurveTo(bx + c * L * 0.5 + sn * w * 0.5, by + sn * L * 0.5 - c * w * 0.5, bx + sn * w, by - c * w);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = P.claw; ctx.lineWidth = w * 0.75;
      ctx.beginPath(); ctx.moveTo(bx + c * L * 0.3, by + sn * L * 0.3);
      ctx.quadraticCurveTo(bx + c * L * 0.68 - sn * curl * 0.15, by + sn * L * 0.68 + c * curl * 0.15, tx, ty);
      ctx.stroke();
    }
  }
  // a thick, shaggy limb from the joint (x0,y0) to the wrist (x1,y1)
  function limb(ctx, r, x0, y0, x1, y1, w0, w1, P, salt) {
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d, nx = -uy, ny = ux;
    ctx.fillStyle = P.deep;
    ctx.beginPath();
    const n = 4;
    ctx.moveTo(x0 + nx * w0, y0 + ny * w0);
    for (let sg = 1; sg >= -1; sg -= 2) {
      for (let ii = 1; ii <= n; ii++) {
        const i = sg > 0 ? ii : n + 1 - ii, k = i / n, w = lerp(w0, w1, k);
        const L = 0.1 * r * (0.3 + nz(salt + i + (sg > 0 ? 0 : 20))) * (1 - 0.5 * k), back = 0.06 + 0.1 * nz(salt + 40 + i);
        const px = x0 + dx * k + sg * nx * w, py = y0 + dy * k + sg * ny * w;
        const qx = x0 + dx * (k - back) + sg * nx * (w + L), qy = y0 + dy * (k - back) + sg * ny * (w + L);
        if (sg > 0) { ctx.lineTo(qx, qy); ctx.lineTo(px, py); } else { ctx.lineTo(px, py); ctx.lineTo(qx, qy); }
      }
      if (sg > 0) ctx.quadraticCurveTo(x1 + ux * w1 * 1.1, y1 + uy * w1 * 1.1, x1 - nx * w1, y1 - ny * w1);
    }
    ctx.closePath(); ctx.fill();
  }
  function paw(ctx, r, x, y, a, s, P, hind) {
    const lx = (hind ? 0.22 : 0.21) * r * s, ly = (hind ? 0.11 : 0.18) * r * s;   // hind feet: long, flat soles
    const c = Math.cos(a), sn = Math.sin(a);
    ctx.fillStyle = P.deep;
    ctx.beginPath(); ctx.ellipse(x, y, lx, ly, a, 0, TAU); ctx.fill();
    // a row of heavy toes along the front of the paw
    for (let k = 0; k < 5; k++) {
      const th = (k - 2) * 0.5, tr = (k === 0 || k === 4 ? 0.05 : 0.062) * r * s;
      const ex = lx * 0.85 * Math.cos(th), ey = ly * 0.95 * Math.sin(th);
      ctx.beginPath(); ctx.arc(x + c * ex - sn * ey, y + sn * ex + c * ey, tr, 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = rgba(P.tip, 0.4); ctx.lineWidth = 0.022 * r * s; ctx.lineCap = 'round';   // knuckle fur catching the light
    ctx.beginPath(); ctx.ellipse(x - c * 0.04 * r * s, y - sn * 0.04 * r * s, lx * 0.55, ly * 0.55, a, -1.9, -0.4); ctx.stroke();
  }

  // Paw placement per pose, in units of r. side s = -1 (-y) or +1 (+y).
  const PW = { x: 0, y: 0, a: 0, s: 1, sp: 1, up: 0 };
  const rakeSide = () => ((SEED & 1) ? 1 : -1);
  function frontPaw(p, t, s, cyc) {
    const ph = cyc + (s > 0 ? PI * 0.5 : PI * 1.5), lift = Math.max(0, Math.cos(ph)) * p.move;
    let x = 0.66 + Math.sin(ph) * 0.24 * p.move, y = s * 0.98, a = s * 0.12, sc = 1 + 0.1 * lift, sp = 1, up = 0;
    if (p.crouch > 0.01) {   // planted wide; one paw rakes the snow back
      let cx = 0.62, cy = s * 1.16, ca = s * 0.3;
      if (s === rakeSide() && p.paw > 0.01) {
        const q = (t * 2.4) % 1;
        cx = q < 0.6 ? lerp(1.02, 0.4, ease(q / 0.6)) : lerp(0.4, 1.02, ease((q - 0.6) / 0.4));
        sc = lerp(sc, q < 0.6 ? 1 : 1.12, p.paw);
      }
      x = lerp(x, cx, p.crouch); y = lerp(y, cy, p.crouch); a = lerp(a, ca, p.crouch); sp = lerp(sp, 1.3, p.crouch);
    }
    if (p.lunge > 0.01) { x = lerp(x, 1.22, p.lunge); y = lerp(y, s * 0.6, p.lunge); a = lerp(a, s * 0.05, p.lunge); sp = lerp(sp, 1.2, p.lunge); }
    if (p.roar > 0.01) { x = lerp(x, 0.55, p.roar); y = lerp(y, s * 1.16, p.roar); a = lerp(a, s * 0.4, p.roar); sp = lerp(sp, 1.35, p.roar); }
    if (p.slam > 0.01) { x = lerp(x, 0.9, p.slam); y = lerp(y, s * 1.12, p.slam); a = lerp(a, s * 0.3, p.slam); sp = lerp(sp, 1.5, p.slam); }
    if (p.stun > 0.01) {
      x = lerp(x, 0.5 + 0.14 * Math.sin(t * 3.1 + s), p.stun); y = lerp(y, s * (1.28 + 0.1 * Math.sin(t * 2.6 + s * 2)), p.stun);
      a = lerp(a, s * 0.7, p.stun); sp = lerp(sp, 0.7, p.stun);
    }
    if (p.rear > 0.01) { x = lerp(x, 0.55, p.rear); y = lerp(y, s * 1.2, p.rear); a = lerp(a, s * 0.65, p.rear); sc = lerp(sc, 1.55, p.rear); sp = lerp(sp, 1.9, p.rear); up = p.rear; }
    if (p.swipe > 0.01 && s === p.ss) { x = lerp(x, 0.12, p.swipe); y = lerp(y, s * 1.42, p.swipe); a = lerp(a, s * 1.2, p.swipe); sc = lerp(sc, 1.35, p.swipe); sp = lerp(sp, 1.7, p.swipe); up = Math.max(up, p.swipe); }
    if (p.follow > 0.01 && s === p.ss) { x = lerp(x, 1.18, p.follow); y = lerp(y, -s * 0.2, p.follow); a = lerp(a, -s * 0.7, p.follow); sc = lerp(sc, 1.2, p.follow); sp = lerp(sp, 1.5, p.follow); up = Math.max(up, p.follow); }
    if (p.dead > 0) { x = 0.4; y = s * 1.24; a = s * 1.3; sp = 0.6; sc = 1; up = 0; }
    PW.x = x; PW.y = y; PW.a = a; PW.s = sc; PW.sp = sp; PW.up = up;
    return PW;
  }
  function hindPaw(p, t, s, cyc) {
    const ph = cyc + (s > 0 ? 0 : PI), lift = Math.max(0, Math.cos(ph)) * p.move;
    let x = -1.1 + Math.sin(ph) * 0.2 * p.move, y = s * 0.66, a = -s * 0.05, sc = 0.9 + 0.08 * lift;
    if (p.crouch > 0.01) { x = lerp(x, -0.86, p.crouch); y = lerp(y, s * 0.82, p.crouch); }
    if (p.lunge > 0.01) { x = lerp(x, -1.66, p.lunge); y = lerp(y, s * 0.44, p.lunge); a = lerp(a, 0, p.lunge); }
    if (p.rear > 0.01) { x = lerp(x, -0.8, p.rear); y = lerp(y, s * 0.9, p.rear); a = lerp(a, s * 0.45, p.rear); }
    if (p.stun > 0.01) { y = lerp(y, s * (1.0 + 0.06 * Math.sin(t * 2.6 + s)), p.stun); a = lerp(a, s * 0.5, p.stun); }
    if (p.dead > 0) { x = -1.14; y = s * 0.98; a = s * 0.9; }
    PW.x = x; PW.y = y; PW.a = a; PW.s = sc; PW.sp = 0.9; PW.up = 0;
    return PW;
  }
  function drawLeg(ctx, r, p, P, front, s, t, cyc, pass) {
    const w = front ? frontPaw(p, t, s, cyc) : hindPaw(p, t, s, cyc);
    if ((pass === 'above') !== (w.up > 0.35)) return;
    const j = map(front ? 0.76 : 0.14, s * 0.5);
    const x = w.x * r, y = w.y * r, sc = w.s, a = w.a, px = x, py = y;
    const wx = px - Math.cos(a) * 0.1 * r * sc, wy = py - Math.sin(a) * 0.1 * r * sc;
    limb(ctx, r, j.x, j.y, wx, wy, (front ? 0.3 : 0.27) * r * (1 + 0.15 * w.up), (front ? 0.17 : 0.14) * r * sc, P, front ? (s > 0 ? 300 : 340) : (s > 0 ? 380 : 420));
    paw(ctx, r, px, py, a, sc, P, !front);
    claws(ctx, r, px, py, a, sc, w.sp, front ? 0.26 : 0.15, P, -s);
  }

  // ---------------------------------------------------------------- scars
  // Three parallel claw rakes across the shoulder: brighter and cracking as hp falls; a fourth opens below 34%.
  function scarStroke(ctx, pts, lw, col, a) {
    ctx.strokeStyle = rgba(col, a); ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    ctx.quadraticCurveTo(pts[2], pts[3], pts[4], pts[5]);
    ctx.stroke();
  }
  const SP6 = [0, 0, 0, 0, 0, 0];
  function scarPts(j) {
    let m;
    if (j < 3) {   // shoulder rakes, from the spine down the near flank
      const du = 0.075 * j;
      m = map(0.88 - du, -0.06); SP6[0] = m.x; SP6[1] = m.y;
      m = map(0.77 - du, -0.5); SP6[2] = m.x; SP6[3] = m.y;
      m = map(0.62 - du, -0.88); SP6[4] = m.x; SP6[5] = m.y;
    } else {       // fresh rakes across the far haunch, opened in phase 3
      const du = 0.08 * (j - 3);
      m = map(0.4 - du, 0.2); SP6[0] = m.x; SP6[1] = m.y;
      m = map(0.38 - du, 0.6); SP6[2] = m.x; SP6[3] = m.y;
      m = map(0.26 - du, 0.86); SP6[4] = m.x; SP6[5] = m.y;
    }
    return SP6;
  }
  function scars(ctx, r, p, t, low) {
    const hurt = p.hurt, beat = hurt > 0.45 ? Math.pow(Math.max(0, Math.sin(t * (4 + 3 * hurt))), 6) : 0;
    const g = (0.5 + 0.5 * hurt + 0.25 * beat) * (p.dead ? 0.25 : 1) * (p.stun > 0.1 ? 0.75 + 0.25 * Math.sin(t * 23) : 1);
    const n = 3 + (hurt > 0.66 ? 2 : 0), wk = 1 + 0.6 * hurt;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let j = 0; j < n; j++) {
      const pts = scarPts(j), fresh = j >= 3 ? 0.6 : 1;
      ctx.strokeStyle = rgba('#000000', 0.5); ctx.lineWidth = 0.1 * r * wk * fresh;   // the scar furrow
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); ctx.quadraticCurveTo(pts[2], pts[3], pts[4], pts[5]); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      if (!low) scarStroke(ctx, pts, 0.18 * r * wk * fresh, SCAR, 0.16 * g);
      scarStroke(ctx, pts, 0.075 * r * wk * fresh, SCAR, 0.6 * g);
      scarStroke(ctx, pts, 0.028 * r * wk * fresh, SCAR_CORE, 0.95 * g);
    }
    if (!low) {   // cracks branch off the rakes as it weakens
      const cracks = Math.floor(hurt * 10 + 0.0001);
      for (let c = 0; c < cracks; c++) {
        const pts = scarPts(c % 3), s = 0.2 + 0.6 * nz(700 + c);
        const x = lerp(lerp(pts[0], pts[2], s), lerp(pts[2], pts[4], s), s), y = lerp(lerp(pts[1], pts[3], s), lerp(pts[3], pts[5], s), s);
        const a = Math.atan2(pts[5] - pts[1], pts[4] - pts[0]) + (nz(720 + c) < 0.5 ? 1 : -1) * (1.1 + 0.5 * nz(740 + c));
        let cx = x, cy = y;
        for (const [lw, col, al] of [[0.05 * r, SCAR, 0.3], [0.018 * r, SCAR_CORE, 0.9]]) {
          ctx.strokeStyle = rgba(col, al * g); ctx.lineWidth = lw;
          ctx.beginPath(); ctx.moveTo(x, y); cx = x; cy = y;
          let aa = a;
          for (let k = 0; k < 3; k++) {
            const L = (0.05 + 0.06 * nz(760 + c * 3 + k)) * r;
            aa += (nz(800 + c * 3 + k) - 0.5) * 1.2;
            cx += Math.cos(aa) * L; cy += Math.sin(aa) * L; ctx.lineTo(cx, cy);
          }
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- body
  function body(ctx, r, p, P, lx, ly, low) {
    const hk = p.hack;
    // 1: dark silhouette with a matted outline
    contour(1, 0, 0);
    furPath(ctx, r, FUR, hk, 11);
    ctx.fillStyle = P.deep; ctx.fill();
    if (p.rage > 0.02) {   // ember rim on the fur
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(RAGE, 0.5 * p.rage); ctx.lineWidth = 0.05 * r; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.restore();
    }
    if (!low) {   // frost on the fur tips facing the light: separates it from dark ground
      const R = 1.6 * r, gr = ctx.createLinearGradient(lx * R, ly * R, -lx * R, -ly * R);
      gr.addColorStop(0, rgba(P.frost, 0.95 * V.rim)); gr.addColorStop(0.45, rgba(P.frost, 0.16 * V.rim)); gr.addColorStop(1, rgba(P.frost, 0.1 * V.rim));
      ctx.strokeStyle = gr; ctx.lineWidth = 0.05 * r; ctx.lineJoin = 'round'; ctx.stroke();   // frosted guard hairs, all round
    }
    // 2: the lit upper back
    contour((u) => 0.72 + 0.08 * bump(u, 0.75, 0.15), lx * 0.08 * r, ly * 0.08 * r);
    furPath(ctx, r, FUR * 0.8, hk * 0.6, 23);
    ctx.fillStyle = P.mid; ctx.fill();
    if (!low) {   // volume: the far flank falls into shadow
      contour(1, 0, 0);
      furPath(ctx, r, FUR, hk, 11);
      const R = 1.1 * r, gr = ctx.createLinearGradient(lx * R, ly * R, -lx * R, -ly * R);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.45)');
      ctx.fillStyle = gr; ctx.fill();
    }
    // 3: the hump crest, highest point of the beast
    contour((u) => 0.22 + 0.34 * bump(u, 0.74, 0.15) + 0.12 * bump(u, 0.12, 0.12), lx * 0.15 * r, ly * 0.15 * r);
    furPath(ctx, r, FUR * 0.6, hk * 0.4, 37);
    ctx.fillStyle = P.top; ctx.fill();
    if (!low) {
      // fur flow strokes, back and out from the spine
      ctx.lineCap = 'round'; ctx.lineWidth = 0.032 * r;
      for (let j = 0; j < 70; j++) {
        const u = 0.04 + 0.92 * nz(500 + j), v = (nz(600 + j) * 2 - 1) * 0.86;
        const m = map(u, v), L = (0.09 + 0.1 * nz(650 + j)) * r;
        let dx = -m.tx + m.nx * v * 0.7, dy = -m.ty + m.ny * v * 0.7;
        const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
        const lit = (m.nx * v * lx + m.ny * v * ly) > 0 || Math.abs(v) < 0.3;
        ctx.strokeStyle = lit ? rgba(P.tip, 0.5 * V.flow) : rgba(P.deep, 0.75);
        ctx.beginPath(); ctx.moveTo(m.x, m.y);
        ctx.quadraticCurveTo(m.x + dx * L * 0.5 - dy * L * 0.15, m.y + dy * L * 0.5 + dx * L * 0.15, m.x + dx * L, m.y + dy * L);
        ctx.stroke();
      }
      // frost crusted on the hump and rump
      ctx.fillStyle = P.frost;
      for (let j = 0; j < 40 && V.crust > 0; j++) {
        const hu = nz(1000 + j), u = hu < 0.75 ? 0.52 + 0.4 * nz(1040 + j) : 0.05 + 0.25 * nz(1040 + j);
        const v = (nz(1080 + j) * 2 - 1) * 0.5;
        const m = map(u, v), rr = (0.012 + 0.024 * nz(1120 + j)) * r;
        ctx.globalAlpha = (0.45 + 0.5 * nz(1160 + j)) * V.crust;
        ctx.beginPath(); ctx.arc(m.x + lx * 0.12 * r, m.y + ly * 0.12 * r, rr, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // hackles: a crest of raised spikes along the spine
    if (hk > 0.05) {
      for (let j = 0; j < 14; j++) {
        const u = 0.44 + 0.48 * (j / 13), sd = j & 1 ? 1 : -1;
        const m = map(u, sd * 0.06), L = (0.13 + 0.08 * nz(1200 + j)) * r * hk * (0.5 + bump(u, 0.72, 0.2)), W = 0.065 * r;
        const dx = -m.tx * 0.6 + m.nx * sd * 0.8, dy = -m.ty * 0.6 + m.ny * sd * 0.8;
        ctx.fillStyle = P.deep;
        ctx.beginPath(); ctx.moveTo(m.x - m.tx * W, m.y - m.ty * W); ctx.lineTo(m.x + dx * L, m.y + dy * L); ctx.lineTo(m.x + m.tx * W, m.y + m.ty * W); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = p.rage > 0.3 ? rgba(RAGE, 0.75 * p.rage) : rgba(P.frost, 0.6);
        ctx.lineWidth = 0.018 * r;
        ctx.beginPath(); ctx.moveTo(m.x + dx * L * 0.45, m.y + dy * L * 0.45); ctx.lineTo(m.x + dx * L, m.y + dy * L); ctx.stroke();
      }
    }
  }

  // ---------------------------------------------------------------- head
  // half outline of the upper head (units r, +x forward from the neck): broad wedge skull, steep stop, long snout
  const HEAD = [[-0.2, 0.2], [-0.12, 0.34], [0.02, 0.42], [0.18, 0.43], [0.32, 0.37], [0.45, 0.27], [0.6, 0.21], [0.8, 0.18], [0.97, 0.15], [1.08, 0.1], [1.13, 0.0]];
  function headPath(ctx, r, salt, hk) {
    ctx.beginPath();
    ctx.moveTo(HEAD[0][0] * r, 0);
    const n = HEAD.length;
    for (let sgn = 1; sgn >= -1; sgn -= 2) {
      for (let ii = 0; ii < n; ii++) {
        const i = sgn > 0 ? ii : n - 1 - ii, x = HEAD[i][0] * r, y = sgn * HEAD[i][1] * r;
        if (i >= 1 && i <= 5) {   // cheek ruff: tufts sweeping back
          const L = r * (0.06 + 0.08 * nz(salt + i + (sgn > 0 ? 0 : 20))) * (1 + 0.8 * hk);
          const j = sgn > 0 ? i - 1 : i + 1 > 5 ? 5 : i + 1;
          const mx = (x + HEAD[j][0] * r) / 2, my = (y + sgn * HEAD[j][1] * r) / 2;
          if (sgn > 0) { ctx.lineTo(mx - L * 0.9, my + sgn * L * 0.8); ctx.lineTo(x, y); }
          else { ctx.lineTo(x, y); if (i < 5) ctx.lineTo(mx - L * 0.9, my + sgn * L * 0.8); }
        } else ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
  }
  function fang(ctx, r, x, y, dx, dy, L, w, P) {
    const nx = -dy, ny = dx;
    ctx.fillStyle = P.fang;
    ctx.beginPath(); ctx.moveTo(x + nx * w, y + ny * w);
    ctx.quadraticCurveTo(x + dx * L * 0.6 + nx * w * 0.6, y + dy * L * 0.6 + ny * w * 0.6, x + dx * L, y + dy * L);
    ctx.lineTo(x - nx * w, y - ny * w); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(60,40,20,.5)'; ctx.lineWidth = 0.008 * r; ctx.stroke();
  }
  function mane(ctx, r, hk, P, lx, ly, low) {
    // shoulder mane spilling over the back of the skull, so the head grows out of the hump
    // a fan of tufts whose roots sit on an arc over the back of the skull and whose tips sweep back and out
    ctx.beginPath();
    const n = 11, cx = -0.3 * r;
    ctx.moveTo(cx - 0.1 * r, 0);
    for (let i = 0; i <= n; i++) {
      const th = -1.25 + 2.5 * i / n;
      const rx = cx + Math.cos(th) * 0.3 * r, ry = Math.sin(th) * 0.4 * r;            // root edge
      const L = (0.12 + 0.1 * nz(1600 + i)) * r * (1 + 0.6 * hk);
      const back = Math.atan2(Math.sin(th), -0.6);                                      // tips point back and out
      const tx = rx + Math.cos(back) * L, ty = ry + Math.sin(back) * L;
      const th2 = th + 1.25 / n, nx2 = cx + Math.cos(th2) * 0.3 * r, ny2 = Math.sin(th2) * 0.4 * r;
      ctx.lineTo(rx, ry);
      ctx.quadraticCurveTo(lerp(rx, tx, 0.5) + Math.cos(th) * 0.04 * r, lerp(ry, ty, 0.5) + Math.sin(th) * 0.04 * r, tx, ty);
      if (i < n) ctx.lineTo(nx2, ny2);
    }
    ctx.closePath();
    ctx.fillStyle = P.deep; ctx.fill();
    if (!low) {   // frost on the light side of the mane
      const R = 0.6 * r, gr = ctx.createLinearGradient(cx + lx * R, ly * R, cx - lx * R, -ly * R);
      gr.addColorStop(0, rgba(P.frost, 0.7)); gr.addColorStop(0.45, rgba(P.frost, 0));
      ctx.strokeStyle = gr; ctx.lineWidth = 0.035 * r; ctx.lineJoin = 'round'; ctx.stroke();
    }
  }
  function head(ctx, e, t, r, p, P, low) {
    const end = at(1);
    const ha = Math.atan2(end.ty, end.tx) + p.yaw;
    const hs = 1 + 0.32 * p.rear + 0.14 * p.roar - 0.12 * p.crouch - 0.14 * p.stun - 0.05 * p.dead;
    const lf = 1 - 0.38 * p.rear - 0.28 * p.roar + 0.05 * p.lunge - 0.06 * p.crouch;
    const fwd = (-0.14 * p.crouch + 0.12 * p.lunge - 0.06 * p.stun) * r;
    const open = p.dead ? 0.15 : Math.max(p.roar, 0.35 * p.lunge, 0.6 * p.rear, 0.25 * p.swipe, 0.25 * p.crouch);
    const hk = p.hack;
    ctx.save();
    ctx.translate(end.x + end.tx * (0.02 * r + fwd), end.y + end.ty * (0.02 * r + fwd));
    ctx.rotate(ha);
    const a = (e.angle || 0) + ha, c = Math.cos(a), s = Math.sin(a);
    const lx = -0.552 * c - 0.834 * s, ly = 0.552 * s - 0.834 * c;
    ctx.save();
    ctx.scale(hs * lf, hs);
    // lower jaw drops forward when the head lifts and the mouth opens
    if (open > 0.04) {
      const jx = (1.0 + 0.42 * open / lf) * r;
      ctx.fillStyle = P.deep;
      ctx.beginPath(); ctx.moveTo(0.3 * r, 0.3 * r);
      ctx.quadraticCurveTo(jx * 0.85, 0.26 * r, jx, 0.1 * r); ctx.quadraticCurveTo(jx + 0.05 * r, 0, jx, -0.1 * r);
      ctx.quadraticCurveTo(jx * 0.85, -0.26 * r, 0.3 * r, -0.3 * r); ctx.closePath(); ctx.fill();
      ctx.fillStyle = P.gum;
      ctx.beginPath(); ctx.moveTo(0.55 * r, 0.19 * r);
      ctx.quadraticCurveTo(jx * 0.9, 0.2 * r, jx - 0.03 * r, 0.08 * r); ctx.lineTo(jx - 0.03 * r, -0.08 * r);
      ctx.quadraticCurveTo(jx * 0.9, -0.2 * r, 0.55 * r, -0.19 * r); ctx.closePath(); ctx.fill();
      ctx.fillStyle = P.mouth;
      ctx.beginPath(); ctx.moveTo(0.6 * r, 0.14 * r);
      ctx.quadraticCurveTo(jx * 0.85, 0.15 * r, jx - 0.07 * r, 0.05 * r); ctx.lineTo(jx - 0.07 * r, -0.05 * r);
      ctx.quadraticCurveTo(jx * 0.85, -0.15 * r, 0.6 * r, -0.14 * r); ctx.closePath(); ctx.fill();
      ctx.fillStyle = P.tongue;
      ctx.beginPath(); ctx.ellipse(jx * 0.78, 0, 0.17 * r, 0.075 * r, 0, 0, TAU); ctx.fill();
      for (let sg = -1; sg <= 1; sg += 2) {   // lower canines and incisors point up and back
        fang(ctx, r, jx - 0.06 * r, sg * 0.1 * r, -0.8, -sg * 0.6, 0.14 * r, 0.03 * r, P);
        for (let k = 0; k < 2; k++) fang(ctx, r, jx - 0.02 * r, sg * (0.03 + 0.03 * k) * r, -1, 0, 0.04 * r, 0.012 * r, P);
      }
    }
    // small ears set wide on the skull, pinned flat when angry
    for (let sg = -1; sg <= 1; sg += 2) {
      ctx.save(); ctx.translate(-0.04 * r - 0.06 * r * hk, sg * 0.38 * r); ctx.rotate(sg * (0.4 + 0.5 * hk)); ctx.scale(1, 1 - 0.45 * hk);
      ctx.fillStyle = P.deep; ctx.beginPath(); ctx.arc(0, 0, 0.1 * r, 0, TAU); ctx.fill();
      ctx.fillStyle = P.mid; ctx.beginPath(); ctx.arc(0.02 * r, 0, 0.05 * r, 0, TAU); ctx.fill();
      ctx.restore();
    }
    headPath(ctx, r, 1300, hk);
    ctx.fillStyle = P.deep; ctx.fill();
    if (!low) {
      const R = 0.9 * r, gr = ctx.createLinearGradient(lx * R + 0.4 * r, ly * R, -lx * R + 0.4 * r, -ly * R);
      gr.addColorStop(0, rgba(P.frost, 0.7)); gr.addColorStop(0.4, rgba(P.frost, 0));
      ctx.strokeStyle = gr; ctx.lineWidth = 0.04 * r; ctx.lineJoin = 'round'; ctx.stroke();
    }
    // forehead plate: the steep cave-bear dome, a wedge narrowing into the snout bridge
    ctx.fillStyle = P.mid;
    ctx.beginPath(); ctx.moveTo(-0.08 * r, 0.3 * r); ctx.quadraticCurveTo(0.25 * r, 0.34 * r, 0.5 * r, 0.12 * r);
    ctx.lineTo(0.5 * r, -0.12 * r); ctx.quadraticCurveTo(0.25 * r, -0.34 * r, -0.08 * r, -0.3 * r); ctx.closePath(); ctx.fill();
    ctx.fillStyle = P.top;
    ctx.beginPath(); ctx.ellipse(0.16 * r + lx * 0.05 * r, ly * 0.07 * r, 0.2 * r, 0.14 * r, 0, 0, TAU); ctx.fill();
    // muzzle
    ctx.fillStyle = P.muzzle;
    ctx.beginPath(); ctx.moveTo(0.5 * r, 0.19 * r); ctx.quadraticCurveTo(0.85 * r, 0.16 * r, 1.04 * r, 0.09 * r);
    ctx.lineTo(1.04 * r, -0.09 * r); ctx.quadraticCurveTo(0.85 * r, -0.16 * r, 0.5 * r, -0.19 * r);
    ctx.quadraticCurveTo(0.44 * r, 0, 0.5 * r, 0.19 * r); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba(P.deep, 0.65); ctx.lineWidth = 0.025 * r; ctx.lineCap = 'round';   // snarl wrinkles
    for (let k = 0; k < 3; k++) {
      const x = (0.58 + 0.08 * k) * r, wr = (0.1 - 0.012 * k) * r * (1 + 0.5 * hk);
      ctx.beginPath(); ctx.moveTo(x, -wr); ctx.quadraticCurveTo(x + 0.04 * r, 0, x, wr); ctx.stroke();
    }
    // nose pad
    ctx.fillStyle = P.nose;
    ctx.beginPath(); ctx.ellipse(1.06 * r, 0, 0.075 * r, 0.11 * r, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.beginPath(); ctx.ellipse(1.06 * r + lx * 0.03 * r, ly * 0.04 * r, 0.025 * r, 0.035 * r, 0, 0, TAU); ctx.fill();
    // upper canines jut past the lip
    const fl = (0.16 + 0.05 * p.rage + 0.05 * open) * r;
    for (let sg = -1; sg <= 1; sg += 2) {
      if (open > 0.04) fang(ctx, r, 0.98 * r, sg * 0.11 * r, 0.85, sg * 0.2, fl, 0.032 * r, P);
      else if (V.closedFangs) fang(ctx, r, 0.9 * r, sg * 0.16 * r, 0.45, sg * 0.75, fl * 0.8, 0.03 * r, P);
    }
    // small ember eyes under a heavy brow
    for (let sg = -1; sg <= 1; sg += 2) {
      const ex = 0.44 * r, ey = sg * 0.18 * r;
      ctx.fillStyle = '#050403';
      ctx.beginPath(); ctx.ellipse(ex, ey, 0.08 * r, 0.055 * r, sg * 0.4, 0, TAU); ctx.fill();
      const dim = p.dead ? 0 : p.stun > 0.1 ? 0.45 + 0.35 * Math.sin(t * 17 + sg) : 1;
      if (!V.ember) {   // a plain animal eye: dark, with a wet highlight
        ctx.fillStyle = '#1a120c';
        ctx.beginPath(); ctx.ellipse(ex, ey, 0.05 * r, 0.032 * r, sg * 0.45, 0, TAU); ctx.fill();
        if (!p.dead) { ctx.fillStyle = 'rgba(255,248,236,0.75)'; ctx.beginPath(); ctx.arc(ex + 0.016 * r, ey - sg * 0.008 * r, 0.011 * r, 0, TAU); ctx.fill(); }
      } else if (dim > 0) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        if (!low) {
          const gR = 0.22 * r * (1 + 0.5 * p.rage);
          const gr = ctx.createRadialGradient(ex, ey, 0, ex, ey, gR);
          gr.addColorStop(0, rgba(EMBER, (0.55 + 0.3 * p.rage) * dim)); gr.addColorStop(1, rgba(EMBER, 0));
          ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(ex, ey, gR, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = rgba(p.rage > 0.5 ? '#FF8A3A' : EMBER, dim);
        ctx.beginPath(); ctx.ellipse(ex, ey, 0.056 * r, 0.028 * r, sg * 0.45, 0, TAU); ctx.fill();
        ctx.fillStyle = rgba(EMBER_CORE, dim);
        ctx.beginPath(); ctx.ellipse(ex + 0.008 * r, ey, 0.026 * r, 0.013 * r, sg * 0.45, 0, TAU); ctx.fill();
        ctx.restore();
      }
    }
    // brow ridge: a hard V that meets over the snout
    ctx.strokeStyle = P.deep; ctx.lineWidth = 0.08 * r; ctx.lineCap = 'round';
    for (let sg = -1; sg <= 1; sg += 2) {
      ctx.beginPath(); ctx.moveTo(0.3 * r, sg * 0.31 * r);
      ctx.quadraticCurveTo(0.43 * r, sg * 0.26 * r, 0.55 * r, sg * (0.1 + 0.03 * (1 - hk)) * r); ctx.stroke();
    }
    ctx.restore();   // head scale
    mane(ctx, r * hs, hk, P, lx, ly, low);
    if (!p.dead && !low) steam(ctx, t, r, p, (1.12 * hs * lf) * r);
    ctx.restore();
  }
  // breath steam from the nostrils: slow plumes, quick snorts while it winds up, a blast when it roars
  function steam(ctx, t, r, p, nx) {
    ctx.fillStyle = '#eef4fa';
    const roar = p.roar > 0.3, snort = p.paw > 0.3;
    const n = roar ? 7 : 3, period = roar ? 0.9 : snort ? 0.7 : 2.4, life = roar ? 0.85 : snort ? 0.6 : 1.3;
    for (let k = 0; k < n; k++) {
      const age = (t + k * period / n * (roar ? 1 : 1.7) + (SEED % 13) * 0.1) % period;
      if (age > life) continue;
      const q = age / life, sd = (k & 1 ? 1 : -1) * (0.05 + (roar ? 0.35 * (nz(1400 + k) - 0.5) * q * 3 : 0));
      const x = nx + (0.1 + (roar ? 1.6 : 0.55) * q) * r, y = (sd + Math.sin(t * 1.3 + k) * 0.08 * q) * r;
      const rad = (0.05 + (roar ? 0.45 : 0.22) * q) * r;
      ctx.globalAlpha = (roar ? 0.42 : 0.32) * (1 - q) * (q < 0.12 ? q / 0.12 : 1);
      ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // snow kicked back by the raking paw
  function snowKick(ctx, r, p, t) {
    if (p.paw < 0.2 || p.crouch < 0.5) return;
    const s = rakeSide(), q = (t * 2.4) % 1;
    if (q > 0.7) return;
    frontPaw(p, t, s, 0);
    const px = PW.x * r, py = PW.y * r;
    ctx.fillStyle = '#f4f8fc';
    for (let j = 0; j < 8; j++) {
      const k = sat(q / 0.7 + nz(1500 + j) * 0.3), d = (0.15 + 0.75 * k) * r;
      ctx.globalAlpha = 0.9 * (1 - k);
      ctx.beginPath(); ctx.arc(px - d, py + s * (nz(1520 + j) - 0.3) * 0.5 * k * r, (0.03 + 0.03 * nz(1540 + j)) * r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- entry point
  A.Shapes.cavebear = function (ctx, e, t, look) {
    const r = e.r || 52, rs = e.rs || (e.rs = {});
    SEED = seedOf(e);
    V = VARIANTS[look && look.variant] || VARIANTS.boss;
    const P0 = palOf(look);
    const p = pose(e, t);
    let P = P0;
    if (p.flash > 0.02) {   // hurt flash: wash the fur toward white
      const f = Math.round(p.flash * 5) / 10;
      if (!rs.bflash || rs.bflash.f !== f) {
        rs.bflash = Object.assign({ f }, P0);
        for (const k of PAL_KEYS) rs.bflash[k] = mix(P0[k], '#ffffff', f);
      }
      P = rs.bflash;
    }
    const zoom = A.G && A.G.cam && A.G.cam.zoom;
    const low = !!zoom && r * zoom < 14;              // tiny on screen: skip the fine passes
    const cyc = (e.phase || 0) * 1.6;
    const a = e.angle || 0, c = Math.cos(a), s = Math.sin(a);
    const lx = -0.552 * c - 0.834 * s, ly = 0.552 * s - 0.834 * c;   // world light in the body frame

    ctx.save();
    ctx.scale(V.scale, V.scale);                            // drawn a touch past r so it towers; collision is unchanged
    if (p.stun > 0.01) ctx.rotate(Math.sin(t * 2.6) * 0.16 * p.stun);
    if (p.crouch > 0.85 && p.paw > 0.5) ctx.translate(Math.sin(t * 61) * r * 0.012, Math.cos(t * 73) * r * 0.012);
    buildSpine(r, p, t, cyc);

    if (p.rage > 0.02) {   // red under-glow
      const pul = 0.85 + 0.15 * Math.sin(t * 4.2);
      const gr = ctx.createRadialGradient(0, 0, 0.3 * r, 0, 0, 2.1 * r);
      gr.addColorStop(0, rgba(RAGE, 0.5 * p.rage * pul)); gr.addColorStop(0.55, rgba(RAGE, 0.22 * p.rage * pul)); gr.addColorStop(1, rgba(RAGE, 0));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, 2.1 * r, 0, TAU); ctx.fill();
    }
    if (p.rear > 0.02) {   // the raised front throws a long shadow where it will land
      ctx.fillStyle = 'rgba(10,14,24,' + (0.3 * p.rear).toFixed(3) + ')';
      ctx.beginPath(); ctx.ellipse(0.55 * r, 0.12 * r, 1.25 * r, 1.05 * r, 0, 0, TAU); ctx.fill();
    }
    for (let sg = -1; sg <= 1; sg += 2) drawLeg(ctx, r, p, P, false, sg, t, cyc, 'below');
    for (let sg = -1; sg <= 1; sg += 2) drawLeg(ctx, r, p, P, true, sg, t, cyc, 'below');
    { const q = at(0); ctx.fillStyle = P.deep;   // stub tail, half buried in the rump fur
      ctx.beginPath(); ctx.ellipse(q.x - q.tx * 0.4 * r, q.y - q.ty * 0.4 * r, 0.14 * r, 0.1 * r, Math.atan2(q.ty, q.tx), 0, TAU); ctx.fill(); }
    body(ctx, r, p, P, lx, ly, low);
    if (V.scars) scars(ctx, r, p, t, low);
    for (let sg = -1; sg <= 1; sg += 2) drawLeg(ctx, r, p, P, true, sg, t, cyc, 'above');
    head(ctx, e, t, r, p, P, low);
    snowKick(ctx, r, p, t);
    ctx.restore();
  };
})();
