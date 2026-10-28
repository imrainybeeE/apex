/* Apex land vertebrates: quadruped, frog, lizard, serpent.
   Also hosts A.VKit, the small drawing kit that shapes-air-water.js reuses. */
(function () {
  'use strict';
  const A = window.Apex = window.Apex || {};
  A.Shapes = A.Shapes || {};
  A.LOOKS = A.LOOKS || {};

  const PI = Math.PI, TAU = PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => t * t * (3 - 2 * t);

  /* ====================================================================
     Kit: stable randomness, colors, pose, eyes, tube bodies, shading
     ==================================================================== */
  const K = A.VKit = A.VKit || {};
  K.clamp = clamp; K.lerp = lerp; K.ease = ease;
  const S = K.S = { lx: -0.55, ly: -0.83, gx: 0.5, gy: 0, blink: 0, desp: false, pal: null, twx: 0, twy: 0, hasT: false, low: false };
  const POSE = {};

  // --- stable per-entity randomness
  function hash(n) {
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    return (n ^ (n >>> 16)) >>> 0;
  }
  function seedOf(e) {
    const rs = e.rs || (e.rs = {});
    if (rs.seed === undefined) {
      const s = String(e.id === undefined ? 0 : e.id);
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      rs.seed = h >>> 0;
    }
    return rs.seed;
  }
  function rnd(e, k) { return hash((seedOf(e) + Math.imul(k + 1, 0x9e3779b1)) >>> 0) / 4294967296; }
  // 0..1..0 bump of length dur repeating every ~period seconds, offset per entity
  function pulse(e, t, period, dur, k) {
    const p = period * (0.8 + 0.4 * rnd(e, k));
    const ph = (t + rnd(e, k + 50) * p) % p;
    return ph < dur ? Math.sin(PI * ph / dur) : 0;
  }
  K.rnd = rnd; K.pulse = pulse;

  // --- colors
  const mixCache = new Map();
  function parse(hex) {
    let h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    const q = Math.round(clamp(t, 0, 1) * 32), key = a + b + q;
    let c = mixCache.get(key);
    if (c) return c;
    if (!/^#[0-9a-f]{3,6}$/i.test(a) || !/^#[0-9a-f]{3,6}$/i.test(b)) return a;
    const x = parse(a), y = parse(b), f = q / 32;
    c = '#';
    for (let i = 0; i < 3; i++) c += Math.round(x[i] + (y[i] - x[i]) * f).toString(16).padStart(2, '0');
    if (mixCache.size > 4000) mixCache.clear();
    mixCache.set(key, c);
    return c;
  }
  K.mix = mix;

  // Palette for this entity: look.pal with player overrides, hurt flash and sickness tint applied.
  const palCache = new Map();
  function palette(e, look) {
    const p = look.pal || {};
    let body = p.body || '#8a8a8a', accent = p.accent || body;
    if (e.pal) { if (e.pal.body) body = e.pal.body; if (e.pal.accent) accent = e.pal.accent; }
    const h = e.hurtT > 0 ? Math.min(6, Math.ceil(e.hurtT * 24)) : 0;
    const key = body + accent + (p.belly || '') + (p.dark || '') + (p.eye || '') + h + (e.sick ? 's' : '');
    let o = palCache.get(key);
    if (o) return o;
    const fl = h / 6 * 0.75;
    const f = (c) => {
      if (e.sick) c = mix(c, '#8fd13c', 0.35);
      return fl ? mix(c, '#ffffff', fl) : c;
    };
    const belly = p.belly || mix(body, '#ffffff', 0.5);
    const dark = p.dark || mix(body, '#000000', 0.6);
    const eye = p.eye || '#3a2a14';
    o = {
      body: f(body), bodyHi: f(mix(body, '#ffffff', 0.32)), bodyLo: f(mix(body, '#000000', 0.38)),
      belly: f(belly), accent: f(accent), accentLo: f(mix(accent, '#000000', 0.35)),
      dark: f(dark), eye, eyeLo: mix(eye, '#000000', 0.4),
      bodyIsLight: parse(body)[1] > 150,
    };
    if (palCache.size > 600) palCache.clear();
    palCache.set(key, o);
    return o;
  }
  K.palette = palette;

  // --- per-frame pose and shared state. Opens ctx.save(); pair with K.end(ctx).
  function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
  function begin(ctx, e, t, look, noScale) {
    const rs = e.rs || (e.rs = {});
    const o = POSE;
    const st = e.state || '';
    const stT = e.stateT === undefined ? 0.4 : e.stateT;
    const r = e.r || 10;
    const sp = Math.hypot(e.vx || 0, e.vy || 0);
    o.r = r; o.speed = sp; o.move = clamp(sp / (r * 1.5), 0, 1);
    o.crouch = st === 'windup' ? ease(clamp(stT / 0.3, 0, 1)) : 0;
    o.stretch = st === 'lunge' ? ease(clamp(stT / 0.08, 0, 1)) : 0;
    o.rest = st === 'rest' ? 1 : 0;
    o.graze = st === 'graze' ? 1 : 0;
    o.alert = st === 'ambush' ? 1 : 0;
    o.flee = st === 'flee' ? 1 : 0;
    o.hopping = st === 'hop' ? 1 : 0;
    o.fly = st === 'fly' || st === 'dive' ? 1 : 0;
    o.dive = st === 'dive' ? 1 : 0;
    o.hurt = e.hurtT > 0 ? clamp(e.hurtT * 5, 0, 1) : 0;
    const b = e.biteT > 0 ? clamp(e.biteT / 0.25, 0, 1) : 0;
    o.bite = b > 0 ? Math.sin(b * PI) : 0;
    o.biteP = 1 - b;
    o.pal = S.pal = palette(e, look);
    o.t = t;
    const zoom = A.G && A.G.cam && A.G.cam.zoom;
    S.low = !!zoom && r * zoom < 11;                   // tiny on screen: skip decorative passes

    // eye state
    let bl = pulse(e, t, 4.2, 0.17, 1);
    if (rnd(e, 5) > 0.55) bl = Math.max(bl, pulse(e, t + 0.24, 4.2, 0.17, 1));
    bl = Math.max(bl, o.crouch * 0.3, o.hurt * 0.6, o.rest * 0.88);
    S.blink = bl;
    S.desp = !!e.desperate;
    const tg = e.target;
    S.hasT = !!(tg && typeof tg.x === 'number');
    if (S.hasT) {
      const wa = Math.atan2(tg.y - e.y, tg.x - e.x);
      S.twx = Math.cos(wa); S.twy = Math.sin(wa);
    }
    S.idleY = Math.sin(t * 0.8 + rnd(e, 7) * TAU) * 0.35;
    frame(e.angle || 0);

    ctx.save();
    if (!noScale) {
      const breath = Math.sin(t * (o.rest ? 1.6 : 2.6) + rnd(e, 3) * TAU) * (o.rest ? 0.035 : 0.016);
      const sx = 1 + 0.13 * o.stretch - 0.1 * o.crouch + 0.05 * o.bite - 0.04 * o.hurt;
      const sy = 1 - 0.07 * o.stretch + 0.09 * o.crouch - 0.03 * o.bite + breath + 0.05 * o.hurt;
      if (o.crouch > 0.9) ctx.translate(Math.sin(t * 70) * r * 0.015, Math.cos(t * 83) * r * 0.015);
      ctx.scale(sx, sy);
    }
    return o;
  }
  // Re-express world light and gaze in a frame rotated by angle a
  function frame(a) {
    const c = Math.cos(a), s = Math.sin(a);
    S.lx = -0.552 * c + -0.834 * s;
    S.ly = 0.552 * s + -0.834 * c;
    if (S.hasT) { S.gx = S.twx * c + S.twy * s; S.gy = -S.twx * s + S.twy * c; }
    else { S.gx = 0.55; S.gy = S.idleY; }
  }
  function end(ctx) { ctx.restore(); }
  K.begin = begin; K.end = end; K.frame = frame; K.wrap = wrap;

  // Smoothed turn rate (-1..1) used to whip tails and trailing bodies
  K.turn = function (e, t) {
    const rs = e.rs;
    if (rs.lt !== t) {
      const d = rs.la === undefined ? 0 : wrap((e.angle || 0) - rs.la);
      rs.turn = (rs.turn || 0) * 0.82 + clamp(d * 7, -1, 1) * 0.18;
      rs.la = e.angle || 0; rs.lt = t;
    }
    return rs.turn || 0;
  };
  // Smoothed head yaw toward the target (radians, relative to the body)
  K.headYaw = function (e, t, o, max) {
    const rs = e.rs;
    let goal = Math.sin(t * 0.7 + rnd(e, 9) * TAU) * 0.1;
    if (S.hasT) goal = clamp(Math.atan2(S.gy, S.gx), -max, max) * 0.7;
    if (o.graze) goal += Math.sin(t * 3.1 + rnd(e, 4)) * 0.12;
    rs.hy = (rs.hy || 0) + (goal - (rs.hy || 0)) * 0.14;
    return rs.hy;
  };

  // --- reusable point arrays
  K.pts = function (e, key, n) {
    const rs = e.rs || (e.rs = {});
    let a = rs[key];
    if (!a) a = rs[key] = [];
    while (a.length < n) a.push({ x: 0, y: 0, w: 0 });
    return a;
  };
  const SUB = [];
  K.sub = function (arr, a, b) {
    SUB.length = 0;
    for (let i = a; i <= b; i++) SUB.push(arr[i]);
    return SUB;
  };
  // Interpolated point along an rear->front array at u in 0..1
  K.at = function (arr, u, out) {
    const n = arr.length - 1, f = clamp(u, 0, 1) * n, i = Math.min(n - 1, Math.floor(f)), k = f - i;
    const a = arr[i], b = arr[i + 1];
    out.x = lerp(a.x, b.x, k); out.y = lerp(a.y, b.y, k); out.w = lerp(a.w, b.w, k);
    out.a = Math.atan2(b.y - a.y, b.x - a.x);
    return out;
  };
  K.prof = function (tbl, u) {
    for (let i = 1; i < tbl.length; i++) {
      if (u <= tbl[i][0]) {
        const a = tbl[i - 1], b = tbl[i];
        return lerp(a[1], b[1], (u - a[0]) / (b[0] - a[0] || 1));
      }
    }
    return tbl[tbl.length - 1][1];
  };

  // --- tube: smooth outline of a variable-width body along pts (rear->front, w = half width)
  const TX = new Float64Array(64), TY = new Float64Array(64);
  const OX = new Float64Array(200), OY = new Float64Array(200);
  let M = 0;
  function put(x, y) { OX[M] = x; OY[M] = y; M++; }
  function tangents(p) {
    const n = p.length;
    for (let i = 0; i < n; i++) {
      const a = p[i > 0 ? i - 1 : 0], b = p[i < n - 1 ? i + 1 : n - 1];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      TX[i] = dx / d; TY[i] = dy / d;
    }
  }
  function cap(p, i, dir, ws, off, k) {
    const b = p[i], w = b.w, tx = TX[i] * dir, ty = TY[i] * dir;
    const nx = -TY[i] * dir, ny = TX[i] * dir;      // left of the direction we leave the body in
    put(b.x + nx * (off + ws * 0.82) * w + tx * ws * w * 0.5 * k, b.y + ny * (off + ws * 0.82) * w + ty * ws * w * 0.5 * k);
    put(b.x + nx * off * w + tx * ws * w * 0.98 * k, b.y + ny * off * w + ty * ws * w * 0.98 * k);
    put(b.x + nx * (off - ws * 0.82) * w + tx * ws * w * 0.5 * k, b.y + ny * (off - ws * 0.82) * w + ty * ws * w * 0.5 * k);
  }
  function tube(ctx, p, ws, off, capF, capB, keep) {
    ws = ws === undefined ? 1 : ws; off = off || 0;
    capF = capF === undefined ? 1 : capF; capB = capB === undefined ? 1 : capB;
    const n = p.length;
    tangents(p);
    M = 0;
    for (let i = 0; i < n; i++) {                    // left edge, rear -> front
      const q = p[i], w = q.w;
      put(q.x - TY[i] * (off + ws) * w, q.y + TX[i] * (off + ws) * w);
    }
    if (capF > 0) cap(p, n - 1, 1, ws, off, capF);
    for (let i = n - 1; i >= 0; i--) {               // right edge, front -> rear
      const q = p[i], w = q.w;
      put(q.x - TY[i] * (off - ws) * w, q.y + TX[i] * (off - ws) * w);
    }
    if (capB > 0) cap(p, 0, -1, ws, -off, capB);
    // closed quadratic spline through edge midpoints
    if (!keep) ctx.beginPath();
    ctx.moveTo((OX[M - 1] + OX[0]) / 2, (OY[M - 1] + OY[0]) / 2);
    for (let i = 0; i < M; i++) {
      const j = i + 1 === M ? 0 : i + 1;
      ctx.quadraticCurveTo(OX[i], OY[i], (OX[i] + OX[j]) / 2, (OY[i] + OY[j]) / 2);
    }
    ctx.closePath();
  }
  // Open smooth polyline along an offset of the tube (for stripes, ridges)
  function trace(ctx, p, off, i0, i1) {
    tangents(p);
    ctx.beginPath();
    let px = 0, py = 0;
    for (let i = i0; i <= i1; i++) {
      const q = p[i], x = q.x - TY[i] * off * q.w, y = q.y + TX[i] * off * q.w;
      if (i === i0) ctx.moveTo(x, y);
      else ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
      px = x; py = y;
    }
    ctx.lineTo(px, py);
  }
  K.tube = tube; K.trace = trace;

  K.circ = function (ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); };
  K.oval = function (ctx, x, y, rx, ry, rot) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, TAU); };
  const circ = K.circ, oval = K.oval;

  // Volume shading over the current path: lit side bright, far side dark (light fixed in the world)
  K.shade = function (ctx, cx, cy, w, k) {
    if (S.low) return;
    const g = ctx.createLinearGradient(cx + S.lx * w, cy + S.ly * w, cx - S.lx * w, cy - S.ly * w);
    g.addColorStop(0, 'rgba(255,255,255,.34)');
    g.addColorStop(0.45, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,.38)');
    ctx.globalAlpha = k === undefined ? 1 : k;
    ctx.fillStyle = g;
    ctx.fill();
    ctx.globalAlpha = 1;
  };
  K.fillShaded = function (ctx, color, cx, cy, w, k) {
    ctx.fillStyle = color; ctx.fill();
    K.shade(ctx, cx, cy, w, k);
  };
  // Glossy specular streak toward the light
  K.gloss = function (ctx, x, y, rx, ry, rot, a) {
    if (S.low) return;
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = 0.16 * a; oval(ctx, x, y, rx * 1.35, ry * 1.5, rot); ctx.fill();
    ctx.globalAlpha = 0.34 * a; oval(ctx, x, y, rx, ry, rot); ctx.fill();
    ctx.globalAlpha = 1;
  };
  // Glossy streak that follows a bending spine on the lit side
  K.glossLine = function (ctx, p, i0, i1, a, width) {
    if (S.low) return;
    const off = clamp(S.ly * 1.1, -0.55, 0.55);
    ctx.lineCap = 'round'; ctx.strokeStyle = '#fff';
    ctx.globalAlpha = 0.16 * a; ctx.lineWidth = width * 2.2; trace(ctx, p, off, i0, i1); ctx.stroke();
    ctx.globalAlpha = 0.34 * a; ctx.lineWidth = width; trace(ctx, p, off, i0, i1); ctx.stroke();
    ctx.globalAlpha = 1;
  };
  K.rim = function (ctx, color, lw) { if (S.low) return; ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); };

  // --- eyes: sclera, iris, pupil, two speculars, blinks, red glow when desperate
  K.eye = function (ctx, x, y, r, shape) {
    const bl = S.blink, P = S.pal;
    ctx.save();
    ctx.translate(x, y);
    if (S.desp) {
      ctx.fillStyle = 'rgba(255,40,40,.2)'; circ(ctx, 0, 0, r * 2.0); ctx.fill();
      ctx.fillStyle = 'rgba(255,40,40,.3)'; circ(ctx, 0, 0, r * 1.5); ctx.fill();
    }
    if (bl > 0.03) ctx.scale(1, 1 - 0.9 * bl);
    ctx.fillStyle = 'rgba(0,0,0,.34)'; circ(ctx, 0, 0, r * 1.17); ctx.fill();
    ctx.fillStyle = '#f8f5ec'; circ(ctx, 0, 0, r); ctx.fill();
    const gx = S.gx * r * 0.24, gy = S.gy * r * 0.24;
    ctx.fillStyle = S.desp ? '#9c0f10' : P.eyeLo; circ(ctx, gx, gy, r * 0.8); ctx.fill();
    ctx.fillStyle = S.desp ? '#ff3a2c' : P.eye; circ(ctx, gx, gy, r * 0.68); ctx.fill();
    ctx.fillStyle = '#0b0e12';
    if (shape === 'hslit') oval(ctx, gx * 1.1, gy * 1.1, r * 0.2, r * 0.5, 0);
    else if (shape === 'vslit') oval(ctx, gx * 1.1, gy * 1.1, r * 0.5, r * 0.2, 0);
    else circ(ctx, gx * 1.15, gy * 1.15, r * (S.desp ? 0.3 : 0.4));
    ctx.fill();
    ctx.fillStyle = '#fff';
    circ(ctx, S.lx * r * 0.36 + gx * 0.4, S.ly * r * 0.36 + gy * 0.4, r * 0.27); ctx.fill();
    ctx.globalAlpha = 0.85;
    circ(ctx, -S.lx * r * 0.38 + gx * 0.4, -S.ly * r * 0.38 + gy * 0.4, r * 0.11); ctx.fill();
    ctx.restore();
  };

  /* ====================================================================
     QUADRUPED
     look: len wid head snout snoutW eye ear earSize tail tailLen leg gait gaitK flex waist
           mark whiskers horns bellySide muzzle tailTip darkLegs matte (no gloss: fur)
     ==================================================================== */
  const TORSO = [[0, 0.5], [0.1, 0.86], [0.26, 1], [0.48, 0.84], [0.7, 0.96], [0.88, 0.88], [1, 0.62]];
  const GAITS = { walk: [PI / 2, PI * 1.5, 0, PI], trot: [0, PI, PI, 0], bound: [0, 0.12, PI * 0.85, PI * 0.97] };
  // tail: length (of L), half-width (of r), width profile tip->root
  const TAILS = {
    thin: { len: 0.62, w: 0.085, prof: [0.45, 0.6, 0.75, 0.9, 1] },
    longthin: { len: 1.0, w: 0.06, prof: [0.4, 0.6, 0.8, 0.95, 1] },
    bushy: { len: 0.6, w: 0.3, prof: [0.35, 0.85, 1, 0.9, 0.55] },
    short: { len: 0.3, w: 0.13, prof: [0.4, 0.75, 0.95, 1, 0.9] },
    stub: { len: 0.14, w: 0.17, prof: [0.8, 1, 1, 0.9, 0.7] },
    flat: { len: 0.55, w: 0.3, prof: [0.6, 0.95, 0.85, 0.5, 0.3] },
  };

  function legsQuad(ctx, o, e, look, P, sp, cyc, r) {
    const gait = GAITS[look.gait || 'trot'], leg = look.leg === undefined ? 1 : look.leg;
    const lw = Math.max(1, r * 0.2 * (0.55 + leg * 0.45));
    const col = look.darkLegs ? P.dark : P.bodyLo;
    const paw = look.pawBelly ? P.belly : col;
    const stride = r * 0.46 * leg * o.move * (1 + 0.5 * o.stretch);
    ctx.lineCap = 'round';
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw;
    for (let k = 0; k < 4; k++) {
      const front = k < 2, s = (k & 1) ? 1 : -1;
      const hp = sp[front ? 5 : 1];
      const hx = hp.x, hy = hp.y + s * hp.w * 0.78;
      const ph = cyc + gait[k], swing = Math.sin(ph), lift = Math.max(0, Math.cos(ph)) * o.move;
      const reach = r * 0.55 * leg;
      const fx = hx + swing * stride - o.crouch * r * 0.05;
      const fy = hy + s * (reach * 0.55 + lift * r * 0.05);
      ctx.beginPath(); ctx.moveTo(hx, hy);
      ctx.quadraticCurveTo((hx + fx) / 2, hy + s * reach * 0.7, fx, fy);
      ctx.stroke();
      ctx.fillStyle = paw;
      oval(ctx, fx, fy, lw * (0.9 + 0.2 * lift), lw * 0.7, 0); ctx.fill();
    }
  }

  function tailQuad(ctx, e, t, o, look, P, r, rearX, W, turn) {
    const T = TAILS[look.tail || 'thin'];
    if (!T) return;
    const len = T.len * (look.tailLen || 1) * r * look.len;
    const wb = T.w * r * (look.tailW || 1);
    const tp = K.pts(e, 'tail', 5), sd = rnd(e, 11) * TAU;
    const sway = (0.18 + 0.5 * o.move) * (o.alert ? 0.2 : 1) + o.crouch * 0.4;
    for (let i = 0; i < 5; i++) {
      const u = i / 4, p = tp[i];                      // u=0 tip .. 1 root
      p.x = rearX + W * 0.25 - len * (1 - u);
      p.y = Math.sin(t * 2.4 + sd + (1 - u) * 1.6) * len * 0.22 * sway * (1 - u)
        - turn * len * 0.5 * (1 - u) * (1 - u) - (o.rest ? 0.2 * len * (1 - u) : 0);
      p.w = wb * T.prof[i];
    }
    tube(ctx, tp, 1, 0, 1, 1);
    K.fillShaded(ctx, look.tail === 'thin' || look.tail === 'longthin' ? P.bodyLo : P.body, rearX, 0, wb, 0.9);
    if (look.tailTip) {
      tube(ctx, K.sub(tp, 0, 1), 1, 0, 1, 1);
      ctx.fillStyle = look.tailTip === 'dark' ? P.dark : P.belly; ctx.fill();
    }
  }

  function earShape(ctx, kind, size, hr, P) {
    // drawn pointing along +x from its base at the origin
    const s = hr * size;
    if (kind === 'round') {
      ctx.fillStyle = P.bodyLo; circ(ctx, s * 0.25, 0, s * 0.46); ctx.fill();
      ctx.fillStyle = K.mix(P.belly, '#ff9fb0', 0.55); circ(ctx, s * 0.27, 0, s * 0.27); ctx.fill();
    } else if (kind === 'long') {
      ctx.fillStyle = P.bodyLo; oval(ctx, s * 0.85, 0, s * 1.05, s * 0.3, 0); ctx.fill();
      ctx.fillStyle = K.mix(P.belly, '#ff9fb0', 0.5); oval(ctx, s * 0.85, 0, s * 0.8, s * 0.15, 0); ctx.fill();
    } else if (kind === 'tiny') {
      ctx.fillStyle = P.bodyLo; circ(ctx, s * 0.08, 0, s * 0.22); ctx.fill();
    } else {                                           // pointy / tufted
      ctx.fillStyle = P.bodyLo;
      ctx.beginPath(); ctx.moveTo(-s * 0.05, -s * 0.42);
      ctx.quadraticCurveTo(s * 0.55, -s * 0.34, s * 1.0, 0);
      ctx.quadraticCurveTo(s * 0.55, s * 0.34, -s * 0.05, s * 0.42); ctx.closePath(); ctx.fill();
      ctx.fillStyle = K.mix(P.belly, '#ff9fb0', 0.5);
      ctx.beginPath(); ctx.moveTo(s * 0.05, -s * 0.24);
      ctx.quadraticCurveTo(s * 0.45, -s * 0.18, s * 0.72, 0);
      ctx.quadraticCurveTo(s * 0.45, s * 0.18, s * 0.05, s * 0.24); ctx.closePath(); ctx.fill();
      if (kind === 'tufted') {
        ctx.strokeStyle = P.dark; ctx.lineWidth = Math.max(1, s * 0.12); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(s * 0.95, 0); ctx.lineTo(s * 1.4, 0); ctx.stroke();
      }
    }
  }

  function hornsQuad(ctx, kind, hr, look, P, side) {
    const s = hr * (look.hornSize || 1);
    ctx.strokeStyle = kind === 'antlers' ? K.mix(P.belly, '#8a6a3c', 0.35) : '#e9e1cc';
    ctx.lineCap = 'round';
    if (kind === 'horns') {
      ctx.lineWidth = s * 0.3;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-s * 0.4, side * s * 0.9, s * 0.35, side * s * 1.5); ctx.stroke();
      return;
    }
    ctx.lineWidth = Math.max(1.5, s * 0.17);          // antler beam with tines
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-s * 0.2, side * s * 1.1, s * 0.5, side * s * 2.0); ctx.stroke();
    ctx.lineWidth = Math.max(1, s * 0.11);
    ctx.beginPath(); ctx.moveTo(-s * 0.1, side * s * 0.8); ctx.lineTo(s * 0.7, side * s * 1.0);
    ctx.moveTo(-s * 0.05, side * s * 1.3); ctx.lineTo(-s * 0.7, side * s * 1.8);
    ctx.moveTo(s * 0.3, side * s * 1.7); ctx.lineTo(s * 1.0, side * s * 1.9);
    ctx.stroke();
  }

  function markingsQuad(ctx, e, look, P, sp, W) {
    const m = look.mark, rx = sp[0].x, fx = sp[6].x, len = fx - rx;
    ctx.save();
    ctx.globalAlpha = 0.8;
    if (m === 'stripes') {
      ctx.strokeStyle = P.dark; ctx.lineCap = 'round'; ctx.lineWidth = W * 0.2;
      for (let k = 0; k < 6; k++) {
        const x = rx + len * (0.12 + 0.14 * k);
        ctx.beginPath(); ctx.moveTo(x, -W * 1.1); ctx.quadraticCurveTo(x - W * 0.35, 0, x, W * 1.1); ctx.stroke();
      }
    } else if (m === 'spots') {
      ctx.fillStyle = P.dark;
      for (let k = 0; k < 11; k++) {
        const x = rx + len * (0.08 + 0.84 * rnd(e, 20 + k * 2)), y = (rnd(e, 21 + k * 2) - 0.5) * W * 1.6;
        circ(ctx, x, y, W * (0.09 + 0.11 * rnd(e, 60 + k))); ctx.fill();
      }
    } else if (m === 'saddle') {
      ctx.fillStyle = P.dark; ctx.globalAlpha = 0.55;
      oval(ctx, rx + len * 0.5, 0, len * 0.34, W * 0.6, 0); ctx.fill();
    }
    ctx.restore();
  }

  A.Shapes.quadruped = function (ctx, e, t, look) {
    const r = e.r || 12, L = look.len * r, W = look.wid * r;
    const o = K.begin(ctx, e, t, look), P = o.pal;
    const turn = K.turn(e, t);
    const hr = W * (look.head || 0.8);
    const snoutL = hr * (look.snout === undefined ? 0.8 : look.snout);
    const headLen = hr * 1.1 + snoutL;
    const thrust = (o.stretch * 0.22 + o.bite * 0.12 - o.crouch * 0.1) * r;
    const rearX = -L * 0.7;
    const frontX = Math.max(L * 0.98 + thrust - headLen + hr * 0.5, rearX + W * 2.2);
    const cyc = (e.phase || 0) * 2 * (look.gaitK || 1);
    const flex = r * 0.15 * (look.flex === undefined ? 1 : look.flex);
    const waist = look.waist === undefined ? 0.9 : look.waist;
    const sd = rnd(e, 2) * TAU;

    // spine of the torso, rear -> front
    const sp = K.pts(e, 'sp', 7);
    for (let i = 0; i < 7; i++) {
      const u = i / 6, p = sp[i];
      p.x = lerp(rearX, frontX, u);
      p.y = Math.sin(cyc - u * 2.6) * flex * (1 - 0.5 * u) * o.move
        + Math.sin(t * 1.1 + sd - u * 2) * r * 0.012 - turn * (1 - u) * (1 - u) * L * 0.3;
      p.w = W * K.prof(TORSO, u) * (u > 0.3 && u < 0.7 ? waist : 1);
    }

    tailQuad(ctx, e, t, o, look, P, r, rearX, W, turn);
    legsQuad(ctx, o, e, look, P, sp, cyc, r);

    // torso
    const cx = (rearX + frontX) / 2;
    if (look.bellySide) {
      tube(ctx, sp, 1, 0, 1, 1); K.fillShaded(ctx, P.belly, cx, 0, W, 1);
      tube(ctx, sp, 0.8, 0, 1, 1); K.fillShaded(ctx, P.body, cx, 0, W, 1);
    } else {
      tube(ctx, sp, 1, 0, 1, 1); K.fillShaded(ctx, P.body, cx, 0, W, 1);
    }
    tube(ctx, sp, 1, 0, 1, 1); K.rim(ctx, P.bodyLo, Math.max(1, r * 0.045));
    if (look.mark && look.mark !== 'none' && look.mark !== 'mask' && look.mark !== 'ruff') {
      ctx.save(); tube(ctx, sp, 1, 0, 1, 1); ctx.clip(); markingsQuad(ctx, e, look, P, sp, W); ctx.restore();
    }
    if (!look.matte) K.glossLine(ctx, sp, 1, 5, 1, W * 0.13);   // fur (matte) has no shiny streak

    // ruff: spiky collar around the neck
    if (look.mark === 'ruff') {
      const nx = frontX - hr * 0.2, ny = sp[6].y;
      ctx.fillStyle = P.bodyHi; ctx.beginPath();
      for (let k = 0; k < 14; k++) {
        const a = k / 14 * TAU, rr = (k & 1 ? 0.82 : 1.25) * hr * 1.05;
        ctx.lineTo(nx + Math.cos(a) * rr * 0.9, ny + Math.sin(a) * rr);
      }
      ctx.closePath(); ctx.fill();
    }

    // head, in its own frame (origin at the neck joint)
    const yaw = K.headYaw(e, t, o, 0.6) - turn * 0.25;
    const tail = sp[6], prev = sp[5];
    const ha = Math.atan2(tail.y - prev.y, tail.x - prev.x) + yaw;
    ctx.save();
    ctx.translate(frontX - hr * 0.5, tail.y);
    ctx.rotate(ha);
    K.frame((e.angle || 0) + ha);
    const grazeDown = 1 - 0.08 * o.graze - 0.05 * o.crouch;
    ctx.scale(grazeDown, grazeDown);
    const tipW = hr * (look.snoutW || 0.45);
    const hp = K.pts(e, 'head', 5);
    const xs = [0, 0.5 * hr, 1.15 * hr, hr * 1.1 + snoutL * 0.5, headLen - tipW * 0.55];
    const ws = [0.7 * hr, 1.0 * hr, 0.92 * hr, lerp(0.92 * hr, tipW, 0.6), tipW];
    for (let i = 0; i < 5; i++) { hp[i].x = xs[i]; hp[i].y = 0; hp[i].w = ws[i]; }
    // ears behind the skull edge
    const earK = look.ear || 'round', earS = look.earSize || 1;
    const earBack = o.crouch * 0.5 + o.flee * 0.45 + o.rest * 0.2 - o.alert * 0.25;
    const flick = pulse(e, t, 5.5, 0.18, 12) * 0.35;
    if (earK !== 'none') {
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        ctx.save();
        ctx.translate(hr * 0.22, sgn * hr * 0.78);
        ctx.rotate(sgn * (1.5 + earBack + (sgn > 0 ? flick : 0)) + (earK === 'long' ? sgn * 0.7 : 0));
        earShape(ctx, earK, earS, hr, P);
        ctx.restore();
      }
    }
    if (look.horns) {
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        ctx.save(); ctx.translate(hr * 0.35, sgn * hr * 0.5);
        hornsQuad(ctx, look.horns, hr, look, P, sgn); ctx.restore();
      }
    }
    tube(ctx, hp, 1, 0, 1, 1); K.fillShaded(ctx, P.body, headLen * 0.45, 0, hr, 1);
    tube(ctx, hp, 1, 0, 1, 1); K.rim(ctx, P.bodyLo, Math.max(1, r * 0.045));
    if (look.muzzle) {
      tube(ctx, K.sub(hp, 3, 4), 0.86, 0, 1, 0); ctx.fillStyle = P.belly; ctx.fill();
    }
    if (look.mark === 'mask') {
      ctx.fillStyle = P.dark; ctx.globalAlpha = 0.8;
      oval(ctx, hr * 0.85, 0, hr * 0.75, hr * 0.96, 0); ctx.fill(); ctx.globalAlpha = 1;
    }
    if (!look.matte) K.gloss(ctx, hr * 0.7 + S.lx * hr * 0.2, S.ly * hr * 0.4, hr * 0.5, hr * 0.12, 0, 0.9);

    // mouth: closed seam, or open when biting / snarling
    const open = Math.max(o.bite, o.crouch * 0.4 + o.stretch * 0.5);
    const mx = headLen - snoutL * 0.3;
    if (open > 0.05) {
      ctx.fillStyle = '#5b1320';
      oval(ctx, mx + hr * 0.1, 0, snoutL * 0.28 + hr * 0.15 * open, tipW * 0.5 + hr * 0.36 * open, 0); ctx.fill();
      ctx.fillStyle = '#fff';
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        ctx.beginPath(); ctx.moveTo(mx + hr * 0.15, sgn * (tipW * 0.5 + hr * 0.3 * open));
        ctx.lineTo(mx + hr * 0.35, sgn * (tipW * 0.5 + hr * 0.12 * open));
        ctx.lineTo(mx - hr * 0.05, sgn * (tipW * 0.5 + hr * 0.14 * open)); ctx.closePath(); ctx.fill();
      }
    }
    ctx.fillStyle = P.dark;                           // nose
    oval(ctx, headLen - tipW * 0.25, 0, Math.max(hr * 0.12, tipW * 0.55), Math.max(hr * 0.12, tipW * 0.62), 0); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    circ(ctx, headLen - tipW * 0.35 + S.lx * tipW * 0.2, S.ly * tipW * 0.25, Math.max(0.7, tipW * 0.16)); ctx.fill();

    if (look.whiskers) {
      ctx.strokeStyle = P.bodyIsLight ? P.dark : '#efe6dc'; ctx.globalAlpha = 0.7;
      ctx.lineWidth = Math.max(0.6, r * 0.025); ctx.lineCap = 'round';
      const wl = hr * 0.9 + snoutL * 0.35, wob = Math.sin(t * 5 + sd) * 0.04;
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        for (let k = 0; k < 3; k++) {
          const a = sgn * (0.35 + k * 0.38) + wob;
          ctx.beginPath(); ctx.moveTo(headLen - tipW * 0.9, sgn * tipW * 0.7);
          ctx.quadraticCurveTo(headLen + wl * 0.45, sgn * (tipW + wl * 0.35 * Math.sin(Math.abs(a))),
            headLen - tipW + Math.cos(a) * wl * 1.15, sgn * (tipW * 0.7 + Math.sin(Math.abs(a)) * wl * 1.1));
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    // eyes
    const er = hr * (look.eye || 0.36), ex = hr * 0.82;
    K.eye(ctx, ex, -hr * 0.6, er, look.pupil); K.eye(ctx, ex, hr * 0.6, er, look.pupil);
    ctx.restore();
    K.end(ctx);
  };

  /* ====================================================================
     FROG: bulging eyes, folded hind legs that extend on hop/lunge, throat pulse,
           glossy skin with spots, tongue flick on bite
     ==================================================================== */
  const FROG = [[0, 0.5], [0.15, 0.88], [0.35, 1], [0.55, 0.93], [0.78, 0.86], [0.92, 0.7], [1, 0.5]];

  function frogHopExt(e, o) {
    if (o.stretch > 0.5) return 1;
    if (o.crouch > 0) return -0.35 * o.crouch;
    if (o.move <= 0.12) return o.hopping ? -0.15 : 0;
    const h = ((e.phase || 0) * 0.3) % 1;              // one hop cycle
    if (h < 0.22) return -0.25 * Math.sin(h / 0.22 * PI);       // crouch
    if (h < 0.34) return ease((h - 0.22) / 0.12);                // push off
    if (h < 0.62) return 1;                                      // airborne
    return 1 - ease(Math.min(1, (h - 0.62) / 0.2));                // land
  }

  A.Shapes.frog = function (ctx, e, t, look) {
    const r = e.r || 12, L = look.len * r, W = look.wid * r;
    const o = K.begin(ctx, e, t, look, true), P = o.pal;
    const ext = frogHopExt(e, o);
    const air = clamp(ext, 0, 1) * (o.stretch ? 0.5 : 1);
    const throat = Math.sin(t * 4.2 + rnd(e, 3) * TAU) * 0.5 + 0.5;
    const breath = o.rest ? 1.5 : 1;
    const bw = W * 0.72 * (1 + 0.03 * throat * breath);           // body half width
    // squash & stretch
    const sx = 1 + 0.2 * air - 0.12 * Math.max(0, -ext) + 0.04 * o.bite;
    const sy = 1 - 0.1 * air + 0.1 * Math.max(0, -ext);
    const up = 1 + 0.16 * Math.sin(clamp(air, 0, 1) * PI) + 0.1 * o.stretch;
    ctx.scale(sx * up, sy * up);

    const rear = -L * 0.78, front = L * 0.88 + o.bite * r * 0.05;
    const sp = K.pts(e, 'sp', 7);
    for (let i = 0; i < 7; i++) {
      const u = i / 6, p = sp[i];
      p.x = lerp(rear, front, u);
      p.y = Math.sin(t * 0.9 + rnd(e, 4) * TAU + u) * r * 0.01;
      p.w = bw * K.prof(FROG, u);
    }
    const hipX = rear + (front - rear) * 0.22, shX = rear + (front - rear) * 0.78;

    // hind legs: folded Z -> extended
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const legW = Math.max(1.4, bw * 0.38);
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      const f = clamp(ext, -0.4, 1);
      const kx = lerp(-L * 0.02, -L * 0.82, f), ky = sgn * lerp(W * 1.0, W * 0.52, f);
      const ax = lerp(-L * 0.66, -L * 1.32, f), ay = sgn * lerp(W * 0.94, W * 0.3, f);
      const fx = lerp(-L * 1.0, -L * 1.72, f), fy = sgn * lerp(W * 1.1, W * 0.4, f);
      const hx = hipX, hy = sgn * bw * 0.8;
      ctx.strokeStyle = P.bodyLo; ctx.lineWidth = legW * 1.12;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.lineTo(ax, ay); ctx.stroke();
      ctx.strokeStyle = P.body; ctx.lineWidth = legW * 0.78;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.lineTo(ax, ay); ctx.stroke();
      // webbed foot: fan of toes
      const fa = Math.atan2(fy - ay, fx - ax), fl = Math.hypot(fx - ax, fy - ay);
      ctx.fillStyle = P.bodyLo;
      ctx.beginPath(); ctx.moveTo(ax, ay);
      for (let k = -1; k <= 1; k++) ctx.lineTo(ax + Math.cos(fa + k * 0.5) * fl * 1.15, ay + Math.sin(fa + k * 0.5) * fl * 1.15);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = P.dark; ctx.lineWidth = Math.max(0.8, r * 0.04); ctx.globalAlpha = 0.5;
      ctx.beginPath();
      for (let k = -1; k <= 1; k++) { ctx.moveTo(ax, ay); ctx.lineTo(ax + Math.cos(fa + k * 0.5) * fl * 1.15, ay + Math.sin(fa + k * 0.5) * fl * 1.15); }
      ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = P.body; circ(ctx, kx, ky, legW * 0.62); ctx.fill();
    }
    // front legs: planted, tuck back when airborne
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      const tuck = clamp(air * 1.2, 0, 1);
      const hx = shX, hy = sgn * bw * 0.75;
      const ex = lerp(shX - L * 0.08, shX - L * 0.35, tuck), ey = sgn * lerp(W * 1.0, W * 0.85, tuck);
      const px = lerp(shX + L * 0.2, shX - L * 0.5, tuck), py = sgn * lerp(W * 1.02, W * 0.9, tuck);
      ctx.strokeStyle = P.bodyLo; ctx.lineWidth = legW * 0.85;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(ex, ey); ctx.lineTo(px, py); ctx.stroke();
      ctx.fillStyle = P.bodyLo;
      for (let k = -1; k <= 1; k++) {
        circ(ctx, px + Math.cos(k * 0.5 + (tuck ? PI : 0)) * legW * 0.7, py + sgn * legW * 0.3 + Math.sin(k * 0.55) * legW * 0.7, legW * 0.3); ctx.fill();
      }
    }

    // tongue (under the head so it emerges from the mouth)
    if (o.bite > 0.02) {
      const tl = r * 1.9 * o.bite;
      ctx.strokeStyle = '#ff6f8f'; ctx.lineWidth = r * 0.16; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(front - r * 0.1, 0); ctx.lineTo(front + tl, 0); ctx.stroke();
      ctx.fillStyle = '#ff4f78'; circ(ctx, front + tl, 0, r * 0.17); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.6)'; circ(ctx, front + tl - r * 0.04, -r * 0.05, r * 0.05); ctx.fill();
    }

    // body: pale flanks, green back, spots and ridges
    tube(ctx, sp, 1, 0, 1, 1); K.fillShaded(ctx, P.belly, 0, 0, bw, 1);
    tube(ctx, sp, 0.84, 0, 1, 1); K.fillShaded(ctx, P.body, 0, 0, bw, 1);
    ctx.save(); tube(ctx, sp, 0.9, 0, 1, 1); ctx.clip();
    ctx.fillStyle = P.dark;
    for (let k = 0; k < 9; k++) {
      ctx.globalAlpha = 0.55 + 0.25 * rnd(e, 70 + k);
      const x = lerp(rear, front, 0.1 + 0.62 * rnd(e, 30 + k * 2)), y = (rnd(e, 31 + k * 2) - 0.5) * bw * 1.5;
      oval(ctx, x, y, bw * (0.1 + 0.1 * rnd(e, 90 + k)), bw * (0.08 + 0.09 * rnd(e, 110 + k)), rnd(e, 130 + k) * PI); ctx.fill();
    }
    ctx.globalAlpha = 0.85; ctx.strokeStyle = P.accent; ctx.lineWidth = Math.max(1, bw * 0.12); ctx.lineCap = 'round';
    for (let sgn = -1; sgn <= 1; sgn += 2) {                       // dorsolateral ridges
      ctx.beginPath(); ctx.moveTo(front - L * 0.35, sgn * bw * 0.42);
      ctx.quadraticCurveTo(rear + (front - rear) * 0.5, sgn * bw * 0.82, rear + (front - rear) * 0.12, sgn * bw * 0.6); ctx.stroke();
    }
    ctx.restore(); ctx.globalAlpha = 1;
    tube(ctx, sp, 1, 0, 1, 1); K.rim(ctx, P.bodyLo, Math.max(1, r * 0.045));
    K.gloss(ctx, S.lx * bw * 0.25, S.ly * bw * 0.4, (front - rear) * 0.28, bw * 0.1, 0, 1);

    // throat peeking out below the snout, pulsing
    ctx.fillStyle = P.belly;
    oval(ctx, front - bw * 0.18, 0, bw * (0.2 + 0.1 * throat * breath), bw * (0.3 + 0.12 * throat * breath), 0); ctx.fill();
    if (o.bite > 0.05) {
      ctx.fillStyle = '#6a1626'; oval(ctx, front - bw * 0.05, 0, bw * 0.16 * (0.5 + o.bite), bw * 0.34 * (0.4 + o.bite), 0); ctx.fill();
    }
    ctx.strokeStyle = P.dark; ctx.globalAlpha = 0.45; ctx.lineWidth = Math.max(0.8, r * 0.04); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(front - bw * 0.6, -bw * 0.5);
    ctx.quadraticCurveTo(front - bw * 0.02, -bw * 0.32, front + bw * 0.02, 0);
    ctx.quadraticCurveTo(front - bw * 0.02, bw * 0.32, front - bw * 0.6, bw * 0.5); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = P.dark;                                         // nostrils
    circ(ctx, front - bw * 0.36, -bw * 0.17, Math.max(0.6, bw * 0.045)); ctx.fill();
    circ(ctx, front - bw * 0.36, bw * 0.17, Math.max(0.6, bw * 0.045)); ctx.fill();

    // big bulging eyes
    const ex = lerp(rear, front, 0.77), ey = bw * 0.76, er = bw * 0.46 * (look.eye || 1);
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      tube(ctx, [{ x: ex - er * 0.2, y: sgn * ey, w: er * 1.28 }, { x: ex + er * 0.1, y: sgn * ey, w: er * 1.28 }], 1, 0, 1, 1);
      K.fillShaded(ctx, P.body, ex, sgn * ey, er * 1.3, 1);
      K.rim(ctx, P.bodyLo, Math.max(1, r * 0.04));
      K.eye(ctx, ex, sgn * ey, er, 'hslit');
    }
    K.end(ctx);
  };

  /* ====================================================================
     LIZARD: undulating spine, 4 splayed legs in a lateral gait, sheen,
             tail recolored (blue-tailed skink)
     look: len wid legs stripes tail pal.accent = tail color
     ==================================================================== */
  const LIZ = [[0, 0.03], [0.12, 0.12], [0.3, 0.3], [0.45, 0.62], [0.55, 0.86], [0.66, 1], [0.76, 0.96], [0.86, 0.72], [0.92, 0.75], [0.97, 0.62], [1, 0.4]];

  A.Shapes.lizard = function (ctx, e, t, look) {
    const r = e.r || 12, L = look.len * r, W = look.wid * r;
    const o = K.begin(ctx, e, t, look), P = o.pal;
    const turn = K.turn(e, t);
    const N = 13, sp = K.pts(e, 'sp', N);
    const cyc = (e.phase || 0) * 2.4, sd = rnd(e, 2) * TAU;
    const mv = o.move, headX = L * 0.98 + (o.stretch * 0.18 + o.bite * 0.1 - o.crouch * 0.08) * r;
    for (let i = 0; i < N; i++) {                     // i=0 tail tip .. N-1 snout
      const u = i / (N - 1), p = sp[i], b = 1 - u;
      p.x = lerp(-L * 1.0, headX, u);
      const a = r * 0.3 * Math.pow(b, 1.15) * (0.12 + 0.88 * mv) + r * 0.07 * Math.pow(b, 1.4);
      p.y = Math.sin(cyc * (mv > 0.05 ? 1 : 0) + b * 5.2 + (mv > 0.05 ? 0 : t * 1.3 + sd)) * a
        - turn * b * b * L * 0.35 + Math.sin(cyc * 0.5 + u * 2) * r * 0.03 * mv;
      p.w = W * K.prof(LIZ, u);
    }
    // legs
    const hipP = K.at(sp, 0.52, { x: 0, y: 0, w: 0 }), shP = K.at(sp, 0.78, { x: 0, y: 0, w: 0 });
    const hipX = hipP.x, hipY = hipP.y, hipW = hipP.w, shX = shP.x, shY = shP.y, shW = shP.w;
    const lw = Math.max(1.2, r * 0.17);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const legPh = [0, PI, PI, 0];                      // FL FR RL RR, diagonal pairs
    for (let k = 0; k < 4; k++) {
      const front = k < 2, s = (k & 1) ? 1 : -1;
      const bx = front ? shX : hipX, by = front ? shY : hipY, bw = front ? shW : hipW;
      const ph = cyc + legPh[k], sw = Math.sin(ph) * mv, lift = Math.max(0, Math.cos(ph)) * mv;
      const ex = bx + sw * r * 0.12 + (front ? 0.06 : -0.04) * r, ey = by + s * (bw * 0.7 + r * 0.26);
      const fx = bx + sw * r * 0.46 + (front ? 0.1 : -0.1) * r, fy = by + s * (bw * 0.7 + r * 0.5 + lift * r * 0.06);
      ctx.strokeStyle = P.bodyLo; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(bx, by + s * bw * 0.45); ctx.lineTo(ex, ey); ctx.lineTo(fx, fy); ctx.stroke();
      ctx.lineWidth = Math.max(0.7, lw * 0.32);
      ctx.beginPath();
      for (let j = 0; j < 4; j++) {                 // toes fan out forward and away from the body
        const a = s * PI * 0.36 + (j - 1.5) * 0.4;
        ctx.moveTo(fx, fy); ctx.lineTo(fx + Math.cos(a) * lw * 1.7, fy + Math.sin(a) * lw * 1.7);
      }
      ctx.stroke();
    }

    // body
    const cx = lerp(-L, headX, 0.5);
    tube(ctx, sp, 1, 0, 1, 0.9);
    ctx.fillStyle = P.body; ctx.fill();
    const tp = K.at(sp, 0.64, { x: 0, y: 0, w: 0 });         // tail color fades in behind the hips
    const g = ctx.createLinearGradient(sp[0].x, 0, tp.x, 0);
    g.addColorStop(0, P.accentLo); g.addColorStop(0.18, P.accent); g.addColorStop(0.78, P.accent);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = look.pal.accent === look.pal.body && !e.pal ? 'rgba(0,0,0,0)' : g;
    ctx.globalAlpha = 1; ctx.fill();
    K.shade(ctx, cx, 0, W, 1);
    tube(ctx, sp, 1, 0, 1, 0.9); K.rim(ctx, P.dark, Math.max(1, r * 0.045));
    ctx.save(); tube(ctx, sp, 1, 0, 1, 0.9); ctx.clip();
    ctx.lineCap = 'round'; ctx.strokeStyle = P.belly; ctx.globalAlpha = 0.9;     // cream stripes
    const offs = look.stripes === undefined ? [0, -0.62, 0.62] : look.stripes;
    for (let k = 0; k < offs.length; k++) {
      ctx.lineWidth = Math.max(0.8, W * (offs[k] === 0 ? 0.13 : 0.1));
      trace(ctx, sp, offs[k], 6, N - 2); ctx.stroke();
    }
    ctx.globalAlpha = 0.5; ctx.strokeStyle = P.dark; ctx.lineWidth = Math.max(0.8, W * 0.18);
    trace(ctx, sp, 0.34, 6, N - 2); ctx.stroke(); trace(ctx, sp, -0.34, 6, N - 2); ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
    // glossy sheen along the back, toward the light
    ctx.save(); ctx.translate(S.lx * W * 0.28, S.ly * W * 0.28);
    tube(ctx, K.sub(sp, 5, N - 3), 0.16, 0, 1, 1); ctx.fillStyle = 'rgba(255,255,255,.32)'; ctx.fill();
    ctx.restore();

    // head: tongue, mouth, eyes
    const h = K.at(sp, 0.93, { x: 0, y: 0, w: 0 });
    ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(h.a); K.frame((e.angle || 0) + h.a);
    const hw = h.w;
    const tongue = Math.max(o.bite, pulse(e, t, 3.6, 0.35, 21) * (o.alert ? 1 : 0.7));
    if (tongue > 0.03) {
      ctx.strokeStyle = '#d94467'; ctx.lineWidth = Math.max(0.8, r * 0.05); ctx.lineCap = 'round';
      const x0 = hw * 1.25, x1 = x0 + r * 0.7 * tongue;
      ctx.beginPath(); ctx.moveTo(x0 - hw * 0.3, 0); ctx.lineTo(x1, 0);
      ctx.moveTo(x1, 0); ctx.lineTo(x1 + r * 0.14, -r * 0.1 * tongue); ctx.moveTo(x1, 0); ctx.lineTo(x1 + r * 0.14, r * 0.1 * tongue); ctx.stroke();
    }
    if (o.bite > 0.05) { ctx.fillStyle = '#5b1320'; oval(ctx, hw * 1.0, 0, hw * 0.45, hw * 0.4 * o.bite + 0.5, 0); ctx.fill(); }
    ctx.fillStyle = P.dark; circ(ctx, hw * 1.25, -hw * 0.18, Math.max(0.5, hw * 0.06)); ctx.fill();
    circ(ctx, hw * 1.25, hw * 0.18, Math.max(0.5, hw * 0.06)); ctx.fill();
    const er = hw * 0.5;
    K.eye(ctx, -hw * 0.05, -hw * 0.78, er, look.pupil); K.eye(ctx, -hw * 0.05, hw * 0.78, er, look.pupil);
    ctx.restore();
    K.end(ctx);
  };

  /* ====================================================================
     SERPENT (world space): smooth body following e.rs.trail, tapered tail,
              tongue flicks, back pattern, S-coil on windup
     look: len wid segs collar bars
     ==================================================================== */
  const SNAKE = [[0, 0.64], [0.07, 0.72], [0.22, 0.94], [0.45, 1], [0.7, 0.78], [0.88, 0.42], [1, 0.07]];

  // Follow-the-leader chain from the head position; reset when the entity jumps
  function updateTrail(e, N, seg, r) {
    const rs = e.rs || (e.rs = {});
    let tr = rs.trail;
    const reset = !tr || tr.length !== N || Math.hypot(e.x - tr[0].x, e.y - tr[0].y) > r * 5;
    if (reset) {
      tr = rs.trail = [];
      const a = e.angle || 0, c = Math.cos(a), s = Math.sin(a);
      for (let i = 0; i < N; i++) tr.push({ x: e.x - c * seg * i, y: e.y - s * seg * i });
      return tr;
    }
    tr[0].x = e.x; tr[0].y = e.y;
    for (let i = 1; i < N; i++) {
      const p = tr[i - 1], q = tr[i];
      const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1, k = seg / d;
      q.x = p.x + dx * k; q.y = p.y + dy * k;
    }
    return tr;
  }

  A.Shapes.serpent = function (ctx, e, t, look) {
    const r = e.r || 12, L = look.len * r, W = look.wid * r;
    const N = look.segs || 17, seg = L * 1.9 / (N - 1);
    const tr = updateTrail(e, N, seg, r);
    const o = K.begin(ctx, e, t, look, true), P = o.pal;
    const turn = K.turn(e, t);
    const coil = ease(o.crouch) * (1 - o.stretch);
    const lunge = o.stretch;
    const mv = o.move, ph = (e.phase || 0) * 1.6 + rnd(e, 2) * TAU;
    // render spine rear -> front, with lateral slither / coil waves
    const sp = K.pts(e, 'sp', N);
    const wl = lerp(0.55, 0.8, coil);
    for (let j = 0; j < N; j++) {
      const i = N - 1 - j, u = i / (N - 1), c = tr[i];
      const a = tr[Math.max(0, i - 1)], b = tr[Math.min(N - 1, i + 1)];
      let dx = a.x - b.x, dy = a.y - b.y; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      const env = Math.sin(clamp(u * 1.15 + 0.08, 0, 1) * PI * 0.9) * 0.9 + 0.1;
      const idle = Math.sin(t * 1.2 + rnd(e, 3) * TAU - i * 0.5) * 0.12;
      const amp = W * env * ((0.2 + 1.0 * mv) * (1 - 0.7 * lunge) + 2.3 * coil + idle + (o.alert ? 0.25 : 0));
      const off = Math.sin(ph * (mv > 0.05 ? 1 : 0) + i * wl) * amp - turn * W * 0.8 * u * u * 2;
      const p = sp[j];
      p.x = c.x - dy * off; p.y = c.y + dx * off;
      p.w = W * K.prof(SNAKE, u) * (1 + 0.12 * coil);
    }
    // own soft shadow along the body
    ctx.save(); ctx.translate(r * 0.1, r * 0.16);
    tube(ctx, sp, 1.12, 0, 1, 1); ctx.fillStyle = 'rgba(8,14,6,.2)'; ctx.fill(); ctx.restore();

    K.frame(0);
    ctx.save();
    tube(ctx, sp, 1, 0, 1, 1);
    K.rim(ctx, P.dark, Math.max(1.5, r * 0.07));
    ctx.fillStyle = P.belly; ctx.fill();
    ctx.clip();
    tube(ctx, sp, 0.78, 0, 0, 1); ctx.fillStyle = P.body; ctx.fill();   // belly-colored sides, olive back
    // flank bars and vertebral scales
    ctx.fillStyle = P.dark; ctx.globalAlpha = 0.65;
    for (let j = 1; j < N - 3; j += 2) {
      const q = sp[j], g = sp[j + 1];
      const tx = g.x - q.x, ty = g.y - q.y, d = Math.hypot(tx, ty) || 1, nx = -ty / d, ny = tx / d;
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        oval(ctx, q.x + nx * q.w * 0.66 * sgn, q.y + ny * q.w * 0.66 * sgn, seg * 0.26, q.w * 0.2, Math.atan2(ny, nx)); ctx.fill();
      }
    }
    ctx.globalAlpha = 0.28; ctx.fillStyle = P.bodyHi;
    for (let j = 0; j < N - 1; j++) {
      const q = sp[j], g = sp[j + 1], d = Math.hypot(g.x - q.x, g.y - q.y) || 1, ang = Math.atan2(g.y - q.y, g.x - q.x);
      oval(ctx, (q.x + g.x) / 2, (q.y + g.y) / 2, d * 0.42, q.w * 0.3, ang); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // yellow collar then black band, just behind the head
    const cj = N - 3;
    for (let k = 0; k < 2; k++) {
      const q = sp[cj - k * 1], g = sp[cj - k * 1 + 1];
      const ang = Math.atan2(g.y - q.y, g.x - q.x);
      ctx.fillStyle = k === 0 ? P.accent : P.dark;
      oval(ctx, q.x, q.y, seg * (k === 0 ? 0.62 : 0.5), q.w * 1.3, ang); ctx.fill();
    }
    ctx.restore();
    // volume: dark crescent on the side away from the light, soft highlight on the lit side
    ctx.save();
    tube(ctx, sp, 1, 0, 1, 1); ctx.clip();
    tube(ctx, sp, 1.04, 0, 1, 1);
    ctx.save(); ctx.translate(S.lx * W * 0.42, S.ly * W * 0.42);
    tube(ctx, sp, 1.04, 0, 1, 1, true);            // second sub-path shifted toward the light
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fill('evenodd');
    ctx.translate(S.lx * W * 0.32, S.ly * W * 0.32);
    tube(ctx, sp, 0.22, 0, 1, 1); ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fill();
    ctx.restore();

    // head
    const hd = e.angle || 0;
    const rise = 1 + 0.2 * coil + 0.1 * lunge;
    ctx.save();
    ctx.translate(e.x + Math.cos(hd) * W * 0.55 * (1 + o.bite * 0.3 + lunge * 0.4), e.y + Math.sin(hd) * W * 0.55 * (1 + o.bite * 0.3 + lunge * 0.4));
    ctx.rotate(hd);
    ctx.scale(rise, rise);
    K.frame(hd);
    const hw = W * 1.05;
    const hp = K.pts(e, 'head', 4);
    const hx = [-W * 1.0, W * 0.1, W * 1.0, W * 1.9], hwd = [W * 0.6, hw, hw * 0.82, hw * 0.46];
    for (let i = 0; i < 4; i++) { hp[i].x = hx[i]; hp[i].y = 0; hp[i].w = hwd[i]; }
    const tongue = pulse(e, t, o.alert ? 1.6 : 3.2, 0.5, 22);
    if (tongue > 0.03) {
      const tl = W * 1.6 * tongue, tx = W * 1.9;
      ctx.strokeStyle = '#e0364f'; ctx.lineWidth = Math.max(0.9, W * 0.1); ctx.lineCap = 'round';
      const wob = Math.sin(t * 60) * 0.2;
      ctx.beginPath(); ctx.moveTo(tx, 0); ctx.lineTo(tx + tl * 0.7, 0);
      ctx.moveTo(tx + tl * 0.7, 0); ctx.lineTo(tx + tl, -tl * (0.28 + wob));
      ctx.moveTo(tx + tl * 0.7, 0); ctx.lineTo(tx + tl, tl * (0.28 - wob)); ctx.stroke();
    }
    tube(ctx, hp, 1, 0, 1, 1); K.fillShaded(ctx, P.body, W * 0.6, 0, hw, 1);
    K.rim(ctx, P.dark, Math.max(1.5, r * 0.07));
    K.gloss(ctx, W * 1.0 + S.lx * hw * 0.2, S.ly * hw * 0.45, W * 0.6, hw * 0.1, 0, 1);
    const open = Math.max(o.bite, o.crouch * 0.5 + lunge * 0.8);
    if (open > 0.05) {
      ctx.fillStyle = '#5b1320'; oval(ctx, W * 1.65, 0, W * 0.4 * open + W * 0.1, hw * 0.52 * open, 0); ctx.fill();
      ctx.fillStyle = '#fff';
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        ctx.beginPath(); ctx.moveTo(W * 1.85, sgn * hw * 0.3 * open); ctx.lineTo(W * 1.65, sgn * hw * 0.5 * open);
        ctx.lineTo(W * 1.55, sgn * hw * 0.25 * open); ctx.closePath(); ctx.fill();
      }
    }
    ctx.fillStyle = P.dark;
    circ(ctx, W * 1.62, -hw * 0.18, Math.max(0.5, W * 0.06)); ctx.fill(); circ(ctx, W * 1.62, hw * 0.18, Math.max(0.5, W * 0.06)); ctx.fill();
    K.eye(ctx, W * 0.85, -hw * 0.66, W * 0.38, look.pupil); K.eye(ctx, W * 0.85, hw * 0.66, W * 0.38, look.pupil);
    ctx.restore();
    K.end(ctx);
  };
  A.Shapes.serpent.worldSpace = true;

  /* ====================================================================
     LOOKS
     ==================================================================== */
  Object.assign(A.LOOKS, {
    shrew: {
      plan: 'quadruped', habitat: 'land', len: 1.25, wid: 0.62, head: 0.68, snout: 1.6, snoutW: 0.2,
      eye: 0.3, ear: 'tiny', tail: 'thin', tailLen: 0.8, leg: 0.8, gait: 'trot', flex: 1.2, waist: 0.95,
      whiskers: true, mark: 'none',
      pal: { body: '#4c4547', belly: '#9a8f88', accent: '#e6a1a6', dark: '#1d1819', eye: '#241a14' },
    },
    weasel: {
      plan: 'quadruped', habitat: 'land', len: 1.75, wid: 0.5, head: 1.0, snout: 0.55, snoutW: 0.5, pawBelly: true,
      eye: 0.34, ear: 'round', earSize: 0.7, tail: 'thin', tailLen: 0.55, tailW: 1.4, tailTip: 'dark', leg: 0.55,
      gait: 'bound', flex: 2.4, waist: 0.82, bellySide: true, muzzle: true, whiskers: true,
      pal: { body: '#b9783d', belly: '#f4e6c6', accent: '#f6ead2', dark: '#3a2414', eye: '#2a1a10' },
    },
    frog: {
      plan: 'frog', habitat: 'land', len: 1.1, wid: 0.95, eye: 1,
      pal: { body: '#52b23c', belly: '#d8e9a0', accent: '#f2d84a', dark: '#1f6428', eye: '#f2bc2a' },
    },
    skink: {
      plan: 'lizard', habitat: 'land', len: 1.5, wid: 0.42, stripes: [0, -0.6, 0.6],
      pal: { body: '#3f3226', belly: '#f1e2b0', accent: '#2c8ee8', dark: '#18110c', eye: '#e8a02c' },
    },
    snake: {
      plan: 'serpent', habitat: 'land', len: 2.0, wid: 0.42, noShadow: true,
      pal: { body: '#76913c', belly: '#e8e3a0', accent: '#f1d23a', dark: '#1d2a14', eye: '#e6c23a' },
    },
    // M2 land path. More natural proportions than the bugs: smaller eyes, longer snouts, bigger animals get smaller eyes.
    mouse: {
      plan: 'quadruped', habitat: 'land', matte: true, len: 1.3, wid: 0.55, head: 0.78, snout: 1.0, snoutW: 0.28,
      eye: 0.3, ear: 'round', earSize: 1.35, tail: 'longthin', tailLen: 1.15, leg: 0.65, gait: 'trot', flex: 1.1,
      whiskers: true, bellySide: true,
      pal: { body: '#8c6a4a', belly: '#e9dcc6', accent: '#e6a1a6', dark: '#2a1c12', eye: '#120c08' },
    },
    vole: {
      plan: 'quadruped', habitat: 'land', matte: true, len: 1.2, wid: 0.64, head: 0.8, snout: 0.6, snoutW: 0.42,
      eye: 0.22, ear: 'tiny', tail: 'short', tailLen: 0.7, leg: 0.6, gait: 'trot', flex: 0.9, whiskers: true,
      pal: { body: '#6b5642', belly: '#ab9984', accent: '#d9a0a0', dark: '#231a12', eye: '#100b08' },
    },
    rabbit: {
      plan: 'quadruped', habitat: 'land', matte: true, len: 1.3, wid: 0.74, head: 0.78, snout: 0.55, snoutW: 0.45,
      eye: 0.28, ear: 'long', earSize: 1.15, tail: 'stub', tailLen: 1.1, tailTip: 'light', leg: 0.9, gait: 'bound',
      whiskers: true, bellySide: true,
      pal: { body: '#8e7658', belly: '#efe6d6', accent: '#e8b0b0', dark: '#2a2016', eye: '#1a120a' },
    },
    hare: {
      plan: 'quadruped', habitat: 'land', matte: true, len: 1.45, wid: 0.66, head: 0.76, snout: 0.6, snoutW: 0.42,
      eye: 0.26, ear: 'long', earSize: 1.35, tail: 'stub', tailTip: 'light', leg: 1.1, gait: 'bound',
      whiskers: true, bellySide: true,
      pal: { body: '#cfc6b6', belly: '#f7f4ee', accent: '#e4b4ae', dark: '#3a3028', eye: '#1c140c' },
    },
    squirrel: {
      plan: 'quadruped', habitat: 'land', matte: true, len: 1.2, wid: 0.55, head: 0.82, snout: 0.5, snoutW: 0.4,
      eye: 0.3, ear: 'tufted', earSize: 0.8, tail: 'bushy', tailLen: 1.25, tailW: 1.05, leg: 0.75, gait: 'bound',
      whiskers: true, bellySide: true,
      pal: { body: '#b4552a', belly: '#f2e6d0', accent: '#e9b08a', dark: '#3a1a0c', eye: '#120a06' },
    },
    fox: {
      plan: 'quadruped', habitat: 'land', matte: true, len: 1.6, wid: 0.55, head: 0.9, snout: 1.1, snoutW: 0.3,
      eye: 0.24, pupil: 'hslit', ear: 'pointy', earSize: 1.2, tail: 'bushy', tailLen: 1.0, tailTip: 'light',
      leg: 0.9, gait: 'trot', muzzle: true, bellySide: true, darkLegs: true, whiskers: true,
      pal: { body: '#cf6420', belly: '#f4ead8', accent: '#f6efe2', dark: '#2a1810', eye: '#d79a2a' },
    },
    lynx: {
      plan: 'quadruped', habitat: 'land', matte: true, len: 1.45, wid: 0.7, head: 0.95, snout: 0.42, snoutW: 0.5,
      eye: 0.24, pupil: 'hslit', ear: 'tufted', earSize: 1.0, tail: 'stub', tailTip: 'dark', leg: 1.15, gait: 'walk',
      mark: 'ruff', muzzle: true, whiskers: true,
      pal: { body: '#a8937a', belly: '#ebe2d2', accent: '#efe6d6', dark: '#2b2218', eye: '#c9a43a' },
    },
    wolverine: {
      plan: 'quadruped', habitat: 'land', matte: true, len: 1.5, wid: 0.72, head: 0.9, snout: 0.6, snoutW: 0.48,
      eye: 0.2, ear: 'round', earSize: 0.6, tail: 'bushy', tailLen: 0.5, leg: 0.7, gait: 'bound', flex: 1.4,
      mark: 'saddle', darkLegs: true,
      pal: { body: '#5a4230', belly: '#c79f68', accent: '#d8b47c', dark: '#1a120c', eye: '#140e0a' },
    },
    wolf: {
      plan: 'quadruped', habitat: 'land', matte: true, len: 1.75, wid: 0.6, head: 0.95, snout: 1.0, snoutW: 0.36,
      eye: 0.2, ear: 'pointy', earSize: 0.95, tail: 'bushy', tailLen: 0.8, tailTip: 'dark', leg: 1.0, gait: 'trot',
      mark: 'saddle', muzzle: true, bellySide: true,
      pal: { body: '#8e867a', belly: '#e0d8c9', accent: '#efe9dd', dark: '#2a2622', eye: '#c9a23a' },
    },
    bear: {
      plan: 'quadruped', habitat: 'land', matte: true, len: 1.8, wid: 0.88, head: 0.7, snout: 1.05, snoutW: 0.42,
      eye: 0.14, ear: 'round', earSize: 0.5, tail: 'stub', tailLen: 0.5, leg: 1.05, gait: 'walk', flex: 0.5, waist: 0.95,
      muzzle: true, darkLegs: true,
      pal: { body: '#7a5232', belly: '#b08458', accent: '#c49a6a', dark: '#2a1a10', eye: '#1a120c' },
    },
    boar: {
      plan: 'quadruped', habitat: 'land', matte: true, len: 1.45, wid: 0.8, head: 0.82, snout: 0.85, snoutW: 0.5,
      eye: 0.16, ear: 'pointy', earSize: 0.6, tail: 'thin', tailLen: 0.35, leg: 0.6, gait: 'trot', flex: 0.7,
      darkLegs: true, mark: 'ruff',
      pal: { body: '#4f4033', belly: '#7a6656', accent: '#efe4cc', dark: '#1d1612', eye: '#140e0a' },
    },
    deer: {
      plan: 'quadruped', habitat: 'land', matte: true, len: 1.6, wid: 0.55, head: 0.75, snout: 0.9, snoutW: 0.4,
      eye: 0.24, ear: 'long', earSize: 0.85, tail: 'short', tailLen: 0.8, tailTip: 'dark', leg: 1.3, gait: 'trot',
      muzzle: true, bellySide: true,
      pal: { body: '#9c7c58', belly: '#ece0ca', accent: '#efe4d0', dark: '#2a2016', eye: '#120c08' },
    },
    elk: {
      plan: 'quadruped', habitat: 'land', matte: true, len: 1.75, wid: 0.62, head: 0.8, snout: 1.0, snoutW: 0.44,
      eye: 0.18, ear: 'pointy', earSize: 0.8, horns: 'antlers', hornSize: 1.35, tail: 'stub', leg: 1.3, gait: 'trot',
      mark: 'ruff', muzzle: true,
      pal: { body: '#a67e50', belly: '#dcc59e', accent: '#e8d8b8', dark: '#3b2818', eye: '#120c08' },
    },
  });
})();
