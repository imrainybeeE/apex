/* Apex world: biomes (litter, undergrowth, pond, meadow, forest, valley), depth layers, grading.
   Everything heavy is pre-rendered at build time; per-frame work is blits. */
(function () {
'use strict';
const A = window.Apex = window.Apex || {};
A.Biomes = A.Biomes || {};

// ---------------------------------------------------------------- utilities
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

function hash32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Seeded rng: callable, with helpers.
function makeRng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.seed = seed >>> 0;
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  r.sub = (tag) => makeRng((r.seed ^ hash32(String(tag))) >>> 0);
  return r;
}

// Colors are [r,g,b] arrays; helpers accept '#rrggbb' strings too.
const rgb = (c) => (typeof c === 'string'
  ? [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)] : c);
const css = (c, a) => {
  c = rgb(c);
  const r = Math.round(clamp(c[0], 0, 255)), g = Math.round(clamp(c[1], 0, 255)), b = Math.round(clamp(c[2], 0, 255));
  return a === undefined || a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
};
const mixc = (a, b, t) => { a = rgb(a); b = rgb(b); return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; };
const mulc = (c, k) => { c = rgb(c); return [clamp(c[0] * k, 0, 255), clamp(c[1] * k, 0, 255), clamp(c[2] * k, 0, 255)]; };

function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
const g2 = (c) => c.getContext('2d');

// Safari lacks ctx.filter; blur falls back to a down/up-scale.
let filterOk = null;
function hasFilter() {
  if (filterOk === null) {
    try { filterOk = 'filter' in g2(mk(1, 1)); } catch (e) { filterOk = false; }
  }
  return filterOk;
}

// Returns a padded, blurred copy of src.
function blurred(src, r, pad) {
  pad = pad === undefined ? Math.ceil(r * 2.5) : pad;
  const c = mk(src.width + pad * 2, src.height + pad * 2), g = g2(c);
  if (hasFilter()) {
    g.filter = `blur(${r}px)`;
    g.drawImage(src, pad, pad);
    g.filter = 'none';
  } else { // repeated half-size bilinear steps approximate a gaussian blur
    let cur = mk(c.width, c.height);
    g2(cur).drawImage(src, pad, pad);
    const levels = Math.max(1, Math.round(Math.log2(Math.max(2, r * 0.9))));
    const step = (from, w, h) => {
      const n = mk(w, h), ng = g2(n);
      ng.imageSmoothingEnabled = true; ng.imageSmoothingQuality = 'high';
      ng.drawImage(from, 0, 0, w, h);
      return n;
    };
    for (let i = 0; i < levels; i++) cur = step(cur, Math.max(2, Math.ceil(cur.width / 2)), Math.max(2, Math.ceil(cur.height / 2)));
    for (let i = 0; i < levels - 1; i++) cur = step(cur, cur.width * 2, cur.height * 2);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, c.width, c.height);
  }
  return c;
}

// Tileable fractal value noise, normalised to ~0..1.
function noiseGrid(n, cells, seed, oct, pers) {
  const out = new Float32Array(n * n);
  let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const f = cells << o, r = makeRng(seed + o * 7919);
    const lat = new Float32Array(f * f);
    for (let i = 0; i < lat.length; i++) lat[i] = r();
    const i0 = new Int32Array(n), i1 = new Int32Array(n), fr = new Float32Array(n);
    for (let x = 0; x < n; x++) {
      const p = x / n * f, ip = Math.floor(p), q = p - ip;
      i0[x] = ip % f; i1[x] = (ip + 1) % f; fr[x] = q * q * (3 - 2 * q);
    }
    for (let y = 0; y < n; y++) {
      const r0 = i0[y] * f, r1 = i1[y] * f, ty = fr[y], row = y * n;
      for (let x = 0; x < n; x++) {
        const a = lat[r0 + i0[x]], b = lat[r0 + i1[x]], c = lat[r1 + i0[x]], d = lat[r1 + i1[x]];
        const top = a + (b - a) * fr[x], bot = c + (d - c) * fr[x];
        out[row + x] += (top + (bot - top) * ty) * amp;
      }
    }
    tot += amp; amp *= pers;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

// Non-tiling lattice value noise at a point (for the lake field).
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi);
  const h = (i, j) => { let v = Math.imul(i * 374761393 + j * 668265263 + seed * 144665, 1274126177); v ^= v >>> 13; v = Math.imul(v, 1103515245); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

// 256-entry colour ramp from [[pos, color], ...].
function makeLut(stops) {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const p = i / 255;
    let k = 0;
    while (k < stops.length - 2 && p > stops[k + 1][0]) k++;
    const a = stops[k], b = stops[k + 1];
    const c = mixc(a[1], b[1], clamp((p - a[0]) / (b[0] - a[0] || 1), 0, 1));
    lut[i * 3] = c[0]; lut[i * 3 + 1] = c[1]; lut[i * 3 + 2] = c[2];
  }
  return lut;
}

function upscale(small, S) {
  const c = mk(S, S), g = g2(c);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(small, 0, 0, S, S);
  return c;
}

// Run draw(x, y) at the point and at its wrapped copies so tiles stay seamless.
function wrapped(S, x, y, ext, draw) {
  const xs = [x], ys = [y];
  if (x < ext) xs.push(x + S); else if (x > S - ext) xs.push(x - S);
  if (y < ext) ys.push(y + S); else if (y > S - ext) ys.push(y - S);
  for (let i = 0; i < xs.length; i++) for (let j = 0; j < ys.length; j++) draw(xs[i], ys[j]);
}

// Scatter `count` marks over a tile. make(rng) -> params, draw(g, x, y, p).
function scatter(g, S, rng, count, ext, make, draw) {
  for (let i = 0; i < count; i++) {
    const x = rng() * S, y = rng() * S, p = make(rng);
    wrapped(S, x, y, ext, (xx, yy) => draw(g, xx, yy, p));
  }
}

// A sprite: canvas drawn in world units around its centre at `ppu` px/unit.
function sprite(wU, hU, ppu, draw) {
  const c = mk(wU * ppu, hU * ppu), g = g2(c);
  g.translate(c.width / 2, c.height / 2);
  g.scale(ppu, ppu);
  g.lineJoin = 'round'; g.lineCap = 'round';
  draw(g, ppu);
  return { c, ppu, w: c.width / ppu, h: c.height / ppu, rad: Math.hypot(c.width, c.height) / ppu / 2 };
}

// Soft shadow drawn behind the already-painted sprite (works through holes).
function addShadow(s, o) {
  const c = s.c, g = g2(c), copy = mk(c.width, c.height);
  g2(copy).drawImage(c, 0, 0);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-over';
  g.shadowColor = `rgba(6,4,2,${o.a === undefined ? 0.5 : o.a})`;
  g.shadowBlur = (o.blur === undefined ? 1.6 : o.blur) * s.ppu;
  g.shadowOffsetX = (o.dx === undefined ? 0.6 : o.dx) * s.ppu;
  g.shadowOffsetY = (o.dy === undefined ? 0.9 : o.dy) * s.ppu;
  g.drawImage(copy, 0, 0);
  g.restore();
  return s;
}

function blobPath(g, cx, cy, rx, ry, rng, n, wob) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU, k = 1 + (rng() - 0.5) * wob;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  closedSpline(g, pts);
}

// Closed smooth curve through points (quadratic midpoints).
function closedSpline(g, pts) {
  const n = pts.length;
  g.beginPath();
  g.moveTo((pts[0][0] + pts[n - 1][0]) / 2, (pts[0][1] + pts[n - 1][1]) / 2);
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
  g.closePath();
}

// ------------------------------------------------------- silhouette sprites
// Generic organic silhouettes (facing +x, ~200 long) used when real portraits are unavailable.
const SIL = {
  fish(g) {
    g.beginPath(); g.moveTo(100, 0); g.bezierCurveTo(70, -34, 10, -44, -48, -14);
    g.lineTo(-98, -42); g.quadraticCurveTo(-78, 0, -98, 42); g.lineTo(-48, 14);
    g.bezierCurveTo(10, 44, 70, 34, 100, 0); g.fill();
    g.beginPath(); g.moveTo(24, -34); g.quadraticCurveTo(-26, -66, -42, -20); g.fill();
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(40, 22 * s); g.quadraticCurveTo(8, 62 * s, -14, 26 * s); g.fill(); }
  },
  bird(g) {
    g.beginPath(); g.ellipse(8, 0, 48, 14, 0, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(62, 0, 13, 10, 0, 0, TAU); g.fill();
    g.beginPath(); g.moveTo(72, -4); g.lineTo(112, 0); g.lineTo(72, 4); g.fill();
    for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(34, -8 * s); g.bezierCurveTo(24, -58 * s, -8, -100 * s, -52, -112 * s);
      g.lineTo(-62, -88 * s); g.bezierCurveTo(-42, -68 * s, -32, -40 * s, -30, -8 * s); g.fill();
    }
    g.beginPath(); g.moveTo(-38, -8); g.lineTo(-96, -20); g.lineTo(-96, 20); g.lineTo(-38, 8); g.fill();
    g.lineWidth = 3; g.beginPath(); g.moveTo(-60, -3); g.lineTo(-126, -8); g.moveTo(-60, 3); g.lineTo(-126, 8); g.stroke();
  },
  snake(g) {
    const n = 40;
    for (let i = 0; i < n; i++) {
      const u = i / n, x = 100 - u * 200, y = 30 * Math.sin(x / 26), x2 = 100 - (i + 1) / n * 200, y2 = 30 * Math.sin(x2 / 26);
      g.lineWidth = 6 + 16 * Math.sin(Math.PI * Math.min(1, u * 1.3 + 0.1)) * (1 - u * 0.6);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
    }
    g.beginPath(); g.ellipse(104, 30 * Math.sin(100 / 26), 17, 12, 0.2, 0, TAU); g.fill();
  },
  spider(g) {
    g.beginPath(); g.ellipse(-20, 0, 34, 26, 0, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(18, 0, 18, 14, 0, 0, TAU); g.fill();
    g.lineWidth = 5;
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
      const a = (i - 1.5) * 0.55, rx = 14 - i * 2, kx = rx + Math.cos(a) * 52, ky = Math.sin(a) * 62 * s - s * 30;
      g.beginPath(); g.moveTo(rx, 4 * s); g.quadraticCurveTo(kx, ky - 18 * s, kx + Math.cos(a) * 34, ky + s * 46); g.stroke();
    }
  },
  beetle(g) {
    g.beginPath(); g.ellipse(-10, 0, 52, 34, 0, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(42, 0, 20, 18, 0, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(64, 0, 11, 10, 0, 0, TAU); g.fill();
    g.lineWidth = 5;
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) { const x = 38 - i * 32; g.beginPath(); g.moveTo(x, 24 * s); g.lineTo(x + 6 * (1 - i), 56 * s); g.lineTo(x - 10 + i * 10, 74 * s); g.stroke(); }
      g.lineWidth = 3; g.beginPath(); g.moveTo(70, 4 * s); g.quadraticCurveTo(100, 16 * s, 108, 40 * s); g.stroke(); g.lineWidth = 5;
    }
  },
  frog(g) {
    g.beginPath(); g.ellipse(-4, 0, 54, 36, 0, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(52, 0, 26, 28, 0, 0, TAU); g.fill();
    g.lineWidth = 15;
    for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(-34, 22 * s); g.lineTo(-66, 52 * s); g.lineTo(-22, 66 * s); g.stroke();
      g.lineWidth = 9; g.beginPath(); g.moveTo(34, 26 * s); g.lineTo(56, 56 * s); g.stroke(); g.lineWidth = 15;
    }
  },
  lizard(g) {
    g.beginPath(); g.ellipse(8, 0, 56, 14, 0, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(70, 0, 18, 11, 0, 0, TAU); g.fill();
    for (let i = 0; i < 22; i++) {
      const u = i / 22, x = -46 - u * 80, y = Math.sin(u * 4) * 20 * u;
      g.beginPath(); g.ellipse(x, y, 12 * (1 - u) + 2, 8 * (1 - u) + 1.5, 0, 0, TAU); g.fill();
    }
    g.lineWidth = 8;
    for (const s of [-1, 1]) for (const x of [34, -22]) { g.beginPath(); g.moveTo(x, 8 * s); g.lineTo(x + 14, 34 * s); g.lineTo(x + 36, 44 * s); g.stroke(); }
  },
  bug(g) {
    g.beginPath(); g.ellipse(0, 0, 42, 26, 0, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(46, 0, 14, 12, 0, 0, TAU); g.fill();
    g.lineWidth = 6;
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { const x = 24 - i * 24; g.beginPath(); g.moveTo(x, 14 * s); g.lineTo(x + 6, 46 * s); g.stroke(); }
  },
};
const KIND_OF = {
  heron: 'bird', hawk: 'bird', eagle: 'bird', songbird: 'bird', kingfisher: 'bird', owl: 'bird',
  snake: 'snake', frog: 'frog', skink: 'lizard', tadpole: 'fish', pike: 'fish', trout: 'fish', minnow: 'fish',
  spider: 'spider', mite: 'spider', beetle: 'beetle', ant: 'bug', aphid: 'bug', springtail: 'bug', fly: 'bug',
  centipede: 'snake', weasel: 'lizard', shrew: 'lizard', cricket: 'beetle', pillbug: 'beetle',
};
const PLAN_KIND = { insect: 'bug', arachnid: 'spider', isopod: 'beetle', segmented: 'snake', frog: 'frog', lizard: 'lizard', serpent: 'snake', bird: 'bird', fish: 'fish', quadruped: 'lizard' };

function genericSil(kind, blur) {
  const S = 360, c = mk(S, S * 0.8), g = g2(c);
  g.translate(S / 2, S * 0.4);
  g.fillStyle = g.strokeStyle = '#000';
  g.lineCap = g.lineJoin = 'round';
  (SIL[kind] || SIL.bug)(g);
  return { c: blurred(c, blur), len: 220, blurPad: Math.ceil(blur * 2.5) };
}

function alphaBounds(c) {
  const g = g2(c), w = c.width, h = c.height, d = g.getImageData(0, 0, w, h).data;
  if (!d || !d.length) return null;
  let x0 = w, y0 = h, x1 = -1, y1 = -1, solid = 0, tot = 0;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    const a = d[(y * w + x) * 4 + 3];
    if (a > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (a > 230) solid++; tot++; }
  }
  if (x1 < 0) return null;
  const area = ((x1 - x0) / 2 + 1) * ((y1 - y0) / 2 + 1);
  return { x0, y0, x1, y1, fill: solid / area };
}

// Real creature silhouette from the portrait renderer, or null.
function portraitSil(sp, blur) {
  try {
    if (!A.drawPortrait || !(A.LOOKS && A.LOOKS[sp])) return null;
    const N = 160, c = mk(N * 3, N * 3), g = g2(c);
    g.translate(N * 1.5, N * 1.5);
    A.drawPortrait(g, sp, N, { t: 0 });
    const bb = alphaBounds(c);
    if (!bb || bb.fill > 0.9) return null;
    const w = bb.x1 - bb.x0 + 4, h = bb.y1 - bb.y0 + 4;
    const o = mk(w, h), og = g2(o);
    og.drawImage(c, bb.x0 - 2, bb.y0 - 2, w, h, 0, 0, w, h);
    og.globalCompositeOperation = 'source-in';
    og.fillStyle = '#000'; og.fillRect(0, 0, w, h);
    const len = Math.max(w, h);
    return { c: blurred(o, blur * len / 220), len, blurPad: Math.ceil(blur * len / 220 * 2.5) };
  } catch (e) { return null; }
}

function kindFor(sp) {
  if (KIND_OF[sp]) return KIND_OF[sp];
  const look = A.LOOKS && A.LOOKS[sp];
  return (look && PLAN_KIND[look.plan]) || 'bug';
}

// Blurred black silhouette sprite {c, len, blurPad}.
function silhouette(sp, blur, fallbackKind) {
  return portraitSil(sp, blur) || genericSil(KIND_OF[sp] || fallbackKind || kindFor(sp), blur);
}

// ------------------------------------------------------------- decor sprites
const SPR_PPU = 5;

// ---- leaves ---------------------------------------------------------------
const LEAF_COLS = {
  russet: ['#a85a30', '#5e2a14'], ochre: ['#c28a40', '#775020'], olive: ['#7c8038', '#434a1e'],
  umber: ['#7d6040', '#412f1e'], rust: ['#b86e34', '#582e14'], green: ['#6c8c3a', '#34501f'],
  gold: ['#cfa545', '#7e5c20'], moss: ['#5c7a34', '#2e4620'],
  crimson: ['#c4402a', '#601810'], amber: ['#e4962e', '#8c4c14'], scarlet: ['#d2502c', '#6e1c10'],
};

function pinnateShape(L, W, hw, nVeins, sweep) {
  const N = 100;
  const path = (g) => {
    g.beginPath();
    for (let i = 0; i <= N; i++) { const u = i / N; g.lineTo(-L / 2 + u * L, -hw(u, 0)); }
    for (let i = N; i >= 0; i--) { const u = i / N; g.lineTo(-L / 2 + u * L, hw(u, 1)); }
    g.closePath();
  };
  const veins = [[[-L / 2 - 2, 0], [L / 2 * 0.94, 0]]];
  for (let k = 1; k <= nVeins; k++) {
    const u = 0.1 + 0.78 * k / (nVeins + 1), x = -L / 2 + u * L;
    for (const s of [-1, 1]) {
      const reach = hw(Math.min(0.96, u + 0.1), s > 0 ? 1 : 0) * 0.86;
      veins.push([[x, 0], [x + L * sweep * 0.5, s * reach * 0.45], [x + L * sweep, s * reach]]);
    }
  }
  return { L, W, path, veins };
}

function oakShape(rng, L) {
  const W = L * 0.6, lobes = rng.range(3.6, 4.6), ph = rng.range(0, 1);
  const hw = (u, s) => {
    const prof = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.72)), 0.8);
    const lob = 0.5 + 0.5 * Math.pow(Math.abs(Math.sin(u * Math.PI * lobes + ph + s * 1.3)), 0.55);
    return W / 2 * prof * lob;
  };
  return pinnateShape(L, W, hw, 6, 0.1);
}

function birchShape(rng, L) {
  const W = L * 0.68, teeth = rng.range(12, 16);
  const hw = (u, s) => {
    const prof = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.82)), 0.85);
    return W / 2 * prof * (1 + 0.12 * (((u * teeth + s * 0.4) % 1) - 0.5)) * (1 - 0.22 * u);
  };
  return pinnateShape(L, W, hw, 9, 0.12);
}

function mapleShape(rng, R) {
  const ph = rng.range(0, 6);
  const lobes = [[0, 1, 0.62], [1.0, 0.92, 0.58], [-1.0, 0.92, 0.58], [2.05, 0.6, 0.5], [-2.05, 0.6, 0.5]]
    .map(([a, l, s]) => [a + rng.range(-0.06, 0.06), l * rng.range(0.92, 1.06), s]);
  const radius = (th) => {
    let m = 0.36;
    for (const [a, l, s] of lobes) {
      let d = Math.abs(th - a); if (d > Math.PI) d = TAU - d;
      m = Math.max(m, l * Math.pow(Math.max(0, 1 - d / s), 0.72));
    }
    const saw = 1 + 0.07 * (((th * 17 + ph) % 1 + 1) % 1 - 0.5) * 2;
    return R * m * saw;
  };
  const cx = -R * 0.38, N = 240;
  const path = (g) => {
    g.beginPath();
    for (let i = 0; i < N; i++) { const th = -Math.PI + i / N * TAU, r = radius(th); g.lineTo(cx + Math.cos(th) * r, Math.sin(th) * r); }
    g.closePath();
  };
  const veins = lobes.map(([a, l]) => [[cx - 1, 0], [cx + Math.cos(a) * R * l * 0.5, Math.sin(a) * R * l * 0.5], [cx + Math.cos(a) * R * l * 0.86, Math.sin(a) * R * l * 0.86]]);
  veins.push([[cx - R * 0.3, 0], [cx, 0]]);
  return { L: R * 1.4, W: R * 1.6, path, veins, cx };
}

function drawVeins(g, veins, style) {
  const pass = (col, w, dx, dy) => {
    g.strokeStyle = col; g.lineWidth = w; g.beginPath();
    for (const v of veins) {
      g.moveTo(v[0][0] + dx, v[0][1] + dy);
      if (v.length === 3) g.quadraticCurveTo(v[1][0] + dx, v[1][1] + dy, v[2][0] + dx, v[2][1] + dy);
      else g.lineTo(v[1][0] + dx, v[1][1] + dy);
    }
    g.stroke();
  };
  pass(style.dark, style.w, 0, 0);
  pass(style.light, style.w * 0.5, -0.35, -0.4);
}

function paintLeaf(g, sh, cols, rng, decay) {
  const hi = rgb(cols[0]), lo = rgb(cols[1]), L = sh.L, W = sh.W;
  // petiole
  const stemX = sh.cx !== undefined ? sh.cx : -L / 2;
  g.strokeStyle = css(mulc(lo, 0.85)); g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(stemX - L * 0.14, rng.range(-1, 1)); g.lineTo(stemX + 2, 0); g.stroke();
  g.save();
  sh.path(g);
  const gr = g.createLinearGradient(0, -W / 2, 0, W / 2);
  gr.addColorStop(0, css(mulc(hi, 1.1))); gr.addColorStop(0.5, css(mixc(hi, lo, 0.45))); gr.addColorStop(1, css(mulc(lo, 1.05)));
  g.fillStyle = gr; g.fill();
  g.clip();
  // mottling, speckle, form shading
  for (let i = 0; i < 50; i++) {
    g.fillStyle = css(mixc(hi, lo, rng()), rng.range(0.1, 0.3));
    g.beginPath(); g.ellipse(rng.range(-L / 2, L / 2), rng.range(-W / 2, W / 2), rng.range(1.5, 7), rng.range(1.5, 5), rng.range(0, 3), 0, TAU); g.fill();
  }
  for (let i = 0; i < 110; i++) {
    g.fillStyle = `rgba(30,14,4,${rng.range(0.1, 0.3)})`;
    g.beginPath(); g.arc(rng.range(-L / 2, L / 2), rng.range(-W / 2, W / 2), rng.range(0.2, 0.7), 0, TAU); g.fill();
  }
  const sheen = g.createLinearGradient(0, -W / 2, 0, -W / 2 + W * 0.3);
  sheen.addColorStop(0, 'rgba(255,230,170,.2)'); sheen.addColorStop(1, 'rgba(255,230,170,0)');
  g.fillStyle = sheen; g.fillRect(-L, -W, L * 2, W);
  if (decay) {
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 12; i++) {
      g.beginPath();
      g.ellipse(rng.range(-L * 0.4, L * 0.4), rng.range(-W * 0.4, W * 0.4), rng.range(2, 7), rng.range(1.5, 5.5), rng.range(0, 3), 0, TAU);
      g.fill();
    }
    for (let i = 0; i < 6; i++) { // bites out of the rim
      const a = rng.range(0, TAU);
      g.beginPath(); g.arc(Math.cos(a) * L * 0.42, Math.sin(a) * W * 0.42, rng.range(3, 8), 0, TAU); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    drawVeins(g, sh.veins, { dark: css(mulc(lo, 0.55)), light: css(mulc(hi, 0.9), 0.5), w: 1.15 });
  } else {
    drawVeins(g, sh.veins, { dark: 'rgba(40,18,6,.3)', light: 'rgba(255,225,160,.16)', w: 0.6 });
  }
  sh.path(g); g.strokeStyle = 'rgba(28,12,4,.42)'; g.lineWidth = 1.9; g.stroke();
  g.restore();
}

function makeLeaf(rng, kind, colKey, size, decay) {
  const sh = kind === 'oak' ? oakShape(rng, size) : kind === 'maple' ? mapleShape(rng, size * 0.62) : birchShape(rng, size);
  const pad = 9;
  const s = sprite(sh.L + pad * 2, sh.W + pad * 2, SPR_PPU, (g) => paintLeaf(g, sh, LEAF_COLS[colKey], rng, decay));
  return addShadow(s, { blur: 1.8, dx: 0.7, dy: 1.1, a: 0.5 });
}

// ---- twigs ----------------------------------------------------------------
function strokePoly(g, pts, w0, w1, col, extra) {
  const m = pts.length - 1;
  g.strokeStyle = col;
  for (let i = 0; i < m; i++) {
    g.lineWidth = lerp(w0, w1, i / m) + extra;
    g.beginPath(); g.moveTo(pts[i][0], pts[i][1]); g.lineTo(pts[i + 1][0], pts[i + 1][1]); g.stroke();
  }
}

function branchPts(rng, x, y, ang, len, bend) {
  const n = Math.max(4, Math.round(len / 4)), pts = [];
  for (let i = 0; i <= n; i++) {
    pts.push([x, y]);
    ang += (rng() - 0.5) * 0.14 + bend;
    x += Math.cos(ang) * len / n; y += Math.sin(ang) * len / n;
  }
  return pts;
}

