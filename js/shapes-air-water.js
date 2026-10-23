/* Apex air and water vertebrates: bird, fish (incl. tadpole variant).
   Uses A.VKit from shapes-land.js at draw time (that file loads first). */
(function () {
  'use strict';
  const A = window.Apex = window.Apex || {};
  A.Shapes = A.Shapes || {};
  A.LOOKS = A.LOOKS || {};

  const PI = Math.PI, TAU = PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ====================================================================
     BIRD
     look: len wid headR beak('dagger'|'hooked'|'short'|'flat') beakLen neck neckS
           span wing('long'|'broad'|'pointed'|'round') feathers flapRate
           tail('fan'|'forked'|'short'|'long') tailLen legs legLen legCol
           crest('plume'|'tuft') disk marks('streaks'|'bars')
     Wings are one feather fan whose angle and length blend from folded to spread.
     ==================================================================== */
  const BODYB = [[0, 0.35], [0.15, 0.8], [0.4, 1], [0.7, 0.95], [0.9, 0.7], [1, 0.45]];

  // Wing shapes as fractions of the semi-span: arm (shoulder->wrist), chord (secondary length),
  // prim (primary length), sweep (back-sweep radians), fan (primary spread radians)
  const WINGS = {
    long: { arm: 0.46, chord: 0.36, prim: 0.56, sweep: 0.2, fan: 0.85, np: 7, ns: 8 },
    broad: { arm: 0.42, chord: 0.52, prim: 0.5, sweep: 0.14, fan: 1.05, np: 7, ns: 8 },
    pointed: { arm: 0.32, chord: 0.26, prim: 0.75, sweep: 0.55, fan: 0.55, np: 7, ns: 6 },
    round: { arm: 0.5, chord: 0.55, prim: 0.38, sweep: 0.1, fan: 1.2, np: 6, ns: 8 },
  };

  function feather(ctx, x, y, a, l, w, base, tip) {
    const c = Math.cos(a), s = Math.sin(a);
    ctx.lineWidth = w;
    ctx.strokeStyle = base;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + c * l, y + s * l); ctx.stroke();
    ctx.strokeStyle = tip;
    ctx.beginPath(); ctx.moveTo(x + c * l * 0.5, y + s * l * 0.5); ctx.lineTo(x + c * l, y + s * l); ctx.stroke();
  }

  // One wing: secondaries along the arm, primaries fanning from the wrist, coverts on top.
  // `spread` 0 folds everything back along the body, 1 opens it out.
  function drawWing(ctx, K, P, o, side, sx, sy, spread, th, shape, span, foldLen) {
    const sh = WINGS[shape] || WINGS.long;
    const sweep = sh.sweep + (o.dive ? 0.7 : 0) + th * 0.25;
    const lc = Math.cos(th * 1.1);
    const armA = side * lerp(PI * 0.96, PI / 2 + sweep, spread);
    const armLen = lerp(foldLen * 0.4, span * sh.arm * lc, spread);
    const wx = sx + Math.cos(armA) * armLen, wy = sy + Math.sin(armA) * armLen;
    const chord = lerp(foldLen * 0.5, span * sh.chord, spread);
    const secBase = K.mix(P.body, P.dark, 0.18), secTip = K.mix(P.body, P.dark, 0.55);
    const primBase = K.mix(P.body, P.dark, 0.5), primTip = P.dark;
    ctx.lineCap = 'round';
    for (let k = sh.ns - 1; k >= 0; k--) {                                // secondaries, wrist -> body
      const f = k / (sh.ns - 1);
      const x = lerp(sx, wx, f), y = lerp(sy, wy, f);
      const a = side * (PI - 0.1 - f * 0.1 + (1 - spread) * 0.02);
      const l = chord * (1 - 0.28 * f) * (0.9 + 0.1 * lc);
      feather(ctx, x, y, a, l, Math.max(1.2, armLen / sh.ns * 1.5), secBase, secTip);
    }
    const primA0 = lerp(PI * 0.88, PI / 2 + sweep, spread), fan = lerp(0.12, sh.fan, spread);
    const primL = lerp(foldLen * 0.5, span * sh.prim * lc, spread);
    for (let k = sh.np - 1; k >= 0; k--) {                                // primaries, trailing first
      const g = k / (sh.np - 1);
      const l = primL * (1 - 0.4 * Math.pow(g, 1.4));
      feather(ctx, wx, wy, side * (primA0 + g * fan), l, Math.max(1.2, primL * 0.17), primBase, primTip);
    }
    // arm: leading-edge coverts as one shaded lens from shoulder to wrist
    const ang = Math.atan2(wy - sy, wx - sx), mx = (sx + wx) / 2, my = (sy + wy) / 2;
    K.oval(ctx, mx, my, Math.max(1, armLen * lerp(0.8, 0.58, spread)), Math.max(1, chord * lerp(0.4, 0.3, spread)), ang);
    K.fillShaded(ctx, P.body, mx, my, chord * 0.3, 1);
    K.rim(ctx, P.bodyLo, 1.2);
  }

  function tailFeathers(ctx, K, P, kind, len, rootX, w, sway) {
    const n = kind === 'forked' ? 4 : 5;
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const f = n === 1 ? 0 : i / (n - 1) * 2 - 1;     // -1..1 across the tail
      const a = PI + f * (kind === 'fan' ? 0.42 : 0.3) + sway;
      let l = len * (1 - 0.18 * Math.abs(f));
      if (kind === 'forked') l = len * (0.7 + 0.5 * Math.abs(f));
      if (kind === 'long') l = len * (1 - 0.1 * Math.abs(f));
      ctx.strokeStyle = i % 2 ? P.bodyLo : P.dark;
      ctx.lineWidth = Math.max(1.2, w * (kind === 'long' ? 0.5 : 0.62));
      ctx.beginPath(); ctx.moveTo(rootX, 0); ctx.lineTo(rootX + Math.cos(a) * l, Math.sin(a) * l); ctx.stroke();
    }
  }

  function beakShape(K, ctx, kind, bl, hr, P, open, headX) {
    // two mandibles that split left/right when open; drawn pointing +x from the head front
    const baseW = kind === 'short' ? hr * 0.55 : kind === 'hooked' ? hr * 0.62 : kind === 'flat' ? hr * 0.62 : hr * 0.52;
    const col = P.accent;
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      ctx.save();
      ctx.translate(headX + hr * 0.7, 0);
      ctx.rotate(sgn * open * 0.55);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      if (kind === 'flat') {
        ctx.lineTo(bl * 0.2, sgn * baseW * 0.85); ctx.quadraticCurveTo(bl * 0.8, sgn * baseW * 1.35, bl, sgn * baseW * 0.6);
        ctx.quadraticCurveTo(bl * 1.04, 0, bl, 0);
      } else if (kind === 'hooked') {
        ctx.quadraticCurveTo(bl * 0.45, sgn * baseW * 1.05, bl * 0.82, sgn * baseW * 0.62);
        ctx.quadraticCurveTo(bl * 1.05, sgn * baseW * 0.25, bl * 0.9, sgn * baseW * 0.02);
        ctx.lineTo(bl * 0.98, 0);
      } else {
        ctx.quadraticCurveTo(bl * 0.4, sgn * baseW, bl, 0);
      }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fill();                 // soft shade on the shadow half
      if (sgn < 0) { ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fill(); }
      ctx.restore();
    }
    if (open < 0.15) {                                              // mouth seam and nostril
      ctx.strokeStyle = 'rgba(40,25,5,.55)'; ctx.lineWidth = Math.max(0.7, hr * 0.07);
      ctx.beginPath(); ctx.moveTo(headX + hr * 0.7, 0); ctx.lineTo(headX + hr * 0.7 + bl * 0.92, 0); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(40,25,5,.6)';
    K.circ(ctx, headX + hr * 0.7 + bl * 0.2, -baseW * 0.25, Math.max(0.5, hr * 0.06)); ctx.fill();
    K.circ(ctx, headX + hr * 0.7 + bl * 0.2, baseW * 0.25, Math.max(0.5, hr * 0.06)); ctx.fill();
    if (kind === 'hooked') {                                        // dark hook tip
      ctx.fillStyle = P.dark; K.circ(ctx, headX + hr * 0.7 + bl * 0.95, 0, hr * 0.12); ctx.fill();
    }
  }

  A.Shapes.bird = function (ctx, e, t, look) {
    const K = A.VKit;
    if (!K) return;
    const S = K.S, rnd = K.rnd, ease = K.ease;
    const r = e.r || 12, L = look.len * r, W = look.wid * r;
    const o = K.begin(ctx, e, t, look), P = o.pal, rs = e.rs;
    const alt = e.alt || 0;
    const flying = alt > 0.1 || o.fly || (o.speed > r * 3.5 && e.state !== 'lunge');
    rs.spr = rs.spr === undefined ? (flying ? 1 : 0) : rs.spr + ((flying ? 1 : 0) - rs.spr) * 0.16;
    const sp = rs.spr, spread = ease(clamp(sp, 0, 1));
    const sc = 1 + 0.22 * alt;
    ctx.scale(sc, sc);
    const turn = K.turn(e, t), sd = rnd(e, 2) * TAU;

    // layout along x
    const headR = r * (look.headR || 0.3), bl = r * (look.beakLen || 0.4), neckL = r * (look.neck || 0);
    const reach = clamp(0.55 + 0.3 * o.alert + 0.12 * o.graze - 0.5 * o.crouch + 1.05 * o.stretch + 0.35 * o.bite - 0.45 * spread, 0.05, 1.7);
    const headRest = L * 0.98 - bl - headR * 0.6;
    const headX = headRest + neckL * (reach - 0.55) - o.hurt * r * 0.05;
    const rear = -L * 0.68, bw = W * 0.88;
    const front = Math.max(headRest - neckL * 0.55 - headR * 0.2, rear + bw * 2.1);
    const torso = K.pts(e, 'sp', 6);
    for (let i = 0; i < 6; i++) {
      const u = i / 5, p = torso[i];
      p.x = lerp(rear, front, u);
      p.y = -turn * (1 - u) * (1 - u) * r * 0.35 + Math.sin(t * 1.3 + sd) * r * 0.01;
      p.w = bw * K.prof(BODYB, u);
    }

    // tail (behind everything)
    const tlen = r * (look.tailLen === undefined ? 0.5 : look.tailLen);
    const tailK = look.tail || 'fan';
    tailFeathers(ctx, K, P, tailK, tlen + bw * 0.5, rear + bw * 0.5, Math.max(bw * 0.35, tlen * 0.3), turn * 0.45 + Math.sin(t * 1.6 + sd) * 0.04);

    // legs: walk when grounded, trail straight back in flight
    if (look.legs) {
      const ll = r * (look.legLen || 1) * look.legs;
      ctx.strokeStyle = look.legCol || P.accentLo; ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = Math.max(1, r * 0.075); ctx.lineCap = 'round';
      const cyc = (e.phase || 0) * 1.5;
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        const hx = rear * 0.35, hy = sgn * bw * 0.3;
        const sw = Math.sin(cyc + (sgn > 0 ? PI : 0)) * o.move;
        const wx = hx + sw * ll * 0.5 + ll * 0.1, wy = sgn * (bw * 0.95 + r * 0.1);
        const fxx = lerp(wx, rear - tlen - ll * 0.85, spread), fyy = lerp(wy, sgn * bw * 0.22, spread);
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(fxx, fyy); ctx.stroke();
        const dx = spread > 0.5 ? -1 : 1;
        for (let k = -1; k <= 1; k++) {                // toes
          ctx.beginPath(); ctx.moveTo(fxx, fyy);
          ctx.lineTo(fxx + dx * r * 0.2, fyy + k * r * 0.1); ctx.stroke();
        }
      }
    }

    // neck: S-curve that straightens on strike, folds in flight
    if (neckL > 0.2 * r) {
      const nk = K.pts(e, 'neck', 5), fold = clamp(1.3 - reach, 0, 1.2);
      const nx0 = front - bw * 0.4, nw = Math.max(r * 0.1, headR * 0.58);
      for (let i = 0; i < 5; i++) {
        const u = i / 4, p = nk[i];
        p.x = lerp(nx0, headX, u);
        p.y = Math.sin(u * TAU * 0.95) * r * 0.32 * (look.neckS === undefined ? 1 : look.neckS) * fold + turn * r * 0.1 * u;
        p.w = nw * (1.15 - 0.2 * u);
      }
      K.tube(ctx, nk, 1, 0, 1, 1); K.fillShaded(ctx, P.belly, (nx0 + headX) / 2, 0, nw, 1);
      K.rim(ctx, P.bodyLo, Math.max(1, r * 0.04));
    }

    // torso
    K.tube(ctx, torso, 1, 0, 1, 1); K.fillShaded(ctx, P.body, (rear + front) / 2, 0, bw, 1);
    K.rim(ctx, P.bodyLo, Math.max(1, r * 0.045));
    if (look.marks) {
      ctx.save(); K.tube(ctx, torso, 1, 0, 1, 1); ctx.clip();
      ctx.strokeStyle = P.dark; ctx.globalAlpha = 0.45; ctx.lineWidth = Math.max(1, bw * 0.1); ctx.lineCap = 'round';
      for (let k = 0; k < 9; k++) {
        const x = lerp(rear * 0.8, front, 0.1 + 0.8 * rnd(e, 30 + k)), y = (rnd(e, 50 + k) - 0.5) * bw * 1.3;
        ctx.beginPath();
        if (look.marks === 'bars') { ctx.moveTo(x, y - bw * 0.25); ctx.quadraticCurveTo(x - bw * 0.25, y, x, y + bw * 0.25); }
        else { ctx.moveTo(x, y); ctx.lineTo(x - bw * 0.3, y + (y > 0 ? 1 : -1) * bw * 0.06); }
        ctx.stroke();
      }
      ctx.restore();
    }
    K.gloss(ctx, (rear + front) / 2 + S.lx * bw * 0.2, S.ly * bw * 0.45, (front - rear) * 0.28, bw * 0.12, 0, 1);

    // wings: folded blade <-> spread fan
    const flapRate = (look.flapRate || 9) * (0.7 + 0.5 * clamp(o.speed / (r * 6), 0, 1));
    const amp = (0.12 + 0.75 * clamp(o.speed / (r * 4.5) + o.fly * 0.3 + (alt > 0.1 ? 0.3 : 0), 0, 1)) * spread;
    const th = Math.sin(t * flapRate + sd) * amp;
    const span = r * (look.span || 1.8) * (o.dive ? 0.6 : 1);
    const foldLen = (front - rear) * 0.95;
    const shoulderX = front * 0.78 + rear * 0.22;
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      drawWing(ctx, K, P, o, sgn, shoulderX, sgn * bw * lerp(0.62, 0.5, spread), spread, th, look.wing || 'long', span, foldLen);
    }

    // head
    ctx.save();
    const yaw = K.headYaw(e, t, o, 0.6) * (neckL > 0.2 * r ? 0.5 : 1) * (1 - 0.7 * o.stretch);
    ctx.translate(headX, 0); ctx.rotate(yaw + turn * 0.2); K.frame((e.angle || 0) + yaw + turn * 0.2);
    ctx.translate(-headX, 0);
    if (look.disk) {                                                 // owl-style facial disk
      ctx.fillStyle = P.belly; K.circ(ctx, headX + headR * 0.2, 0, headR * 1.55); ctx.fill();
      K.rim(ctx, P.bodyLo, Math.max(1, r * 0.04));
    }
    K.circ(ctx, headX, 0, headR); K.fillShaded(ctx, look.headCol === 'belly' ? P.belly : P.body, headX, 0, headR, 1);
    K.rim(ctx, P.bodyLo, Math.max(1, r * 0.04));
    K.gloss(ctx, headX + S.lx * headR * 0.3, S.ly * headR * 0.35, headR * 0.4, headR * 0.12, 0, 1);
    const open = Math.max(o.bite, o.stretch * 0.5);
    beakShape(K, ctx, look.beak || 'dagger', bl, headR, P, open, headX);
    // eyes
    const er = Math.max(headR * 0.4, r * 0.06) * (look.eye || 1);
    const ex = headX + headR * (look.disk ? 0.55 : 0.28), ey = headR * (look.disk ? 0.75 : 0.62);
    K.eye(ctx, ex, -ey, er, look.pupil); K.eye(ctx, ex, ey, er, look.pupil);
    // crest plume / tuft
    if (look.crest) {
      ctx.strokeStyle = P.dark; ctx.lineCap = 'round';
      const sway = Math.sin(t * 3 + sd) * 0.08 + spread * 0.35 + turn * 0.3;
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        const cl = look.crest === 'plume' ? headR * 2.1 : headR * 1.2;
        ctx.lineWidth = Math.max(1, headR * (look.crest === 'plume' ? 0.22 : 0.45));
        ctx.beginPath(); ctx.moveTo(headX + headR * 0.1, sgn * headR * 0.5);
        ctx.quadraticCurveTo(headX - cl * 0.5, sgn * (headR * 0.35 + cl * 0.08) + sway * cl * 0.3, headX - cl, sgn * headR * 0.15 + sway * cl * 0.5);
        ctx.stroke();
      }
    }
    ctx.restore();
    K.end(ctx);
  };

  /* ====================================================================
     FISH (and tadpole)
     look: len wid body('fusiform'|'elongate'|'deep'|'tadpole') tail('forked'|'lunate'|'round'|'fan')
           tailLen fins stripes('bars'|'lateral'|'spots') eye teeth swim
     ==================================================================== */
  const FISH = {
    fusiform: [[0, 0.2], [0.18, 0.5], [0.4, 0.92], [0.58, 1], [0.78, 0.82], [0.92, 0.55], [1, 0.3]],
    elongate: [[0, 0.35], [0.2, 0.62], [0.5, 0.8], [0.75, 0.78], [0.9, 0.66], [0.97, 0.55], [1, 0.4]],
    deep: [[0, 0.18], [0.2, 0.62], [0.4, 1], [0.6, 0.98], [0.8, 0.7], [0.93, 0.45], [1, 0.28]],
    tadpole: [[0, 0.02], [0.2, 0.06], [0.42, 0.1], [0.55, 0.45], [0.7, 0.95], [0.84, 1], [0.94, 0.78], [1, 0.45]],
  };

  function finPath(ctx, kind, tl, tw, pw) {
    ctx.beginPath();
    ctx.moveTo(0, -pw);
    if (kind === 'round' || kind === 'fan') {
      ctx.quadraticCurveTo(tl * 0.75, -tw * 1.15, tl, 0);
      ctx.quadraticCurveTo(tl * 0.75, tw * 1.15, 0, pw);
    } else {
      const notch = kind === 'lunate' ? 0.42 : 0.66;
      ctx.quadraticCurveTo(tl * 0.5, -tw * 0.95, tl, -tw);
      ctx.quadraticCurveTo(tl * notch, -tw * 0.18, tl * notch, 0);
      ctx.quadraticCurveTo(tl * notch, tw * 0.18, tl, tw);
      ctx.quadraticCurveTo(tl * 0.5, tw * 0.95, 0, pw);
    }
    ctx.closePath();
  }
  function ribs(ctx, tl, tw, n) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const f = n === 1 ? 0 : i / (n - 1) * 2 - 1;
      ctx.moveTo(0, f * tw * 0.2); ctx.lineTo(tl * 0.95, f * tw * 0.9);
    }
    ctx.stroke();
  }

  A.Shapes.fish = function (ctx, e, t, look) {
    const K = A.VKit;
    if (!K) return;
    const S = K.S, rnd = K.rnd;
    const r = e.r || 12, L = look.len * r, W = look.wid * r;
    const o = K.begin(ctx, e, t, look), P = o.pal;
    const turn = K.turn(e, t), sd = rnd(e, 2) * TAU;
    const tad = look.body === 'tadpole';
    const N = 12, sp = K.pts(e, 'sp', N);
    const cyc = (e.phase || 0) * 1.9 + t * (tad ? 7 : 1.4) * (1 - o.move * 0.9) + sd;
    const tbl = FISH[look.body || 'fusiform'];
    const rearX = tad ? -L : -L * 0.58, headX = L * 0.98 + (o.stretch * 0.1 + o.bite * 0.05) * r;
    const amp = r * (tad ? 0.34 : 0.26) * (0.35 + 0.65 * o.move) * (1 + 0.5 * o.flee);
    for (let i = 0; i < N; i++) {                       // i=0 tail end .. N-1 snout
      const u = i / (N - 1), b = 1 - u, p = sp[i];
      p.x = lerp(rearX, headX, u);
      p.y = Math.sin(cyc - u * 4.2) * amp * Math.pow(b, tad ? 1.1 : 1.5) - turn * b * b * L * 0.4;
      p.w = W * K.prof(tbl, u);
    }

    // soft dark blob below (water creatures draw their own shadow)
    ctx.save();
    ctx.translate(-S.lx * r * 0.12, -S.ly * r * 0.14);
    K.oval(ctx, (rearX + headX) / 2, 0, L * 0.95, W * 1.0, 0); ctx.fillStyle = 'rgba(2,12,18,.1)'; ctx.fill();
    K.oval(ctx, (rearX + headX) / 2, 0, L * 0.7, W * 0.75, 0); ctx.fillStyle = 'rgba(2,12,18,.1)'; ctx.fill();
    ctx.restore();

    if (tad) {
      // translucent tail membrane
      const fm = K.pts(e, 'fin', 8);
      for (let i = 0; i < 8; i++) {
        const q = sp[i], f = i / 7;
        fm[i].x = q.x; fm[i].y = q.y; fm[i].w = W * 0.5 * Math.sin(clamp(f * 1.15, 0, 1) * PI * 0.92) + W * 0.04;
      }
      K.tube(ctx, fm, 1, 0, 1, 1); ctx.fillStyle = K.mix(P.accent, P.dark, 0.2); ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1;
    } else {
      // tail fin, trailing the peduncle with a lag
      const p0 = sp[0], p1 = sp[1];
      const back = Math.atan2(p0.y - p1.y, p0.x - p1.x) + Math.sin(cyc - 1.4) * 0.38 * (0.3 + 0.7 * o.move);
      const tl = L * 0.5 * (look.tailLen || 1), tw = Math.max(W * 0.95, r * 0.3) * (look.tailW || 1);
      ctx.save(); ctx.translate(p0.x, p0.y); ctx.rotate(back);
      finPath(ctx, look.tail || 'forked', tl, tw, p0.w * 0.9);
      ctx.fillStyle = P.accent; ctx.globalAlpha = 0.92; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = P.dark; ctx.globalAlpha = 0.28; ctx.lineWidth = Math.max(0.6, r * 0.025); ribs(ctx, tl, tw, 6);
      ctx.globalAlpha = 0.5; finPath(ctx, look.tail || 'forked', tl, tw, p0.w * 0.9); ctx.stroke(); ctx.restore();
      // paired pectoral fins, fanning as it swims
      const pu = look.finU || 0.7, pec = K.at(sp, pu, { x: 0, y: 0, w: 0, a: 0 });
      const fl = r * 0.62 * (look.fins === undefined ? 1 : look.fins);
      if (fl > 0) {
        for (let sgn = -1; sgn <= 1; sgn += 2) {
          const th = 0.75 + 0.35 * Math.sin(t * 3.4 + sd + (sgn > 0 ? 1.3 : 0)) * (0.5 + 0.5 * o.move);
          ctx.save(); ctx.translate(pec.x, pec.y + sgn * pec.w * 0.8); ctx.rotate(pec.a);
          ctx.beginPath(); ctx.moveTo(fl * 0.15, 0);
          ctx.quadraticCurveTo(fl * 0.05, sgn * fl * 0.55, -Math.cos(th) * fl * 0.35, sgn * Math.sin(th) * fl * 1.0);
          ctx.quadraticCurveTo(-fl * 0.5, sgn * fl * 0.35, -fl * 0.35, 0); ctx.closePath();
          ctx.fillStyle = P.accent; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 0.3;
          ctx.strokeStyle = P.dark; ctx.lineWidth = Math.max(0.6, r * 0.022); ctx.stroke(); ctx.globalAlpha = 1; ctx.restore();
        }
      }
    }

    // body
    const cx = (rearX + headX) / 2;
    K.tube(ctx, sp, 1, 0, tad ? 0.8 : 1, 1); K.fillShaded(ctx, P.belly, cx, 0, W, 1);
    K.tube(ctx, sp, tad ? 1 : 0.8, 0, tad ? 0.8 : 1, 1); K.fillShaded(ctx, P.body, cx, 0, W, tad ? 1.1 : 0.75);
    K.tube(ctx, sp, 1, 0, tad ? 0.8 : 1, 1); K.rim(ctx, P.bodyLo, Math.max(1, r * 0.045));
    const st = look.stripes;
    if (st) {
      ctx.save(); K.tube(ctx, sp, 1, 0, 1, 1); ctx.clip();
      ctx.fillStyle = P.dark; ctx.strokeStyle = P.dark; ctx.globalAlpha = 0.55; ctx.lineCap = 'round';
      if (st === 'bars') {
        for (let i = 2; i < N - 3; i += 2) {
          const q = sp[i], g = sp[i + 1];
          K.oval(ctx, q.x, q.y, (headX - rearX) / N * 0.45, q.w * 1.2, Math.atan2(g.y - q.y, g.x - q.x) + PI / 2); ctx.fill();
        }
      } else if (st === 'lateral') {
        ctx.lineWidth = Math.max(1, W * 0.2); K.trace(ctx, sp, -0.1, 1, N - 3); ctx.stroke();
        ctx.strokeStyle = P.accent; ctx.globalAlpha = 0.6; ctx.lineWidth = Math.max(0.8, W * 0.08); K.trace(ctx, sp, -0.28, 1, N - 3); ctx.stroke();
      } else if (st === 'spots') {
        for (let k = 0; k < 14; k++) {
          ctx.globalAlpha = 0.5 + 0.3 * rnd(e, 80 + k);
          K.circ(ctx, lerp(rearX * 0.5, headX * 0.8, rnd(e, 30 + k * 2)), (rnd(e, 31 + k * 2) - 0.5) * W * 1.4, W * (0.07 + 0.08 * rnd(e, 120 + k))); ctx.fill();
        }
      }
      ctx.restore(); ctx.globalAlpha = 1;
    }
    if (tad) {
      ctx.save(); K.tube(ctx, K.sub(sp, 5, N - 1), 1, 0, 0.8, 0.2); ctx.clip();   // golden flecks on the dark head
      ctx.fillStyle = P.accent; ctx.globalAlpha = 0.5;
      for (let k = 0; k < 7; k++) {
        K.circ(ctx, lerp(rearX * 0.2, headX * 0.9, 0.3 + 0.65 * rnd(e, 40 + k)), (rnd(e, 60 + k) - 0.5) * W * 1.5, Math.max(0.5, W * 0.05 * (1 + rnd(e, 90 + k)))); ctx.fill();
      }
      ctx.restore(); ctx.globalAlpha = 1;
    }
    if (!tad && look.dorsal !== false) {                                     // dorsal ridge
      ctx.save(); ctx.globalAlpha = 0.75; ctx.strokeStyle = P.accentLo; ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1, W * 0.14); K.trace(ctx, sp, 0, 3, 8); ctx.stroke(); ctx.restore();
    }
    const hd = K.at(sp, 0.9, { x: 0, y: 0, w: 0, a: 0 });
    if (tad) K.gloss(ctx, hd.x - W * 0.2 + S.lx * W * 0.3, S.ly * W * 0.4, W * 0.5, W * 0.22, hd.a, 1.5);
    else {
      K.glossLine(ctx, sp, 2, N - 3, 1, W * 0.1);
      ctx.strokeStyle = P.dark; ctx.globalAlpha = 0.3; ctx.lineWidth = Math.max(0.8, r * 0.04);   // gill cover
      const gl = K.at(sp, 0.77, { x: 0, y: 0, w: 0, a: 0 });
      ctx.beginPath(); ctx.moveTo(gl.x + gl.w * 0.25, gl.y - gl.w * 0.8);
      ctx.quadraticCurveTo(gl.x - gl.w * 0.35, gl.y, gl.x + gl.w * 0.25, gl.y + gl.w * 0.8); ctx.stroke(); ctx.globalAlpha = 1;
    }

    // head: mouth and eyes
    ctx.save(); ctx.translate(hd.x, hd.y); ctx.rotate(hd.a); K.frame((e.angle || 0) + hd.a);
    const mouthX = (headX - hd.x) + (tad ? -W * 0.05 : 0);
    if (!tad && o.bite + o.stretch * 0.5 > 0.04) {
      const op = Math.max(o.bite, o.stretch * 0.5);
      ctx.fillStyle = '#5b1320'; K.oval(ctx, mouthX - r * 0.05, 0, r * 0.2 * (0.5 + op), hd.w * 0.36 * (0.3 + op), 0); ctx.fill();
      if (look.teeth) {
        ctx.fillStyle = '#fff';
        for (let k = -1; k <= 1; k += 2) { ctx.beginPath(); ctx.moveTo(mouthX - r * 0.2, k * hd.w * 0.3 * op); ctx.lineTo(mouthX - r * 0.02, k * hd.w * 0.36 * op); ctx.lineTo(mouthX - r * 0.1, k * hd.w * 0.18 * op); ctx.closePath(); ctx.fill(); }
      }
    } else if (!tad) {
      ctx.strokeStyle = P.dark; ctx.globalAlpha = 0.5; ctx.lineWidth = Math.max(0.7, r * 0.03);
      ctx.beginPath(); ctx.moveTo(mouthX - r * 0.2, 0); ctx.lineTo(mouthX, 0); ctx.stroke(); ctx.globalAlpha = 1;
    }
    const er = (tad ? hd.w * 0.36 : hd.w * 0.58) * (look.eye || 1);
    const eyY = tad ? hd.w * 0.72 : hd.w * 0.5;
    const eyX = tad ? hd.w * 0.15 : -hd.w * 0.1;
    K.eye(ctx, eyX, -eyY, er, look.pupil); K.eye(ctx, eyX, eyY, er, look.pupil);
    ctx.restore();
    K.end(ctx);
  };

  /* ====================================================================
     LOOKS
     ==================================================================== */
  Object.assign(A.LOOKS, {
    heron: {
      plan: 'bird', habitat: 'air', len: 2.0, wid: 0.5, headR: 0.24, beak: 'dagger', beakLen: 0.95, neck: 1.6, neckS: 1,
      span: 2.3, wing: 'long', feathers: 11, flapRate: 6, tail: 'short', tailLen: 0.4, legs: 1, legLen: 1.5,
      legCol: '#b79a34', crest: 'plume', eye: 1,
      pal: { body: '#7f9cb5', belly: '#eef2f2', accent: '#f0c43a', dark: '#1b2533', eye: '#f2d94a' },
    },
    tadpole: {
      plan: 'fish', habitat: 'water', noShadow: true, body: 'tadpole', len: 1.4, wid: 0.5, eye: 1,
      pal: { body: '#2b3a31', belly: '#61785a', accent: '#7f9a5e', dark: '#0f1914', eye: '#f1dc7a' },
    },
  });
})();
