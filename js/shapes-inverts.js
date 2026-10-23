// Invertebrate and plant body plans: insect, arachnid, isopod, segmented, plant.
// All plans draw in "r units" (ctx scaled by e.r) so look params are plain proportions.
(function () {
  'use strict';
  const A = window.Apex = window.Apex || {};
  const Shapes = A.Shapes = A.Shapes || {};
  const LOOKS = A.LOOKS = A.LOOKS || {};
  const TAU = Math.PI * 2;
  const PI = Math.PI;

  // ---------------------------------------------------------------- utils
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function idNum(id) {
    if (typeof id === 'number') return id | 0;
    let h = 0;
    const s = String(id);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }

  // Stable per-entity random in [0,1): same id and k always give the same value.
  function rnd(id, k) {
    let h = (idNum(id) * 374761393 + (k + 1) * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // ---------------------------------------------------------------- per-draw view state
  // One creature is drawn at a time, so plans share this scratch state instead of passing it around.
  const V = {
    e: null, t: 0, id: 0, look: null, fl: 0, lx: -0.6, ly: -0.8, rot: 0,
    P: { body: '#888', belly: '#ccc', accent: '#fff', dark: '#222', eye: '#fe8' },
  };
  const LXW = -0.6, LYW = -0.8; // light comes from the upper left of the screen
  const DEFPAL = { body: '#8a8a8a', belly: '#c8c8c8', accent: '#eeeeee', dark: '#222222', eye: '#ffe27a' };

  // ---------------------------------------------------------------- colors
  const LIGHT = [255, 248, 232];
  const SHADE = [22, 12, 38];
  const parseCache = new Map();
  const toneCache = new Map();
  const mixCache = new Map();

  function parse(hex) {
    let c = parseCache.get(hex);
    if (c) return c;
    let h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16) || 0;
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    parseCache.set(hex, c);
    return c;
  }

  // Tone a hex color: k>0 lightens, k<0 darkens (toward a deep violet), with the hurt flash folded in.
  // k is rounded to 0.01, alpha to 0.01. Results are cached per hex so hot paths build no strings.
  function C(hex, k, a) {
    const kk = Math.round((k || 0) * 100), aa = a === undefined || a >= 1 ? 100 : Math.round(a * 100);
    const fi = Math.round(V.fl * 6);
    const key = ((kk + 200) * 128 + aa) * 8 + fi;
    let m = toneCache.get(hex);
    if (!m) { m = new Map(); toneCache.set(hex, m); }
    let s = m.get(key);
    if (s) return s;
    const c = parse(hex);
    let r = c[0], g = c[1], b = c[2];
    if (kk > 0) { const q = kk / 100; r += (LIGHT[0] - r) * q; g += (LIGHT[1] - g) * q; b += (LIGHT[2] - b) * q; }
    else if (kk < 0) { const q = -kk / 100; r += (SHADE[0] - r) * q; g += (SHADE[1] - g) * q; b += (SHADE[2] - b) * q; }
    if (fi > 0) { const q = fi / 6; r += (255 - r) * q; g += (255 - g) * q; b += (255 - b) * q; }
    s = aa === 100
      ? 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')'
      : 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + aa / 100 + ')';
    if (m.size > 600) m.clear();
    m.set(key, s);
    return s;
  }

  function mixHex(a, b, k) {
    const key = a + b + k;
    let s = mixCache.get(key);
    if (s) return s;
    const p = parse(a), q = parse(b);
    const m = (i) => ('0' + Math.round(p[i] + (q[i] - p[i]) * k).toString(16)).slice(-2);
    s = '#' + m(0) + m(1) + m(2);
    if (mixCache.size > 2000) mixCache.clear();
    mixCache.set(key, s);
    return s;
  }

  function resolvePalette(e, look) {
    const P = V.P, lp = look.pal || DEFPAL, ep = e.pal;
    P.dark = lp.dark; P.eye = lp.eye;
    if (ep && ep.body) {
      P.body = ep.body;
      P.belly = mixHex(ep.body, '#ffffff', 0.35);
    } else {
      // tiny stable tone drift so a crowd of the same species is not identical
      const q = Math.floor(rnd(e.id, 7) * 3) - 1;
      P.body = q ? mixHex(lp.body, q > 0 ? '#ffffff' : '#000000', 0.07) : lp.body;
      P.belly = lp.belly || P.body;
    }
    P.accent = (ep && ep.accent) || lp.accent;
    if (e.sick) {
      P.body = mixHex(P.body, '#8fd14a', 0.42);
      P.belly = mixHex(P.belly, '#c4ec7a', 0.35);
      P.accent = mixHex(P.accent, '#b5e05a', 0.3);
    }
  }

  // ---------------------------------------------------------------- frame setup
  function setLight(rot) {
    const c = Math.cos(rot), s = Math.sin(rot);
    V.lx = LXW * c + LYW * s;
    V.ly = -LXW * s + LYW * c;
    V.rot = rot;
  }

  // Idle breathing plus squash and stretch from bite, windup, lunge and hop.
  function squash(ctx, e, t, look, r) {
    const st = e.state, sT = e.stateT || 0;
    const rest = st === 'rest' ? 1.7 : 1;
    const br = Math.sin(t * 2.3 + rnd(V.id, 4) * TAU);
    let sx = 1 + 0.012 * br * rest, sy = 1 + 0.03 * br * rest, dx = 0, dy = 0;
    const bp = e.biteT > 0 ? Math.sin(clamp(e.biteT / 0.25, 0, 1) * PI) : 0;
    sx += 0.12 * bp; sy -= 0.09 * bp; dx += 0.08 * bp;
    if (st === 'windup') {
      const k = clamp(sT / 0.3, 0, 1);
      sx -= 0.1 * k; sy += 0.12 * k; dx -= 0.12 * k;
      dy = Math.sin(t * 70) * 0.03 * k;
    } else if (st === 'lunge') {
      sx += 0.15; sy -= 0.1; dx += 0.06;
    } else if (st === 'hop') {
      const s = Math.sin(clamp(sT / 0.5, 0, 1) * PI);
      sx += 0.2 * s; sy -= 0.14 * s;
    }
    ctx.translate(dx * Math.min(look.len || 1, 1.3) * r, dy * r);
    ctx.scale(sx, sy);
  }

  const NONE = {};
  // Begin a plan: save, rotate extra, squash, scale to r units. Always pair with close().
  function open(ctx, e, t, look, o) {
    o = o || NONE;
    V.e = e; V.t = t; V.look = look; V.id = e.id;
    V.fl = e.hurtT > 0 ? Math.round(Math.min(0.9, e.hurtT * 12) * 6) / 6 : 0;
    resolvePalette(e, look);
    ctx.save();
    if (o.world) { setLight(0); return; }
    setLight((e.angle || 0) + (o.rot || 0));
    if (o.rot) ctx.rotate(o.rot);
    const r = e.r || 10;
    if (!o.still) squash(ctx, e, t, look, r);
    ctx.scale(r, r);
  }
  function close(ctx) { ctx.restore(); }

  // World-space plans draw the head in a local frame; headOpen/headClose bracket that.
  function headOpen(ctx, e, t, look) {
    const r = e.r || 10;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle || 0);
    setLight(e.angle || 0);
    squash(ctx, e, t, look, r);
    ctx.scale(r, r);
  }
  function headClose(ctx) { ctx.restore(); setLight(0); }

  // ---------------------------------------------------------------- primitives (r units)
  function disc(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }

  // Glossy highlight pulled toward the light.
  function shine(ctx, x, y, rx, ry, rot, a) {
    let lx = V.lx, ly = V.ly, cx = x, cy = y;
    if (rot) {
      const c = Math.cos(rot), s = Math.sin(rot);
      lx = V.lx * c + V.ly * s; ly = -V.lx * s + V.ly * c;
      const ox = lx * rx * 0.34, oy = ly * ry * 0.52;
      cx += ox * c - oy * s; cy += ox * s + oy * c;
    } else {
      cx += lx * rx * 0.34; cy += ly * ry * 0.52;
    }
    const ga = ctx.globalAlpha;
    ctx.globalAlpha = ga * a;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.34, ry * 0.2, rot || 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = ga;
  }

  // Unit-circle radial gradient lit from (lx,ly). Cached: it lives in unit space, so size does not matter.
  const gradCache = new Map();
  function litGrad(ctx, hex, tone, lx, ly) {
    const qa = Math.round(Math.atan2(ly, lx) * 7.64); // 48 light steps
    const key = hex + '|' + Math.round(tone * 100) + '|' + Math.round(V.fl * 6) + '|' + qa;
    let g = gradCache.get(key);
    if (g) return g;
    const a = qa / 7.64;
    g = ctx.createRadialGradient(Math.cos(a) * 0.4, Math.sin(a) * 0.4, 0, 0, 0, 1.1);
    g.addColorStop(0, C(hex, tone + 0.34));
    g.addColorStop(0.5, C(hex, tone));
    g.addColorStop(1, C(hex, tone - 0.42));
    if (gradCache.size > 3000) gradCache.clear();
    gradCache.set(key, g);
    return g;
  }

  // Shaded ellipse lit from the upper left, optional gloss.
  function blob(ctx, x, y, rx, ry, hex, rot, tone, gloss) {
    ctx.save();
    ctx.translate(x, y);
    let lx = V.lx, ly = V.ly;
    if (rot) {
      ctx.rotate(rot);
      const c = Math.cos(rot), s = Math.sin(rot);
      lx = V.lx * c + V.ly * s; ly = -V.lx * s + V.ly * c;
    }
    ctx.scale(rx, ry);
    ctx.fillStyle = litGrad(ctx, hex, tone || 0, lx, ly);
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
    if (gloss) shine(ctx, x, y, rx, ry, rot, gloss);
  }

  // Tapered curved horn from (x0,y0) to a point; used for mandibles, fangs, claws.
  function horn(ctx, x0, y0, x1, y1, w, cv) {
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1e-4;
    const nx = -dy / d, ny = dx / d;
    const mx = (x0 + x1) / 2 + nx * cv * d, my = (y0 + y1) / 2 + ny * cv * d;
    ctx.beginPath();
    ctx.moveTo(x0 + nx * w, y0 + ny * w);
    ctx.quadraticCurveTo(mx + nx * w * 0.45, my + ny * w * 0.45, x1, y1);
    ctx.quadraticCurveTo(mx - nx * w * 0.45, my - ny * w * 0.45, x0 - nx * w, y0 - ny * w);
    ctx.closePath();
    ctx.fill();
  }

  // Two-bone leg appended to the current path. bend picks which side the knee pops out to.
  const KN = { kx: 0, ky: 0, fx: 0, fy: 0 };
  function legPath(ctx, hx, hy, fx, fy, l1, l2, bend) {
    let dx = fx - hx, dy = fy - hy;
    let d = Math.hypot(dx, dy) || 1e-4;
    const maxd = l1 + l2 - 0.001;
    if (d > maxd) { fx = hx + dx * maxd / d; fy = hy + dy * maxd / d; dx = fx - hx; dy = fy - hy; d = maxd; }
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const kx = hx + dx * a / d - dy / d * h * bend;
    const ky = hy + dy * a / d + dx / d * h * bend;
    ctx.moveTo(hx, hy);
    ctx.lineTo(kx, ky);
    ctx.lineTo(fx, fy);
  }

  // Limb color: body tone pulled toward the dark tone, so legs read against soil.
  function legColor() { return C(mixHex(V.P.body, V.P.dark, 0.4), 0.05); }

  // ---------------------------------------------------------------- eyes
  const GZ = { x: 0, y: 0 };
  // Unit-ish gaze vector in the current local frame: toward e.target, else a lazy idle look.
  function gaze() {
    const e = V.e, tg = e.target;
    if (tg && typeof tg === 'object' && tg.x !== undefined && tg.alive !== false) {
      const dx = tg.x - e.x, dy = tg.y - e.y, d = Math.hypot(dx, dy) || 1;
      const c = Math.cos(V.rot), s = Math.sin(V.rot);
      GZ.x = (dx * c + dy * s) / d; GZ.y = (-dx * s + dy * c) / d;
    } else {
      const w = V.t * 0.6 + rnd(V.id, 6) * TAU;
      GZ.x = 0.45 + 0.35 * Math.sin(w); GZ.y = 0.5 * Math.sin(w * 1.7 + 2);
    }
  }

  // 1 = open, small = closed. Blink timing is stable per entity id.
  function blinkK() {
    const per = 3 + 3.5 * rnd(V.id, 1);
    const u = (V.t + rnd(V.id, 2) * per) % per;
    let k = u > 0.16 ? 1 : 0.12 + 0.88 * Math.abs(Math.cos(u / 0.16 * PI));
    if (V.e.state === 'rest') k *= 0.6;
    return k;
  }

  // Big glossy eye. style: 'iris' (default), 'bead' (black bead) or 'compound' (insect dome).
  function eye(ctx, x, y, R, style) {
    const P = V.P, e = V.e, bk = blinkK(), red = !!e.desperate;
    if (red) { ctx.fillStyle = 'rgba(255,50,40,0.32)'; disc(ctx, x, y, R * 1.75); }
    gaze();
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, bk);
    ctx.fillStyle = C(P.dark, 0);
    disc(ctx, 0, 0, R * 1.12);
    const iris = red ? '#ff4a3a' : P.eye;
    if (style === 'bead') {
      ctx.fillStyle = C('#15161e', 0);
      disc(ctx, 0, 0, R);
      if (red) { ctx.fillStyle = C(iris, 0, 0.6); disc(ctx, 0, 0, R * 0.8); }
    } else if (style === 'compound') {
      ctx.fillStyle = C(iris, -0.25); disc(ctx, 0, 0, R);
      ctx.fillStyle = C(iris, 0.3, 0.75); disc(ctx, V.lx * R * 0.2, V.ly * R * 0.2, R * 0.72);
      ctx.fillStyle = C('#1a0a10', 0, 0.8); disc(ctx, GZ.x * R * 0.3, GZ.y * R * 0.3, R * 0.34);
    } else {
      ctx.fillStyle = C(iris, 0); disc(ctx, 0, 0, R * 0.98);
      ctx.fillStyle = C(iris, 0.4, 0.55); disc(ctx, -V.lx * R * 0.22, -V.ly * R * 0.22, R * 0.6);
      ctx.fillStyle = C('#0b0b12', 0); disc(ctx, GZ.x * R * 0.3, GZ.y * R * 0.3, R * 0.54);
    }
    if (bk > 0.3) {
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      disc(ctx, V.lx * R * 0.4, V.ly * R * 0.4, R * 0.3);
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      disc(ctx, -V.lx * R * 0.34, -V.ly * R * 0.34, R * 0.13);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- shared animation bits
  function biteOpen(e) { return e.biteT > 0 ? Math.sin(clamp(e.biteT / 0.25, 0, 1) * PI) : 0; }

  // How open jaws are: snap on bite, wide when threatening, chewing while grazing, idle twitch otherwise.
  function jawOpen(e, t) {
    let o = 0.16 + 0.08 * Math.sin(t * 3 + rnd(V.id, 8) * TAU);
    const st = e.state;
    if (st === 'windup' || st === 'lunge') o = 0.8;
    else if (st === 'graze') o = 0.2 + 0.35 * Math.abs(Math.sin(t * 9));
    return Math.max(o, biteOpen(e));
  }

  // 0..1 bump over a hop; 0 when not hopping.
  function hopS(e) { return e.state === 'hop' ? Math.sin(clamp((e.stateT || 0) / 0.5, 0, 1) * PI) : 0; }

  // ================================================================= INSECT
  const LEG_REST = [[0.6, 0.72], [0.02, 0.95], [-0.72, 0.82]];
  const LEG_BEND = [-1, -1, 1];

  function insectLayout(look) {
    if (look._k) return look._k;
    const L = look.len, W = look.wid, sg = look.seg, sw = look.segW, tot = 2 * L, ov = 1.14;
    const hl = sg[0] * tot, tl = sg[1] * tot, al = sg[2] * tot;
    return (look._k = {
      ax: -L + al / 2, arx: al / 2 * ov, ary: sw[2] * W,
      tx: -L + al + tl / 2, trx: tl / 2 * ov, ty: sw[1] * W,
      hx: L - hl / 2, hrx: hl / 2 * ov, hry: sw[0] * W,
    });
  }

  function insectLegs(ctx, K, look, ph) {
    const ll = look.legLen, step = look.step, n = look.hind ? 2 : 3;
    ctx.strokeStyle = legColor();
    ctx.lineWidth = look.legW || 0.1;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let j = 0; j < n; j++) {
      for (let s = -1; s <= 1; s += 2) {
        const hx = K.tx + K.trx * (0.55 - 0.55 * j), hy = s * K.ty * 0.55;
        const a = ph + (((j + (s > 0 ? 1 : 0)) & 1) * PI); // tripod gait
        const sw = Math.sin(a), lift = Math.max(0, Math.cos(a));
        const fx = hx + LEG_REST[j][0] * ll + sw * step * (j === 1 ? 0.7 : 1);
        const fy = hy + s * (LEG_REST[j][1] * ll - lift * 0.12 * ll);
        legPath(ctx, hx, hy, fx, fy, ll * 0.58, ll * 0.6, s * LEG_BEND[j]);
      }
    }
    ctx.stroke();
  }

  // Big folded jumping legs (cricket, grasshopper); unfold during a hop.
  function hindLegs(ctx, K, look, ext) {
    const hl = look.hind, P = V.P;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let s = -1; s <= 1; s += 2) {
      const hx = K.tx - K.trx * 0.45, hy = s * K.ty * 0.7;
      const kx = hx - hl * (1.0 - 0.1 * ext), ky = s * (K.ary * 1.12 + ext * hl * 0.25);
      const fx = hx + hl * (0.15 - 2.05 * ext), fy = s * (K.ary * 1.12 + 0.24 * hl - ext * (K.ary * 0.9 + 0.1 * hl));
      ctx.strokeStyle = legColor(); ctx.lineWidth = 0.09;
      ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
      ctx.strokeStyle = C(P.dark, 0.1); ctx.lineWidth = 0.22 * hl + 0.05;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.stroke();
      ctx.strokeStyle = C(P.body, -0.05); ctx.lineWidth = 0.22 * hl;
      ctx.stroke();
      ctx.strokeStyle = C(P.body, 0.45, 0.8); ctx.lineWidth = 0.06 * hl;
      ctx.beginPath(); ctx.moveTo(hx + V.lx * 0.03, hy + V.ly * 0.03); ctx.lineTo(kx + V.lx * 0.03, ky + V.ly * 0.03); ctx.stroke();
    }
  }

  function furcula(ctx, K, look, flick) {
    const x0 = -look.len * 0.62, tuck = 1 - flick;
    ctx.strokeStyle = C(V.P.accent, -0.1);
    ctx.lineWidth = 0.075; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let s = -1; s <= 1; s += 2) {
      ctx.moveTo(x0, 0);
      ctx.lineTo(x0 + (0.55 * tuck - 0.85 * flick), s * (0.1 + 0.14 * flick));
    }
    ctx.stroke();
  }

  // One translucent wing rooted at (x,y). ang is the direction of the wing; s flips it for the left side.
  function wingShape(ctx, x, y, ang, s, len, wd, fill, edge, veins) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    if (s < 0) ctx.scale(1, -1);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(len * 0.25, -wd * 0.7, len * 0.75, -wd * 0.55, len, -wd * 0.05);
    ctx.bezierCurveTo(len * 0.92, wd * 0.7, len * 0.35, wd * 1.0, 0, wd * 0.12);
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = edge; ctx.lineWidth = 0.025; ctx.stroke();
    if (veins) {
      ctx.beginPath();
      ctx.moveTo(len * 0.02, -wd * 0.05); ctx.quadraticCurveTo(len * 0.5, -wd * 0.38, len * 0.97, -wd * 0.06);
      ctx.moveTo(len * 0.04, wd * 0.02); ctx.lineTo(len * 0.9, wd * 0.12);
      ctx.moveTo(len * 0.1, wd * 0.1); ctx.lineTo(len * 0.6, wd * 0.6);
      for (let i = 1; i <= 4; i++) {
        const x1 = len * (0.14 + i * 0.17);
        ctx.moveTo(x1, -wd * (0.42 - i * 0.07)); ctx.lineTo(x1 - len * 0.02, wd * 0.12);
      }
      ctx.lineWidth = 0.014; ctx.stroke();
      ctx.fillStyle = C(V.P.dark, 0.1, 0.85);
      ctx.fillRect(len * 0.8, -wd * 0.14, len * 0.07, wd * 0.14);
    }
    ctx.restore();
  }

  function flyWings(ctx, K, look) {
    const e = V.e, f = Math.sin(V.t * (e.state === 'flee' ? 46 : 36) + rnd(V.id, 3) * 6);
    const wl = look.wingLen, ww = look.wingW;
    const fill = C(look.wingCol, 0, 0.34), ghost = C(look.wingCol, 0, 0.2), edge = 'rgba(255,255,255,0.5)';
    for (let s = -1; s <= 1; s += 2) {
      const x = K.tx + 0.05, y = s * K.ty * 0.5;
      wingShape(ctx, x, y, PI - s * (0.4 + 0.3 * f), s, wl, ww, ghost, 'rgba(255,255,255,0)', false);
      wingShape(ctx, x, y, PI - s * (0.4 - 0.25 * f), s, wl, ww, fill, edge, true);
    }
  }

  function dragonWings(ctx, K, look) {
    const w = V.t * 15 + rnd(V.id, 3) * 6, wl = look.wingLen, ww = look.wingW;
    const fill = C(look.wingCol, 0, 0.36), edge = C(look.wingCol, -0.4, 0.7);
    for (let s = -1; s <= 1; s += 2) {
      wingShape(ctx, K.tx - K.trx * 0.35, s * K.ty * 0.5, s * (PI / 2 + 0.42 + 0.1 * Math.sin(w + PI)), s, wl * 0.94, ww * 1.15, fill, edge, true);
      wingShape(ctx, K.tx + K.trx * 0.3, s * K.ty * 0.5, s * (PI / 2 + 0.14 + 0.1 * Math.sin(w)), s, wl, ww, fill, edge, true);
    }
  }

  // Shiny elytra: two half shells that lift slightly when the beetle winds up or lunges.
  function elytra(ctx, K, look) {
    const P = V.P, e = V.e, st = e.state;
    const open = (st === 'windup' || st === 'lunge') ? 0.2 + 0.03 * Math.sin(V.t * 40) : 0;
    const rx = K.arx * 1.02, ry = K.ary, ex = K.ax + 0.02, hinge = ex + rx * 0.92;
    if (open > 0) {
      ctx.fillStyle = C(P.dark, 0.2); // dark body and a glimpse of folded wing between the shells
      ctx.beginPath(); ctx.ellipse(ex, 0, rx * 0.95, ry * 0.7, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(230,240,255,0.5)';
      ctx.beginPath(); ctx.ellipse(ex - rx * 0.1, 0, rx * 0.7, ry * 0.22, 0, 0, TAU); ctx.fill();
    }
    for (let s = -1; s <= 1; s += 2) {
      ctx.save();
      ctx.translate(hinge, 0);
      ctx.rotate(s * open);
      ctx.translate(-hinge, 0);
      const g = ctx.createLinearGradient(0, -ry, 0, ry);
      const hi = V.ly < 0 ? 0.28 : 0.72;
      g.addColorStop(0, C(P.body, -0.38)); g.addColorStop(hi, C(P.body, 0.32));
      g.addColorStop(1, C(P.body, -0.38));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(ex, 0, rx, ry, 0, s > 0 ? 0 : PI, s > 0 ? PI : TAU);
      ctx.closePath(); ctx.fill();
      if (look.stripe) {
        ctx.strokeStyle = C(P.accent, 0, 0.9); ctx.lineWidth = 0.05; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.ellipse(ex, 0, rx * 0.9, ry * 0.62, 0, s > 0 ? 0.15 : PI + 0.15, s > 0 ? PI - 0.15 : TAU - 0.15); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,' + (s * V.ly < 0 ? 0.45 : 0.18) + ')';
      ctx.beginPath(); ctx.ellipse(ex - rx * 0.12, s * ry * 0.42, rx * 0.55, ry * 0.13, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = C(P.dark, 0, 0.7); ctx.lineWidth = 0.03;
    ctx.beginPath(); ctx.moveTo(hinge, 0); ctx.lineTo(ex - rx, 0); ctx.stroke();
  }

  // Folded wing covers lying over the abdomen (cricket, grasshopper).
  function wingCovers(ctx, K, look) {
    const P = V.P, c = look.cover;
    const cx = K.ax + K.arx * c.dx, rx = K.arx * c.rx, ry = K.ary * c.ry;
    blob(ctx, cx, 0, rx, ry, c.col === 'accent' ? P.accent : P.body, 0, c.tone, 0.3);
    ctx.strokeStyle = C(P.dark, 0.1, 0.5); ctx.lineWidth = 0.025; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + rx * 0.9, 0); ctx.lineTo(cx - rx * 0.95, 0);
    for (let s = -1; s <= 1; s += 2) {
      ctx.moveTo(cx + rx * 0.7, s * ry * 0.18); ctx.lineTo(cx - rx * 0.8, s * ry * 0.5);
      ctx.moveTo(cx + rx * 0.3, s * ry * 0.5); ctx.lineTo(cx - rx * 0.6, s * ry * 0.8);
    }
    ctx.stroke();
  }

  function abdomenBands(ctx, K, look) {
    const n = look.bands, P = V.P;
    ctx.strokeStyle = C(look.bandCol === 'accent' ? P.accent : P.dark, 0.05, look.bandA || 0.55);
    ctx.lineWidth = look.bandW || 0.06;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const u = (i + 0.6) / (n + 0.2);
      const x = K.ax + K.arx * (0.85 - 1.7 * u);
      const h = K.ary * Math.sqrt(Math.max(0, 1 - Math.pow((x - K.ax) / K.arx, 2))) * 0.94;
      ctx.moveTo(x, -h); ctx.quadraticCurveTo(x - 0.06, 0, x, h);
    }
    ctx.stroke();
  }

  function antennae(ctx, K, look) {
    const n = look.antLen;
    if (!n) return;
    const e = V.e, fast = e.state === 'flee' ? 1.8 : 1;
    ctx.strokeStyle = C(mixHex(V.P.body, V.P.dark, 0.5), 0.05); ctx.lineWidth = look.antW || 0.065;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let s = -1; s <= 1; s += 2) {
      const bx = K.hx + K.hrx * 0.78, by = s * K.hry * 0.38;
      const sw = Math.sin(V.t * 2.4 * fast + rnd(V.id, 5) * 6 + s * 1.3) * 0.22;
      const a = s * (0.5 + sw);
      ctx.moveTo(bx, by);
      if (look.antStyle === 'elbow') {
        const ex = bx + Math.cos(a * 0.4) * n * 0.5, ey = by + Math.sin(a * 0.4) * n * 0.5;
        const b2 = a * 0.4 + s * (0.95 + sw * 0.6);
        ctx.lineTo(ex, ey);
        ctx.lineTo(ex + Math.cos(b2) * n * 0.55, ey + Math.sin(b2) * n * 0.55);
      } else {
        ctx.quadraticCurveTo(bx + Math.cos(a * 0.3) * n * 0.6, by + Math.sin(a * 0.3) * n * 0.6,
          bx + Math.cos(a) * n, by + Math.sin(a) * n);
      }
    }
    ctx.stroke();
    if (look.antStyle === 'club') {
      ctx.fillStyle = C(V.P.dark, 0.12);
      for (let s = -1; s <= 1; s += 2) {
        const a = s * (0.5 + Math.sin(V.t * 2.4 * fast + rnd(V.id, 5) * 6 + s * 1.3) * 0.22);
        disc(ctx, K.hx + K.hrx * 0.78 + Math.cos(a) * n, s * K.hry * 0.38 + Math.sin(a) * n, 0.07);
      }
    }
  }

  function mandibles(ctx, K, look) {
    const sz = look.mand;
    if (!sz) return;
    const o = jawOpen(V.e, V.t);
    ctx.fillStyle = C(look.mandCol === 'accent' ? V.P.accent : V.P.dark, 0.1);
    for (let s = -1; s <= 1; s += 2) {
      const bx = K.hx + K.hrx * 0.8, by = s * K.hry * 0.5;
      const a = s * (-0.5 + 1.1 * o);
      horn(ctx, bx, by, bx + Math.cos(a) * sz, by + Math.sin(a) * sz, 0.07 + sz * 0.1, s * 0.22);
    }
  }

  Shapes.insect = function (ctx, e, t, look) {
    open(ctx, e, t, look);
    const K = insectLayout(look), P = V.P;
    const ph = (e.phase || 0) * (look.gait || 3);
    const hop = hopS(e), hopStart = e.state === 'hop' && (e.stateT || 0) < 0.25 ? 1 - (e.stateT || 0) / 0.25 : 0;
    if (look.furcula) furcula(ctx, K, look, hopStart);
    insectLegs(ctx, K, look, ph);
    if (look.hind) hindLegs(ctx, K, look, hop);
    if (look.wings === 'dragon') dragonWings(ctx, K, look);

    // abdomen, thorax, head from back to front
    if (look.elytra) {
      blob(ctx, K.ax, 0, K.arx, K.ary, P.dark, 0, 0.1);
      elytra(ctx, K, look);
    } else {
      blob(ctx, K.ax, 0, K.arx, K.ary, look.soft ? P.body : P.body, 0, 0, look.soft ? 0.6 : 0.45);
      if (look.bands) abdomenBands(ctx, K, look);
      if (look.cover) wingCovers(ctx, K, look);
    }
    blob(ctx, K.tx, 0, K.trx, K.ty, look.thoraxAccent ? P.accent : P.body, 0, look.thoraxTone || 0.04, 0.4);
    if (look.elytra) {
      ctx.fillStyle = C(P.dark, 0, 0.35); // pronotum rim
      ctx.beginPath(); ctx.ellipse(K.tx - K.trx * 0.1, 0, K.trx * 0.15, K.ty * 0.8, 0, 0, TAU); ctx.fill();
    }
    blob(ctx, K.hx, 0, K.hrx, K.hry, look.headTone ? P.accent : P.body, 0, look.headTone ? 0 : 0.06, 0.4);
    if (look.wings === 'fly') flyWings(ctx, K, look);
    if (look.cornicles) {
      ctx.fillStyle = C(P.dark, 0.2);
      for (let s = -1; s <= 1; s += 2) horn(ctx, K.ax - K.arx * 0.55, s * K.ary * 0.55, K.ax - K.arx * 0.95, s * K.ary * 0.75, 0.04, 0);
    }
    if (look.cerci) {
      ctx.strokeStyle = C(P.dark, 0.15); ctx.lineWidth = 0.04; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let s = -1; s <= 1; s += 2) {
        const w = Math.sin(V.t * 3 + s) * 0.06;
        ctx.moveTo(-look.len * 0.95, s * 0.05);
        ctx.quadraticCurveTo(-look.len - 0.2, s * 0.2 + w, -look.len - 0.5, s * (0.28 + w));
      }
      ctx.stroke();
    }
    antennae(ctx, K, look);
    mandibles(ctx, K, look);
    const ex = K.hx + K.hrx * look.eyeX, ey = K.hry * look.eyeY;
    eye(ctx, ex, -ey, look.eyeR, look.eyeStyle);
    eye(ctx, ex, ey, look.eyeR, look.eyeStyle);
    close(ctx);
  };

  // ================================================================= ARACHNID
  // Femur angle, tibia angle (radians from forward, mirrored per side): legs arch with knees out.
  const SP_ANG = [[0.75, 0.12], [1.25, 0.8], [1.85, 2.3], [2.3, 2.95]];

  function arachnidLayout(look) {
    if (look._k) return look._k;
    const L = look.len, W = look.wid, cl = look.ceph * 2 * L, al = 2 * L - cl;
    return (look._k = {
      cx: L - cl / 2, crx: cl / 2 * 1.12, cry: look.cephW * W,
      ax: -L + al / 2, arx: al / 2 * 1.1, ary: W,
    });
  }

  function arachnidLegs(ctx, K, look, ph) {
    const ll = look.legLen, step = look.step;
    ctx.strokeStyle = legColor();
    ctx.lineWidth = look.legW || 0.1; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let j = 0; j < 4; j++) {
      for (let s = -1; s <= 1; s += 2) {
        const hx = K.cx + K.crx * (0.6 - 0.4 * j), hy = s * K.cry * 0.55;
        const a = ph + (((j + (s > 0 ? 1 : 0)) & 1) * PI);
        const sw = Math.sin(a) * step, lift = Math.max(0, Math.cos(a));
        const a1 = SP_ANG[j][0] + sw * 0.4, a2 = SP_ANG[j][1] + sw * 0.8;
        const kx = hx + Math.cos(a1) * ll * 0.7, ky = hy + s * Math.sin(a1) * ll * 0.7;
        const l2 = ll * (0.9 - 0.12 * lift);
        ctx.moveTo(hx, hy);
        ctx.lineTo(kx, ky);
        ctx.lineTo(kx + Math.cos(a2) * l2, ky + s * Math.sin(a2) * l2);
      }
    }
    ctx.stroke();
  }

  function abdomenMarks(ctx, K, look) {
    const P = V.P;
    ctx.strokeStyle = C(P.accent, 0, 0.6); ctx.lineWidth = 0.07; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(K.ax + K.arx * 0.7, 0); ctx.lineTo(K.ax - K.arx * 0.75, 0);
    for (let i = 0; i < 3; i++) {
      const x = K.ax + K.arx * (0.35 - i * 0.4);
      ctx.moveTo(x + 0.14, -K.ary * (0.55 - i * 0.1)); ctx.lineTo(x - 0.06, 0); ctx.lineTo(x + 0.14, K.ary * (0.55 - i * 0.1));
    }
    ctx.stroke();
  }

  function velvetFuzz(ctx, K, look) {
    ctx.fillStyle = C(V.P.accent, 0.1, 0.5);
    ctx.beginPath();
    for (let i = 0; i < look.fuzz; i++) {
      const a = rnd(7, i) * TAU, d = Math.sqrt(rnd(8, i)) * 0.82;
      const x = K.ax + Math.cos(a) * K.arx * d, y = Math.sin(a) * K.ary * d;
      ctx.moveTo(x + 0.035, y); ctx.arc(x, y, 0.035, 0, TAU);
    }
    ctx.fill();
  }

  Shapes.arachnid = function (ctx, e, t, look) {
    open(ctx, e, t, look);
    const K = arachnidLayout(look), P = V.P;
    const ph = (e.phase || 0) * (look.gait || 2.4);
    arachnidLegs(ctx, K, look, ph);
    blob(ctx, K.ax, 0, K.arx, K.ary, P.body, 0, look.round ? 0.05 : 0, 0.5);
    if (look.marks) abdomenMarks(ctx, K, look);
    if (look.fuzz) velvetFuzz(ctx, K, look);

    // chelicerae and fangs, then the cephalothorax over their roots
    const o = jawOpen(e, t);
    const fx = K.cx + K.crx * 0.88;
    if (look.fangs) {
      ctx.fillStyle = C(P.dark, 0.25);
      for (let s = -1; s <= 1; s += 2) {
        const a = s * (-0.22 + 0.7 * o);
        horn(ctx, fx, s * K.cry * 0.28, fx + Math.cos(a) * look.fangs, s * K.cry * 0.28 + Math.sin(a) * look.fangs, 0.075, s * 0.2);
      }
    }
    ctx.strokeStyle = C(P.body, -0.15); ctx.lineWidth = 0.09; ctx.lineCap = 'round';
    ctx.beginPath(); // pedipalps, fidgeting
    for (let s = -1; s <= 1; s += 2) {
      const w = Math.sin(t * 5 + s * 2 + rnd(V.id, 9) * 6) * 0.07;
      ctx.moveTo(K.cx + K.crx * 0.72, s * K.cry * 0.72);
      ctx.lineTo(K.cx + K.crx * 1.12 + 0.12, s * (K.cry * 0.6 + w));
    }
    ctx.stroke();
    blob(ctx, K.cx, 0, K.crx, K.cry, look.cephTone ? P.accent : P.body, 0, 0.06, 0.45);
    if (look.stripe) {
      ctx.strokeStyle = C(P.accent, 0, 0.55); ctx.lineWidth = 0.1; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(K.cx - K.crx * 0.6, 0); ctx.lineTo(K.cx + K.crx * 0.1, 0); ctx.stroke();
    }

    // eyes: two big front eyes, plus the small wolf-spider rows
    const R = look.eyeR;
    if (look.eyes === 'wolf') {
      ctx.fillStyle = C('#101018', 0);
      for (let s = -1; s <= 1; s += 2) {
        disc(ctx, K.cx + K.crx * 0.8, s * K.cry * 0.22, R * 0.3);
        disc(ctx, K.cx + K.crx * 0.8, s * K.cry * 0.62, R * 0.3);
        disc(ctx, K.cx - K.crx * 0.05, s * K.cry * 0.5, R * 0.45);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      for (let s = -1; s <= 1; s += 2) {
        disc(ctx, K.cx + K.crx * 0.8 - 0.02, s * K.cry * 0.22 - 0.02, R * 0.1);
        disc(ctx, K.cx - K.crx * 0.05 - 0.02, s * K.cry * 0.5 - 0.02, R * 0.14);
      }
    }
    const ex = K.cx + K.crx * look.eyeX, ey = K.cry * look.eyeY;
    eye(ctx, ex, -ey, R, look.eyeStyle);
    eye(ctx, ex, ey, R, look.eyeStyle);
    close(ctx);
  };

  // ================================================================= ISOPOD
  Shapes.isopod = function (ctx, e, t, look) {
    open(ctx, e, t, look);
    const L = look.len, W = look.wid, P = V.P, N = 7;
    const ph = (e.phase || 0) * (look.gait || 3.2);
    const x0 = 0.62 * L, step = (-0.72 * L - x0) / N;
    const prof = (x) => W * Math.sqrt(Math.max(0, 1 - (x / L) * (x / L)));

    // leg fringe under the shell, rippling front to back
    ctx.strokeStyle = legColor(); ctx.lineWidth = 0.09; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = x0 + step * (i + 0.5), w = prof(x), sw = Math.sin(ph - i * 0.8) * 0.12;
      for (let s = -1; s <= 1; s += 2) {
        ctx.moveTo(x + sw * 0.4, s * w * 0.7);
        ctx.lineTo(x + sw, s * (w + 0.26));
      }
    }
    ctx.stroke();

    blob(ctx, 0, 0, L, W, P.body, 0, 0, 0.5);
    // plate edges, then a soft lighter crown on each plate
    ctx.lineCap = 'butt';
    ctx.strokeStyle = C(P.dark, 0.05, 0.55); ctx.lineWidth = 0.05;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const x = x0 + step * i, w = prof(x) * 0.97;
      ctx.moveTo(x, -w); ctx.quadraticCurveTo(x - 0.15, 0, x, w);
    }
    ctx.stroke();
    ctx.strokeStyle = C(P.accent, 0.1, 0.3); ctx.lineWidth = Math.abs(step) * 0.5;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = x0 + step * (i + 0.5), w = prof(x) * 0.8;
      ctx.moveTo(x, -w); ctx.quadraticCurveTo(x - 0.12, 0, x, w);
    }
    ctx.stroke();
    shine(ctx, 0, 0, L * 0.9, W, 0, 0.35);

    // head with eyes and short antennae
    blob(ctx, 0.82 * L, 0, 0.2 * L * 1.1, prof(0.82 * L) * 0.8, P.body, 0, -0.1, 0.3);
    ctx.strokeStyle = C(P.dark, 0.2); ctx.lineWidth = 0.05; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let s = -1; s <= 1; s += 2) {
      const sw = Math.sin(t * 2.6 + s * 1.7 + rnd(V.id, 5) * 6) * 0.14;
      ctx.moveTo(L * 0.98, s * 0.14);
      ctx.lineTo(L + 0.22, s * (0.26 + sw));
      ctx.lineTo(L + 0.46, s * (0.34 + sw * 1.4));
    }
    ctx.stroke();
    const eyY = prof(0.84 * L) * 0.62;
    eye(ctx, 0.86 * L, -eyY, look.eyeR, look.eyeStyle);
    eye(ctx, 0.86 * L, eyY, look.eyeR, look.eyeStyle);
    close(ctx);
  };

  // ================================================================= SEGMENTED (world space)
  Shapes.segmented = function (ctx, e, t, look) {
    const r = e.r || 10;
    const n = look.segs, sp = Math.max(0.5, (2 * look.len - 2 * look.wid) * r / (n - 1));
    const tr = updateTrail(e, n, sp);
    const pts = chainPoints(e, tr, look, r);
    open(ctx, e, t, look, { world: true });
    chainShadow(ctx, pts, look, r);
    DRAW[look.variant](ctx, e, t, look, pts, r, sp);
    close(ctx);
  };
  Shapes.segmented.worldSpace = true;

  // Follow-the-leader chain: each point is dragged to stay `sp` behind the one ahead.
  function updateTrail(e, n, sp) {
    const rs = e.rs || (e.rs = {});
    let tr = rs.trail;
    if (!tr || tr.length !== n || Math.hypot(e.x - tr[0].x, e.y - tr[0].y) > sp * 4 + 30) {
      tr = rs.trail = [];
      const a = e.angle || 0, c = Math.cos(a), s = Math.sin(a);
      for (let i = 0; i < n; i++) tr.push({ x: e.x - c * sp * i, y: e.y - s * sp * i });
      return tr;
    }
    tr[0].x = e.x; tr[0].y = e.y;
    for (let i = 1; i < n; i++) {
      const p = tr[i - 1], q = tr[i];
      const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1e-4;
      q.x = p.x + dx * sp / d; q.y = p.y + dy * sp / d;
    }
    return tr;
  }

  // Drawn points: trail plus a travelling lateral wave, with tangent (toward the head) at each.
  function chainPoints(e, tr, look, r) {
    const n = tr.length, rs = e.rs, pts = rs.pts || (rs.pts = []);
    const mv = clamp(Math.hypot(e.vx || 0, e.vy || 0) / (r * 2.5), 0, 1);
    const wave = look.wave * r * mv, ph = (e.phase || 0) * look.gait;
    for (let i = 0; i < n; i++) {
      const p = pts[i] || (pts[i] = { x: 0, y: 0, tx: 1, ty: 0 });
      const a = tr[Math.max(0, i - 1)], b = tr[Math.min(n - 1, i + 1)];
      let tx = a.x - b.x, ty = a.y - b.y;
      const d = Math.hypot(tx, ty) || 1;
      tx /= d; ty /= d;
      const w = wave * Math.sin(ph * 0.6 - i * 0.5) * Math.min(1, i / 3);
      p.tx = tx; p.ty = ty;
      p.x = tr[i].x - ty * w; p.y = tr[i].y + tx * w;
    }
    pts.length = n;
    return pts;
  }

  function chainShadow(ctx, pts, look, r) {
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = look.wid * r * 1.7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const ox = 0.12 * r, oy = 0.22 * r;
    ctx.beginPath();
    ctx.moveTo(pts[0].x + ox, pts[0].y + oy);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x + ox, pts[i].y + oy);
    ctx.stroke();
  }

  const DRAW = {};

  DRAW.centipede = function (ctx, e, t, look, pts, r, sp) {
    const P = V.P, n = pts.length, W = look.wid * r, ph = (e.phase || 0) * look.gait;
    const wd = (i) => W * (i === 0 ? 1 : 1 - 0.5 * Math.pow(i / (n - 1), 2.2));
    // legs first so the plates cover the hips
    ctx.strokeStyle = C(P.accent, -0.05); ctx.lineWidth = Math.max(0.06 * r, 0.8); ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 1; i < n; i++) {
      const p = pts[i], Lg = look.legLen * r * (1 - 0.3 * i / n), sw = Math.sin(ph - i * 0.7);
      for (let s = -1; s <= 1; s += 2) {
        const nx = -p.ty * s, ny = p.tx * s, hx = p.x + nx * wd(i) * 0.7, hy = p.y + ny * wd(i) * 0.7;
        ctx.moveTo(hx, hy);
        ctx.quadraticCurveTo(hx + nx * Lg * 0.7 + p.tx * Lg * (0.25 + 0.3 * sw), hy + ny * Lg * 0.7 + p.ty * Lg * (0.25 + 0.3 * sw),
          hx + nx * Lg + p.tx * sw * Lg * 0.6, hy + ny * Lg + p.ty * sw * Lg * 0.6);
      }
    }
    // long trailing anal legs
    const q = pts[n - 1];
    for (let s = -1; s <= 1; s += 2) {
      const w = Math.sin(t * 3 + s) * 0.12 * r;
      ctx.moveTo(q.x, q.y);
      ctx.quadraticCurveTo(q.x - q.tx * r * 0.7 - q.ty * s * r * 0.3, q.y - q.ty * r * 0.7 + q.tx * s * r * 0.3,
        q.x - q.tx * r * 1.5 - q.ty * (s * 0.35 * r + w), q.y - q.ty * r * 1.5 + q.tx * (s * 0.35 * r + w));
    }
    ctx.stroke();

    for (let i = n - 1; i >= 1; i--) {
      const p = pts[i], rot = Math.atan2(p.ty, p.tx);
      blob(ctx, p.x, p.y, sp * 0.82, wd(i), P.body, rot, i % 2 ? 0.07 : -0.03, 0.35);
    }
    ctx.strokeStyle = C(P.dark, 0.1, 0.35); ctx.lineWidth = Math.max(0.05 * r, 0.7);
    ctx.beginPath();
    ctx.moveTo(pts[1].x, pts[1].y);
    for (let i = 2; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();

    // head: accent plate, venom claws, antennae, eyes
    headOpen(ctx, e, t, look);
    const o = jawOpen(e, t);
    ctx.strokeStyle = C(P.accent, -0.05); ctx.lineWidth = 0.06; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let s = -1; s <= 1; s += 2) {
      const sw = Math.sin(t * 2.2 + s * 1.5) * 0.2;
      ctx.moveTo(0.55, s * 0.32);
      ctx.quadraticCurveTo(1.1, s * (0.55 + sw), 1.6, s * (0.6 + sw * 1.5));
    }
    ctx.stroke();
    ctx.fillStyle = C('#e83a2a', 0);
    for (let s = -1; s <= 1; s += 2) {
      const a = s * (-0.45 + 1.0 * o);
      horn(ctx, 0.62, s * 0.24, 0.62 + Math.cos(a) * 0.85, s * 0.24 + Math.sin(a) * 0.85, 0.12, s * 0.28);
    }
    blob(ctx, 0.08, 0, 0.72, look.wid * 0.9 + 0.1, P.accent, 0, -0.12, 0.45);
    eye(ctx, 0.3, -0.34, look.eyeR, look.eyeStyle);
    eye(ctx, 0.3, 0.34, look.eyeR, look.eyeStyle);
    headClose(ctx);
  };

  DRAW.caterpillar = function (ctx, e, t, look, pts, r, sp) {
    const P = V.P, n = pts.length, W = look.wid * r, ph = (e.phase || 0) * look.gait;
    const mv = clamp(Math.hypot(e.vx || 0, e.vy || 0) / (r * 2.5), 0, 1);
    const wd = (i) => W * (0.78 + 0.22 * Math.sin(clamp(i / (n - 1), 0, 1) * PI * 0.9 + 0.35))
      * (1 + (0.07 * mv + 0.015) * Math.sin(ph - i * 0.8));
    // prolegs under the middle segments, marching
    ctx.fillStyle = C(P.belly, -0.1);
    for (let i = 2; i < n; i++) {
      const p = pts[i], w = wd(i), sw = Math.sin(ph - i * 0.8) * 0.1 * r * mv;
      for (let s = -1; s <= 1; s += 2) {
        ctx.beginPath();
        ctx.ellipse(p.x - p.ty * s * w * 0.92 + p.tx * sw, p.y + p.tx * s * w * 0.92 + p.ty * sw, 0.17 * r, 0.12 * r, Math.atan2(p.ty, p.tx), 0, TAU);
        ctx.fill();
      }
    }
    // hair tufts
    ctx.strokeStyle = C(P.accent, 0.3, 0.8); ctx.lineWidth = Math.max(0.03 * r, 0.5); ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 1; i < n; i++) {
      const p = pts[i], w = wd(i);
      for (let s = -1; s <= 1; s += 2) {
        const bx = p.x - p.ty * s * w * 0.9, by = p.y + p.tx * s * w * 0.9;
        for (let k = -1; k <= 1; k++) {
          const a = Math.atan2(p.tx * s, -p.ty * s) + k * 0.55;
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(a) * 0.27 * r, by + Math.sin(a) * 0.27 * r);
        }
      }
    }
    ctx.stroke();

    for (let i = n - 1; i >= 1; i--) {
      const p = pts[i], w = wd(i), rot = Math.atan2(p.ty, p.tx), rx = Math.max(sp * 0.95, w * 0.62);
      blob(ctx, p.x, p.y, rx, w, P.body, rot, 0, 0.42);
      if (i % 2 === 1) { // warning band
        ctx.fillStyle = C(P.dark, 0.05, 0.85);
        ctx.beginPath(); ctx.ellipse(p.x - p.tx * rx * 0.25, p.y - p.ty * rx * 0.25, rx * 0.3, w * 0.97, rot, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = C(P.accent, 0, 0.95); // side spots
      for (let s = -1; s <= 1; s += 2) disc(ctx, p.x - p.ty * s * w * 0.62, p.y + p.tx * s * w * 0.62, 0.075 * r);
    }

    headOpen(ctx, e, t, look);
    const o = jawOpen(e, t);
    ctx.fillStyle = C(P.dark, 0.2);
    for (let s = -1; s <= 1; s += 2) {
      const a = s * (-0.35 + 0.8 * o);
      horn(ctx, 0.5, s * 0.14, 0.5 + Math.cos(a) * 0.3, s * 0.14 + Math.sin(a) * 0.3, 0.05, s * 0.2);
    }
    ctx.strokeStyle = C(P.dark, 0.2); ctx.lineWidth = 0.04; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let s = -1; s <= 1; s += 2) { ctx.moveTo(0.4, s * 0.3); ctx.lineTo(0.78, s * (0.42 + Math.sin(t * 2.5 + s) * 0.06)); }
    ctx.stroke();
    blob(ctx, 0, 0, 0.62, 0.62, mixHex(P.accent, P.body, 0.15), 0, 0, 0.55);
    eye(ctx, 0.2, -0.3, look.eyeR, look.eyeStyle);
    eye(ctx, 0.2, 0.3, look.eyeR, look.eyeStyle);
    headClose(ctx);
  };

  DRAW.worm = function (ctx, e, t, look, pts, r) {
    const P = V.P, n = pts.length, W = look.wid * r, ph = (e.phase || 0) * look.gait;
    const mv = clamp(Math.hypot(e.vx || 0, e.vy || 0) / (r * 2.5), 0, 1);
    const c0 = Math.round(n * 0.18), c1 = Math.round(n * 0.3);
    const w = e.rs.w || (e.rs.w = []);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const taper = Math.min(1, 0.6 + i * 0.2) * (1 - 0.62 * Math.pow(Math.max(0, u - 0.7) / 0.3, 1.6));
      const pulse = 1 + 0.12 * mv * Math.sin(ph - i * 0.6) + 0.035 * Math.sin(t * 2 - i * 0.4);
      w[i] = W * taper * pulse * (i >= c0 && i <= c1 ? 1.1 : 1);
    }
    ctx.lineCap = 'round';
    const pass = (scale, ox, oy, colFor) => {
      for (let i = n - 1; i >= 1; i--) {
        ctx.strokeStyle = colFor(i);
        ctx.lineWidth = 2 * w[i] * scale;
        ctx.beginPath();
        ctx.moveTo(pts[i].x + ox * w[i], pts[i].y + oy * w[i]);
        ctx.lineTo(pts[i - 1].x + ox * w[i], pts[i - 1].y + oy * w[i]);
        ctx.stroke();
      }
    };
    const inBand = (i) => i >= c0 && i <= c1;
    pass(1.06, 0, 0, (i) => C(P.dark, 0.05));
    pass(0.9, 0, 0, (i) => (inBand(i) ? C(P.accent, -0.02) : C(P.body, -0.02)));
    pass(0.62, V.lx * 0.12, V.ly * 0.12, (i) => (inBand(i) ? C(P.accent, 0.3) : C(P.body, 0.28)));
    pass(0.22, V.lx * 0.3, V.ly * 0.3, (i) => C(P.belly, 0.6, 0.9));
    // fine ring lines
    ctx.strokeStyle = C(P.dark, 0.1, 0.3); ctx.lineWidth = Math.max(0.03 * r, 0.5); ctx.lineCap = 'butt';
    ctx.beginPath();
    for (let i = 2; i < n; i += 2) {
      const p = pts[i], k = w[i] * 0.82;
      ctx.moveTo(p.x + p.ty * k, p.y - p.tx * k);
      ctx.lineTo(p.x - p.ty * k, p.y + p.tx * k);
    }
    ctx.stroke();

    headOpen(ctx, e, t, look);
    eye(ctx, 0.1, -0.2, look.eyeR, look.eyeStyle);
    eye(ctx, 0.1, 0.2, look.eyeR, look.eyeStyle);
    headClose(ctx);
  };

  // ================================================================= PLANT
  const PLANT = {};

  Shapes.plant = function (ctx, e, t, look) {
    const am = e.amount == null ? 1 : clamp(e.amount, 0, 1);
    open(ctx, e, t, look, { rot: rnd(e.id, 9) * TAU, still: true });
    ctx.scale(look.len, look.len);
    PLANT[look.variant](ctx, e, t, look, am);
    close(ctx);
  };

  PLANT.seed = function (ctx, e, t, look, am) {
    const P = V.P, n = 3 + Math.floor(rnd(e.id, 10) * 4);
    const shown = am < 0.04 ? 0 : Math.min(n, Math.ceil(n * am));
    const sc = 0.55 + 0.45 * Math.min(1, am * 1.6);
    for (let i = 0; i < shown; i++) {
      const a = i * 2.4 + rnd(e.id, 11 + i) * 0.8, d = Math.sqrt((i + 0.5) / n) * 0.6 * sc;
      const x = Math.cos(a) * d, y = Math.sin(a) * d, rot = a + (rnd(e.id, 20 + i) - 0.5) * 0.7;
      const bob = 1 + 0.02 * Math.sin(t * 1.6 + i);
      blob(ctx, x, y, 0.44 * sc * bob, 0.25 * sc * bob, i % 2 ? P.body : P.belly, rot, 0, 0.55);
      ctx.save();
      ctx.translate(x, y); ctx.rotate(rot);
      ctx.strokeStyle = C(P.dark, 0, 0.4); ctx.lineWidth = 0.02 * sc; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-0.28 * sc, -0.06 * sc); ctx.lineTo(0.2 * sc, -0.06 * sc);
      ctx.moveTo(-0.28 * sc, 0.06 * sc); ctx.lineTo(0.2 * sc, 0.06 * sc);
      ctx.stroke();
      ctx.fillStyle = C(P.accent, 0, 0.9);
      ctx.beginPath(); ctx.ellipse(0.3 * sc, 0, 0.05 * sc, 0.045 * sc, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
  };

  function mushroomCap(ctx, x, y, R, seed, hex, spots) {
    const P = V.P, n = 22;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = i / n * TAU, rr = R * (1 + 0.035 * Math.sin(a * 5 + seed * 6) + 0.02 * Math.sin(a * 3 + seed * 9));
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(x + V.lx * R * 0.35, y + V.ly * R * 0.35, R * 0.05, x, y, R * 1.05);
    g.addColorStop(0, C(hex, 0.5)); g.addColorStop(0.55, C(hex, 0)); g.addColorStop(1, C(hex, -0.42));
    ctx.fillStyle = g; ctx.fill();
    // rolled rim with gill hint on the side away from the light
    const a0 = Math.atan2(-V.ly, -V.lx);
    ctx.strokeStyle = C(P.belly, 0, 0.5); ctx.lineWidth = R * 0.018; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = a0 - 0.95 + i * 0.125;
      ctx.moveTo(x + Math.cos(a) * R * 0.74, y + Math.sin(a) * R * 0.74);
      ctx.lineTo(x + Math.cos(a) * R * 0.97, y + Math.sin(a) * R * 0.97);
    }
    ctx.stroke();
    ctx.fillStyle = C(P.accent, 0.1, 0.92);
    for (let i = 0; i < spots; i++) {
      const a = rnd(seed * 100, 30 + i) * TAU, d = 0.18 + 0.5 * rnd(seed * 100, 40 + i);
      disc(ctx, x + Math.cos(a) * R * d, y + Math.sin(a) * R * d, R * (0.07 + 0.07 * rnd(seed * 100, 50 + i)));
    }
    shine(ctx, x, y, R, R, 0, 0.35);
  }

  PLANT.fungus = function (ctx, e, t, look, am) {
    const P = V.P, n = am < 0.35 ? 1 : 1 + Math.floor(rnd(e.id, 10) * 3);
    const sc = 0.5 + 0.5 * Math.min(1, am * 1.3);
    const pulse = 0.75 + 0.25 * Math.sin(t * 1.5 + rnd(e.id, 12) * 6);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.45);
    g.addColorStop(0, C(P.body, 0.3, 0.3 * pulse)); g.addColorStop(1, C(P.body, 0.3, 0));
    ctx.fillStyle = g; disc(ctx, 0, 0, 1.45);
    const caps = [[0, 0, 0.62], [0.6, 0.3, 0.38], [-0.46, 0.46, 0.34]];
    for (let i = n - 1; i >= 0; i--) {
      const c = caps[i], rot = rnd(e.id, 13) * TAU;
      const x = (Math.cos(rot) * c[0] - Math.sin(rot) * c[1]) * sc, y = (Math.sin(rot) * c[0] + Math.cos(rot) * c[1]) * sc;
      mushroomCap(ctx, x, y, c[2] * sc * (1 + 0.015 * Math.sin(t * 1.2 + i)), rnd(e.id, 14 + i), P.body, 3 + i);
    }
  };

  function heart(ctx, ll) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(ll * 0.15, -ll * 0.5, ll * 0.7, -ll * 0.62, ll * 0.98, -ll * 0.28);
    ctx.quadraticCurveTo(ll * 1.02, -ll * 0.02, ll * 0.84, 0);
    ctx.quadraticCurveTo(ll * 1.02, ll * 0.02, ll * 0.98, ll * 0.28);
    ctx.bezierCurveTo(ll * 0.7, ll * 0.62, ll * 0.15, ll * 0.5, 0, 0);
    ctx.closePath();
  }

  PLANT.clover = function (ctx, e, t, look, am) {
    const P = V.P, nt = Math.max(1, Math.round((2 + Math.floor(rnd(e.id, 10) * 2)) * (0.45 + 0.55 * am)));
    const sc = 0.65 + 0.35 * am;
    const flower = rnd(e.id, 15) > 0.5 && am > 0.5;
    const offs = [[-0.36, -0.22], [0.38, -0.12], [0.0, 0.42]];
    for (let i = 0; i < nt; i++) {
      const sway = Math.sin(t * 1.1 + i * 2 + rnd(e.id, 16) * 6) * 0.05;
      ctx.save();
      ctx.translate(offs[i][0] * sc, offs[i][1] * sc);
      ctx.rotate(rnd(e.id, 17 + i) * TAU + sway);
      const ll = 0.66 * sc;
      for (let k = 0; k < 3; k++) {
        ctx.save();
        ctx.rotate(k * TAU / 3);
        heart(ctx, ll);
        ctx.fillStyle = C(P.body, -0.12); ctx.fill();
        ctx.strokeStyle = C(P.body, -0.45, 0.6); ctx.lineWidth = 0.02; ctx.stroke();
        ctx.save(); ctx.translate(ll * 0.06, ll * -0.04); ctx.scale(0.78, 0.8);
        heart(ctx, ll); ctx.fillStyle = C(P.body, 0.22, 0.75); ctx.fill(); ctx.restore();
        ctx.strokeStyle = C(P.accent, 0, 0.7); ctx.lineWidth = 0.035; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(ll * 0.3, -ll * 0.22); ctx.lineTo(ll * 0.55, 0); ctx.lineTo(ll * 0.3, ll * 0.22);
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }
    if (flower) {
      const fx = 0.05, fy = 0.02;
      ctx.fillStyle = C('#ffffff', -0.02); disc(ctx, fx, fy, 0.2);
      ctx.fillStyle = C('#ffd9e6', 0, 0.9);
      for (let i = 0; i < 9; i++) { const a = i * 0.7 + 0.3; disc(ctx, fx + Math.cos(a) * 0.12, fy + Math.sin(a) * 0.12, 0.06); }
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; disc(ctx, fx - 0.06, fy - 0.07, 0.05);
    }
  };

  PLANT.reeds = function (ctx, e, t, look, am) {
    const P = V.P, nb = Math.max(3, Math.round((9 + Math.floor(rnd(e.id, 10) * 4)) * (0.4 + 0.6 * am)));
    const sc = 0.55 + 0.45 * am;
    ctx.fillStyle = C(P.dark, 0, 0.3); disc(ctx, 0, 0, 0.14);
    for (let i = 0; i < nb; i++) {
      const a = i / nb * TAU + (rnd(e.id, 20 + i) - 0.5) * 0.5;
      const len = (0.62 + 0.5 * rnd(e.id, 40 + i)) * sc;
      const bend = (rnd(e.id, 60 + i) - 0.5) * 0.9 + Math.sin(t * 1.2 + i + rnd(e.id, 5) * 6) * 0.07;
      const tipx = Math.cos(a + bend * 0.5) * len, tipy = Math.sin(a + bend * 0.5) * len;
      const cx = Math.cos(a - bend * 0.35) * len * 0.55, cy = Math.sin(a - bend * 0.35) * len * 0.55;
      const wd = 0.105 * (0.7 + 0.5 * rnd(e.id, 80 + i));
      const nx = -Math.sin(a), ny = Math.cos(a);
      ctx.fillStyle = C(P.body, [-0.2, 0.05, 0.25][i % 3]);
      ctx.beginPath();
      ctx.moveTo(nx * wd, ny * wd);
      ctx.quadraticCurveTo(cx + nx * wd * 1.1, cy + ny * wd * 1.1, tipx, tipy);
      ctx.quadraticCurveTo(cx - nx * wd * 1.1, cy - ny * wd * 1.1, -nx * wd, -ny * wd);
      ctx.fill();
      ctx.strokeStyle = C(P.accent, 0.25, 0.5); ctx.lineWidth = 0.014; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(cx, cy, tipx * 0.92, tipy * 0.92); ctx.stroke();
      if (i < 2 && rnd(e.id, 90 + i) > 0.35 && am > 0.3) { // cattail head
        ctx.save(); ctx.translate(tipx * 0.78, tipy * 0.78); ctx.rotate(a);
        blob(ctx, 0, 0, 0.13, 0.07, P.accent, 0, -0.1, 0.4);
        ctx.restore();
      }
    }
  };

  PLANT.lilypad = function (ctx, e, t, look, am) {
    const P = V.P, R = 0.95 * (0.55 + 0.45 * am);
    const bob = 1 + 0.015 * Math.sin(t * 1.3 + rnd(e.id, 12) * 6);
    const notch = 0.2 + 0.1 * rnd(e.id, 18);
    // faint ripple ring
    const f = (t * 0.25 + rnd(e.id, 19)) % 1;
    ctx.strokeStyle = 'rgba(220,245,255,' + (0.18 * (1 - f)).toFixed(3) + ')'; ctx.lineWidth = 0.025;
    ctx.beginPath(); ctx.arc(0, 0, R * (1.05 + 0.25 * f), 0, TAU); ctx.stroke();
    ctx.save();
    ctx.scale(bob, bob);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, notch, TAU - notch);
    ctx.closePath();
    const g = ctx.createRadialGradient(V.lx * R * 0.3, V.ly * R * 0.3, R * 0.05, 0, 0, R * 1.05);
    g.addColorStop(0, C(P.body, 0.38)); g.addColorStop(0.6, C(P.body, 0)); g.addColorStop(1, C(P.body, -0.35));
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = C(P.dark, 0.1, 0.65); ctx.lineWidth = 0.035; ctx.stroke();
    ctx.strokeStyle = C(P.body, 0.45, 0.4); ctx.lineWidth = 0.014; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const a = notch + 0.22 + i * (TAU - 2 * notch - 0.44) / 11;
      ctx.moveTo(Math.cos(a) * R * 0.12, Math.sin(a) * R * 0.12);
      ctx.lineTo(Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 0.05;
    const la = Math.atan2(V.ly, V.lx);
    ctx.beginPath(); ctx.arc(0, 0, R * 0.74, la - 0.55, la + 0.55); ctx.stroke();
    if (rnd(e.id, 3) > 0.62 && am > 0.4) lotusFlower(ctx, R * 0.18, R * 0.12, R * 0.34, t);
    ctx.restore();
  };

  function lotusFlower(ctx, x, y, R, t) {
    const P = V.P;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(t * 0.5) * 0.05);
    for (let ring = 0; ring < 2; ring++) {
      const n = ring ? 6 : 9, len = R * (ring ? 0.7 : 1), off = ring ? 0.35 : 0;
      for (let i = 0; i < n; i++) {
        ctx.save();
        ctx.rotate(i / n * TAU + off);
        ctx.fillStyle = C(P.accent, ring ? 0.35 : 0.1);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(len * 0.55, -len * 0.42, len, 0);
        ctx.quadraticCurveTo(len * 0.55, len * 0.42, 0, 0);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.fillStyle = C('#ffd54a', 0); disc(ctx, 0, 0, R * 0.2);
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; disc(ctx, -R * 0.07, -R * 0.07, R * 0.07);
    ctx.restore();
  }

  PLANT.carrion = function (ctx, e, t, look, am) {
    const P = V.P, sc = 0.45 + 0.55 * am, n = 9;
    const ga = ctx.globalAlpha;
    ctx.globalAlpha = ga * (0.7 + 0.3 * am);
    const px = [], py = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU, rr = (0.7 + 0.3 * rnd(e.id, 20 + i)) * sc * 0.95;
      px.push(Math.cos(a) * rr); py.push(Math.sin(a) * rr * 0.78);
    }
    ctx.beginPath();
    ctx.moveTo((px[0] + px[n - 1]) / 2, (py[0] + py[n - 1]) / 2);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      ctx.quadraticCurveTo(px[i], py[i], (px[i] + px[j]) / 2, (py[i] + py[j]) / 2);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(V.lx * 0.2 * sc, V.ly * 0.2 * sc, 0.05, 0, 0, sc);
    g.addColorStop(0, C(P.body, 0.28)); g.addColorStop(0.6, C(P.body, -0.05)); g.addColorStop(1, C(P.body, -0.4));
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = C(P.dark, 0, 0.45); ctx.lineWidth = 0.03; ctx.stroke();
    // reddish flesh patches, then a spine with ribs and a stray bone
    ctx.fillStyle = C('#8a4a3a', 0, 0.45);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse((rnd(e.id, 80 + i) - 0.5) * sc * 0.7, (rnd(e.id, 83 + i) - 0.5) * sc * 0.5, sc * 0.2, sc * 0.12, rnd(e.id, 86 + i) * 3, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = C(P.accent, 0, 0.95); ctx.lineWidth = 0.06 * sc; ctx.lineCap = 'round';
    const ra = rnd(e.id, 40) * TAU;
    ctx.save();
    ctx.rotate(ra);
    ctx.beginPath();
    ctx.moveTo(-0.45 * sc, 0); ctx.lineTo(0.45 * sc, 0);
    for (let i = 0; i < 4; i++) {
      const x = (-0.3 + i * 0.2) * sc;
      for (let k = -1; k <= 1; k += 2) { ctx.moveTo(x, 0); ctx.quadraticCurveTo(x + 0.06 * sc, k * 0.2 * sc, x - 0.06 * sc, k * 0.3 * sc); }
    }
    ctx.stroke();
    ctx.fillStyle = C(P.accent, 0, 0.95);
    disc(ctx, 0.5 * sc, 0, 0.09 * sc);
    ctx.restore();
    ctx.fillStyle = C(P.dark, 0, 0.5);
    for (let i = 0; i < 4; i++) disc(ctx, (rnd(e.id, 60 + i) - 0.5) * sc * 1.1, (rnd(e.id, 70 + i) - 0.5) * sc * 0.8, 0.04 * sc);
    ctx.globalAlpha = ga;
  };

  // ================================================================= LOOKS
  const def = (sp, look) => { LOOKS[sp] = look; };

  const insect = (o) => Object.assign({
    plan: 'insect', habitat: 'land', gait: 3, step: 0.42, legLen: 1.0, legW: 0.1,
    antLen: 0.9, antStyle: 'curve', eyeStyle: 'iris', eyeX: 0.3, eyeY: 0.8,
  }, o);

  def('ant', insect({
    len: 1.55, wid: 0.56, seg: [0.27, 0.27, 0.46], segW: [0.78, 0.5, 1.0], antStyle: 'elbow', antLen: 1.0,
    mand: 0.3, eyeR: 0.2, eyeX: 0.4, eyeY: 0.85,
    pal: { body: '#d2562a', belly: '#f08a4b', accent: '#ffd27a', dark: '#3a1408', eye: '#fff2c4' },
  }));
  def('beetle', insect({
    len: 1.5, wid: 0.78, seg: [0.2, 0.2, 0.6], segW: [0.62, 0.8, 1.0], elytra: true, stripe: true,
    antStyle: 'club', antLen: 0.7, mand: 0.34, mandCol: 'accent', eyeR: 0.17, eyeX: 0.2, eyeY: 0.75, legLen: 0.95, gait: 2.6,
    pal: { body: '#1f8a72', belly: '#7fe0c9', accent: '#d8f25c', dark: '#0c2a26', eye: '#ffd54a' },
  }));
  def('aphid', insect({
    len: 1.15, wid: 0.85, seg: [0.2, 0.22, 0.6], segW: [0.5, 0.78, 1.0], soft: true, cornicles: true,
    antLen: 1.0, legLen: 0.85, legW: 0.075, step: 0.3, eyeR: 0.17, eyeX: 0.3, eyeY: 0.85,
    pal: { body: '#8fd94c', belly: '#d6f58c', accent: '#2e7d32', dark: '#1d4a18', eye: '#ff6b5e' },
  }));
  def('fly', insect({
    len: 1.2, wid: 0.62, seg: [0.28, 0.3, 0.42], segW: [0.9, 0.82, 1.0], wings: 'fly', wingLen: 1.45, wingW: 0.4,
    wingCol: '#dff0ff', antLen: 0.35, legLen: 0.8, legW: 0.08, eyeR: 0.27, eyeX: 0.3, eyeY: 0.8, eyeStyle: 'compound',
    bands: 3, bandCol: 'accent', bandA: 0.4, gait: 3.4, step: 0.3,
    pal: { body: '#5a7f93', belly: '#a8c4d2', accent: '#b8f0e6', dark: '#10202c', eye: '#e23b3b' },
  }));
  def('cricket', insect({
    len: 1.55, wid: 0.62, seg: [0.24, 0.26, 0.5], segW: [0.82, 0.88, 1.0], hind: 0.95, cerci: true,
    antLen: 2.0, cover: { dx: 0.15, rx: 0.9, ry: 0.86, tone: 0.0, col: 'body' }, headTone: false, mand: 0.2,
    eyeR: 0.17, eyeX: 0.35, eyeY: 0.8, legLen: 0.85, step: 0.35,
    pal: { body: '#8a5428', belly: '#c88a4a', accent: '#e0b060', dark: '#2a1608', eye: '#ffe27a' },
  }));
  def('grasshopper', insect({
    len: 1.75, wid: 0.58, seg: [0.2, 0.26, 0.54], segW: [0.82, 0.8, 1.0], hind: 1.15,
    antLen: 0.8, antStyle: 'curve', cover: { dx: -0.1, rx: 1.0, ry: 0.78, tone: -0.05, col: 'accent' }, mand: 0.18,
    eyeR: 0.17, eyeX: 0.4, eyeY: 0.82, legLen: 0.85, step: 0.35,
    pal: { body: '#7ec43a', belly: '#d4f08a', accent: '#a9d84a', dark: '#25410f', eye: '#ffe27a' },
  }));
  def('dragonfly', insect({
    len: 2.2, wid: 0.5, seg: [0.19, 0.2, 0.61], segW: [1.0, 0.8, 0.42], wings: 'dragon', wingLen: 1.9, wingW: 0.52,
    wingCol: '#cfeff7', thoraxAccent: true, bands: 9, bandA: 0.5, bandW: 0.045, antLen: 0.25, legLen: 0.5, legW: 0.07,
    eyeR: 0.27, eyeX: 0.15, eyeY: 0.9, eyeStyle: 'compound', step: 0.1, habitat: 'air',
    pal: { body: '#2aa5d8', belly: '#8fe0f5', accent: '#c6e83a', dark: '#0a2a40', eye: '#3de0a8' },
  }));
  def('springtail', insect({
    len: 1.45, wid: 0.46, seg: [0.2, 0.24, 0.56], segW: [0.8, 0.9, 1.0], furcula: true,
    antLen: 0.65, legLen: 0.7, legW: 0.08, eyeR: 0.17, eyeX: 0.4, eyeY: 0.85, eyeStyle: 'bead', bands: 4, bandCol: 'accent', bandA: 0.35, step: 0.28,
    pal: { body: '#9fb7d4', belly: '#d8e6f5', accent: '#f0a85a', dark: '#243044', eye: '#e8f4ff' },
  }));

  def('spider', {
    plan: 'arachnid', habitat: 'land', len: 1.45, wid: 0.78, ceph: 0.42, cephW: 0.66, legLen: 1.15, legW: 0.115,
    step: 0.55, gait: 2.4, fangs: 0.34, marks: true, stripe: true, eyes: 'wolf', eyeR: 0.2, eyeX: 0.52, eyeY: 0.46,
    pal: { body: '#8a4f27', belly: '#c88a52', accent: '#f0cf8a', dark: '#2e160a', eye: '#e8ff7a' },
  });
  def('mite', {
    plan: 'arachnid', habitat: 'land', len: 1.0, wid: 0.9, ceph: 0.26, cephW: 0.52, legLen: 0.72, legW: 0.09,
    step: 0.5, gait: 3.4, round: true, fuzz: 16, eyeR: 0.19, eyeX: 0.55, eyeY: 0.5, eyeStyle: 'bead',
    pal: { body: '#e5322b', belly: '#ff7a63', accent: '#ff9a7a', dark: '#5a0f0f', eye: '#fff1d0' },
  });

  def('pillbug', {
    plan: 'isopod', habitat: 'land', len: 1.12, wid: 0.8, gait: 3.2, eyeR: 0.15, eyeStyle: 'bead',
    pal: { body: '#6f86a0', belly: '#b6c7d8', accent: '#e4eef7', dark: '#232f3d', eye: '#f5f0c8' },
  });

  def('centipede', {
    plan: 'segmented', variant: 'centipede', habitat: 'land', noShadow: true, len: 2.5, wid: 0.4, segs: 15, gait: 3,
    wave: 0.14, legLen: 0.62, eyeR: 0.17, eyeStyle: 'iris',
    pal: { body: '#9c2f22', belly: '#d95a3a', accent: '#f2a93b', dark: '#2b0c08', eye: '#ffe27a' },
  });
  def('caterpillar', {
    plan: 'segmented', variant: 'caterpillar', habitat: 'land', noShadow: true, len: 1.75, wid: 0.6, segs: 7, gait: 2.2,
    wave: 0.05, eyeR: 0.17, eyeStyle: 'iris',
    pal: { body: '#a8e640', belly: '#e0f7a0', accent: '#ffd21f', dark: '#1a1a14', eye: '#fff6c8' },
  });
  def('worm', {
    plan: 'segmented', variant: 'worm', habitat: 'land', noShadow: true, len: 2.3, wid: 0.36, segs: 22, gait: 2.6,
    wave: 0.18, eyeR: 0.14, eyeStyle: 'bead',
    pal: { body: '#d98a7a', belly: '#f6c4b4', accent: '#ee9f8a', dark: '#7a3a35', eye: '#f2f2f2' },
  });

  def('seed', {
    plan: 'plant', variant: 'seed', habitat: 'land', len: 1.0, wid: 1.0,
    pal: { body: '#c9892f', belly: '#f0c866', accent: '#fff0b8', dark: '#4a2e12', eye: '#fff' },
  });
  def('fungus', {
    plan: 'plant', variant: 'fungus', habitat: 'land', len: 1.0, wid: 1.0,
    pal: { body: '#46c9b4', belly: '#a8f0e0', accent: '#f4fff8', dark: '#0c3a35', eye: '#fff' },
  });
  def('clover', {
    plan: 'plant', variant: 'clover', habitat: 'land', len: 1.0, wid: 1.0, noShadow: true,
    pal: { body: '#3fae4a', belly: '#9ee08a', accent: '#e8f7c8', dark: '#12401a', eye: '#fff' },
  });
  def('reeds', {
    plan: 'plant', variant: 'reeds', habitat: 'water', len: 1.1, wid: 1.1,
    pal: { body: '#68aa48', belly: '#a8d878', accent: '#8a5a2a', dark: '#1b4a1c', eye: '#fff' },
  });
  def('lilypad', {
    plan: 'plant', variant: 'lilypad', habitat: 'water', len: 1.0, wid: 1.0, noShadow: true,
    pal: { body: '#3d9a52', belly: '#8ad48c', accent: '#ff93bd', dark: '#12401f', eye: '#fff' },
  });
  def('carrion', {
    plan: 'plant', variant: 'carrion', habitat: 'land', len: 1.0, wid: 0.8, noShadow: true,
    pal: { body: '#8a7d72', belly: '#b3a89c', accent: '#ece4d0', dark: '#3a322c', eye: '#fff' },
  });
})();