function makeTwig(rng, len, w, cols) {
  const dark = cols[0], mid = cols[1], light = cols[2];
  const s = sprite(len * 1.5 + 12, len * 0.6 + 12, SPR_PPU, (g) => {
    const main = branchPts(rng, -len / 2, rng.range(-4, 4), rng.range(-0.15, 0.15), len, rng.range(-0.012, 0.012));
    const parts = [{ pts: main, w0: w, w1: w * 0.4 }];
    const nb = rng.int(1, 3);
    for (let k = 0; k < nb; k++) {
      const i = rng.int(Math.floor(main.length * 0.2), Math.floor(main.length * 0.75)), p = main[i];
      const a = Math.atan2(main[i + 1][1] - p[1], main[i + 1][0] - p[0]) + (rng() < 0.5 ? -1 : 1) * rng.range(0.5, 0.9);
      parts.push({ pts: branchPts(rng, p[0], p[1], a, len * rng.range(0.18, 0.34), rng.range(-0.03, 0.03)), w0: w * 0.5, w1: w * 0.18 });
    }
    for (const p of parts) {
      strokePoly(g, p.pts, p.w0, p.w1, dark, 1.2);
      strokePoly(g, p.pts, p.w0, p.w1, mid, 0);
      const hl = p.pts.map((q) => [q[0] - 0.25 * p.w0, q[1] - 0.3 * p.w0]);
      strokePoly(g, hl, p.w0 * 0.35, p.w1 * 0.3, css(rgb(light), 0.6), 0);
      for (let i = 1; i < p.pts.length - 1; i += 2) { // bark cracks
        const q = p.pts[i], r = p.pts[i + 1], ww = lerp(p.w0, p.w1, i / p.pts.length);
        const nx = -(r[1] - q[1]), ny = r[0] - q[0], nl = Math.hypot(nx, ny) || 1;
        g.strokeStyle = 'rgba(20,10,4,.4)'; g.lineWidth = 0.35;
        g.beginPath(); g.moveTo(q[0] + nx / nl * ww * 0.3, q[1] + ny / nl * ww * 0.3); g.lineTo(q[0] - nx / nl * ww * 0.35, q[1] - ny / nl * ww * 0.35); g.stroke();
      }
    }
    for (let i = 0; i < 3; i++) { // knots + lichen
      const q = main[rng.int(2, main.length - 3)];
      g.fillStyle = 'rgba(25,12,5,.55)'; g.beginPath(); g.ellipse(q[0], q[1], w * 0.2, w * 0.28, 0.5, 0, TAU); g.fill();
      if (rng() < 0.6) { g.fillStyle = 'rgba(150,170,90,.35)'; g.beginPath(); g.ellipse(q[0] + 1, q[1] - w * 0.2, w * 0.55, w * 0.3, 0.3, 0, TAU); g.fill(); }
    }
  });
  return addShadow(s, { blur: 1.4, dx: 0.9, dy: 1.4, a: 0.55 });
}

// ---- pebbles --------------------------------------------------------------
const STONES = [['#948e80', '#4e4a42'], ['#a39580', '#5c5040'], ['#767a78', '#383c3c'], ['#b3a78c', '#6c614d'], ['#857466', '#463a30']];

function makePebble(rng, r, cols) {
  const rx = r * rng.range(0.85, 1.15), ry = r * rng.range(0.7, 0.95), pad = 6;
  const s = sprite(rx * 2 + pad * 2, ry * 2 + pad * 2, SPR_PPU, (g) => {
    const hi = rgb(cols[0]), lo = rgb(cols[1]);
    blobPath(g, 0, 0, rx, ry, rng, 11, 0.22);
    const gr = g.createRadialGradient(-rx * 0.3, -ry * 0.38, r * 0.1, 0, 0, r * 1.15);
    gr.addColorStop(0, css(mulc(hi, 1.15))); gr.addColorStop(0.6, css(mixc(hi, lo, 0.5))); gr.addColorStop(1, css(mulc(lo, 0.9)));
    g.fillStyle = gr; g.fill();
    g.save(); g.clip();
    for (let i = 0; i < r * 9; i++) {
      g.fillStyle = rng() < 0.5 ? `rgba(255,248,225,${rng.range(0.1, 0.28)})` : `rgba(20,15,10,${rng.range(0.1, 0.3)})`;
      g.beginPath(); g.arc(rng.range(-rx, rx), rng.range(-ry, ry), rng.range(0.2, 0.7), 0, TAU); g.fill();
    }
    if (rng() < 0.6) { // mineral vein
      g.strokeStyle = 'rgba(235,230,215,.4)'; g.lineWidth = rng.range(0.4, 0.9);
      g.beginPath(); g.moveTo(-rx, rng.range(-ry, ry) * 0.5); g.quadraticCurveTo(0, rng.range(-ry, ry), rx, rng.range(-ry, ry) * 0.5); g.stroke();
    }
    g.strokeStyle = 'rgba(255,240,210,.18)'; g.lineWidth = r * 0.28; // bounce light
    g.beginPath(); g.arc(0, 0, r * 0.95, 0.2, 1.4); g.stroke();
    g.restore();
    blobPath(g, 0, 0, rx, ry, makeRng(rng.seed), 11, 0.22); // same outline for the rim
    g.strokeStyle = 'rgba(15,10,6,.45)'; g.lineWidth = 0.8; g.stroke();
    g.fillStyle = 'rgba(255,255,245,.34)';
    g.beginPath(); g.ellipse(-rx * 0.32, -ry * 0.42, rx * 0.3, ry * 0.16, -0.5, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.beginPath(); g.ellipse(-rx * 0.38, -ry * 0.46, rx * 0.1, ry * 0.06, -0.5, 0, TAU); g.fill();
  });
  return addShadow(s, { blur: 1.6, dx: 1.3, dy: 1.9, a: 0.6 });
}

// ---- mushrooms (top view) -------------------------------------------------
const MUSH = {
  tan: { cap: ['#c7a77c', '#7d5f3d'], stem: '#e3d6bb', spot: null },
  brown: { cap: ['#8e6a48', '#4b3223'], stem: '#cdbd9d', spot: null },
  red: { cap: ['#b4553a', '#64281b'], stem: '#e0d3b6', spot: '#f0e4c8' },
  pale: { cap: ['#ddd2b6', '#8f8467'], stem: '#efe6d0', spot: null },
};

function makeMushroom(rng, style, n) {
  const st = MUSH[style], caps = [];
  for (let i = 0; i < n; i++) caps.push({ x: i ? rng.range(-9, 9) : 0, y: i ? rng.range(-6, 8) : 0, r: i ? rng.range(3.5, 6.5) : rng.range(6, 9) });
  const s = sprite(36, 36, SPR_PPU, (g) => {
    caps.sort((a, b) => a.y - b.y);
    for (const c of caps) {
      const r = c.r;
      g.fillStyle = css(st.stem); // stem peeks out below the cap
      g.beginPath(); g.ellipse(c.x + r * 0.15, c.y + r * 0.62, r * 0.38, r * 0.62, 0.1, 0, TAU); g.fill();
      g.fillStyle = 'rgba(60,40,20,.28)'; g.beginPath(); g.ellipse(c.x + r * 0.3, c.y + r * 0.9, r * 0.3, r * 0.34, 0.1, 0, TAU); g.fill();
      blobPath(g, c.x, c.y, r, r * 0.94, rng, 12, 0.07);
      const gr = g.createRadialGradient(c.x - r * 0.35, c.y - r * 0.4, r * 0.1, c.x, c.y, r * 1.05);
      gr.addColorStop(0, css(mulc(st.cap[0], 1.12))); gr.addColorStop(1, css(st.cap[1]));
      g.fillStyle = gr; g.fill();
      g.save(); g.clip();
      g.strokeStyle = 'rgba(30,18,8,.12)'; g.lineWidth = 0.35; // gill hint
      for (let k = 0; k < 28; k++) { const a = k / 28 * TAU; g.beginPath(); g.moveTo(c.x + Math.cos(a) * r * 0.55, c.y + Math.sin(a) * r * 0.55); g.lineTo(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r); g.stroke(); }
      if (st.spot) {
        g.fillStyle = css(st.spot, 0.85);
        for (let k = 0; k < 7; k++) { const a = rng.range(0, TAU), d = rng.range(0, r * 0.75); g.beginPath(); g.ellipse(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, rng.range(0.5, 1.3), rng.range(0.4, 1), a, 0, TAU); g.fill(); }
      }
      g.strokeStyle = 'rgba(255,240,200,.3)'; g.lineWidth = r * 0.12; g.beginPath(); g.arc(c.x, c.y, r * 0.88, 3.4, 4.6); g.stroke();
      g.restore();
      g.fillStyle = 'rgba(255,255,240,.4)'; g.beginPath(); g.ellipse(c.x - r * 0.35, c.y - r * 0.42, r * 0.22, r * 0.12, -0.7, 0, TAU); g.fill();
    }
  });
  return addShadow(s, { blur: 1.4, dx: 1, dy: 1.6, a: 0.5 });
}

// ---- moss cushion ---------------------------------------------------------
function makeMoss(rng, R, cols) {
  const s = sprite(R * 2.6, R * 2.6, 4, (g) => {
    const a1 = rng.range(0, 6), a2 = rng.range(0, 6);
    const edge = (th) => 1 + 0.22 * Math.sin(3 * th + a1) + 0.12 * Math.sin(7 * th + a2);
    const base = g.createRadialGradient(0, 0, 0, 0, 0, R * 1.1);
    base.addColorStop(0, css(cols[1], 0.55)); base.addColorStop(0.7, css(cols[1], 0.35)); base.addColorStop(1, css(cols[1], 0));
    g.fillStyle = base; g.beginPath(); g.arc(0, 0, R * 1.1, 0, TAU); g.fill();
    for (let i = 0; i < R * 80; i++) {
      const th = rng.range(0, TAU), d = Math.sqrt(rng()), e = edge(th) * R * 0.95;
      const x = Math.cos(th) * d * e, y = Math.sin(th) * d * e;
      const fade = 1 - Math.pow(d, 3) * 0.55;
      const lite = rng();
      g.strokeStyle = css(mixc(cols[1], cols[0], lite * (1.1 - d * 0.5)), rng.range(0.5, 0.95) * fade);
      g.lineWidth = rng.range(0.35, 0.8);
      const a = rng.range(0, TAU), l = rng.range(0.5, 1.4);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    for (let i = 0; i < R * 1.4; i++) { // lit tips
      const th = rng.range(0, TAU), d = Math.sqrt(rng()) * 0.9, e = edge(th) * R;
      g.fillStyle = css(mulc(cols[0], 1.25), 0.45);
      g.beginPath(); g.arc(Math.cos(th) * d * e - 0.6, Math.sin(th) * d * e - 0.6, rng.range(0.3, 0.7), 0, TAU); g.fill();
    }
  });
  return s;
}

// ---- dew drops ------------------------------------------------------------
function makeDew(r) {
  const s = sprite(r * 2 + 4, r * 2 + 4, 10, (g) => {
    const gr = g.createRadialGradient(r * 0.25, r * 0.3, r * 0.1, 0, 0, r);
    gr.addColorStop(0, 'rgba(210,235,245,.10)'); gr.addColorStop(0.65, 'rgba(120,160,175,.18)'); gr.addColorStop(1, 'rgba(14,34,40,.55)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(230,248,255,.4)'; g.lineWidth = r * 0.14; // caustic crescent bottom-right
    g.beginPath(); g.arc(0, 0, r * 0.7, 0.2, 1.5); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.3)'; g.lineWidth = r * 0.06; g.beginPath(); g.arc(0, 0, r * 0.97, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.95)'; g.beginPath(); g.ellipse(-r * 0.32, -r * 0.4, r * 0.3, r * 0.17, -0.7, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.arc(r * 0.35, r * 0.4, r * 0.09, 0, TAU); g.fill();
  });
  return addShadow(s, { blur: 0.7, dx: 0.5, dy: 0.8, a: 0.45 });
}

// ---- clover (top view) ----------------------------------------------------
function leaflet(g, r, rot) {
  g.save(); g.rotate(rot);
  g.beginPath();
  g.arc(-r * 0.46, -r * 0.7, r * 0.66, 0, TAU);
  g.arc(r * 0.46, -r * 0.7, r * 0.66, 0, TAU);
  g.moveTo(-r * 1.0, -r * 0.55); g.lineTo(0, 0); g.lineTo(r * 1.0, -r * 0.55); g.closePath();
  g.restore();
}

function makeClover(rng, R, cols) {
  const s = sprite(R * 2.4, R * 2.4, SPR_PPU, (g) => {
    const n = rng.int(4, 7), plants = [];
    for (let i = 0; i < n; i++) { const a = rng.range(0, TAU), d = Math.sqrt(rng()) * R * 0.75; plants.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: rng.range(5.4, 8), rot: rng.range(0, TAU) }); }
    plants.sort((a, b) => a.y - b.y);
    for (const p of plants) {
      const base = mixc(cols[0], cols[1], rng());
      g.save(); g.translate(p.x, p.y);
      for (let k = 0; k < 3; k++) {
        const rot = p.rot + k * TAU / 3 + rng.range(-0.15, 0.15);
        g.save(); g.translate(Math.cos(rot) * 0.4, Math.sin(rot) * 0.4); g.rotate(rot + Math.PI / 2);
        const gr = g.createRadialGradient(-p.r * 0.2, -p.r * 0.8, 0, 0, -p.r * 0.6, p.r * 1.3);
        gr.addColorStop(0, css(mulc(base, 1.25))); gr.addColorStop(1, css(mulc(base, 0.7)));
        leaflet(g, p.r, 0); g.fillStyle = gr; g.fill();
        g.strokeStyle = 'rgba(240,248,220,.42)'; g.lineWidth = 0.45; // pale chevron
        g.beginPath(); g.moveTo(-p.r * 0.5, -p.r * 0.75); g.lineTo(0, -p.r * 0.3); g.lineTo(p.r * 0.5, -p.r * 0.75); g.stroke();
        g.restore();
      }
      g.restore();
    }
    if (rng() < 0.5) { // clover flower head
      const fx = rng.range(-R * 0.4, R * 0.4), fy = rng.range(-R * 0.4, R * 0.4);
      for (let i = 0; i < 26; i++) {
        const a = rng.range(0, TAU), d = Math.sqrt(rng()) * 3.2;
        g.fillStyle = css(mixc('#f4eef0', '#e6a8bd', rng() * 0.6), 0.95);
        g.beginPath(); g.ellipse(fx + Math.cos(a) * d, fy + Math.sin(a) * d * 0.9, 1.3, 0.9, a, 0, TAU); g.fill();
      }
    }
  });
  return addShadow(s, { blur: 1.8, dx: 0.5, dy: 0.8, a: 0.4 });
}

// ---- fern frond -----------------------------------------------------------
function paintFern(g, rng, len, cols, curve) {
  const hi = rgb(cols[0]), lo = rgb(cols[1]);
  const spine = (u) => [(u - 0.5) * len, Math.sin(u * Math.PI) * curve * len * 0.15 - u * u * curve * len * 0.08];
  const n = 26;
  g.strokeStyle = css(mulc(lo, 0.8)); g.lineWidth = len * 0.012 + 0.5;
  g.beginPath(); for (let i = 0; i <= 30; i++) { const p = spine(i / 30); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); } g.stroke();
  for (let i = 1; i <= n; i++) {
    const u = 0.04 + 0.94 * i / n, p = spine(u), q = spine(Math.min(1, u + 0.02));
    const ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const pl = len * 0.2 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.95 + 0.08)), 0.8) * (1 - u * 0.5);
    for (const s of [-1, 1]) {
      const a = ang + s * (1.15 - u * 0.35);
      const tipx = p[0] + Math.cos(a) * pl, tipy = p[1] + Math.sin(a) * pl;
      const steps = 6;
      for (let j = 0; j < steps; j++) {
        const t = (j + 0.5) / steps, px = lerp(p[0], tipx, t), py = lerp(p[1], tipy, t);
        const w = pl * 0.2 * (1 - t * 0.75), l = pl / steps * 1.7;
        g.fillStyle = css(mixc(lo, hi, 0.35 + 0.65 * t * rng.range(0.7, 1.1) - (s > 0 ? 0.12 : 0)));
        g.beginPath(); g.ellipse(px, py, l, w, a + s * 0.5, 0, TAU); g.fill();
      }
      g.strokeStyle = css(mulc(lo, 0.7), 0.7); g.lineWidth = 0.35;
      g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(tipx, tipy); g.stroke();
    }
  }
}

function makeFern(rng, len, cols, curve) {
  const s = sprite(len * 1.3, len * 0.8, 4, (g) => paintFern(g, rng, len, cols, curve));
  return addShadow(s, { blur: 2, dx: 1.2, dy: 1.8, a: 0.4 });
}

// ---- seed husks -----------------------------------------------------------
function makeHusk(rng, kind) {
  const s = sprite(34, 34, SPR_PPU, (g) => {
    if (kind === 'samara') { // maple helicopter seed
      for (const s of [-1, 1]) {
        g.save(); g.rotate(s * 0.2); g.translate(0, 0);
        g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(8 * s, -4, 14 * s, -10, 12 * s, -15); g.bezierCurveTo(7 * s, -14, 2 * s, -6, 0, 0);
        const gr = g.createLinearGradient(0, 0, 10 * s, -14); gr.addColorStop(0, '#9c7b46'); gr.addColorStop(1, '#d6bd86');
        g.fillStyle = gr; g.fill(); g.strokeStyle = 'rgba(70,45,20,.5)'; g.lineWidth = 0.4; g.stroke();
        g.strokeStyle = 'rgba(80,52,24,.35)'; g.lineWidth = 0.3;
        for (let k = 1; k < 5; k++) { g.beginPath(); g.moveTo(0.6 * s, -k * 1.2); g.lineTo(9 * s, -k * 2.4 - 1); g.stroke(); }
        g.restore();
      }
      g.fillStyle = '#7a5a30'; g.beginPath(); g.ellipse(0, 1, 2.2, 2.8, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,230,170,.4)'; g.beginPath(); g.ellipse(-0.6, 0, 0.7, 1, 0, 0, TAU); g.fill();
    } else if (kind === 'acorn') { // acorn cup with nut
      g.fillStyle = '#6c4a28'; g.beginPath(); g.ellipse(2.5, 2.5, 5.5, 7, 0.4, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,220,150,.35)'; g.beginPath(); g.ellipse(1, 0.5, 1.4, 3, 0.4, 0, TAU); g.fill();
      const gr = g.createRadialGradient(-2, -2, 1, 0, 0, 8); gr.addColorStop(0, '#9a7a4a'); gr.addColorStop(1, '#50381c');
      g.fillStyle = gr; g.beginPath(); g.arc(-3, -2, 6.6, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(30,16,6,.45)'; g.lineWidth = 0.45;
      for (let r = 1.6; r < 6.5; r += 1.6) { g.beginPath(); for (let a = 0; a < TAU; a += 0.3) { const rr = r + (Math.floor(a / 0.3) % 2) * 0.45; g.lineTo(-3 + Math.cos(a) * rr, -2 + Math.sin(a) * rr); } g.closePath(); g.stroke(); }
      g.fillStyle = '#3f2a14'; g.beginPath(); g.arc(-3, -2, 1, 0, TAU); g.fill();
    } else { // split pod
      for (let k = 0; k < 4; k++) {
        g.save(); g.rotate(k * Math.PI / 2 + 0.3);
        g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(5, -2, 9, -4, 11, -10); g.bezierCurveTo(5, -9, 1, -5, 0, 0);
        const gr = g.createLinearGradient(0, 0, 8, -10); gr.addColorStop(0, '#5c4426'); gr.addColorStop(1, '#a58a58');
        g.fillStyle = gr; g.fill(); g.strokeStyle = 'rgba(30,18,6,.55)'; g.lineWidth = 0.4; g.stroke();
        g.restore();
      }
      g.fillStyle = '#2f2010'; g.beginPath(); g.arc(0, 0, 1.6, 0, TAU); g.fill();
      for (let k = 0; k < 4; k++) { g.fillStyle = '#d3b98a'; g.beginPath(); g.arc(Math.cos(k * 1.6) * 2.2, Math.sin(k * 1.6) * 2.2, 0.7, 0, TAU); g.fill(); }
    }
  });
  return addShadow(s, { blur: 1, dx: 0.8, dy: 1.2, a: 0.5 });
}

// ---- pond: reeds, lily pads, grass tufts ----------------------------------
function makeReeds(rng, cols) {
  const s = sprite(76, 76, 4, (g) => {
    const n = rng.int(14, 20);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, TAU), len = rng.range(18, 34), w = rng.range(0.9, 1.6), bend = rng.range(-0.5, 0.5);
      const ex = Math.cos(a) * len, ey = Math.sin(a) * len, mx = Math.cos(a + bend) * len * 0.55, my = Math.sin(a + bend) * len * 0.55;
      const nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
      g.beginPath(); g.moveTo(nx * 0.5, ny * 0.5); g.quadraticCurveTo(mx + nx, my + ny, ex, ey); g.quadraticCurveTo(mx - nx, my - ny, -nx * 0.5, -ny * 0.5); g.closePath();
      const gr = g.createLinearGradient(0, 0, ex, ey);
      gr.addColorStop(0, css(mulc(cols[1], 0.8))); gr.addColorStop(1, css(mixc(cols[0], '#c8b86a', rng() * 0.5)));
      g.fillStyle = gr; g.fill();
      g.strokeStyle = 'rgba(230,240,170,.22)'; g.lineWidth = 0.3; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(mx, my, ex * 0.9, ey * 0.9); g.stroke();
    }
    for (let k = 0; k < 2; k++) { // cattail heads
      const a = rng.range(0, TAU), d = rng.range(6, 16), x = Math.cos(a) * d, y = Math.sin(a) * d;
      g.strokeStyle = '#5b6b32'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(0, 0); g.lineTo(x, y); g.stroke();
      g.save(); g.translate(x, y); g.rotate(a);
      const gr = g.createLinearGradient(0, -2, 0, 2); gr.addColorStop(0, '#8a6038'); gr.addColorStop(1, '#3e2814');
      g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, 7, 2.1, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,225,170,.3)'; g.beginPath(); g.ellipse(-1, -0.8, 4, 0.6, 0, 0, TAU); g.fill();
      g.restore();
    }
  });
  return addShadow(s, { blur: 2.2, dx: 1.4, dy: 2, a: 0.5 });
}

function makeLilyPad(rng, r, flower) {
  const s = sprite(r * 2 + 14, r * 2 + 14, SPR_PPU, (g) => {
    const notch = rng.range(0.22, 0.4), a0 = rng.range(0, TAU);
    g.save(); g.rotate(a0);
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, r, notch, TAU - notch); g.closePath();
    const gr = g.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.1, 0, 0, r * 1.05);
    gr.addColorStop(0, '#6f9a45'); gr.addColorStop(0.7, '#42682f'); gr.addColorStop(1, '#2a4a24');
    g.fillStyle = gr; g.fill();
    g.save(); g.clip();
    for (let i = 0; i < 34; i++) { // blotches and darker mottling
      g.fillStyle = css(mixc('#9bb55a', '#1f3a1c', rng()), rng.range(0.1, 0.25));
      g.beginPath(); g.ellipse(rng.range(-r, r), rng.range(-r, r), rng.range(1, 4), rng.range(1, 3), rng.range(0, 3), 0, TAU); g.fill();
    }
    g.strokeStyle = 'rgba(20,50,18,.5)'; g.lineWidth = 0.5;
    for (let k = 0; k < 18; k++) { const a = notch + (TAU - 2 * notch) * (k + 0.5) / 18; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); g.stroke(); }
    g.strokeStyle = 'rgba(230,255,190,.3)'; g.lineWidth = 0.35;
    for (let k = 0; k < 18; k++) { const a = notch + (TAU - 2 * notch) * (k + 0.5) / 18; g.beginPath(); g.moveTo(-0.3, -0.3); g.lineTo(Math.cos(a) * r - 0.3, Math.sin(a) * r - 0.3); g.stroke(); }
    g.restore();
    g.strokeStyle = 'rgba(14,34,12,.6)'; g.lineWidth = 0.9;
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, r, notch, TAU - notch); g.closePath(); g.stroke();
    g.strokeStyle = 'rgba(210,240,170,.35)'; g.lineWidth = 0.8; g.beginPath(); g.arc(0, 0, r * 0.94, Math.PI * 0.9, Math.PI * 1.45); g.stroke();
    g.restore();
    g.fillStyle = 'rgba(255,255,235,.14)'; g.beginPath(); g.ellipse(-r * 0.3, -r * 0.32, r * 0.42, r * 0.2, -0.7, 0, TAU); g.fill(); // wet sheen
    if (flower) {
      for (let ring = 0; ring < 2; ring++) for (let k = 0; k < 9; k++) {
        const a = k / 9 * TAU + ring * 0.35, l = r * (ring ? 0.3 : 0.45);
        g.save(); g.translate(r * 0.1, r * 0.05); g.rotate(a);
        g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(l * 0.5, -l * 0.28, l, 0); g.quadraticCurveTo(l * 0.5, l * 0.28, 0, 0);
        g.fillStyle = ring ? '#f4dbe2' : '#e8b3c4'; g.fill(); g.strokeStyle = 'rgba(150,70,100,.3)'; g.lineWidth = 0.3; g.stroke();
        g.restore();
      }
      g.fillStyle = '#e6c24a'; g.beginPath(); g.arc(r * 0.1, r * 0.05, r * 0.1, 0, TAU); g.fill();
    }
  });
  return addShadow(s, { blur: 3, dx: 1, dy: 1.6, a: 0.5 });
}

function makeGrassTuft(rng, cols) {
  const s = sprite(40, 40, SPR_PPU, (g) => {
    const n = rng.int(14, 22);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, TAU), len = rng.range(7, 17), w = rng.range(0.5, 0.9), bend = rng.range(-0.6, 0.6);
      const ex = Math.cos(a + bend) * len, ey = Math.sin(a + bend) * len, mx = Math.cos(a) * len * 0.55, my = Math.sin(a) * len * 0.55;
      const nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
      g.beginPath(); g.moveTo(nx, ny); g.quadraticCurveTo(mx + nx * 0.7, my + ny * 0.7, ex, ey); g.quadraticCurveTo(mx - nx * 0.7, my - ny * 0.7, -nx, -ny); g.closePath();
      g.fillStyle = css(mixc(cols[1], cols[0], rng()), 0.95); g.fill();
    }
  });
  return addShadow(s, { blur: 1.2, dx: 0.6, dy: 1, a: 0.4 });
}

function makeFlower(rng, petal) {
  const s = sprite(18, 18, SPR_PPU, (g) => {
    const n = rng.int(5, 8), len = rng.range(3.2, 4.6);
    for (let k = 0; k < n; k++) {
      g.save(); g.rotate(k / n * TAU + rng.range(-0.1, 0.1));
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(len * 0.55, -len * 0.4, len, 0); g.quadraticCurveTo(len * 0.55, len * 0.4, 0, 0);
      const gr = g.createLinearGradient(0, 0, len, 0); gr.addColorStop(0, css(mulc(petal, 0.82))); gr.addColorStop(1, css(mixc(petal, '#ffffff', 0.35)));
      g.fillStyle = gr; g.fill(); g.strokeStyle = 'rgba(60,40,30,.2)'; g.lineWidth = 0.2; g.stroke();
      g.restore();
    }
    const gr = g.createRadialGradient(-0.3, -0.3, 0, 0, 0, 1.4); gr.addColorStop(0, '#f6dc6a'); gr.addColorStop(1, '#b8892a');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1.3, 0, TAU); g.fill();
  });
  return addShadow(s, { blur: 0.8, dx: 0.5, dy: 0.7, a: 0.35 });
}

// ---- foreground (blurred) sprites ------------------------------------------
// Drawn with the root at the bottom-centre, growing upward; placed at screen edges.
function bladeCluster(g, rng, o) {
  for (let i = 0; i < o.n; i++) {
    const a = rng.range(-o.spread, o.spread), len = o.len * rng.range(0.55, 1), w = o.wid * rng.range(0.7, 1.25), curl = rng.range(-0.5, 0.5);
    const tx = Math.sin(a) * len + curl * len * 0.35, ty = -Math.cos(a) * len;
    const cxp = Math.sin(a) * len * 0.45 - curl * len * 0.2, cyp = -len * 0.55;
    g.beginPath(); g.moveTo(-w / 2, 0); g.quadraticCurveTo(cxp - w * 0.4, cyp, tx, ty); g.quadraticCurveTo(cxp + w * 0.5, cyp, w / 2, 0); g.closePath();
    const gr = g.createLinearGradient(0, 0, tx, ty);
    gr.addColorStop(0, css(o.cols[0])); gr.addColorStop(1, css(mixc(o.cols[1], o.cols[2], rng())));
    g.fillStyle = gr; g.fill();
    g.strokeStyle = css(o.cols[2], 0.25); g.lineWidth = w * 0.1;
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(cxp, cyp, tx * 0.9, ty * 0.9); g.stroke();
  }
}

function makeFg(kind, rng, cols, blur) {
  const W = 340, H = 420;
  const c = mk(W, H), g = g2(c);
  g.translate(W / 2, H - 6); g.lineJoin = g.lineCap = 'round';
  if (kind === 'ferns') {
    for (let i = 0; i < 3; i++) {
      g.save(); g.rotate((i - 1) * 0.55 + rng.range(-0.1, 0.1)); g.translate(0, -140); g.rotate(-Math.PI / 2);
      paintFern(g, rng, 270 - i * 20, cols, rng.range(-0.8, 0.8)); g.restore();
    }
  } else if (kind === 'leaves') {
    for (let i = 0; i < 3; i++) {
      g.save(); g.rotate((i - 1) * 0.6); g.translate(0, -120 - rng.range(0, 40)); g.rotate(-Math.PI / 2 + rng.range(-0.2, 0.2));
      const sh = i === 1 ? mapleShape(rng, 150) : oakShape(rng, 230);
      paintLeaf(g, sh, rng.pick([cols, [cols[1], cols[2]]]), rng, false); g.restore();
    }
  } else {
    bladeCluster(g, rng, { n: 11, spread: 0.65, len: 330, wid: 26, cols });
  }
  return { c: blurred(c, blur), root: H - 6 + Math.ceil(blur * 2.5), w: W + Math.ceil(blur * 2.5) * 2 };
}

// ------------------------------------------------------------ ground textures
// Batched short strokes: colours is an array of css strings, one path per colour.
function strokeBatch(g, S, rng, count, colors, len, lw, alpha, curve) {
  const per = Math.ceil(count / colors.length);
  g.lineCap = 'round';
  g.lineWidth = lw;
  for (const col of colors) {
    g.strokeStyle = col; g.globalAlpha = alpha;
    g.beginPath();
    for (let i = 0; i < per; i++) {
      const x = rng() * S, y = rng() * S, a = rng() * TAU, l = len * (0.5 + rng() * 0.8), c = (rng() - 0.5) * curve;
      const dx = Math.cos(a) * l, dy = Math.sin(a) * l, mx = dx * 0.5 - dy * c, my = dy * 0.5 + dx * c;
      wrapped(S, x, y, len * 1.4, (xx, yy) => { g.moveTo(xx, yy); g.quadraticCurveTo(xx + mx, yy + my, xx + dx, yy + dy); });
    }
    g.stroke();
  }
  g.globalAlpha = 1;
}

function dotBatch(g, S, rng, count, colors, rmin, rmax, alpha) {
  const per = Math.ceil(count / colors.length);
  for (const col of colors) {
    g.fillStyle = col; g.globalAlpha = alpha;
    for (let i = 0; i < per; i++) {
      const r = rmin + (rmax - rmin) * rng(), x = rng() * S, y = rng() * S;
      wrapped(S, x, y, r + 1, (xx, yy) => g.fillRect(xx - r, yy - r, r * 2, r * 2));
    }
  }
  g.globalAlpha = 1;
}

// Colourise three noise fields into a small canvas, then upscale to S.
function baseTexture(seed, S, lut, cellsA, mixFn, bump) {
  const n = 512, fb = noiseGrid(n, 36, seed + 41, 2, 0.5);
  const f1 = noiseGrid(n, cellsA[0], seed, 5, 0.55), f2 = noiseGrid(n, cellsA[1], seed + 11, 3, 0.5), f3 = noiseGrid(n, cellsA[2], seed + 23, 2, 0.5);
  const small = mk(n, n), sg = g2(small), img = sg.createImageData(n, n), d = img.data;
  const out = [0, 0, 0];
  for (let i = 0; i < n * n; i++) {
    let v = f1[i] * 0.5 + f2[i] * 0.33 + f3[i] * 0.17;
    v = clamp((v - 0.5) * 2.3 + 0.5, 0, 1);
    const k = (v * 255) | 0;
    out[0] = lut[k * 3]; out[1] = lut[k * 3 + 1]; out[2] = lut[k * 3 + 2];
    if (mixFn) mixFn(out, f1[i], f2[i], f3[i]);
    let sh = 1;
    if (bump) { // light from the top-left raking over a fine noise height-field
      const x = i % n, y = (i - x) / n;
      const gx = fb[y * n + (x + 1) % n] - fb[y * n + (x + n - 1) % n], gy = fb[((y + 1) % n) * n + x] - fb[((y + n - 1) % n) * n + x];
      sh = 1 - (gx + gy) * bump;
    }
    d[i * 4] = out[0] * sh; d[i * 4 + 1] = out[1] * sh; d[i * 4 + 2] = out[2] * sh; d[i * 4 + 3] = 255;
  }
  sg.putImageData(img, 0, 0);
  return upscale(small, S);
}

function soilTexture(seed, S) {
  const lut = makeLut([[0, '#25170d'], [0.3, '#3a2415'], [0.55, '#513620'], [0.8, '#69482a'], [1, '#7f5b35']]);
  const c = baseTexture(seed, S, lut, [3, 9, 22], (o, a, b, cc) => {
    const olive = clamp((cc - 0.56) * 4, 0, 1) * 0.28, wet = b < 0.4 ? 0.88 : 1;
    o[0] = (o[0] + (78 - o[0]) * olive) * wet; o[1] = (o[1] + (70 - o[1]) * olive) * wet; o[2] = (o[2] + (34 - o[2]) * olive) * wet;
  }, 1.2);
  const g = g2(c), rng = makeRng(seed + 99);
  dotBatch(g, S, rng, 14000, ['#150c06', '#241509', '#7d5d3b', '#9b7a52'], 0.8, 2.6, 0.3);
  scatter(g, S, rng, 380, 14, (r) => ({ r: r.range(3, 8) }), (gg, x, y, p) => { // humus crumbs
    gg.fillStyle = 'rgba(15,8,3,.32)'; gg.beginPath(); gg.arc(x + 1, y + 1.4, p.r, 0, TAU); gg.fill();
    gg.fillStyle = 'rgba(150,115,76,.3)'; gg.beginPath(); gg.arc(x - 0.6, y - 0.8, p.r * 0.85, 0, TAU); gg.fill();
  });
  scatter(g, S, rng, 340, 22, (r) => ({ r: r.range(7, 17) }), (gg, x, y, p) => { // clods lit from the top-left
    const gr = gg.createRadialGradient(x - p.r * 0.35, y - p.r * 0.4, p.r * 0.1, x, y, p.r);
    gr.addColorStop(0, 'rgba(150,108,66,.5)'); gr.addColorStop(0.7, 'rgba(60,38,20,.25)'); gr.addColorStop(1, 'rgba(10,5,2,.35)');
    gg.fillStyle = gr; gg.beginPath(); gg.ellipse(x, y, p.r, p.r * 0.85, 0.4, 0, TAU); gg.fill();
  });
  scatter(g, S, rng, 200, 12, (r) => ({ r: r.range(3, 7) }), (gg, x, y, p) => { // pits
    gg.fillStyle = 'rgba(8,4,1,.5)'; gg.beginPath(); gg.arc(x, y, p.r, 0, TAU); gg.fill();
    gg.strokeStyle = 'rgba(190,150,100,.28)'; gg.lineWidth = 1; gg.beginPath(); gg.arc(x, y, p.r + 0.5, 0.3, 2.2); gg.stroke();
  });
  scatter(g, S, rng, 520, 10, (r) => ({ r: r.range(2, 5), c: r.pick(['#8a826f', '#a1927a', '#6b655a', '#b3a589']), n: r.int(5, 7), a: r.range(0, 6) }), (gg, x, y, p) => { // gravel
    gg.fillStyle = p.c; gg.beginPath();
    for (let i = 0; i < p.n; i++) { const a = p.a + i / p.n * TAU, r = p.r * (0.7 + 0.3 * ((i * 37) % 3) / 2); gg.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    gg.closePath(); gg.globalAlpha = 0.75; gg.fill(); gg.globalAlpha = 1;
    gg.fillStyle = 'rgba(255,250,235,.4)'; gg.fillRect(x - p.r * 0.5, y - p.r * 0.6, p.r * 0.5, p.r * 0.3);
    gg.fillStyle = 'rgba(10,6,2,.4)'; gg.fillRect(x + 0.5, y + p.r * 0.5, p.r * 0.8, 1);
  });
  scatter(g, S, rng, 70, 230, (r) => ({ pts: (() => { const a = []; let x = 0, y = 0, an = r.range(0, TAU); const len = r.int(14, 40); for (let i = 0; i < len; i++) { a.push([x, y]); an += r.range(-0.35, 0.35); x += Math.cos(an) * 5; y += Math.sin(an) * 5; } return a; })(), w: r.range(1, 2.6) }), (gg, x, y, p) => { // rootlets
    gg.lineCap = 'round';
    for (const [col, off, w] of [['rgba(18,10,5,.6)', 0, p.w + 0.8], ['rgba(125,92,58,.45)', -0.8, p.w * 0.45]]) {
      gg.strokeStyle = col; gg.lineWidth = w; gg.beginPath();
      p.pts.forEach((q, i) => (i ? gg.lineTo(x + q[0] + off, y + q[1] + off) : gg.moveTo(x + q[0] + off, y + q[1] + off)));
      gg.stroke();
    }
  });
  scatter(g, S, rng, 700, 34, (r) => ({ s: r.range(8, 28), n: r.int(4, 7), a: r.range(0, 6), c: r.pick(['#65381c', '#775022', '#4f3b1f', '#5a3b20', '#6c4a26', '#403018']) }), (gg, x, y, p) => { // rotted leaf bits
    gg.fillStyle = p.c; gg.globalAlpha = 0.5; gg.beginPath();
    for (let i = 0; i < p.n; i++) { const a = p.a + i / p.n * TAU, r = p.s * (0.5 + 0.5 * ((i * 53) % 4) / 3); gg.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.55); }
    gg.closePath(); gg.fill(); gg.globalAlpha = 1;
    gg.strokeStyle = 'rgba(20,10,4,.3)'; gg.lineWidth = 0.8; gg.beginPath(); gg.moveTo(x - p.s * 0.7, y); gg.lineTo(x + p.s * 0.7, y); gg.stroke();
  });
  strokeBatch(g, S, rng, 260, ['#9a7a4a', '#7a5d36'], 24, 1.1, 0.35, 0);
  return c;
}

function mossTexture(seed, S) {
  const lut = makeLut([[0, '#202f1b'], [0.35, '#2f4526'], [0.65, '#41592d'], [1, '#5a7338']]);
  const c = baseTexture(seed, S, lut, [4, 11, 26], (o, a, b, cc) => {
    const loam = clamp((0.3 - a) * 5, 0, 1) * 0.7; // bare brown patches
    o[0] += (58 - o[0]) * loam; o[1] += (44 - o[1]) * loam; o[2] += (26 - o[2]) * loam;
    const yel = clamp((cc - 0.6) * 3, 0, 1) * 0.25; o[0] += (118 - o[0]) * yel; o[1] += (130 - o[1]) * yel; o[2] += (50 - o[2]) * yel;
  }, 1.3);
  const g = g2(c), rng = makeRng(seed + 99);
  const blot = [];
  for (let i = 0; i < 6; i++) blot.push(css(mixc('#1f2f1a', '#75934a', i / 5)));
  scatter(g, S, rng, 420, 30, (r) => ({ r: r.range(10, 28), l: r.range(0, 1) }), (gg, x, y, p) => { // moss cushions
    const gr = gg.createRadialGradient(x - p.r * 0.2, y - p.r * 0.25, 0, x, y, p.r);
    gr.addColorStop(0, css(mixc('#4c7634', '#8bb056', p.l), 0.34)); gr.addColorStop(1, 'rgba(40,70,36,0)');
    gg.fillStyle = gr; gg.beginPath(); gg.arc(x, y, p.r, 0, TAU); gg.fill();
  });
  strokeBatch(g, S, rng, 36000, blot, 5, 1.4, 0.5, 0.6);
  strokeBatch(g, S, rng, 9000, [css('#a6c870'), css('#c7dc8a')], 3, 0.9, 0.28, 0.3);
  dotBatch(g, S, rng, 2600, ['#0e1b0f', '#193019'], 1, 2.4, 0.4);
  scatter(g, S, rng, 160, 12, (r) => ({ s: r.range(5, 11), a: r.range(0, 6), c: r.pick(['#6a4a26', '#7b5a2c', '#554022']) }), (gg, x, y, p) => { // dead leaf bits
    gg.fillStyle = p.c; gg.globalAlpha = 0.7; gg.beginPath(); gg.ellipse(x, y, p.s, p.s * 0.45, p.a, 0, TAU); gg.fill(); gg.globalAlpha = 1;
  });
  return c;
}

function grassTexture(seed, S) {
  const lut = makeLut([[0, '#2d3d1c'], [0.35, '#42562a'], [0.65, '#586f34'], [1, '#788a44']]);
  const c = baseTexture(seed, S, lut, [4, 12, 24], (o, a, b, cc) => {
    const mud = clamp((0.34 - a) * 5, 0, 1) * 0.65;
    o[0] += (72 - o[0]) * mud; o[1] += (58 - o[1]) * mud; o[2] += (34 - o[2]) * mud;
    const dry = clamp((cc - 0.58) * 3.5, 0, 1) * 0.4; o[0] += (150 - o[0]) * dry; o[1] += (132 - o[1]) * dry; o[2] += (62 - o[2]) * dry;
  }, 1.0);
  const g = g2(c), rng = makeRng(seed + 99);
  const blades = [];
  for (let i = 0; i < 8; i++) blades.push(css(mixc('#2a3a19', '#8da24a', i / 7)));
  blades.push(css('#a39a52'), css('#b3a860'));
  strokeBatch(g, S, rng, 40000, blades, 17, 1.2, 0.5, 0.7);
  strokeBatch(g, S, rng, 14000, [css('#cddc8a'), css('#e0e6a6')], 11, 0.8, 0.25, 0.5);
  dotBatch(g, S, rng, 3500, ['#1a1a0c', '#2b2412', '#6d5a35'], 0.8, 2.2, 0.35);
  scatter(g, S, rng, 240, 20, (r) => ({ r: r.range(4, 12) }), (gg, x, y, p) => {
    gg.fillStyle = 'rgba(40,28,14,.22)'; gg.beginPath(); gg.ellipse(x, y, p.r, p.r * 0.6, 0.3, 0, TAU); gg.fill();
  });
  return c;
}

function mudTexture(seed, S) {
  const lut = makeLut([[0, '#2b2115'], [0.5, '#43331e'], [1, '#5c4a2a']]);
  const c = baseTexture(seed, S, lut, [4, 10, 20], null, 1.2);
  const g = g2(c), rng = makeRng(seed + 7);
  dotBatch(g, S, rng, 7000, ['#1a120a', '#7b6644', '#2a1f12'], 0.8, 2.4, 0.3);
  scatter(g, S, rng, 160, 24, (r) => ({ rx: r.range(6, 22), ry: r.range(2, 7), a: r.range(0, 3) }), (gg, x, y, p) => { // wet sheen
    gg.fillStyle = 'rgba(190,205,190,.12)'; gg.beginPath(); gg.ellipse(x, y, p.rx, p.ry, p.a, 0, TAU); gg.fill();
    gg.fillStyle = 'rgba(15,10,5,.2)'; gg.beginPath(); gg.ellipse(x + 2, y + 2, p.rx * 0.9, p.ry * 0.8, p.a, 0, TAU); gg.fill();
  });
  strokeBatch(g, S, rng, 200, ['#18110a'], 30, 1, 0.4, 1.2);
  return c;
}

// Sun/shade pattern for 'overlay': neutral grey, darker shade, warm bright sun gaps.
function dappleTexture(seed, S, tint, shade) {
  const n = 512, f = noiseGrid(n, 6, seed, 4, 0.55), f2 = noiseGrid(n, 15, seed + 9, 2, 0.5);
  const small = mk(n, n), sg = g2(small), img = sg.createImageData(n, n), d = img.data, col = rgb(tint), sh = shade === undefined ? 110 : shade;
  for (let i = 0; i < n * n; i++) {
    const sun = smooth((f[i] * 0.78 + f2[i] * 0.22 - 0.54) / 0.1);
    d[i * 4] = lerp(sh, col[0], sun); d[i * 4 + 1] = lerp(sh, col[1], sun); d[i * 4 + 2] = lerp(sh, col[2], sun); d[i * 4 + 3] = 255;
  }
  sg.putImageData(img, 0, 0);
  return upscale(small, S);
}

function causticTexture(seed, S) {
  const n = 256, a = noiseGrid(n, 6, seed, 4, 0.55), b = noiseGrid(n, 8, seed + 31, 4, 0.55);
  const small = mk(n, n), sg = g2(small), img = sg.createImageData(n, n), d = img.data;
  for (let i = 0; i < n * n; i++) {
    const r1 = clamp(1 - Math.abs(a[i] - 0.5) / 0.03, 0, 1), r2 = clamp(1 - Math.abs(b[i] - 0.5) / 0.03, 0, 1);
    const v = clamp(r1 * r1 + r2 * r2 + r1 * r2 * 0.6, 0, 1);
    d[i * 4] = 235; d[i * 4 + 1] = 255; d[i * 4 + 2] = 190; d[i * 4 + 3] = v * 255;
  }
  sg.putImageData(img, 0, 0);
  return upscale(small, S);
}

// ------------------------------------------------------ chunked decor engine
function makeDecor(world, cs) {
  const n = Math.ceil(world / cs);
  const d = { cs, n, z: [], maxRad: 0 };
  for (let k = 0; k < 6; k++) d.z.push(new Array(n * n).fill(null));
  d.add = (z, s, x, y, rot, sc, o) => {
    const ci = clamp(Math.floor(y / cs), 0, n - 1) * n + clamp(Math.floor(x / cs), 0, n - 1);
    const arr = d.z[z][ci] || (d.z[z][ci] = []);
    arr.push({ s, x, y, rot, cos: Math.cos(rot), sin: Math.sin(rot), sc, fx: o && o.flip ? -1 : 1, a: o && o.a !== undefined ? o.a : 1, bob: (o && o.bob) || 0, ph: (o && o.ph) || 0 });
    if (s.rad * sc > d.maxRad) d.maxRad = s.rad * sc;
  };
  return d;
}

function viewRect(cam, pad) {
  const hw = A.W / 2 / cam.zoom + pad, hh = A.H / 2 / cam.zoom + pad;
  return { x0: cam.x - hw, y0: cam.y - hh, x1: cam.x + hw, y1: cam.y + hh };
}

function drawDecor(ctx, cam, dec, zs, t) {
  const D = A.DPR || 1, W = A.W, H = A.H, z = cam.zoom;
  const ox = W / 2 - cam.x * z + cam.shakeX, oy = H / 2 - cam.y * z + cam.shakeY;
  const v = viewRect(cam, dec.maxRad), cs = dec.cs, n = dec.n;
  const cx0 = clamp(Math.floor(v.x0 / cs), 0, n - 1), cx1 = clamp(Math.floor(v.x1 / cs), 0, n - 1);
  const cy0 = clamp(Math.floor(v.y0 / cs), 0, n - 1), cy1 = clamp(Math.floor(v.y1 / cs), 0, n - 1);
  ctx.imageSmoothingEnabled = true;
  for (let zi = 0; zi < zs.length; zi++) {
    const bucket = dec.z[zs[zi]];
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const arr = bucket[cy * n + cx];
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const it = arr[i], s = it.s, px = it.x * z + ox, py = it.y * z + oy, rpx = s.rad * it.sc * z * 1.05;
        if (px < -rpx || px > W + rpx || py < -rpx || py > H + rpx) continue;
        let k = D * z * it.sc / s.ppu, cs_ = it.cos, sn = it.sin;
        if (it.bob) {
          const b = 1 + it.bob * Math.sin(t * 1.3 + it.ph), r = it.rot + it.bob * 1.5 * Math.sin(t * 0.7 + it.ph * 1.7);
          k *= b; cs_ = Math.cos(r); sn = Math.sin(r);
        }
        ctx.setTransform(k * cs_ * it.fx, k * sn * it.fx, -k * sn, k * cs_, D * px, D * py);
        ctx.globalAlpha = it.a;
        ctx.drawImage(s.c, -s.c.width / 2, -s.c.height / 2);
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(D, 0, 0, D, 0, 0);
}

// Pattern-fill the screen with a tiled texture. q = layer scale/parallax (1 = ground).
function getPat(ctx, canvas) {
  if (canvas._patCtx !== ctx || !canvas._pat) { canvas._pat = ctx.createPattern(canvas, 'repeat'); canvas._patCtx = ctx; }
  return canvas._pat;
}

function fillTile(ctx, cam, canvas, tileUnits, q, ox, oy, alpha, comp) {
  const D = A.DPR || 1, W = A.W, H = A.H, k = canvas.width / tileUnits, a = cam.zoom * q / k;
  const e = W / 2 + (ox - cam.x) * cam.zoom * q + cam.shakeX * q, f = H / 2 + (oy - cam.y) * cam.zoom * q + cam.shakeY * q;
  ctx.save();
  ctx.globalAlpha = alpha === undefined ? 1 : alpha;
  if (comp) ctx.globalCompositeOperation = comp;
  ctx.setTransform(D * a, 0, 0, D * a, D * e, D * f);
  ctx.fillStyle = getPat(ctx, canvas);
  ctx.fillRect(-e / a, -f / a, W / a, H / a);
  ctx.restore();
}

// Periodic particle field: positions repeat every P units around the camera.
const wrapRel = (v, P) => ((((v + P / 2) % P) + P) % P) - P / 2;

function makeGlow(size, color) {
  const c = mk(size, size), g = g2(c), h = size / 2, col = rgb(color);
  const gr = g.createRadialGradient(h, h, 0, h, h, h);
  gr.addColorStop(0, css(col, 1)); gr.addColorStop(0.25, css(col, 0.55)); gr.addColorStop(1, css(col, 0));
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return c;
}

function makeMotes(rng, n, o) {
  const a = [];
  for (let i = 0; i < n; i++) a.push({
    x: rng.range(0, o.P), y: rng.range(0, o.P), vx: rng.range(o.vx[0], o.vx[1]), vy: rng.range(o.vy[0], o.vy[1]),
    q: rng.range(o.q[0], o.q[1]), r: rng.range(o.r[0], o.r[1]), ph: rng.range(0, TAU), a: rng.range(o.a[0], o.a[1]), sp: rng.range(0.5, 1.6),
  });
  return a;
}

function drawMotes(ctx, cam, t, motes, glow, P, comp, steady) {
  if (World.quality < 1) return;
  const D = A.DPR || 1, W = A.W, H = A.H, z = cam.zoom;
  ctx.save();
  ctx.globalCompositeOperation = comp || 'lighter';
  for (let i = 0; i < motes.length; i++) {
    const m = motes[i];
    const ux = m.x + m.vx * t + Math.sin(t * 0.5 * m.sp + m.ph) * 6, uy = m.y + m.vy * t + Math.cos(t * 0.4 * m.sp + m.ph * 1.3) * 5;
    const sx = W / 2 + wrapRel(ux - cam.x, P) * z * m.q, sy = H / 2 + wrapRel(uy - cam.y, P) * z * m.q;
    const r = Math.max(1.6, m.r * z * m.q);
    if (sx < -r || sx > W + r || sy < -r || sy > H + r) continue;
    ctx.globalAlpha = steady ? m.a : m.a * (0.55 + 0.45 * Math.sin(t * 1.4 * m.sp + m.ph));
    ctx.drawImage(glow, sx - r * 2, sy - r * 2, r * 4, r * 4);
  }
  ctx.restore();
  ctx.setTransform(D, 0, 0, D, 0, 0);
}

// ----------------------------------------------------------------- lake model
// Water body from a blob field -> contour polygons + signed-distance grid.
function makeLake(world, rng, o) {
  const N = 129, cell = world / (N - 1), F = new Float32Array(N * N), seed = rng.int(1, 9999);
  const keepR = 0.17 * world, edgeW = 0.075 * world;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i * cell, y = j * cell;
    let v = 0;
    for (const b of o.blobs) { const dx = x - b.x * world, dy = y - b.y * world; v += b.w * Math.exp(-(dx * dx + dy * dy) / (2 * b.s * b.s * world * world)); }
    v += 0.7 * (vnoise(x / 420, y / 420, seed + 2) - 0.5) + 0.55 * (vnoise(x / 260, y / 260, seed) - 0.5) + 0.3 * (vnoise(x / 120, y / 120, seed + 5) - 0.5) + 0.12 * (vnoise(x / 55, y / 55, seed + 9) - 0.5);
    const cx = x - o.keep[0] * world, cy = y - o.keep[1] * world;
    v -= 1.2 * Math.exp(-(cx * cx + cy * cy) / (2 * keepR * keepR));
    v -= 2.2 * smooth(1 - Math.min(x, y, world - x, world - y) / edgeW);
    F[j * N + i] = v;
  }
  let lo = -1, hi = 2, thr = 0;
  for (let it = 0; it < 26; it++) {
    thr = (lo + hi) / 2;
    let c = 0; for (let i = 0; i < F.length; i++) if (F[i] > thr) c++;
    if (c / F.length > o.coverage) lo = thr; else hi = thr;
  }
  for (let i = 0; i < F.length; i++) F[i] -= thr;
  const loops = contours(F, N, cell).map((l) => chaikin(chaikin(l)));
  const sd = signedDist(F, N, cell);
  const lake = { N, cell, F, sd, loops, world };
  lake.isWater = (x, y) => sampleGrid(F, N, cell, x, y) > 0;
  lake.dist = (x, y) => sampleGrid(sd, N, cell, x, y);
  lake.bbox = loops.map((l) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of l) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; } return { x0, y0, x1, y1 }; });
  return lake;
}

function tileSample(arr, n, x, y) {
  const i = Math.floor(x), j = Math.floor(y), tx = x - i, ty = y - j, i0 = i % n, j0 = j % n, i1 = (i + 1) % n, j1 = (j + 1) % n;
  return lerp(lerp(arr[j0 * n + i0], arr[j0 * n + i1], tx), lerp(arr[j1 * n + i0], arr[j1 * n + i1], tx), ty);
}

function sampleGrid(arr, N, cell, x, y) {
  const fx = clamp(x / cell, 0, N - 1.001), fy = clamp(y / cell, 0, N - 1.001), i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
  const a = arr[j * N + i], b = arr[j * N + i + 1], c = arr[(j + 1) * N + i], d = arr[(j + 1) * N + i + 1];
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

function signedDist(F, N, cell) {
  const INF = 1e6, dIn = new Float32Array(N * N), dOut = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) { const inside = F[i] > 0; dIn[i] = inside ? INF : 0; dOut[i] = inside ? 0 : INF; }
  const pass = (d) => {
    const R2 = 1.4142;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let v = d[j * N + i];
      if (i > 0) v = Math.min(v, d[j * N + i - 1] + 1);
      if (j > 0) { v = Math.min(v, d[(j - 1) * N + i] + 1); if (i > 0) v = Math.min(v, d[(j - 1) * N + i - 1] + R2); if (i < N - 1) v = Math.min(v, d[(j - 1) * N + i + 1] + R2); }
      d[j * N + i] = v;
    }
    for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) {
      let v = d[j * N + i];
      if (i < N - 1) v = Math.min(v, d[j * N + i + 1] + 1);
      if (j < N - 1) { v = Math.min(v, d[(j + 1) * N + i] + 1); if (i < N - 1) v = Math.min(v, d[(j + 1) * N + i + 1] + R2); if (i > 0) v = Math.min(v, d[(j + 1) * N + i - 1] + R2); }
      d[j * N + i] = v;
    }
  };
  pass(dIn); pass(dOut);
  const sd = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) sd[i] = F[i] > 0 ? (dIn[i] - 0.5) * cell : -(dOut[i] - 0.5) * cell;
  return sd;
}

// Marching squares at iso 0 -> closed polylines (water = positive).
function contours(F, N, cell) {
  const adj = new Map(), pos = new Map();
  const hId = (i, j) => (j * N + i) * 2, vId = (i, j) => (j * N + i) * 2 + 1;
  const hPt = (i, j) => { const a = F[j * N + i], b = F[j * N + i + 1]; return [(i + a / (a - b)) * cell, j * cell]; };
  const vPt = (i, j) => { const a = F[j * N + i], b = F[(j + 1) * N + i]; return [i * cell, (j + a / (a - b)) * cell]; };
  const link = (p, q) => {
    for (const [a, b] of [[p, q], [q, p]]) { if (!adj.has(a[0])) adj.set(a[0], []); adj.get(a[0]).push(b[0]); pos.set(a[0], a[1]); }
  };
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = F[j * N + i] > 0, b = F[j * N + i + 1] > 0, c = F[(j + 1) * N + i + 1] > 0, d = F[(j + 1) * N + i] > 0;
    const idx = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0);
    if (idx === 0 || idx === 15) continue;
    const T = () => [hId(i, j), hPt(i, j)], R = () => [vId(i + 1, j), vPt(i + 1, j)], B = () => [hId(i, j + 1), hPt(i, j + 1)], L = () => [vId(i, j), vPt(i, j)];
    const avg = (F[j * N + i] + F[j * N + i + 1] + F[(j + 1) * N + i + 1] + F[(j + 1) * N + i]) / 4;
    switch (idx) {
      case 1: case 14: link(L(), T()); break;
      case 2: case 13: link(T(), R()); break;
      case 3: case 12: link(L(), R()); break;
      case 4: case 11: link(R(), B()); break;
      case 5: if (avg > 0) { link(L(), B()); link(T(), R()); } else { link(L(), T()); link(R(), B()); } break;
      case 6: case 9: link(T(), B()); break;
      case 7: case 8: link(L(), B()); break;
      case 10: if (avg > 0) { link(L(), T()); link(R(), B()); } else { link(L(), B()); link(T(), R()); } break;
    }
  }
  const loops = [], used = new Set();
  for (const start of adj.keys()) {
    if (used.has(start)) continue;
    const loop = [];
    let prev = -1, cur = start;
    for (let guard = 0; guard < 20000; guard++) {
      used.add(cur); loop.push(pos.get(cur));
      const nb = adj.get(cur);
      const next = nb[0] !== prev && !used.has(nb[0]) ? nb[0] : (nb[1] !== undefined && nb[1] !== prev && !used.has(nb[1]) ? nb[1] : -1);
      if (next < 0) break;
      prev = cur; cur = next;
    }
    if (loop.length > 6) loops.push(loop);
  }
  return loops;
}

function chaikin(pts) {
  const out = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    out.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25], [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
  }
  return out;
}

// Trace polygons in screen space; skip loops that miss the view.
function tracePolys(ctx, cam, lake) {
  const W = A.W, H = A.H, z = cam.zoom, ox = W / 2 - cam.x * z + cam.shakeX, oy = H / 2 - cam.y * z + cam.shakeY;
  const v = viewRect(cam, 20);
  for (let k = 0; k < lake.loops.length; k++) {
    const b = lake.bbox[k];
    if (b.x1 < v.x0 || b.x0 > v.x1 || b.y1 < v.y0 || b.y0 > v.y1) continue;
    const l = lake.loops[k];
    ctx.moveTo(l[0][0] * z + ox, l[0][1] * z + oy);
    for (let i = 1; i < l.length; i++) ctx.lineTo(l[i][0] * z + ox, l[i][1] * z + oy);
    ctx.closePath();
  }
}

// Open polylines of just the coast runs near the view (for strokes).
function traceCoast(ctx, cam, lake) {
  const W = A.W, H = A.H, z = cam.zoom, ox = W / 2 - cam.x * z + cam.shakeX, oy = H / 2 - cam.y * z + cam.shakeY;
  const v = viewRect(cam, 60);
  for (let k = 0; k < lake.loops.length; k++) {
    const b = lake.bbox[k];
    if (b.x1 < v.x0 || b.x0 > v.x1 || b.y1 < v.y0 || b.y0 > v.y1) continue;
    const l = lake.loops[k], n = l.length;
    let pen = false;
    for (let i = 0; i <= n; i += 1) {
      const p = l[i % n];
      const vis = p[0] > v.x0 && p[0] < v.x1 && p[1] > v.y0 && p[1] < v.y1;
      if (vis) { if (!pen) { ctx.moveTo(p[0] * z + ox, p[1] * z + oy); pen = true; } else ctx.lineTo(p[0] * z + ox, p[1] * z + oy); } else pen = false;
    }
  }
}

// Water depth map (whole world, ~2.5 units/px): colour + alpha by distance from shore.
function waterMap(lake, seed, o) {
  const S = 1024, c = mk(S, S), g = g2(c), img = g.createImageData(S, S), d = img.data, ws = lake.world / S;
  const n1 = noiseGrid(256, 5, seed, 4, 0.55), n2 = noiseGrid(256, 12, seed + 3, 3, 0.5);
  const shallow = rgb(o.shallow), mid = rgb(o.mid), deep = rgb(o.deep), silt = rgb(o.silt), weed = rgb(o.weed);
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const s = sampleGrid(lake.sd, lake.N, lake.cell, (px + 0.5) * ws, (py + 0.5) * ws), i = (py * S + px) * 4;
    if (s < -14) { d[i + 3] = 0; continue; }
    const a = tileSample(n1, 256, px / 4, py / 4), b = tileSample(n2, 256, px / 4, py / 4);
    const t = smooth(s / 230), t2 = smooth(s / 90);
    let col = mixc(mixc(shallow, mid, t2), deep, Math.pow(t, 0.9));
    col = mixc(col, silt, smooth((a - 0.45) * 3) * 0.32 * (1 - t * 0.6));
    col = mixc(col, weed, smooth((b - 0.4) * 2.4) * 0.16 * (0.4 + t * 0.6));
    const alpha = lerp(o.alphaShallow, o.alphaDeep, t) + (a - 0.5) * 0.1;
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2];
    d[i + 3] = clamp((alpha * clamp((s + 14) / 24, 0, 1)) * 255, 0, 255);
  }
  g.putImageData(img, 0, 0);
  // underwater smudges (weed beds, shadows of rocks)
  const rng = makeRng(seed + 17);
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 160; i++) {
    const x = rng() * S, y = rng() * S, r = rng.range(8, 34), dark = rng() < 0.65;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, dark ? 'rgba(10,26,14,.28)' : 'rgba(170,170,100,.16)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r, r * rng.range(0.5, 1), rng.range(0, 3), 0, TAU); g.fill();
  }
  return c;
}

function drawEdges(ctx, cam, world, fog) {
  const W = A.W, H = A.H, z = cam.zoom, X = (x) => (x - cam.x) * z + W / 2 + cam.shakeX, Y = (y) => (y - cam.y) * z + H / 2 + cam.shakeY;
  const l = X(0), r = X(world), tp = Y(0), b = Y(world), fade = 100 * z;
  if (l > -fade || r < W + fade || tp > -fade || b < H + fade) {
    ctx.save();
    const solid = css(fog, 0.97), soft = (x0, y0, x1, y1) => {
      const gr = ctx.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, css(fog, 0.92)); gr.addColorStop(0.3, css(fog, 0.5)); gr.addColorStop(0.65, css(fog, 0.16)); gr.addColorStop(1, css(fog, 0));
      return gr;
    };
    if (l > -fade) { ctx.fillStyle = soft(l, 0, l + fade, 0); ctx.fillRect(l, 0, fade, H); }
    if (r < W + fade) { ctx.fillStyle = soft(r, 0, r - fade, 0); ctx.fillRect(r - fade, 0, fade, H); }
    if (tp > -fade) { ctx.fillStyle = soft(0, tp, 0, tp + fade); ctx.fillRect(0, tp, W, fade); }
    if (b < H + fade) { ctx.fillStyle = soft(0, b, 0, b - fade); ctx.fillRect(0, b - fade, W, fade); }
    ctx.fillStyle = solid;
    if (l > 0) ctx.fillRect(0, 0, l, H);
    if (r < W) ctx.fillRect(r, 0, W - r, H);
    if (tp > 0) ctx.fillRect(0, 0, W, tp);
    if (b < H) ctx.fillRect(0, b, W, H - b);
    ctx.restore();
  }
}

// ------------------------------------------------------------------- biomes
const FG_BLADES = { kind: 'blades', cols: ['#16260f', '#38561f', '#6f8f3a'] };

// Shared light overlays: dappled canopy light and drifting motes.
function drawDapples(ctx, cam, t, st, o) {
  fillTile(ctx, cam, st.dapple, o.tile, 1.12, t * o.vx, t * o.vy, o.alpha, 'overlay');
  if (World.quality < 1) return;
  fillTile(ctx, cam, st.dapple, o.tile * 0.62, 1.26, 90 - t * o.vx * 0.7, 40 + t * o.vy * 1.4, o.alpha * 0.7, 'overlay');
}

function placeDew(dec, sp, rng, x, y, rad, p) {
  if (!rng.chance(p)) return;
  for (let m = rng.int(1, 3); m-- > 0;) {
    const a = rng() * TAU, d = rng.range(0, rad * 0.45);
    dec.add(3, rng.pick(sp.dew), x + Math.cos(a) * d, y + Math.sin(a) * d, 0, rng.range(0.85, 1.2));
  }
}

// ---- litter ---------------------------------------------------------------
function buildLitterSprites(rng) {
  const sp = { leaves: [], decayed: [], small: [], twigs: [], pebbles: [], mush: [], moss: [], dew: [], husks: [] };
  const kinds = [['oak', 80], ['maple', 70], ['birch', 58]];
  for (const [k, size] of kinds) for (const col of ['russet', 'ochre', 'olive', 'umber', 'rust']) sp.leaves.push(makeLeaf(rng.sub(k + col), k, col, size * rng.range(0.92, 1.08), false));
  for (const [k, col] of [['oak', 'umber'], ['oak', 'russet'], ['maple', 'ochre'], ['maple', 'umber'], ['birch', 'umber']]) sp.decayed.push(makeLeaf(rng.sub('d' + k + col), k, col, kinds.find((x) => x[0] === k)[1], true));
  for (const [k, col] of [['oak', 'umber'], ['birch', 'ochre'], ['maple', 'russet'], ['birch', 'olive'], ['oak', 'rust']]) sp.small.push(makeLeaf(rng.sub('s' + k + col), k, col, rng.range(24, 32), rng() < 0.4));
  for (const [len, w] of [[70, 5], [95, 6], [120, 7], [85, 5.5]]) sp.twigs.push(makeTwig(rng.sub('t' + len), len, w, ['#24160c', '#5d4228', '#a68a5c']));
  for (const r of [6, 8, 10, 12, 15, 18, 22, 9, 11, 14]) sp.pebbles.push(makePebble(rng.sub('p' + r + sp.pebbles.length), r, rng.pick(STONES)));
  for (const [style, n] of [['tan', 1], ['tan', 3], ['brown', 2], ['red', 2], ['pale', 3]]) sp.mush.push(makeMushroom(rng.sub('m' + style + n), style, n));
  for (const R of [22, 30, 38]) sp.moss.push(makeMoss(rng.sub('mo' + R), R, ['#8aaa52', '#2e4a22']));
  for (const r of [1.4, 2.1, 3]) sp.dew.push(makeDew(r));
  for (const k of ['samara', 'acorn', 'pod']) sp.husks.push(makeHusk(rng.sub(k), k));
  return sp;
}

function placeLitter(dec, sp, rng, world, seed) {
  const cs = dec.cs, n = dec.n;
  for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) {
    const x0 = cx * cs, y0 = cy * cs, P = () => [x0 + rng() * cs, y0 + rng() * cs];
    const dens = 0.3 + 1.5 * smooth(vnoise(cx * 0.42, cy * 0.42, seed % 977));
    if (rng() < 0.2) { const [x, y] = P(); dec.add(0, rng.pick(sp.moss), x, y, rng() * TAU, rng.range(0.8, 1.3), { a: 0.95 }); }
    for (let k = Math.floor(1.25 * dens + rng()); k-- > 0;) {
      const spr = rng() < 0.22 ? rng.pick(sp.decayed) : rng.pick(sp.leaves), [x, y] = P();
      dec.add(1, spr, x, y, rng() * TAU, rng.range(0.8, 1.25), { flip: rng() < 0.5, a: rng.range(0.9, 1) });
      placeDew(dec, sp, rng, x, y, spr.rad, 0.5);
    }
    for (let k = Math.floor(1.9 * dens + rng()); k-- > 0;) { const [x, y] = P(); dec.add(1, rng.pick(sp.small), x, y, rng() * TAU, rng.range(0.8, 1.3), { flip: rng() < 0.5 }); }
    if (rng() < 0.4 * dens) { const [x, y] = P(); dec.add(2, rng.pick(sp.twigs), x, y, rng() * TAU, rng.range(0.85, 1.25), { flip: rng() < 0.5 }); }
    for (let k = Math.floor(0.9 * (1.25 - 0.45 * dens) + rng()); k-- > 0;) { const [x, y] = P(); dec.add(2, rng.pick(sp.pebbles), x, y, 0, rng.range(0.85, 1.2), { flip: rng() < 0.5 }); placeDew(dec, sp, rng, x, y, 8, 0.12); }
    if (rng() < 0.07) { const [x, y] = P(); dec.add(3, rng.pick(sp.mush), x, y, 0, rng.range(0.9, 1.25)); }
    if (rng() < 0.2 * dens) { const [x, y] = P(); dec.add(2, rng.pick(sp.husks), x, y, rng() * TAU, rng.range(0.9, 1.3)); }
  }
}

A.Biomes.litter = {
  habitat: 'land',
  palette: { bg: '#2b1c11', grade: '#ffd9a0', fog: '#0b0704' },
  depth: { giants: ['spider', 'beetle'], specks: ['mite', 'springtail', 'aphid'], fg: [{ kind: 'leaves', cols: ['#a85a30', '#5e2a14', '#c28a40'] }, FG_BLADES] },
  build(tier, rng) {
    const world = tier.world || 2600, st = { world };
    st.tex = soilTexture(rng.seed, 2048); st.texUnits = 512;
    st.dec = makeDecor(world, 128);
    placeLitter(st.dec, buildLitterSprites(rng.sub('spr')), rng.sub('place'), world, rng.seed);
    st.dapple = dappleTexture(rng.seed + 5, 1024, '#ffe2a0');
    st.glow = makeGlow(48, '#ffe9b0');
    st.motes = makeMotes(rng.sub('motes'), 64, { P: 900, vx: [-3, 5], vy: [-5, 2], q: [0.9, 1.5], r: [0.9, 2.4], a: [0.35, 0.9] });
    return st;
  },
  back(ctx, cam, t, st) {
    fillTile(ctx, cam, st.tex, st.texUnits, 1, 0, 0, 1);
    drawDecor(ctx, cam, st.dec, [0, 1, 2, 3], t);
  },
  front(ctx, cam, t, st) {
    drawDapples(ctx, cam, t, st, { tile: 560, vx: 5, vy: 2.4, alpha: 0.36 });
    drawMotes(ctx, cam, t, st.motes, st.glow, 900);
  },
};

// ---- undergrowth ----------------------------------------------------------
function buildUndergrowthSprites(rng) {
  const sp = { clover: [], ferns: [], leaves: [], twigs: [], husks: [], pebbles: [], mush: [], dew: [], cushions: [], flowers: [] };
  for (const R of [24, 30, 36, 42]) sp.clover.push(makeClover(rng.sub('c' + R), R, ['#689a46', '#386a2e']));
  for (const [len, curve, cols] of [[100, 0.6, ['#41683a', '#1c351d']], [128, -0.7, ['#3d6236', '#193219']], [150, 0.4, ['#486f3d', '#203d22']], [112, -0.4, ['#41683a', '#1d391e']], [90, 0.8, ['#4a7440', '#223f23']]]) sp.ferns.push(makeFern(rng.sub('f' + len), len, cols, curve));
  for (const [k, col, size] of [['oak', 'umber', 30], ['birch', 'olive', 26], ['maple', 'ochre', 28], ['birch', 'ochre', 30], ['oak', 'russet', 34], ['maple', 'moss', 26], ['birch', 'umber', 28], ['oak', 'olive', 56], ['maple', 'umber', 50]]) sp.leaves.push(makeLeaf(rng.sub('l' + k + col + size), k, col, size, rng() < 0.3));
  for (const [len, w] of [[75, 5], [100, 6], [60, 4.5]]) sp.twigs.push(makeTwig(rng.sub('t' + len), len, w, ['#1c140c', '#54402a', '#9b8458']));
  for (const k of ['samara', 'acorn', 'pod', 'samara']) sp.husks.push(makeHusk(rng.sub('h' + sp.husks.length + k), k));
  for (const r of [6, 9, 12, 16, 8]) sp.pebbles.push(makePebble(rng.sub('p' + r + sp.pebbles.length), r, rng.pick(STONES)));
  for (const [style, n] of [['tan', 2], ['pale', 3], ['brown', 1]]) sp.mush.push(makeMushroom(rng.sub('m' + style + n), style, n));
  for (const r of [1.4, 2.1, 3]) sp.dew.push(makeDew(r));
  for (const c of ['#f3efe4', '#f0e08a']) sp.flowers.push(makeFlower(rng.sub('fl' + c), c));
  for (const R of [18, 26, 34]) sp.cushions.push(makeMoss(rng.sub('cu' + R), R, ['#a3c46a', '#3a5e2b']));
  return sp;
}

function placeUndergrowth(dec, sp, rng, world, seed) {
  const cs = dec.cs, n = dec.n;
  for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) {
    const x0 = cx * cs, y0 = cy * cs, P = () => [x0 + rng() * cs, y0 + rng() * cs];
    const dens = 0.3 + 1.5 * smooth(vnoise(cx * 0.4, cy * 0.4, seed % 977));
    if (rng() < 0.35) { const [x, y] = P(); dec.add(0, rng.pick(sp.cushions), x, y, rng() * TAU, rng.range(0.8, 1.4)); }
    for (let k = Math.floor(0.55 * dens + rng()); k-- > 0;) {
      const spr = rng.pick(sp.clover), [x, y] = P();
      dec.add(1, spr, x, y, rng() * TAU, rng.range(0.85, 1.3), { flip: rng() < 0.5 });
      placeDew(dec, sp, rng, x, y, spr.rad, 0.5);
    }
    for (let k = Math.floor(0.42 * dens + rng()); k-- > 0;) { const [x, y] = P(); dec.add(2, rng.pick(sp.ferns), x, y, rng() * TAU, rng.range(0.8, 1.3), { flip: rng() < 0.5, a: 0.97 }); }
    for (let k = Math.floor(0.8 * dens + rng()); k-- > 0;) { const [x, y] = P(); dec.add(1, rng.pick(sp.leaves), x, y, rng() * TAU, rng.range(0.85, 1.25), { flip: rng() < 0.5 }); }
    if (rng() < 0.3) { const [x, y] = P(); dec.add(2, rng.pick(sp.twigs), x, y, rng() * TAU, rng.range(0.9, 1.3), { flip: rng() < 0.5 }); }
    if (rng() < 0.25) { const [x, y] = P(); dec.add(2, rng.pick(sp.flowers), x, y, rng() * TAU, rng.range(0.8, 1.3)); }
    if (rng() < 0.3 * dens) { const [x, y] = P(); dec.add(2, rng.pick(sp.husks), x, y, rng() * TAU, rng.range(0.9, 1.3)); }
    if (rng() < 0.28) { const [x, y] = P(); dec.add(2, rng.pick(sp.pebbles), x, y, 0, rng.range(0.85, 1.2), { flip: rng() < 0.5 }); }
    if (rng() < 0.07) { const [x, y] = P(); dec.add(3, rng.pick(sp.mush), x, y, 0, rng.range(0.9, 1.25)); }
  }
}

A.Biomes.undergrowth = {
  habitat: 'land',
  palette: { bg: '#1c2d1c', grade: '#d6ffb0', fog: '#050b06' },
  depth: { giants: ['frog', 'skink'], specks: ['ant', 'aphid', 'fly'], fg: [{ kind: 'ferns', cols: ['#4a7a38', '#1b351c', '#5d8c42'] }, { kind: 'blades', cols: ['#10200d', '#2e5a22', '#7fa84a'] }] },
  build(tier, rng) {
    const world = tier.world || 2600, st = { world };
    st.tex = mossTexture(rng.seed, 2048); st.texUnits = 512;
    st.dec = makeDecor(world, 128);
    placeUndergrowth(st.dec, buildUndergrowthSprites(rng.sub('spr')), rng.sub('place'), world, rng.seed);
    st.dapple = dappleTexture(rng.seed + 5, 1024, '#e8ffb8');
    st.glow = makeGlow(48, '#fff0a0');
    st.motes = makeMotes(rng.sub('motes'), 70, { P: 900, vx: [-4, 6], vy: [-6, 1], q: [0.9, 1.6], r: [0.5, 1.3], a: [0.3, 0.85] });
    st.shaftSpr = makeShaft();
    st.shafts = [];
    for (let i = 0; i < 6; i++) st.shafts.push({ x: rng.range(0, 1), w: rng.range(70, 170), a: rng.range(0.05, 0.11), ph: rng.range(0, TAU), sp: rng.range(0.15, 0.4) });
    return st;
  },
  back(ctx, cam, t, st) {
    fillTile(ctx, cam, st.tex, st.texUnits, 1, 0, 0, 1);
    drawDecor(ctx, cam, st.dec, [0, 1, 2, 3], t);
  },
  front(ctx, cam, t, st) {
    drawDapples(ctx, cam, t, st, { tile: 560, vx: 4, vy: 2, alpha: 0.32 });
    drawShafts(ctx, cam, t, st.shafts, st.shaftSpr);
    drawMotes(ctx, cam, t, st.motes, st.glow, 900);
  },
};

function makeShaft(tint) {
  const tc = rgb(tint || [255, 246, 190]);
  const w = 96, h = 384, c = mk(w, h), g = g2(c), img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) {
    const fy = Math.pow(1 - y / h, 1.3) * smooth(y / 24);
    for (let x = 0; x < w; x++) {
      const u = Math.abs(x / (w - 1) * 2 - 1), a = Math.pow(Math.cos(Math.min(1, u) * Math.PI / 2), 1.6) * fy;
      const i = (y * w + x) * 4;
      d[i] = tc[0]; d[i + 1] = tc[1]; d[i + 2] = tc[2]; d[i + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Slanted god-rays: a soft sprite sheared across the screen.
function drawShafts(ctx, cam, t, shafts, spr) {
  const W = A.W, H = A.H, D = A.DPR || 1, z = cam.zoom, span = W + 500, lean = 0.55;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (const s of shafts) {
    const x = ((s.x * span - cam.x * z * 0.06 + t * 4 * s.sp) % span + span) % span - 250;
    ctx.globalAlpha = Math.min(1, s.a * 7 * (0.65 + 0.35 * Math.sin(t * s.sp + s.ph)));
    ctx.setTransform(D * s.w / spr.width, 0, -D * lean * H / spr.height, D * H / spr.height, D * (x + lean * H * 0.5), 0);
    ctx.drawImage(spr, -spr.width / 2, 0);
  }
  ctx.restore();
}

// ---- pond edge ------------------------------------------------------------
const POND_BLOBS = [
  { x: 0.66, y: 0.56, s: 0.2, w: 1 }, { x: 0.52, y: 0.82, s: 0.15, w: 0.95 }, { x: 0.74, y: 0.27, s: 0.13, w: 0.9 },
  { x: 0.2, y: 0.72, s: 0.075, w: 0.85 }, { x: 0.36, y: 0.18, s: 0.07, w: 0.8 }, { x: 0.76, y: 0.8, s: 0.1, w: 0.9 }, { x: 0.58, y: 0.4, s: 0.12, w: 0.8 },
];

function buildPondSprites(rng) {
  const sp = { tufts: [], clover: [], reeds: [], pads: [], pebbles: [], twigs: [], leaves: [], mush: [], dew: [], moss: [], weed: [], flowers: [] };
  for (let i = 0; i < 5; i++) sp.tufts.push(makeGrassTuft(rng.sub('g' + i), ['#34481f', '#8a9c48']));
  for (const R of [24, 32, 40]) sp.clover.push(makeClover(rng.sub('c' + R), R, ['#628f3a', '#35582a']));
  for (let i = 0; i < 5; i++) sp.reeds.push(makeReeds(rng.sub('r' + i), ['#7c9a3a', '#2e4a20']));
  for (const [r, f] of [[14, 0], [18, 0], [22, 0], [26, 0], [20, 1], [30, 0], [16, 0], [24, 1]]) sp.pads.push(makeLilyPad(rng.sub('lp' + r + sp.pads.length), r, f));
  for (const r of [6, 8, 11, 14, 18, 9, 12]) sp.pebbles.push(makePebble(rng.sub('p' + r + sp.pebbles.length), r, rng.pick(STONES)));
  for (const [len, w] of [[110, 8], [150, 10], [90, 6]]) sp.twigs.push(makeTwig(rng.sub('t' + len), len, w, ['#1f160f', '#5c4a36', '#a69678']));
  for (const [k, col, size] of [['oak', 'olive', 40], ['birch', 'ochre', 32], ['maple', 'umber', 36], ['birch', 'green', 30], ['oak', 'ochre', 44]]) sp.leaves.push(makeLeaf(rng.sub('l' + k + col + size), k, col, size, rng() < 0.3));
  for (const [style, n] of [['pale', 2], ['tan', 3]]) sp.mush.push(makeMushroom(rng.sub('m' + style + n), style, n));
  for (const r of [1.4, 2.1, 3]) sp.dew.push(makeDew(r));
  for (const R of [20, 28]) sp.moss.push(makeMoss(rng.sub('mo' + R), R, ['#8aa84c', '#34502a']));
  for (let i = 0; i < 3; i++) sp.weed.push(makeDuckweed(rng.sub('w' + i)));
  for (const c of ['#f3efe4', '#f0e08a', '#e9c2d8', '#c9b4e8']) sp.flowers.push(makeFlower(rng.sub('fl' + c), c));
  return sp;
}

function makeDuckweed(rng) {
  const s = sprite(30, 30, 6, (g) => {
    for (let i = 0; i < 26; i++) {
      const a = rng.range(0, TAU), d = Math.sqrt(rng()) * 11, r = rng.range(0.7, 1.5);
      g.fillStyle = css(mixc('#7fae3c', '#b6d65a', rng()), 0.92);
      g.beginPath(); g.ellipse(Math.cos(a) * d, Math.sin(a) * d * 0.8, r, r * 0.8, a, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,220,.35)'; g.beginPath(); g.arc(Math.cos(a) * d - r * 0.25, Math.sin(a) * d * 0.8 - r * 0.25, r * 0.28, 0, TAU); g.fill();
    }
  });
  return addShadow(s, { blur: 0.8, dx: 0.4, dy: 0.6, a: 0.3 });
}

function placePond(dec, sp, rng, lake, world, seed) {
  const cs = dec.cs, n = dec.n;
  const land = (x, y, m) => lake.dist(x, y) < -(m === undefined ? 14 : m);
  for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) {
    const x0 = cx * cs, y0 = cy * cs, P = () => [x0 + rng() * cs, y0 + rng() * cs];
    const dens = 0.3 + 1.5 * smooth(vnoise(cx * 0.4, cy * 0.4, seed % 977));
    for (let k = Math.floor(3.2 * dens + rng()); k-- > 0;) { const [x, y] = P(); if (land(x, y)) dec.add(1, rng.pick(sp.tufts), x, y, rng() * TAU, rng.range(0.9, 1.9)); }
    for (let k = Math.floor(0.7 * dens + rng()); k-- > 0;) { const [x, y] = P(); if (land(x, y, 24)) dec.add(2, rng.pick(sp.flowers), x, y, rng() * TAU, rng.range(0.8, 1.3)); }
    if (rng() < 0.2) { const [x, y] = P(); if (land(x, y, 30)) dec.add(0, rng.pick(sp.moss), x, y, rng() * TAU, rng.range(0.8, 1.3)); }
    if (rng() < 0.3 * dens) { const [x, y] = P(); if (land(x, y, 30)) { const spr = rng.pick(sp.clover); dec.add(1, spr, x, y, rng() * TAU, rng.range(0.85, 1.25)); placeDew(dec, sp, rng, x, y, spr.rad, 0.45); } }
    if (rng() < 0.4 * dens) { const [x, y] = P(); if (land(x, y)) dec.add(1, rng.pick(sp.leaves), x, y, rng() * TAU, rng.range(0.85, 1.25), { flip: rng() < 0.5 }); }
    if (rng() < 0.1) { const [x, y] = P(); if (land(x, y, 40)) dec.add(3, rng.pick(sp.mush), x, y, 0, rng.range(0.9, 1.2)); }
  }
  // shore dressing: reeds, pebbles, driftwood just beside the water
  for (let tries = 0, got = 0; tries < 60000 && got < 420; tries++) {
    const x = rng.range(80, world - 80), y = rng.range(80, world - 80), d = lake.dist(x, y);
    if (d < -26 || d > 10) continue;
    const r = rng();
    if (r < 0.55) dec.add(3, rng.pick(sp.reeds), x, y, rng() * TAU, rng.range(0.9, 1.4), { flip: rng() < 0.5 });
    else if (r < 0.82 && d < -4) { dec.add(2, rng.pick(sp.pebbles), x, y, 0, rng.range(0.7, 1.15), { flip: rng() < 0.5 }); }
    else if (d < -10) dec.add(2, rng.pick(sp.twigs), x, y, rng() * TAU, rng.range(0.9, 1.3));
    else continue;
    got++;
  }
  // lily pads in clusters on the shallows, duckweed and floating leaves
  const centers = [];
  for (let tries = 0; tries < 9000 && centers.length < 22; tries++) {
    const x = rng.range(100, world - 100), y = rng.range(100, world - 100), d = lake.dist(x, y);
    if (d > 70 && d < 240) centers.push([x, y]);
  }
  for (const [cx0, cy0] of centers) for (let k = rng.int(3, 8); k-- > 0;) {
    const a = rng() * TAU, r = rng.range(8, 80), x = cx0 + Math.cos(a) * r, y = cy0 + Math.sin(a) * r;
    if (lake.dist(x, y) < 40) continue;
    dec.add(4, rng.pick(sp.pads), x, y, rng() * TAU, rng.range(0.9, 1.25), { bob: 0.018, ph: rng() * TAU, a: 0.97 });
  }
  for (let tries = 0, got = 0; tries < 8000 && got < 120; tries++) {
    const x = rng.range(100, world - 100), y = rng.range(100, world - 100);
    if (lake.dist(x, y) < 25) continue;
    dec.add(5, rng.pick(sp.weed), x, y, rng() * TAU, rng.range(0.8, 1.4), { bob: 0.02, ph: rng() * TAU });
    got++;
  }
  for (let tries = 0, got = 0; tries < 5000 && got < 40; tries++) {
    const x = rng.range(100, world - 100), y = rng.range(100, world - 100);
    if (lake.dist(x, y) < 30) continue;
    dec.add(5, rng.pick(sp.leaves), x, y, rng() * TAU, rng.range(0.7, 1.0), { bob: 0.015, ph: rng() * TAU, a: 0.92 });
    got++;
  }
}

function drawWater(ctx, cam, t, st) {
  const W = A.W, H = A.H, z = cam.zoom, v = viewRect(cam, 0), wm = st.wmap, ws = st.world / wm.width;
  const sx0 = clamp(v.x0 / ws, 0, wm.width), sy0 = clamp(v.y0 / ws, 0, wm.height), sx1 = clamp(v.x1 / ws, 0, wm.width), sy1 = clamp(v.y1 / ws, 0, wm.height);
  if (sx1 > sx0 && sy1 > sy0) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(wm, sx0, sy0, sx1 - sx0, sy1 - sy0, (sx0 * ws - cam.x) * z + W / 2 + cam.shakeX, (sy0 * ws - cam.y) * z + H / 2 + cam.shakeY, (sx1 - sx0) * ws * z, (sy1 - sy0) * ws * z);
  }
  fillTile(ctx, cam, st.caustic, 150, 1, t * 3.5, t * 2, 0.15, 'lighter');
  fillTile(ctx, cam, st.caustic, 230, 1, -t * 2.6 + 40, t * 3 + 70, 0.1, 'lighter');
  drawRipples(ctx, cam, t, st);
}

function drawRipples(ctx, cam, t, st) {
  const W = A.W, H = A.H, z = cam.zoom, v = viewRect(cam, 40);
  ctx.save();
  ctx.lineWidth = Math.max(1, 0.5 * z);
  for (const r of st.ripples) {
    if (r.x < v.x0 || r.x > v.x1 || r.y < v.y0 || r.y > v.y1) continue;
    const sx = (r.x - cam.x) * z + W / 2 + cam.shakeX, sy = (r.y - cam.y) * z + H / 2 + cam.shakeY;
    for (let k = 0; k < 2; k++) {
      const age = (((t / r.per + r.ph - k * 0.12) % 1) + 1) % 1;
      const rad = age * r.max * z, a = Math.pow(1 - age, 1.6) * 0.3;
      ctx.strokeStyle = `rgba(225,245,215,${a})`;
      ctx.beginPath(); ctx.arc(sx, sy, rad, 0, TAU); ctx.stroke();
      ctx.strokeStyle = `rgba(10,30,20,${a * 0.8})`;
      ctx.beginPath(); ctx.arc(sx + 0.8, sy + 1, rad, 0, TAU); ctx.stroke();
    }
  }
  ctx.restore();
}

function matrixFor(cam, canvas, tileUnits, q, ox, oy) {
  const k = canvas.width / tileUnits, a = cam.zoom * q / k;
  return { a, d: a, e: A.W / 2 + (ox - cam.x) * cam.zoom * q + cam.shakeX * q, f: A.H / 2 + (oy - cam.y) * cam.zoom * q + cam.shakeY * q };
}

A.Biomes.pond = {
  habitat: 'land',
  palette: { bg: '#566640', grade: '#e6f5c0', fog: '#050a07' },
  depth: { giants: ['heron', 'snake'], below: true, belowSp: ['pike', 'trout'], specks: ['cricket', 'fly', 'spider'], fg: [{ kind: 'blades', cols: ['#121e0b', '#344f1e', '#86a042'] }, { kind: 'blades', cols: ['#10200c', '#3a5a22', '#8aa04a'] }] },
  build(tier, rng) {
    const world = tier.world || 2600, st = { world };
    st.lake = makeLake(world, rng.sub('lake'), { blobs: POND_BLOBS, keep: [0.5, 0.5], coverage: 0.43 });
    st.tex = grassTexture(rng.seed, 2048); st.texUnits = 512;
    st.mud = mudTexture(rng.seed + 1, 1024);
    st.caustic = causticTexture(rng.seed + 2, 512);
    st.wmap = waterMap(st.lake, rng.seed, { shallow: '#7f8d4e', mid: '#566e3e', deep: '#223a2a', silt: '#7a6838', weed: '#35603a', alphaShallow: 0.42, alphaDeep: 0.72 });
    st.dec = makeDecor(world, 128);
    placePond(st.dec, buildPondSprites(rng.sub('spr')), rng.sub('place'), st.lake, world, rng.seed);
    st.dapple = dappleTexture(rng.seed + 5, 1024, '#f2ffd2');
    st.glow = makeGlow(48, '#f4ffd0');
    st.motes = makeMotes(rng.sub('motes'), 56, { P: 900, vx: [-4, 7], vy: [-6, 3], q: [0.9, 1.5], r: [0.5, 1.4], a: [0.3, 0.8] });
    st.ripples = [];
    for (let tries = 0; tries < 4000 && st.ripples.length < 26; tries++) {
      const x = rng.range(0, world), y = rng.range(0, world);
      if (st.lake.dist(x, y) > 30) st.ripples.push({ x, y, per: rng.range(4, 8), ph: rng(), max: rng.range(14, 30) });
    }
    return st;
  },
  isWater(st, x, y) { return st.lake.isWater(x, y); },
  waterDepth(st, x, y) { return Math.max(0, st.lake.dist(x, y)); },
  back(ctx, cam, t, st) {
    const lake = st.lake, W = A.W, H = A.H, { touching, allWater } = lakeInView(cam, lake);
    if (!allWater) {
      ctx.save();
      if (touching) { ctx.beginPath(); ctx.rect(-20, -20, W + 40, H + 40); tracePolys(ctx, cam, lake); ctx.clip('evenodd'); }
      fillTile(ctx, cam, st.tex, st.texUnits, 1, 0, 0, 1);
      if (touching) drawBank(ctx, cam, st);
      ctx.restore();
    }
    if (touching || allWater) {
      ctx.save();
      if (touching) { ctx.beginPath(); tracePolys(ctx, cam, lake); ctx.clip('evenodd'); } else { ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip(); }
      drawWater(ctx, cam, t, st);
      if (touching) drawShoreWater(ctx, cam, st);
      ctx.restore();
    }
    drawDecor(ctx, cam, st.dec, [0, 1, 2, 3, 4, 5], t);
  },
  front(ctx, cam, t, st) {
    const { touching, allWater } = lakeInView(cam, st.lake);
    if (!allWater) { // canopy light only falls on the bank
      ctx.save();
      if (touching) { ctx.beginPath(); ctx.rect(-20, -20, A.W + 40, A.H + 40); tracePolys(ctx, cam, st.lake); ctx.clip('evenodd'); }
      drawDapples(ctx, cam, t, st, { tile: 560, vx: 4.5, vy: 2.2, alpha: 0.3 });
      ctx.restore();
    }
    drawMotes(ctx, cam, t, st.motes, st.glow, 900);
  },
};

function lakeInView(cam, lake) {
  const v = viewRect(cam, 30);
  let touching = false;
  for (const b of lake.bbox) if (!(b.x1 < v.x0 || b.x0 > v.x1 || b.y1 < v.y0 || b.y0 > v.y1)) { touching = true; break; }
  return { touching, allWater: !touching && lake.isWater(cam.x, cam.y) };
}

// Mud and damp grass along the shore, drawn on the land side (land clip active).
function drawBank(ctx, cam, st) {
  const z = cam.zoom, m = matrixFor(cam, st.mud, 256, 1, 0, 0), pat = getPat(ctx, st.mud);
  if (pat.setTransform) pat.setTransform(m);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath(); traceCoast(ctx, cam, st.lake);
  const passes = [[170, 'rgba(26,38,16,1)', 0.12], [124, 'rgba(34,46,20,1)', 0.12], [96, pat, 0.16], [70, pat, 0.18], [46, pat, 0.24], [26, pat, 0.3], [10, 'rgba(14,10,6,1)', 0.3]];
  for (const [w, style, a] of passes) { ctx.strokeStyle = style; ctx.globalAlpha = a; ctx.lineWidth = w * z; ctx.stroke(); }
  ctx.globalAlpha = 1;
}

// Pale shallows, foam line and wet rim along the shore (water clip active).
function drawShoreWater(ctx, cam, st) {
  const z = cam.zoom;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath(); traceCoast(ctx, cam, st.lake);
  for (const [w, col] of [[60, 'rgba(150,165,95,.07)'], [34, 'rgba(165,180,110,.08)'], [16, 'rgba(190,204,140,.1)'], [5, 'rgba(225,236,195,.2)']]) { ctx.strokeStyle = col; ctx.lineWidth = w * z; ctx.stroke(); }
  ctx.strokeStyle = 'rgba(12,22,12,.35)'; ctx.lineWidth = 1.4 * z; ctx.stroke();
}

// ============================================================ seasonal land biomes
// meadow = spring, forest = autumn, valley = early winter. Same helpers, new palettes.

// ---- spring: wildflowers, dandelion puffs, fallen petals -------------------
function paintBloom(g, rng, kind, x, y, s) {
  g.save(); g.translate(x, y); g.rotate(rng.range(0, TAU)); g.scale(s, s);
  const petal = (a, len, wid, c0, c1, round) => {
    g.save(); g.rotate(a);
    g.beginPath();
    if (round) g.ellipse(len * 0.5, 0, len * 0.5, wid, 0, 0, TAU);
    else { g.moveTo(0, 0); g.quadraticCurveTo(len * 0.45, -wid * 1.25, len, -wid * 0.15); g.lineTo(len * 0.9, 0); g.lineTo(len, wid * 0.15); g.quadraticCurveTo(len * 0.45, wid * 1.25, 0, 0); }
    const gr = g.createLinearGradient(0, 0, len, 0); gr.addColorStop(0, c0); gr.addColorStop(1, c1);
    g.fillStyle = gr; g.fill();
    g.strokeStyle = 'rgba(50,20,30,.22)'; g.lineWidth = 0.22; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 0.18; g.beginPath(); g.moveTo(len * 0.15, 0); g.lineTo(len * 0.85, 0); g.stroke();
    g.restore();
  };
  const eye = (r, c0, c1) => {
    const gr = g.createRadialGradient(-r * 0.3, -r * 0.3, 0, 0, 0, r * 1.2); gr.addColorStop(0, c0); gr.addColorStop(1, c1);
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
  };
  if (kind === 'daisy') {
    for (let k = 0; k < 14; k++) petal(k / 14 * TAU, 4.3, 0.6, '#d2ccb6', '#fbfaf3', true);
    for (let k = 0; k < 14; k++) petal((k + 0.5) / 14 * TAU, 3.5, 0.55, '#e2dcc8', '#ffffff', true);
    eye(1.5, '#f9e260', '#c18a1a');
  } else if (kind === 'butter') {
    for (let k = 0; k < 5; k++) petal(k / 5 * TAU, 3.7, 1.9, '#d6a00e', '#fce650', true);
    eye(0.9, '#e0a820', '#9a6a0c');
    g.fillStyle = 'rgba(255,255,255,.3)'; g.beginPath(); g.ellipse(-1.2, -1.4, 1.1, 0.5, -0.6, 0, TAU); g.fill();
  } else if (kind === 'bell') {
    for (let k = 0; k < 6; k++) petal(k / 6 * TAU, 4.8, 1.15, '#3a5cb8', '#a2bcf4', false);
    eye(0.9, '#4a5ca8', '#1e2c6c');
  } else if (kind === 'poppy') {
    for (let k = 0; k < 4; k++) petal(k * Math.PI / 2 + 0.3, 4.5, 2.5, '#a01810', '#f05a34', true);
    eye(1.2, '#4a2a1e', '#1c100c');
    g.fillStyle = '#2a1812'; for (let k = 0; k < 9; k++) { const a = k / 9 * TAU; g.beginPath(); g.arc(Math.cos(a) * 1.8, Math.sin(a) * 1.8, 0.2, 0, TAU); g.fill(); }
  } else { // campion
    for (let k = 0; k < 5; k++) petal(k / 5 * TAU, 3.9, 1.55, '#cc5486', '#f8b8d2', false);
    eye(0.7, '#fff0f6', '#e8a8c4');
  }
  g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.ellipse(-1, -1.2, 0.8, 0.4, -0.7, 0, TAU); g.fill();
  g.restore();
}

// A little rosette of leaves carrying a few blooms of one kind.
function makeWildflower(rng, kind, count) {
  const s = sprite(40, 40, SPR_PPU, (g) => {
    for (let i = rng.int(4, 7); i-- > 0;) {
      const a = rng.range(0, TAU), l = rng.range(6, 10), w = rng.range(1.6, 2.6);
      g.save(); g.rotate(a);
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(l * 0.5, -w, l, 0); g.quadraticCurveTo(l * 0.5, w, 0, 0);
      const gr = g.createLinearGradient(0, 0, l, 0); gr.addColorStop(0, '#2d5a20'); gr.addColorStop(1, css(mixc('#58a038', '#92cc58', rng())));
      g.fillStyle = gr; g.fill(); g.strokeStyle = 'rgba(18,50,14,.4)'; g.lineWidth = 0.3; g.stroke();
      g.strokeStyle = 'rgba(220,245,170,.35)'; g.lineWidth = 0.22; g.beginPath(); g.moveTo(1, 0); g.lineTo(l * 0.9, 0); g.stroke();
      g.restore();
    }
    for (let i = 0; i < count; i++) {
      const a = rng.range(0, TAU), d = i ? rng.range(3.5, 10) : 0;
      paintBloom(g, rng, kind, Math.cos(a) * d, Math.sin(a) * d, rng.range(0.8, 1.15));
    }
  });
  return addShadow(s, { blur: 1.2, dx: 0.6, dy: 0.9, a: 0.35 });
}

function makeDandelionPuff(rng) {
  const s = sprite(22, 22, 6, (g) => {
    for (let i = rng.int(3, 5); i-- > 0;) { // toothed leaves under the puff
      const a = rng.range(0, TAU), l = rng.range(6, 9);
      g.save(); g.rotate(a); g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(l * 0.5, -1.7, l, 0); g.quadraticCurveTo(l * 0.5, 1.7, 0, 0);
      g.fillStyle = css(mixc('#3c7a2a', '#7cba48', rng())); g.fill(); g.restore();
    }
    const R = 4.6;
    const core = g.createRadialGradient(0, 0, 0, 0, 0, R); core.addColorStop(0, 'rgba(255,255,250,.75)'); core.addColorStop(1, 'rgba(240,244,236,.12)');
    g.fillStyle = core; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
    g.lineWidth = 0.14;
    for (let i = 0; i < 54; i++) {
      const a = rng.range(0, TAU), l = R * rng.range(0.8, 1.05);
      g.strokeStyle = 'rgba(252,252,244,.8)'; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * l, Math.sin(a) * l); g.stroke();
      g.fillStyle = 'rgba(255,255,250,.92)'; g.beginPath(); g.arc(Math.cos(a) * l, Math.sin(a) * l, 0.34, 0, TAU); g.fill();
    }
    g.fillStyle = '#b6ac86'; g.beginPath(); g.arc(0, 0, 0.7, 0, TAU); g.fill();
  });
  return addShadow(s, { blur: 1, dx: 0.5, dy: 0.8, a: 0.28 });
}

function makePetals(rng, cols) {
  const s = sprite(24, 24, 6, (g) => {
    for (let i = rng.int(5, 9); i-- > 0;) {
      const a = rng.range(0, TAU), d = Math.sqrt(rng()) * 7.5, rx = rng.range(1.5, 2.2), ry = rx * rng.range(0.55, 0.75);
      g.save(); g.translate(Math.cos(a) * d, Math.sin(a) * d); g.rotate(rng.range(0, TAU));
      const gr = g.createLinearGradient(-rx, 0, rx, 0); gr.addColorStop(0, cols[0]); gr.addColorStop(1, cols[1]);
      g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(150,60,90,.28)'; g.lineWidth = 0.15; g.beginPath(); g.moveTo(-rx * 0.8, 0); g.lineTo(rx * 0.6, 0); g.stroke();
      g.restore();
    }
  });
  return addShadow(s, { blur: 0.7, dx: 0.4, dy: 0.6, a: 0.3 });
}

// ---- autumn: pine needles, cones -------------------------------------------
function makeNeedles(rng, cols) {
  const s = sprite(44, 44, SPR_PPU, (g) => {
    const cx = rng.range(-4, 4), cy = rng.range(-4, 4);
    for (let i = rng.int(14, 22); i-- > 0;) {
      const x = cx + rng.range(-11, 11) * rng.range(0.4, 1), y = cy + rng.range(-11, 11) * rng.range(0.4, 1);
      const a = rng.range(0, TAU), len = rng.range(8, 15), sp = rng.range(0.08, 0.16), col = rng.pick(cols);
      for (const sg of [-1, 1]) {
        const aa = a + sg * sp, ex = x + Math.cos(aa) * len, ey = y + Math.sin(aa) * len;
        g.strokeStyle = css(mulc(col, 0.55)); g.lineWidth = 0.95; g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke();
        g.strokeStyle = css(col); g.lineWidth = 0.55; g.beginPath(); g.moveTo(x - 0.15, y - 0.2); g.lineTo(ex - 0.15, ey - 0.2); g.stroke();
      }
      g.fillStyle = css(mulc(col, 0.5)); g.beginPath(); g.arc(x, y, 0.7, 0, TAU); g.fill();
    }
  });
  return addShadow(s, { blur: 0.9, dx: 0.5, dy: 0.8, a: 0.4 });
}

function makePineCone(rng) {
  const L = rng.range(11, 14), W = rng.range(6, 7.4);
  const s = sprite(L * 2 + 10, L * 2 + 10, SPR_PPU, (g) => {
    g.rotate(rng.range(0, TAU));
    const body = g.createRadialGradient(-L * 0.3, -W * 0.4, 1, 0, 0, L * 1.1);
    body.addColorStop(0, '#9a6c3c'); body.addColorStop(1, '#3a2210');
    g.fillStyle = body; g.beginPath(); g.ellipse(0, 0, L, W, 0, 0, TAU); g.fill();
    const rows = 9;
    for (let i = 0; i < rows; i++) {
      const u = -0.84 + 1.68 * i / (rows - 1), x = u * L, half = W * Math.sqrt(1 - u * u) * 0.9;
      for (let j = 0; j < 4; j++) {
        const v = ((j + 0.5 + (i % 2) * 0.5) / 4.5) * 2 - 1;
        if (Math.abs(v) > 1) continue;
        const y = v * half, sc = 1 - 0.3 * Math.abs(v);
        g.save(); g.translate(x, y); g.rotate(v * 0.5);
        const gr = g.createLinearGradient(-2.4, 0, 2.6, 0); gr.addColorStop(0, '#5a3a1c'); gr.addColorStop(0.55, '#b98a52'); gr.addColorStop(1, '#d6ac72');
        g.fillStyle = gr; g.beginPath(); g.ellipse(0.4, 0, 2.7 * sc, 1.75 * sc, 0, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(30,14,6,.55)'; g.lineWidth = 0.32; g.stroke();
        g.restore();
      }
    }
    g.fillStyle = 'rgba(255,235,190,.22)'; g.beginPath(); g.ellipse(-L * 0.28, -W * 0.45, L * 0.35, W * 0.16, -0.2, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(25,12,5,.5)'; g.lineWidth = 0.7; g.beginPath(); g.ellipse(0, 0, L, W, 0, 0, TAU); g.stroke();
  });
  return addShadow(s, { blur: 1.5, dx: 1, dy: 1.6, a: 0.55 });
}

// ---- winter: snow drifts, frozen puddles, frost crystals, dry grass --------
function makeSnowDrift(rng, R) {
  const rx = R * rng.range(0.9, 1.15), ry = R * rng.range(0.55, 0.8);
  const s = sprite(rx * 2 + 14, ry * 2 + 14, 4, (g) => {
    const seed = rng.int(1, 900000), path = () => blobPath(g, 0, 0, rx, ry, makeRng(seed), 13, 0.42);
    path();
    const gr = g.createLinearGradient(-rx * 0.6, -ry, rx * 0.6, ry);
    gr.addColorStop(0, '#f6fafc'); gr.addColorStop(0.55, '#dbe7ee'); gr.addColorStop(1, '#a6bbcc');
    g.fillStyle = gr; g.fill();
    g.save(); g.clip();
    for (let i = 0; i < 10; i++) { g.fillStyle = `rgba(104,138,176,${rng.range(0.06, 0.14)})`; g.beginPath(); g.ellipse(rng.range(0, rx * 0.9), rng.range(-ry * 0.2, ry * 0.9), rng.range(rx * 0.15, rx * 0.45), rng.range(ry * 0.1, ry * 0.3), rng.range(0, 3), 0, TAU); g.fill(); }
    for (let k = 0; k < 4; k++) { // wind ripples
      const y = rng.range(-ry * 0.6, ry * 0.6), x = rng.range(-rx * 0.5, rx * 0.2), w = rx * rng.range(0.35, 0.7);
      g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + w * 0.5, y - 2, x + w, y + 0.5); g.stroke();
      g.strokeStyle = 'rgba(110,146,184,.3)'; g.lineWidth = 0.5; g.beginPath(); g.moveTo(x, y + 1.3); g.quadraticCurveTo(x + w * 0.5, y - 0.7, x + w, y + 1.8); g.stroke();
    }
    for (let i = 0; i < 34; i++) { g.fillStyle = rng() < 0.7 ? 'rgba(255,255,255,.85)' : 'rgba(150,185,220,.5)'; g.beginPath(); g.arc(rng.range(-rx, rx), rng.range(-ry, ry), rng.range(0.2, 0.55), 0, TAU); g.fill(); }
    g.restore();
    path(); g.strokeStyle = 'rgba(112,144,178,.32)'; g.lineWidth = 0.8; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1.2; g.beginPath(); g.ellipse(0, 0, rx * 0.93, ry * 0.9, 0, Math.PI * 1.02, Math.PI * 1.6); g.stroke();
  });
  return addShadow(s, { blur: 2, dx: 0.8, dy: 1.4, a: 0.3 });
}

function makeIcePuddle(rng, R) {
  const rx = R * rng.range(0.95, 1.2), ry = R * rng.range(0.6, 0.85);
  const s = sprite(rx * 2 + 14, ry * 2 + 14, 4, (g) => {
    const seed = rng.int(1, 900000), path = () => blobPath(g, 0, 0, rx, ry, makeRng(seed), 12, 0.38);
    path(); g.strokeStyle = 'rgba(236,246,252,.55)'; g.lineWidth = 5; g.stroke();
    path();
    const gr = g.createRadialGradient(-rx * 0.25, -ry * 0.3, rx * 0.1, 0, 0, rx * 1.1);
    gr.addColorStop(0, '#d4e8f0'); gr.addColorStop(0.6, '#9ac0d4'); gr.addColorStop(1, '#5c86a2');
    g.fillStyle = gr; g.fill();
    g.save(); g.clip();
    for (let i = 0; i < 18; i++) { g.fillStyle = rng() < 0.55 ? `rgba(56,100,134,${rng.range(0.1, 0.2)})` : `rgba(232,246,252,${rng.range(0.1, 0.2)})`; g.beginPath(); g.ellipse(rng.range(-rx, rx), rng.range(-ry, ry), rng.range(1.5, rx * 0.35), rng.range(1, ry * 0.3), rng.range(0, 3), 0, TAU); g.fill(); }
    for (let i = 0; i < 14; i++) { // trapped air bubbles
      const x = rng.range(-rx * 0.8, rx * 0.8), y = rng.range(-ry * 0.8, ry * 0.8), r = rng.range(0.4, 1.3);
      g.strokeStyle = 'rgba(238,250,255,.55)'; g.lineWidth = 0.25; g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
      g.fillStyle = 'rgba(40,80,110,.18)'; g.beginPath(); g.arc(x + 0.25, y + 0.3, r * 0.8, 0, TAU); g.fill();
    }
    for (let k = 0; k < 6; k++) { // cracks
      let x = rng.range(-rx * 0.3, rx * 0.3), y = rng.range(-ry * 0.3, ry * 0.3), a = rng.range(0, TAU);
      const pts = [[x, y]]; for (let i = rng.int(4, 8); i-- > 0;) { a += rng.range(-0.7, 0.7); x += Math.cos(a) * rx * 0.16; y += Math.sin(a) * rx * 0.16; pts.push([x, y]); }
      for (const [col, off, w] of [['rgba(38,76,106,.5)', 0, 0.7], ['rgba(246,251,255,.8)', -0.25, 0.35]]) {
        g.strokeStyle = col; g.lineWidth = w; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0] + off, p[1] + off) : g.moveTo(p[0] + off, p[1] + off))); g.stroke();
      }
    }
    g.fillStyle = 'rgba(255,255,255,.38)'; g.beginPath(); g.ellipse(-rx * 0.3, -ry * 0.36, rx * 0.3, ry * 0.1, -0.5, 0, TAU); g.fill();
    g.restore();
    path(); g.strokeStyle = 'rgba(30,60,86,.5)'; g.lineWidth = 0.9; g.stroke();
  });
  return addShadow(s, { blur: 1.2, dx: 0.5, dy: 0.8, a: 0.25 });
}

function makeFrostStar(rng, R) {
  return sprite(R * 2 + 6, R * 2 + 6, 6, (g) => {
    const halo = g.createRadialGradient(0, 0, 0, 0, 0, R); halo.addColorStop(0, 'rgba(210,232,248,.3)'); halo.addColorStop(1, 'rgba(210,232,248,0)');
    g.fillStyle = halo; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
    const rot = rng.range(0, TAU);
    for (const [col, w, o] of [['rgba(110,150,196,.5)', 0.55, 0.22], ['rgba(250,253,255,.92)', 0.3, 0]]) {
      g.strokeStyle = col; g.lineWidth = w; g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = rot + k * Math.PI / 3, ca = Math.cos(a), sa = Math.sin(a);
        g.moveTo(o, o); g.lineTo(ca * R * 0.95 + o, sa * R * 0.95 + o);
        for (const f of [0.34, 0.58, 0.8]) {
          const bx = ca * R * f + o, by = sa * R * f + o, bl = R * 0.3 * (1 - f * 0.5);
          for (const sg of [-1, 1]) { const ba = a + sg * Math.PI / 3; g.moveTo(bx, by); g.lineTo(bx + Math.cos(ba) * bl, by + Math.sin(ba) * bl); }
        }
      }
      g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(0, 0, 0.45, 0, TAU); g.fill();
  });
}

// Dry winter grass, tips furred with frost.
function makeDryGrass(rng, cols, frost) {
  const s = sprite(44, 44, SPR_PPU, (g) => {
    for (let i = rng.int(9, 15); i-- > 0;) {
      const a = rng.range(0, TAU), len = rng.range(8, 17), w = rng.range(0.5, 0.85), bend = rng.range(-0.9, 0.9);
      const ex = Math.cos(a + bend) * len, ey = Math.sin(a + bend) * len, mx = Math.cos(a) * len * 0.55, my = Math.sin(a) * len * 0.55;
      const nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
      g.beginPath(); g.moveTo(nx, ny); g.quadraticCurveTo(mx + nx * 0.7, my + ny * 0.7, ex, ey); g.quadraticCurveTo(mx - nx * 0.7, my - ny * 0.7, -nx, -ny); g.closePath();
      const gr = g.createLinearGradient(0, 0, ex, ey); gr.addColorStop(0, css(mulc(cols[0], 0.8))); gr.addColorStop(1, css(mixc(cols[0], cols[1], rng.range(0.4, 1))));
      g.fillStyle = gr; g.fill();
      if (frost) {
        g.strokeStyle = 'rgba(240,248,252,.8)'; g.lineWidth = 0.38; g.beginPath();
        for (let k = 0; k <= 5; k++) { const u = 0.55 + 0.45 * k / 5, v = 1 - u; const px = 2 * v * u * mx + u * u * ex, py = 2 * v * u * my + u * u * ey; k ? g.lineTo(px, py) : g.moveTo(px, py); }
        g.stroke();
      }
    }
  });
  return addShadow(s, { blur: 1.2, dx: 0.6, dy: 1, a: 0.35 });
}

function makeSnowStone(rng, r) {
  const rx = r * rng.range(0.85, 1.15), ry = r * rng.range(0.7, 0.95);
  const s = sprite(rx * 2 + 12, ry * 2 + 12, SPR_PPU, (g) => {
    const seed = rng.int(1, 900000);
    blobPath(g, 0, 0, rx, ry, makeRng(seed), 11, 0.22);
    const gr = g.createRadialGradient(-rx * 0.3, -ry * 0.38, r * 0.1, 0, 0, r * 1.15);
    gr.addColorStop(0, '#9aa0a4'); gr.addColorStop(0.6, '#5c6266'); gr.addColorStop(1, '#2e3236');
    g.fillStyle = gr; g.fill(); g.strokeStyle = 'rgba(12,16,20,.5)'; g.lineWidth = 0.8; g.stroke();
    blobPath(g, -rx * 0.1, -ry * 0.2, rx * 0.78, ry * 0.68, makeRng(seed + 5), 11, 0.5);
    const sn = g.createLinearGradient(-rx * 0.6, -ry * 0.7, rx * 0.5, ry * 0.4); sn.addColorStop(0, '#f8fcfe'); sn.addColorStop(1, '#bccfdc');
    g.fillStyle = sn; g.fill(); g.strokeStyle = 'rgba(110,142,174,.5)'; g.lineWidth = 0.6; g.stroke();
    for (let i = 0; i < 10; i++) { g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(rng.range(-rx * 0.6, rx * 0.4), rng.range(-ry * 0.6, ry * 0.3), rng.range(0.2, 0.5), 0, TAU); g.fill(); }
  });
  return addShadow(s, { blur: 1.6, dx: 1.2, dy: 1.8, a: 0.5 });
}

// ---- ground textures -------------------------------------------------------
function meadowTexture(seed, S) {
  const lut = makeLut([[0, '#2c5e20'], [0.35, '#448a2a'], [0.65, '#62aa3a'], [1, '#88cc4e']]);
  const c = baseTexture(seed, S, lut, [4, 12, 24], (o, a, b, cc) => {
    const lime = clamp((cc - 0.56) * 4, 0, 1) * 0.35; o[0] += (176 - o[0]) * lime; o[1] += (220 - o[1]) * lime; o[2] += (86 - o[2]) * lime;
    const lush = clamp((0.34 - a) * 5, 0, 1) * 0.4; o[0] += (30 - o[0]) * lush; o[1] += (86 - o[1]) * lush; o[2] += (40 - o[2]) * lush;
  }, 1.0);
  const g = g2(c), rng = makeRng(seed + 99);
  const blades = [];
  for (let i = 0; i < 8; i++) blades.push(css(mixc('#2a5a1c', '#9cd250', i / 7)));
  blades.push(css('#c2e068'), css('#b4d85a'));
  strokeBatch(g, S, rng, 40000, blades, 17, 1.2, 0.5, 0.7);
  strokeBatch(g, S, rng, 16000, [css('#dcf29a'), css('#effab8')], 11, 0.8, 0.26, 0.5);
  dotBatch(g, S, rng, 3000, ['#16380f', '#1f4a14'], 0.8, 2.2, 0.35);
  dotBatch(g, S, rng, 700, ['#fff6cc', '#ffe56a', '#f6c6dc', '#ffffff'], 0.9, 1.8, 0.8); // far-off flower specks
  scatter(g, S, rng, 240, 20, (r) => ({ r: r.range(4, 12) }), (gg, x, y, p) => {
    gg.fillStyle = 'rgba(20,50,14,.2)'; gg.beginPath(); gg.ellipse(x, y, p.r, p.r * 0.6, 0.3, 0, TAU); gg.fill();
  });
  return c;
}

const FOREST_LEAVES = ['#b9501c', '#d07a22', '#9c2e16', '#dca43a', '#7a3a14', '#c4602a', '#e0b44a'];

function forestTexture(seed, S) {
  const lut = makeLut([[0, '#241508'], [0.3, '#3c220d'], [0.55, '#5c3415'], [0.8, '#7e4a1c'], [1, '#9c6226']]);
  const c = baseTexture(seed, S, lut, [4, 10, 24], (o, a, b, cc) => {
    const moss = clamp((b - 0.58) * 4, 0, 1) * 0.5; o[0] += (60 - o[0]) * moss; o[1] += (82 - o[1]) * moss; o[2] += (30 - o[2]) * moss;
    const dk = b < 0.36 ? 0.82 : 1; o[0] *= dk; o[1] *= dk; o[2] *= dk;
  }, 1.1);
  const g = g2(c), rng = makeRng(seed + 99);
  dotBatch(g, S, rng, 12000, ['#1c0f06', '#321c0c', '#a8773e'], 0.8, 2.4, 0.3);
  scatter(g, S, rng, 150, 34, (r) => ({ r: r.range(10, 26) }), (gg, x, y, p) => { // damp moss
    const gr = gg.createRadialGradient(x, y, 0, x, y, p.r); gr.addColorStop(0, 'rgba(110,142,56,.4)'); gr.addColorStop(1, 'rgba(70,98,36,0)');
    gg.fillStyle = gr; gg.beginPath(); gg.arc(x, y, p.r, 0, TAU); gg.fill();
  });
  strokeBatch(g, S, rng, 30000, ['#8a6a3a', '#6b4f2a', '#a88a52', '#4e3820', '#7a4a24'], 26, 1.4, 0.55, 0.15); // pine needles
  scatter(g, S, rng, 1100, 28, (r) => ({ s: r.range(7, 17), a: r.range(0, TAU), c: r.pick(FOREST_LEAVES) }), (gg, x, y, p) => { // fallen leaf bits
    gg.save(); gg.translate(x, y); gg.rotate(p.a);
    gg.globalAlpha = 0.62; gg.fillStyle = p.c;
    gg.beginPath(); gg.moveTo(-p.s, 0); gg.quadraticCurveTo(0, -p.s * 0.62, p.s, 0); gg.quadraticCurveTo(0, p.s * 0.62, -p.s, 0); gg.fill();
    gg.globalAlpha = 1; gg.strokeStyle = 'rgba(40,16,6,.35)'; gg.lineWidth = 0.8; gg.beginPath(); gg.moveTo(-p.s * 0.9, 0); gg.lineTo(p.s * 0.8, 0); gg.stroke();
    gg.restore();
  });
  strokeBatch(g, S, rng, 200, ['#e0b070'], 22, 1, 0.35, 0);
  return c;
}

// Frosty bare ground under patchy snow. Returns the tile with .snowMask/.maskN for decor placement.
function frostTexture(seed, S) {
  const n = 512;
  const f1 = noiseGrid(n, 5, seed, 5, 0.55), f2 = noiseGrid(n, 11, seed + 11, 3, 0.5), f3 = noiseGrid(n, 24, seed + 23, 2, 0.5);
  const fb = noiseGrid(n, 36, seed + 41, 2, 0.5), fq = noiseGrid(n, 5, seed + 57, 3, 0.5), fg = noiseGrid(n, 14, seed + 71, 3, 0.5);
  const mask = new Float32Array(n * n), sf = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) sf[i] = f1[i] * 0.58 + f2[i] * 0.3 + f3[i] * 0.12;
  const thr = Float32Array.from(sf).sort()[Math.floor(n * n * 0.6)]; // ~40% of the ground under snow
  for (let i = 0; i < n * n; i++) mask[i] = smooth((sf[i] - thr) / 0.024 + 0.5);
  const lut = makeLut([[0, '#4a463a'], [0.4, '#665f4a'], [0.7, '#8a7f5c'], [1, '#a89e74']]);
  const gS = mk(n, n), gI = g2(gS).createImageData(n, n), gd = gI.data;
  const sS = mk(n, n), sI = g2(sS).createImageData(n, n), sd = sI.data;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, xl = y * n + (x + n - 2) % n, xr = y * n + (x + 2) % n, yu = ((y + n - 2) % n) * n + x, yd = ((y + 2) % n) * n + x;
    const bump = 1 - (fb[y * n + (x + 1) % n] - fb[y * n + (x + n - 1) % n] + fb[((y + 1) % n) * n + x] - fb[((y + n - 1) % n) * n + x]) * 0.9;
    const k = (clamp((f2[i] * 0.5 + f3[i] * 0.3 + f1[i] * 0.2 - 0.5) * 2.4 + 0.5, 0, 1) * 255) | 0;
    const fr = smooth((fq[i] - 0.32) / 0.25) * 0.7; // hoar frost on the bare ground
    gd[i * 4] = (lut[k * 3] + (170 - lut[k * 3]) * fr) * bump; gd[i * 4 + 1] = (lut[k * 3 + 1] + (190 - lut[k * 3 + 1]) * fr) * bump; gd[i * 4 + 2] = (lut[k * 3 + 2] + (202 - lut[k * 3 + 2]) * fr) * bump; gd[i * 4 + 3] = 255;
    const m = mask[i], gl = (mask[xr] - mask[xl] + mask[yd] - mask[yu]) * 0.9; // lit on the top-left bank, shaded bottom-right
    const thick = clamp(0.5 + (fg[i] - 0.5) * 1.6, 0, 1);
    const lum = clamp(0.58 + (thick - 0.5) * 0.5 + (fb[i] - 0.5) * 0.7 + Math.sin(TAU * (46 * x + 26 * y) / n + fg[i] * 30) * 0.035 + gl, 0, 1), rim = Math.sin(Math.PI * m) * 0.3;
    sd[i * 4] = lerp(lerp(160, 236, lum), 120, rim); sd[i * 4 + 1] = lerp(lerp(184, 244, lum), 150, rim); sd[i * 4 + 2] = lerp(lerp(204, 248, lum), 186, rim); sd[i * 4 + 3] = m * 255;
  }
  g2(gS).putImageData(gI, 0, 0); g2(sS).putImageData(sI, 0, 0);
  const c = upscale(gS, S), snow = upscale(sS, S), g = g2(c), rng = makeRng(seed + 99);
  strokeBatch(g, S, rng, 30000, ['#8a7a50', '#a89868', '#6a5c3c', '#c4b484', '#5a5038'], 22, 1.3, 0.55, 0.8); // dead grass
  strokeBatch(g, S, rng, 9000, ['#ebf4f8'], 8, 1, 0.3, 0.2); // frosted blades
  dotBatch(g, S, rng, 7000, ['#1e1c14', '#2e2a1e'], 0.8, 2.2, 0.3);
  g.drawImage(snow, 0, 0);
  g.lineCap = 'round'; g.lineWidth = 1.5;
  for (let i = 0; i < 4200; i++) { // dry grass poking through the snow, mostly near its edge
    const x = rng() * S, y = rng() * S, m = mask[Math.floor(y / S * n) * n + Math.floor(x / S * n)];
    if (rng() > m * (1 - m) * 3.2 + 0.1 * m) continue;
    g.strokeStyle = rng.pick(['#8c7c52', '#a69666', '#6e5f3c']); g.globalAlpha = rng.range(0.6, 0.9); g.beginPath();
    for (let k = rng.int(2, 4); k-- > 0;) { const a = -Math.PI / 2 + rng.range(-0.8, 0.8), l = rng.range(8, 20); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + rng.range(-3, 3), y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l + rng.range(-5, 5), y + Math.sin(a) * l); }
    g.stroke();
  }
  g.globalAlpha = 1;
  strokeBatch(g, S, rng, 90, ['#f4f9fc'], 70, 1.6, 0.18, 1.1); // wind-drift streaks
  dotBatch(g, S, rng, 5000, ['#ffffff', '#dff0fa'], 0.7, 1.5, 0.55); // glitter
  c.snowMask = mask; c.maskN = n;
  return c;
}

// ---- frozen creek (visual only: it is passable ice, no water queries) ------
function iceCreek(world, rng) {
  const S = 2048, k = S / world, N = 72, pts = [];
  const y0 = rng.range(0.25, 0.35) * world, y1 = rng.range(0.68, 0.8) * world, ph = rng.range(0, TAU), ph2 = rng.range(0, TAU);
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    pts.push([-80 + u * (world + 160), lerp(y0, y1, smooth(u)) + Math.sin(u * TAU * 1.4 + ph) * world * 0.1 + Math.sin(u * TAU * 3.3 + ph2) * world * 0.025, 62 + 18 * Math.sin(u * 11 + ph) + 10 * Math.sin(u * 27 + ph2)]);
  }
  const nrm = pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; });
  const ribbon = (g, scale, style) => {
    g.strokeStyle = style; g.lineCap = 'round';
    for (let i = 0; i < N; i++) { g.lineWidth = (pts[i][2] + pts[i + 1][2]) / 2 * scale * k; g.beginPath(); g.moveTo(pts[i][0] * k, pts[i][1] * k); g.lineTo(pts[i + 1][0] * k, pts[i + 1][1] * k); g.stroke(); }
  };
  const off0 = (i, o) => [(pts[i][0] + nrm[i][0] * o * pts[i][2]) * k, (pts[i][1] + nrm[i][1] * o * pts[i][2]) * k], off = off0;
  const out = mk(S, S), og = g2(out);
  for (const [scale, col, blur, a] of [[1.9, '#d8e6ee', 16, 0.3], [1.38, '#e6f0f5', 6, 0.45]]) { // frosted banks
    const h = mk(S, S); ribbon(g2(h), scale, col);
    og.globalAlpha = a; og.drawImage(blurred(h, blur, 0), 0, 0);
  }
  og.globalAlpha = 1;
  const iceRaw = mk(S, S), rg = g2(iceRaw);
  for (const [scale, col] of [[1.1, '#7a9db4'], [1, '#aecbda'], [0.74, '#9cbdd0'], [0.5, '#86aac2'], [0.24, '#6a96b2']]) ribbon(rg, scale, col);
  const ice = blurred(iceRaw, 4, 0), ig = g2(ice);
  ig.globalCompositeOperation = 'source-atop';
  for (let q = 0; q < 90; q++) { // mottled ice
    const i = rng.int(0, N), p = off0(i, rng.range(-0.5, 0.5)), r = rng.range(5, 18) * k;
    const mg = ig.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * 1.8), dark = rng() < 0.5, ma = rng.range(0.1, 0.22);
    mg.addColorStop(0, dark ? `rgba(52,96,130,${ma})` : `rgba(236,248,254,${ma})`); mg.addColorStop(1, dark ? 'rgba(52,96,130,0)' : 'rgba(236,248,254,0)');
    ig.fillStyle = mg; ig.beginPath(); ig.arc(p[0], p[1], r * 1.8, 0, TAU); ig.fill();
  }
  for (const o of [-0.34, -0.18, 0.12, 0.3]) { // flow streaks
    ig.strokeStyle = 'rgba(244,250,254,.3)'; ig.lineWidth = 1.6 * k; ig.setLineDash([rng.range(30, 80) * k, rng.range(20, 60) * k]); ig.beginPath();
    for (let i = 0; i <= N; i++) { const p = off(i, o); i ? ig.lineTo(p[0], p[1]) : ig.moveTo(p[0], p[1]); }
    ig.stroke(); ig.setLineDash([]);
  }
  for (let q = 0; q < 3; q++) { // open black-ice patches
    const i = rng.int(4, N - 4), p = off(i, rng.range(-0.15, 0.15)), rx = rng.range(12, 22) * k, ry = rng.range(6, 10) * k;
    const gr = ig.createRadialGradient(p[0], p[1], 0, p[0], p[1], rx); gr.addColorStop(0, '#2a4c62'); gr.addColorStop(0.7, '#3a6a84'); gr.addColorStop(1, '#5a92ae');
    ig.fillStyle = gr; ig.beginPath(); ig.ellipse(p[0], p[1], rx, ry, Math.atan2(nrm[i][0], -nrm[i][1]), 0, TAU); ig.fill();
    ig.strokeStyle = 'rgba(220,240,250,.7)'; ig.lineWidth = 1.4 * k; ig.stroke();
  }
  for (let q = 0; q < 34; q++) { // cracks
    const i = rng.int(0, N), p = off(i, rng.range(-0.4, 0.4));
    let x = p[0], y = p[1], a = rng.range(0, TAU);
    const cr = [[x, y]]; for (let j = rng.int(5, 11); j-- > 0;) { a += rng.range(-0.8, 0.8); x += Math.cos(a) * rng.range(6, 14) * k; y += Math.sin(a) * rng.range(6, 14) * k; cr.push([x, y]); }
    for (const [col, d, w] of [['rgba(44,84,116,.55)', 0, 1.1], ['rgba(248,252,255,.85)', -0.5, 0.55]]) {
      ig.strokeStyle = col; ig.lineWidth = w * k * 1.3; ig.beginPath(); cr.forEach((c, j) => (j ? ig.lineTo(c[0] + d, c[1] + d) : ig.moveTo(c[0] + d, c[1] + d))); ig.stroke();
    }
  }
  for (let i = 0; i <= N; i++) for (const sg of [-1, 1]) { // snow dusted along both banks
    if (rng() < 0.3) continue;
    const p = off(i, sg * rng.range(0.42, 0.56)), r = rng.range(2, 8) * k;
    ig.fillStyle = `rgba(246,251,254,${rng.range(0.45, 0.8)})`; ig.beginPath(); ig.ellipse(p[0], p[1], r * 1.4, r, rng.range(0, 3), 0, TAU); ig.fill();
  }
  for (let q = 0; q < 1400; q++) { ig.fillStyle = `rgba(255,255,255,${rng.range(0.25, 0.7)})`; ig.beginPath(); ig.arc(rng() * S, rng() * S, rng.range(0.6, 1.8), 0, TAU); ig.fill(); }
  og.drawImage(ice, 0, 0);
  const d = (x, y) => { let best = 1e9; for (let i = 0; i <= N; i++) { const v = Math.hypot(x - pts[i][0], y - pts[i][1]) - pts[i][2] * 0.5; if (v < best) best = v; } return best; };
  return { c: out, pts, nrm, d, world };
}

// Crop-blit a whole-world map canvas (transparent where it is empty).
function drawWorldMap(ctx, cam, map, world) {
  const W = A.W, H = A.H, z = cam.zoom, v = viewRect(cam, 0), ws = world / map.width;
  const sx0 = clamp(v.x0 / ws, 0, map.width), sy0 = clamp(v.y0 / ws, 0, map.height), sx1 = clamp(v.x1 / ws, 0, map.width), sy1 = clamp(v.y1 / ws, 0, map.height);
  if (sx1 <= sx0 || sy1 <= sy0) return;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(map, sx0, sy0, sx1 - sx0, sy1 - sy0, (sx0 * ws - cam.x) * z + W / 2 + cam.shakeX, (sy0 * ws - cam.y) * z + H / 2 + cam.shakeY, (sx1 - sx0) * ws * z, (sy1 - sy0) * ws * z);
}

// Leaves that spin down through the light (forest front layer).
function makeFalling(rng, sprs, n) {
  const a = [];
  for (let i = 0; i < n; i++) {
    const s = rng.pick(sprs), sc = rng.range(0.8, 1.2);
    a.push({ spr: { c: s.c, len: s.c.width }, sz: s.w * sc, x: rng.range(0, 900), y: rng.range(0, 900), vx: rng.range(-6, 10), vy: rng.range(9, 20), q: rng.range(1.1, 1.3), rot: rng.range(0, TAU), spin: rng.range(-0.9, 0.9), sw: rng.range(0.6, 1.4), ph: rng.range(0, TAU), a: rng.range(0.85, 1) });
  }
  return a;
}

function drawFalling(ctx, cam, t, list, P) {
  if (World.quality < 1) return;
  for (const f of list) {
    const sway = Math.sin(t * f.sw + f.ph);
    layerSprite(ctx, cam, f.spr, f.x + f.vx * t + sway * 14, f.y + f.vy * t, f.q, f.sz, f.rot + t * f.spin + sway * 0.5, f.a, P);
  }
  const D = A.DPR || 1;
  ctx.globalAlpha = 1; ctx.setTransform(D, 0, 0, D, 0, 0);
}

// ---- meadow (spring) --------------------------------------------------------
function buildMeadowSprites(rng) {
  const sp = { tufts: [], clover: [], flowers: [], puffs: [], petals: [], pebbles: [], dew: [] };
  for (const [i, cols] of [['a', ['#2f6a1e', '#9ad04c']], ['b', ['#3a7a24', '#b6e060']], ['c', ['#285a1a', '#7cb83e']], ['d', ['#357424', '#a8d850']], ['e', ['#2f6a1e', '#c2e468']], ['f', ['#3a7a24', '#8cc848']]]) sp.tufts.push(makeGrassTuft(rng.sub('g' + i), cols));
  for (const R of [24, 30, 36, 42]) sp.clover.push(makeClover(rng.sub('c' + R), R, ['#94cc5e', '#4c9238']));
  for (const [kind, n] of [['daisy', 3], ['butter', 3], ['bell', 3], ['poppy', 2], ['campion', 3]]) {
    const set = [];
    for (let i = 0; i < n; i++) set.push(makeWildflower(rng.sub('w' + kind + i), kind, rng.int(2, 4)));
    sp.flowers.push(set);
  }
  for (let i = 0; i < 3; i++) sp.puffs.push(makeDandelionPuff(rng.sub('dp' + i)));
  for (const [i, cols] of [[0, ['#fbe8ee', '#f2a9c4']], [1, ['#ffffff', '#f6c8d8']], [2, ['#fdeef2', '#eeb0c8']]]) sp.petals.push(makePetals(rng.sub('pe' + i), cols));
  for (const r of [5, 7, 9, 11, 6, 8]) sp.pebbles.push(makePebble(rng.sub('p' + r + sp.pebbles.length), r, rng.pick(STONES)));
  for (const r of [1.4, 2.1, 3]) sp.dew.push(makeDew(r));
  return sp;
}

function placeMeadow(dec, sp, rng, world, seed) {
  const cs = dec.cs, n = dec.n, s0 = seed % 977;
  for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) {
    const x0 = cx * cs, y0 = cy * cs, P = () => [x0 + rng() * cs, y0 + rng() * cs];
    const dens = 0.3 + 1.5 * smooth(vnoise(cx * 0.4, cy * 0.4, s0));
    if (rng() < 0.28) { const [x, y] = P(); dec.add(0, rng.pick(sp.petals), x, y, rng() * TAU, rng.range(0.8, 1.3)); }
    for (let k = Math.floor(2.6 * dens + rng()); k-- > 0;) { const spr = rng.pick(sp.tufts), [x, y] = P(); dec.add(1, spr, x, y, rng() * TAU, rng.range(0.9, 1.8), { flip: rng() < 0.5 }); placeDew(dec, sp, rng, x, y, 14, 0.28); }
    for (let k = Math.floor(0.45 * dens + rng()); k-- > 0;) { const spr = rng.pick(sp.clover), [x, y] = P(); dec.add(1, spr, x, y, rng() * TAU, rng.range(0.85, 1.25), { flip: rng() < 0.5 }); placeDew(dec, sp, rng, x, y, spr.rad, 0.55); }
    sp.flowers.forEach((set, i) => { // drifts of one colour
      const p = vnoise(cx * 0.5 + i * 7.3, cy * 0.5 - i * 3.1, s0 + i * 31);
      for (let k = Math.floor(Math.pow(p, 2.2) * 5.2 + rng()); k-- > 0;) { const [x, y] = P(); dec.add(2, rng.pick(set), x, y, rng() * TAU, rng.range(0.85, 1.3)); }
    });
    if (rng() < 0.3) { const [x, y] = P(); dec.add(2, rng.pick(sp.puffs), x, y, rng() * TAU, rng.range(0.85, 1.3)); }
    if (rng() < 0.12) { const [x, y] = P(); dec.add(2, rng.pick(sp.pebbles), x, y, 0, rng.range(0.85, 1.2), { flip: rng() < 0.5 }); placeDew(dec, sp, rng, x, y, 8, 0.4); }
  }
}

A.Biomes.meadow = {
  habitat: 'land',
  palette: { bg: '#4a8a30', grade: '#fff2c0', fog: '#0b1a08' },
  depth: { giants: ['fox', 'hawk'], specks: ['grasshopper', 'mouse'], fg: [{ kind: 'blades', cols: ['#1e4a14', '#4f9a2c', '#b0e060'] }, { kind: 'blades', cols: ['#245416', '#68b434', '#c8ee78'] }] },
  build(tier, rng) {
    const world = tier.world || 2600, st = { world };
    st.tex = meadowTexture(rng.seed, 2048); st.texUnits = 512;
    st.dec = makeDecor(world, 128);
    placeMeadow(st.dec, buildMeadowSprites(rng.sub('spr')), rng.sub('place'), world, rng.seed);
    st.dapple = dappleTexture(rng.seed + 5, 1024, '#fff6c8', 122);
    st.glow = makeGlow(48, '#fffbd0');
    st.motes = makeMotes(rng.sub('motes'), 64, { P: 900, vx: [-6, 9], vy: [-6, 3], q: [0.9, 1.5], r: [0.5, 1.5], a: [0.3, 0.85] });
    st.shaftSpr = makeShaft('#fff4c4');
    st.shafts = [];
    for (let i = 0; i < 4; i++) st.shafts.push({ x: rng.range(0, 1), w: rng.range(110, 220), a: rng.range(0.04, 0.08), ph: rng.range(0, TAU), sp: rng.range(0.1, 0.3) });
    return st;
  },
  back(ctx, cam, t, st) {
    fillTile(ctx, cam, st.tex, st.texUnits, 1, 0, 0, 1);
    drawDecor(ctx, cam, st.dec, [0, 1, 2, 3], t);
  },
  front(ctx, cam, t, st) {
    drawDapples(ctx, cam, t, st, { tile: 820, vx: 4, vy: 1.6, alpha: 0.28 });
    drawShafts(ctx, cam, t, st.shafts, st.shaftSpr);
    drawMotes(ctx, cam, t, st.motes, st.glow, 900);
  },
};

// ---- forest (autumn) --------------------------------------------------------
function buildForestSprites(rng) {
  const sp = { leaves: [], decayed: [], small: [], needles: [], cones: [], twigs: [], ferns: [], husks: [], pebbles: [], mush: [], moss: [], dew: [] };
  const kinds = [['oak', 44], ['maple', 56], ['birch', 40]], cols = ['crimson', 'scarlet', 'amber', 'ochre', 'rust', 'russet', 'gold', 'umber'];
  for (const [k, size] of kinds) for (const col of cols) sp.leaves.push(makeLeaf(rng.sub(k + col), k, col, size * rng.range(0.92, 1.1), false));
  for (const [k, col] of [['oak', 'umber'], ['maple', 'russet'], ['birch', 'umber'], ['maple', 'amber']]) sp.decayed.push(makeLeaf(rng.sub('d' + k + col), k, col, kinds.find((x) => x[0] === k)[1], true));
  for (const [k, col] of [['oak', 'amber'], ['birch', 'gold'], ['maple', 'scarlet'], ['birch', 'ochre'], ['oak', 'crimson'], ['maple', 'gold']]) sp.small.push(makeLeaf(rng.sub('s' + k + col), k, col, rng.range(20, 28), rng() < 0.3));
  for (let i = 0; i < 4; i++) sp.needles.push(makeNeedles(rng.sub('n' + i), ['#b08a4a', '#8a4a22', '#c8a868', '#7c6a2c', '#a05a2a']));
  for (let i = 0; i < 3; i++) sp.cones.push(makePineCone(rng.sub('cone' + i)));
  for (const [len, w] of [[60, 4.5], [75, 5], [90, 6], [110, 7], [150, 10]]) sp.twigs.push(makeTwig(rng.sub('t' + len), len, w, ['#24160c', '#5d4228', '#a68a5c']));
  for (const [len, curve, c] of [[66, 0.6, ['#a2682c', '#4a2812']], [82, -0.7, ['#8e5a24', '#3e2210']], [74, 0.4, ['#b87a34', '#52301a']], [60, -0.5, ['#7c6a2c', '#3a2c14']]]) sp.ferns.push(makeFern(rng.sub('f' + len), len, c, curve));
  for (const k of ['acorn', 'samara', 'pod', 'acorn']) sp.husks.push(makeHusk(rng.sub('h' + sp.husks.length + k), k));
  for (const r of [6, 8, 10, 13, 16, 9]) sp.pebbles.push(makePebble(rng.sub('p' + r + sp.pebbles.length), r, rng.pick(STONES)));
  for (const [style, n] of [['red', 1], ['red', 3], ['brown', 2], ['tan', 3], ['pale', 2], ['red', 2]]) sp.mush.push(makeMushroom(rng.sub('m' + style + n + sp.mush.length), style, n));
  for (const R of [22, 30, 38]) sp.moss.push(makeMoss(rng.sub('mo' + R), R, ['#9ab456', '#2e4620']));
  for (const r of [1.4, 2.1, 3]) sp.dew.push(makeDew(r));
  return sp;
}

function placeForest(dec, sp, rng, world, seed) {
  const cs = dec.cs, n = dec.n;
  for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) {
    const x0 = cx * cs, y0 = cy * cs, P = () => [x0 + rng() * cs, y0 + rng() * cs];
    const dens = 0.3 + 1.5 * smooth(vnoise(cx * 0.42, cy * 0.42, seed % 977));
    if (rng() < 0.3) { const [x, y] = P(); dec.add(0, rng.pick(sp.moss), x, y, rng() * TAU, rng.range(0.8, 1.3), { a: 0.95 }); }
    for (let k = Math.floor(0.9 + rng()); k-- > 0;) { const [x, y] = P(); dec.add(0, rng.pick(sp.needles), x, y, rng() * TAU, rng.range(0.9, 1.4), { flip: rng() < 0.5 }); }
    for (let k = Math.floor(1.4 * dens + rng()); k-- > 0;) {
      const spr = rng() < 0.2 ? rng.pick(sp.decayed) : rng.pick(sp.leaves), [x, y] = P();
      dec.add(1, spr, x, y, rng() * TAU, rng.range(0.8, 1.25), { flip: rng() < 0.5, a: rng.range(0.92, 1) });
      placeDew(dec, sp, rng, x, y, spr.rad, 0.25);
    }
    for (let k = Math.floor(1.7 * dens + rng()); k-- > 0;) { const [x, y] = P(); dec.add(1, rng.pick(sp.small), x, y, rng() * TAU, rng.range(0.8, 1.3), { flip: rng() < 0.5 }); }
    if (rng() < 0.22 * dens) { const [x, y] = P(); dec.add(2, sp.twigs[rng() < 0.12 ? 4 : rng.int(0, 3)], x, y, rng() * TAU, rng.range(0.85, 1.25), { flip: rng() < 0.5 }); }
    if (rng() < 0.28) { const [x, y] = P(); dec.add(2, rng.pick(sp.cones), x, y, rng() * TAU, rng.range(0.9, 1.25), { flip: rng() < 0.5 }); }
    if (rng() < 0.28 * dens) { const [x, y] = P(); dec.add(2, rng.pick(sp.ferns), x, y, rng() * TAU, rng.range(0.8, 1.3), { flip: rng() < 0.5, a: 0.96 }); }
    if (rng() < 0.32 * dens) { const [x, y] = P(); dec.add(2, rng.pick(sp.husks), x, y, rng() * TAU, rng.range(0.9, 1.3)); }
    if (rng() < 0.22) { const [x, y] = P(); dec.add(2, rng.pick(sp.pebbles), x, y, 0, rng.range(0.85, 1.2), { flip: rng() < 0.5 }); }
    if (rng() < 0.14) { const [x, y] = P(); dec.add(3, rng.pick(sp.mush), x, y, 0, rng.range(0.9, 1.3)); }
  }
}

A.Biomes.forest = {
  habitat: 'land',
  palette: { bg: '#4a2c14', grade: '#ffc880', fog: '#0c0603' },
  depth: { giants: ['wolf', 'bear'], specks: ['mouse', 'squirrel'], fg: [{ kind: 'leaves', cols: ['#c0501e', '#5a1e0e', '#e8a238'] }, { kind: 'ferns', cols: ['#a2682c', '#3a2210', '#c8883a'] }] },
  build(tier, rng) {
    const world = tier.world || 2600, st = { world };
    st.tex = forestTexture(rng.seed, 2048); st.texUnits = 512;
    st.dec = makeDecor(world, 128);
    const sp = buildForestSprites(rng.sub('spr'));
    placeForest(st.dec, sp, rng.sub('place'), world, rng.seed);
    st.dapple = dappleTexture(rng.seed + 5, 1024, '#ffc66e', 108);
    st.glow = makeGlow(48, '#ffd890');
    st.motes = makeMotes(rng.sub('motes'), 48, { P: 900, vx: [-3, 6], vy: [-4, 3], q: [0.9, 1.5], r: [0.5, 1.2], a: [0.3, 0.8] });
    st.shaftSpr = makeShaft('#ffc874');
    st.shafts = [];
    for (let i = 0; i < 7; i++) st.shafts.push({ x: rng.range(0, 1), w: rng.range(60, 150), a: rng.range(0.06, 0.12), ph: rng.range(0, TAU), sp: rng.range(0.12, 0.35) });
    st.falling = makeFalling(rng.sub('fall'), [...sp.small, ...sp.leaves.filter((l, i) => i % 3 === 0)], 24);
    return st;
  },
  back(ctx, cam, t, st) {
    fillTile(ctx, cam, st.tex, st.texUnits, 1, 0, 0, 1);
    drawDecor(ctx, cam, st.dec, [0, 1, 2, 3], t);
  },
  front(ctx, cam, t, st) {
    drawDapples(ctx, cam, t, st, { tile: 520, vx: 5, vy: 2.4, alpha: 0.38 });
    drawShafts(ctx, cam, t, st.shafts, st.shaftSpr);
    drawMotes(ctx, cam, t, st.motes, st.glow, 900);
    drawFalling(ctx, cam, t, st.falling, 900);
  },
};

// ---- valley (early winter) --------------------------------------------------
function buildValleySprites(rng) {
  const sp = { drifts: [], puddles: [], stars: [], grass: [], stones: [], twigs: [], needles: [], leaves: [] };
  for (const [i, R] of [[0, 12], [1, 16], [2, 20], [3, 26], [4, 32], [5, 18]]) sp.drifts.push(makeSnowDrift(rng.sub('sd' + i), R));
  for (const [i, R] of [[0, 9], [1, 12], [2, 16], [3, 20]]) sp.puddles.push(makeIcePuddle(rng.sub('ip' + i), R));
  for (const [i, R] of [[0, 5], [1, 7], [2, 9], [3, 6]]) sp.stars.push(makeFrostStar(rng.sub('fs' + i), R));
  for (const [i, c] of [[0, ['#8a7a52', '#c9b98a']], [1, ['#94845a', '#d8caa0']], [2, ['#7c6e4a', '#bfae80']], [3, ['#8a7a52', '#dccfa6']], [4, ['#94845a', '#c9b98a']]]) sp.grass.push(makeDryGrass(rng.sub('dg' + i), c, true));
  for (const r of [6, 8, 11, 14, 9, 17]) sp.stones.push(makeSnowStone(rng.sub('st' + r + sp.stones.length), r));
  for (const [len, w] of [[70, 5], [100, 6], [60, 4.5]]) sp.twigs.push(makeTwig(rng.sub('t' + len), len, w, ['#26221e', '#5e5448', '#b8b0a2']));
  for (let i = 0; i < 2; i++) sp.needles.push(makeNeedles(rng.sub('n' + i), ['#3f3a28', '#59492c', '#6e6a44']));
  for (const [k, col, size] of [['oak', 'umber', 30], ['birch', 'umber', 26], ['maple', 'umber', 28]]) sp.leaves.push(makeLeaf(rng.sub('l' + k), k, col, size, true));
  return sp;
}

function placeValley(dec, sp, rng, world, seed, tex, creek) {
  const cs = dec.cs, n = dec.n, mask = tex.snowMask, mn = tex.maskN;
  const snowAt = (x, y) => mask[Math.floor((((y % 512) + 512) % 512) / 512 * mn) * mn + Math.floor((((x % 512) + 512) % 512) / 512 * mn)];
  for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) {
    const x0 = cx * cs, y0 = cy * cs, P = () => [x0 + rng() * cs, y0 + rng() * cs];
    const dens = 0.3 + 1.5 * smooth(vnoise(cx * 0.4, cy * 0.4, seed % 977));
    for (let k = Math.floor(0.5 + rng()); k-- > 0;) { const [x, y] = P(); if (creek.d(x, y) > 6) dec.add(0, rng.pick(sp.stars), x, y, 0, rng.range(0.9, 1.5)); }
    for (let k = Math.floor(0.6 + rng()); k-- > 0;) { const [x, y] = P(); if (snowAt(x, y) > 0.7 && creek.d(x, y) > 10) dec.add(0, rng.pick(sp.drifts), x, y, rng.range(-0.4, 0.4), rng.range(0.8, 1.2), { flip: rng() < 0.5 }); }
    if (rng() < 0.12) { const [x, y] = P(); if (creek.d(x, y) > 30) dec.add(0, rng.pick(sp.puddles), x, y, rng() * TAU, rng.range(0.85, 1.2), { flip: rng() < 0.5 }); }
    for (let k = Math.floor(2.4 * dens + rng()); k-- > 0;) { const [x, y] = P(); if (creek.d(x, y) > 6 && (snowAt(x, y) < 0.5 || rng() < 0.15)) dec.add(1, rng.pick(sp.grass), x, y, rng() * TAU, rng.range(0.9, 1.7), { flip: rng() < 0.5 }); }
    if (rng() < 0.3) { const [x, y] = P(); if (creek.d(x, y) > 8) dec.add(2, rng.pick(sp.stones), x, y, 0, rng.range(0.85, 1.2), { flip: rng() < 0.5 }); }
    if (rng() < 0.28) { const [x, y] = P(); if (creek.d(x, y) > 8) dec.add(2, rng.pick(sp.twigs), x, y, rng() * TAU, rng.range(0.85, 1.25), { flip: rng() < 0.5 }); }
    if (rng() < 0.14) { const [x, y] = P(); if (creek.d(x, y) > 8) dec.add(1, rng.pick(sp.needles), x, y, rng() * TAU, rng.range(0.9, 1.3)); }
    if (rng() < 0.12) { const [x, y] = P(); if (creek.d(x, y) > 8) dec.add(1, rng.pick(sp.leaves), x, y, rng() * TAU, rng.range(0.8, 1.2), { a: 0.9 }); }
  }
  for (let i = 0; i <= creek.pts.length - 1; i += 1) for (const sg of [-1, 1]) { // frozen banks: snow lips, dry reeds, stones
    const p = creek.pts[i], nm = creek.nrm[i], r = rng();
    if (p[0] < 20 || p[0] > world - 20) continue;
    const o = sg * (p[2] * 0.5 + rng.range(8, 24)), x = p[0] + nm[0] * o + rng.range(-6, 6), y = p[1] + nm[1] * o + rng.range(-6, 6);
    if (r < 0.22) dec.add(0, rng.pick(sp.drifts), x, y, Math.atan2(nm[1], nm[0]) + Math.PI / 2, rng.range(0.6, 0.95), { flip: rng() < 0.5 });
    else if (r < 0.52) dec.add(1, rng.pick(sp.grass), x, y, rng() * TAU, rng.range(1, 1.5), { flip: rng() < 0.5 });
    else if (r < 0.64) dec.add(2, rng.pick(sp.stones), x, y, 0, rng.range(0.8, 1.2), { flip: rng() < 0.5 });
  }
}

A.Biomes.valley = {
  habitat: 'land',
  palette: { bg: '#7f93a0', grade: '#d6ecff', fog: '#101a24' },
  depth: { giants: ['elk', 'bear'], specks: ['hare', 'fox'], fg: [{ kind: 'blades', cols: ['#34302a', '#8c7c58', '#d8e2e4'] }, { kind: 'blades', cols: ['#2c2a24', '#7a6c4c', '#c8d6da'] }] },
  build(tier, rng) {
    const world = tier.world || 2600, st = { world };
    st.tex = frostTexture(rng.seed, 2048); st.texUnits = 512;
    st.creek = iceCreek(world, rng.sub('creek'));
    st.dec = makeDecor(world, 128);
    placeValley(st.dec, buildValleySprites(rng.sub('spr')), rng.sub('place'), world, rng.seed, st.tex, st.creek);
    st.dapple = dappleTexture(rng.seed + 5, 1024, '#e4f2ff', 116);
    st.glow = makeGlow(32, '#ffffff');
    st.snowFar = makeMotes(rng.sub('snowfar'), 80, { P: 900, vx: [-4, 3], vy: [7, 14], q: [0.9, 1.15], r: [0.5, 1.1], a: [0.4, 0.85] });
    st.snowNear = makeMotes(rng.sub('snownear'), 36, { P: 900, vx: [-6, 4], vy: [10, 20], q: [1.25, 1.6], r: [1.1, 2.2], a: [0.3, 0.65] });
    return st;
  },
  back(ctx, cam, t, st) {
    fillTile(ctx, cam, st.tex, st.texUnits, 1, 0, 0, 1);
    drawWorldMap(ctx, cam, st.creek.c, st.world);
    drawDecor(ctx, cam, st.dec, [0, 1, 2, 3], t);
  },
  front(ctx, cam, t, st) {
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = 0.26; ctx.fillStyle = '#6f9cff';
    ctx.fillRect(0, 0, A.W, A.H);
    ctx.restore();
    drawDapples(ctx, cam, t, st, { tile: 900, vx: 3, vy: 1.2, alpha: 0.3 });
    drawMotes(ctx, cam, t, st.snowFar, st.glow, 900, 'source-over', true);
    drawMotes(ctx, cam, t, st.snowNear, st.glow, 900, 'source-over', true);
  },
};

// -------------------------------------------------------------- depth layers
const GIANT_P = 1500, SPECK_P = 800;

function speciesNames(tier, role) {
  return (tier.roster || []).filter((r) => r.role === role).map((r) => r.sp);
}

// Players and hunters of the next tier(s), else the biome's own list.
function giantSpecies(tier, cfg) {
  const out = [];
  for (const id of tier.next || []) {
    const nt = A.TIERS && A.TIERS[id];
    if (nt) out.push(...(nt.players || []), ...speciesNames(nt, 'hunter'));
  }
  return out.length ? out : (cfg.giants || ['beetle']);
}

function buildDepth(tier, biome, rng) {
  const cfg = biome.depth || {}, hab = tier.habitat || biome.habitat || 'land';
  const d = { hab, giants: [], below: [], specks: [], fg: [], clouds: [], ground: null };
  const gsp = giantSpecies(tier, cfg);
  if (hab === 'land' && cfg.above !== false) {
    for (let i = 0; i < 3; i++) {
      const ang = rng.range(0, TAU), sp = gsp[i % gsp.length], v = rng.range(16, 30);
      d.giants.push({ spr: silhouette(sp, 7), x: rng.range(0, GIANT_P), y: rng.range(0, GIANT_P), vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, rot: ang, sz: rng.range(250, 360), q: 1.2, a: rng.range(0.1, 0.16) });
    }
  }
  if (hab === 'water' || cfg.below) {
    const bsp = cfg.belowSp || gsp;
    for (let i = 0; i < 7; i++) {
      const ang = rng.range(0, TAU), v = rng.range(9, 18);
      d.below.push({ spr: silhouette(bsp[i % bsp.length], 6, 'fish'), x: rng.range(0, GIANT_P), y: rng.range(0, GIANT_P), vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, rot: ang, sz: rng.range(240, 420), q: rng.range(0.5, 0.7), a: rng.range(0.7, 0.9), ph: rng.range(0, TAU) });
    }
  }
  const small = cfg.specks || speciesNames(tier, 'grazer').slice(0, 3);
  const sprs = (small.length ? small : ['mite']).map((sp) => silhouette(sp, 5, 'bug'));
  for (let i = 0; i < 24; i++) {
    const ang = rng.range(0, TAU), v = rng.range(2, 8);
    d.specks.push({ spr: sprs[i % sprs.length], x: rng.range(0, SPECK_P), y: rng.range(0, SPECK_P), vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, sz: rng.range(1.4, 2.8), q: rng.range(1.2, 1.5), a: rng.range(0.35, 0.5), ph: rng.range(0, TAU) });
  }
  if (hab === 'land' && cfg.fg !== null) {
    const kinds = cfg.fg || [FG_BLADES], sprs2 = [];
    for (let i = 0; i < 4; i++) { const k = kinds[i % kinds.length]; sprs2.push(makeFg(k.kind, rng.sub('fg' + i), k.cols, 7)); }
    for (let e = 0; e < 4; e++) for (let i = 0; i < 3; i++) {
      d.fg.push({ spr: rng.pick(sprs2), edge: e, along: rng(), s: rng.range(0.3, 0.62), par: rng.range(0.35, 0.8), inset: rng.range(-4, 30), ph: rng.range(0, TAU), a: rng.range(0.78, 0.92) });
    }
  }
  if (hab === 'air') buildAir(d, biome, rng);
  return d;
}

// Air habitat: patchwork ground far below, clouds above.
function buildAir(d, biome, rng) {
  const S = 512, c = mk(S, S), g = g2(c);
  g.fillStyle = '#4a6a34'; g.fillRect(0, 0, S, S);
  const cols = ['#5b7d3a', '#7a8c3e', '#8b7a46', '#486a3a', '#9a8a52', '#3d5c34'];
  for (let i = 0; i < 90; i++) {
    const w = rng.range(30, 110), h = rng.range(24, 90), x = rng() * S, y = rng() * S;
    wrapped(S, x, y, 120, (xx, yy) => { g.fillStyle = rng.pick(cols); g.fillRect(xx, yy, w, h); g.strokeStyle = 'rgba(30,40,20,.35)'; g.lineWidth = 1.5; g.strokeRect(xx, yy, w, h); });
  }
  d.ground = blurred(c, 2, 0);
  for (let i = 0; i < 5; i++) {
    const s = sprite(260, 150, 1, (gg) => { for (let k = 0; k < 14; k++) { gg.fillStyle = `rgba(255,255,255,${rng.range(0.4, 0.8)})`; gg.beginPath(); gg.arc(rng.range(-80, 80), rng.range(-30, 30), rng.range(18, 44), 0, TAU); gg.fill(); } });
    d.clouds.push({ spr: { c: blurred(s.c, 14), len: 260 }, x: rng.range(0, GIANT_P), y: rng.range(0, GIANT_P), vx: rng.range(6, 14), vy: rng.range(-3, 3), sz: rng.range(300, 520), q: 1.7, a: rng.range(0.4, 0.6) });
  }
}

function layerSprite(ctx, cam, spr, ux, uy, q, szUnits, rot, alpha, P) {
  const W = A.W, H = A.H, D = A.DPR || 1, z = cam.zoom * q;
  const sx = W / 2 + wrapRel(ux - cam.x, P) * z + cam.shakeX * q, sy = H / 2 + wrapRel(uy - cam.y, P) * z + cam.shakeY * q;
  const scale = szUnits * z / spr.len, ext = Math.max(spr.c.width, spr.c.height) * scale * 0.5;
  if (sx < -ext || sx > W + ext || sy < -ext || sy > H + ext) return;
  const cs = Math.cos(rot) * scale, sn = Math.sin(rot) * scale;
  ctx.setTransform(D * cs, D * sn, -D * sn, D * cs, D * sx, D * sy);
  ctx.globalAlpha = alpha;
  ctx.drawImage(spr.c, -spr.c.width / 2, -spr.c.height / 2);
}

function drawGiants(ctx, cam, t, list, P, wobble) {
  for (const g of list) {
    const rot = g.rot + (wobble ? 0.1 * Math.sin(t * 0.5 + g.ph) : 0);
    layerSprite(ctx, cam, g.spr, g.x + g.vx * t, g.y + g.vy * t, g.q, g.sz, rot, g.a, P);
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(A.DPR || 1, 0, 0, A.DPR || 1, 0, 0);
}

function drawSpecks(ctx, cam, t, list) {
  for (const s of list) {
    const wob = 0.8 * Math.sin(t * 1.3 + s.ph);
    layerSprite(ctx, cam, s.spr, s.x + s.vx * t + wob, s.y + s.vy * t + wob, s.q, s.sz, Math.atan2(s.vy, s.vx) + 0.4 * Math.sin(t * 0.9 + s.ph), s.a, SPECK_P);
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(A.DPR || 1, 0, 0, A.DPR || 1, 0, 0);
}

function drawFg(ctx, cam, t, list) {
  const W = A.W, H = A.H, D = A.DPR || 1, z = cam.zoom, k0 = Math.min(W, H) / 900;
  for (const it of list) {
    const spr = it.spr, s = it.s * k0 * 1.3, vert = it.edge < 2, span = (vert ? H : W) + 500;
    const along = ((it.along * span - (vert ? cam.y : cam.x) * z * it.par) % span + span) % span - 250;
    const drift = 14 * Math.sin((vert ? cam.x : cam.y) * z * 0.003 + it.ph);
    let px, py, rot;
    if (it.edge === 0) { px = -it.inset + drift; py = along; rot = Math.PI / 2; }
    else if (it.edge === 1) { px = W + it.inset - drift; py = along; rot = -Math.PI / 2; }
    else if (it.edge === 2) { px = along; py = -it.inset + drift; rot = Math.PI; }
    else { px = along; py = H + it.inset - drift; rot = 0; }
    rot += 0.05 * Math.sin(t * 0.7 + it.ph);
    const cs = Math.cos(rot) * s, sn = Math.sin(rot) * s;
    ctx.setTransform(D * cs, D * sn, -D * sn, D * cs, D * px, D * py);
    ctx.globalAlpha = it.a;
    ctx.drawImage(spr.c, -spr.c.width / 2, -spr.root);
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(D, 0, 0, D, 0, 0);
}

// -------------------------------------------------------------- grading
const fx = { harm: 70, barren: 0, last: 0 };

function resetFx() {
  const eco = A.G && A.G.eco;
  fx.harm = eco && typeof eco.harmony === 'number' ? eco.harmony : 70;
  fx.barren = eco && eco.flags && eco.flags.barren ? 1 : 0;
  fx.last = 0;
}

// Ease the grade toward the live ecosystem state (real-time, independent of pause).
function updateFx() {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const dt = fx.last ? clamp((now - fx.last) / 1000, 0, 0.1) : 0;
  fx.last = now;
  const eco = A.G && A.G.eco;
  const h = eco && typeof eco.harmony === 'number' ? eco.harmony : 70;
  const b = eco && eco.flags && eco.flags.barren ? 1 : 0;
  const k = 1 - Math.exp(-dt * 0.7);
  fx.harm += (h - fx.harm) * k;
  fx.barren += (b - fx.barren) * k;
}

function applyGrade(ctx, W, H) {
  const low = clamp((62 - fx.harm) / 62, 0, 1), b = fx.barren, high = clamp((fx.harm - 72) / 28, 0, 1);
  const desat = Math.min(0.9, low * 0.6 + b * 0.38), brown = Math.min(0.55, low * 0.34 + b * 0.36);
  if (desat < 0.02 && brown < 0.02 && b < 0.02 && high < 0.02) return;
  ctx.save();
  if (desat > 0.02) { ctx.globalCompositeOperation = 'saturation'; ctx.globalAlpha = desat; ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H); }
  if (brown > 0.02) { ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = brown; ctx.fillStyle = '#d0a870'; ctx.fillRect(0, 0, W, H); }
  if (b > 0.02) { ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = 0.5 * b; ctx.fillStyle = '#d9b266'; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 0.1 * b; ctx.fillStyle = '#a88c58'; ctx.fillRect(0, 0, W, H); }
  if (high > 0.02) {
    ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = 0.18 * high; ctx.fillStyle = '#c4ff70'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'saturation'; ctx.globalAlpha = 0.09 * high; ctx.fillStyle = '#30ff50'; ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

function makeVignette(pal) {
  const c = mk(256, 160), g = g2(c);
  const tint = mixc('#ffffff', pal.grade, 0.2), edge = mixc(pal.fog, '#ffffff', 0.46), mid = mixc(tint, edge, 0.18);
  g.fillStyle = css(tint); g.fillRect(0, 0, 256, 160);
  g.save(); g.translate(128, 80); g.scale(1, 0.625);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 160);
  gr.addColorStop(0, css(tint)); gr.addColorStop(0.45, css(tint)); gr.addColorStop(0.75, css(mid)); gr.addColorStop(1, css(edge));
  g.fillStyle = gr; g.fillRect(-200, -200, 400, 400);
  g.restore();
  return c;
}

// -------------------------------------------------------------- dispatcher
// Drops the optional light layers once if frames stay slow (e.g. software rendering).
const perf = { last: 0, ema: 16 };
function watchFrameRate() {
  const now = typeof performance !== 'undefined' ? performance.now() : 0, dt = now - perf.last;
  perf.last = now;
  if (!World.autoQuality || dt <= 0 || dt > 120 || World.quality < 1) return;
  perf.ema += (dt - perf.ema) * 0.04;
  if (perf.ema > 30) World.quality = 0;
}

const FALLBACK = {
  habitat: 'land', palette: { bg: '#1c2a1c', grade: '#ffffff', fog: '#050805' },
  build() { return {}; },
  back(ctx) { ctx.fillStyle = '#243a26'; ctx.fillRect(0, 0, A.W, A.H); },
  front() {},
};
const cache = new Map();
let cur = null;

function ensureView(ctx) {
  if (!A.DPR) A.DPR = 1;
  if (!A.W && ctx.canvas) A.W = ctx.canvas.width / A.DPR;
  if (!A.H && ctx.canvas) A.H = ctx.canvas.height / A.DPR;
}

function safeCam(cam) {
  if (!cam || !cam.zoom) return { x: 0, y: 0, zoom: 4, shakeX: 0, shakeY: 0 };
  return cam.shakeX === undefined || cam.shakeY === undefined ? Object.assign({}, cam, { shakeX: cam.shakeX || 0, shakeY: cam.shakeY || 0 }) : cam;
}

const World = {
  quality: 1, // 0 drops the second dapple layer and the motes on slow machines
  autoQuality: true, // set false to keep quality fixed (tests, screenshots)
  init() { A.Biomes = A.Biomes || {}; },

  build(tier) {
    if (!tier) return;
    resetFx();
    perf.last = 0;
    if (cache.has(tier.id)) { cur = cache.get(tier.id); return; }
    const biome = A.Biomes[tier.biome] || FALLBACK;
    const rng = makeRng(hash32(tier.id || tier.biome || 'tier'));
    let st = {}, depth = { hab: 'land', giants: [], below: [], specks: [], fg: [], clouds: [] };
    try { st = biome.build(tier, rng) || {}; } catch (e) { console.error('World biome build failed', tier.biome, e); }
    try { depth = buildDepth(tier, biome, rng.sub('depth')); } catch (e) { console.error('World depth build failed', e); }
    cur = { tier, biome, st, depth, vig: makeVignette(biome.palette || FALLBACK.palette), world: tier.world || 2600 };
    cache.set(tier.id, cur);
    if (cache.size > 3) cache.delete(cache.keys().next().value);
  },

  drawDepthBelow(ctx, cam, t) {
    ensureView(ctx); cam = safeCam(cam); t = t || 0;
    ctx.fillStyle = cur ? cur.biome.palette.bg : '#101810';
    ctx.fillRect(0, 0, A.W, A.H);
    if (!cur) return;
    const d = cur.depth;
    if (d.hab === 'air' && d.ground) fillTile(ctx, cam, d.ground, 900, 0.45, 0, 0, 1);
    if (d.below.length) drawGiants(ctx, cam, t, d.below, GIANT_P, true);
  },

  drawBack(ctx, cam, t) {
    ensureView(ctx); cam = safeCam(cam); t = t || 0;
    if (!cur) return;
    watchFrameRate();
    try { cur.biome.back(ctx, cam, t, cur.st); } catch (e) { if (!cur.err) { cur.err = true; console.error('World back failed', e); } }
    drawEdges(ctx, cam, cur.world, rgb(cur.biome.palette.fog));
  },

  drawFront(ctx, cam, t) {
    ensureView(ctx); cam = safeCam(cam); t = t || 0;
    if (!cur) return;
    updateFx();
    try { if (cur.biome.front) cur.biome.front(ctx, cam, t, cur.st); } catch (e) { if (!cur.errF) { cur.errF = true; console.error('World front failed', e); } }
    applyGrade(ctx, A.W, A.H);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(cur.vig, 0, 0, A.W, A.H);
    ctx.restore();
  },

  drawDepthAbove(ctx, cam, t) {
    ensureView(ctx); cam = safeCam(cam); t = t || 0;
    if (!cur) return;
    const d = cur.depth;
    drawSpecks(ctx, cam, t, d.specks);
    if (d.giants.length) drawGiants(ctx, cam, t, d.giants, GIANT_P, false);
    if (d.clouds.length) drawGiants(ctx, cam, t, d.clouds, GIANT_P, false);
    if (d.fg.length) drawFg(ctx, cam, t, d.fg);
  },

  isWater(x, y) {
    const b = cur && cur.biome;
    return !!(b && b.isWater && b.isWater(cur.st, x, y));
  },
  waterDepth(x, y) {
    const b = cur && cur.biome;
    return b && b.waterDepth ? b.waterDepth(cur.st, x, y) : 0;
  },
  palette() { return cur ? cur.biome.palette : FALLBACK.palette; },
  get state() { return cur && cur.st; },
  get depth() { return cur && cur.depth; },
};

A.World = World;
})();
