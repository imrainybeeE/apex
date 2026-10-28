/* Apex: title logo as inline SVG (no external images, so the single-file build stays self-contained).
   The A is a trophic pyramid of the six tiers, bottom to top: leaf litter, undergrowth, pond edge, spring meadow,
   autumn forest, winter valley. The climb (ant, beetle, frog, snake, fox, wolf) walks along the letter tops, each
   tinted by its tier, toward the X torn by the Old One's glowing claws. The h1 in ui.js carries the accessible name. */
(function () {
  const A = (window.Apex = window.Apex || {});

  const BONE = '#EFE8DA', SOIL = '#1B1612', SPORE = '#7FE8D4';
  const TIER = ['#9C8262', '#5A9A30', '#2AA48C', '#8FD14F', '#F2D94E', '#E4F6F2'];

  // Letterforms: cap height 100 on baseline y=100; the A's summit overshoots to y=-8.
  const A_OUT = 'M0 100 L52 -8 L104 100 L76 100 L68.3 84 L35.7 84 L28 100 Z';
  const A_IN = 'M44.4 66 L59.6 66 L52 50 Z';
  const P = 'M108 0 H162 L182 18 V46 L164 64 H136 V100 H108 Z M136 22 H152 L156 26 V38 L152 42 H136 Z';
  const E = 'M186 0 H250 V24 H214 V39 H242 V61 H214 V76 H250 V100 H186 Z';
  const X = 'M252 0 H282 L297 30 L312 0 H342 L314 50 L342 100 H312 L297 70 L282 100 H252 L280 50 Z';

  const f = (n) => +n.toFixed(1);
  /** A tapered slash (lens) from (x1,y1) to (x2,y2) with half-width w. */
  function slash(x1, y1, x2, y2, w) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, L = Math.hypot(x2 - x1, y2 - y1);
    const nx = -(y2 - y1) / L * w, ny = (x2 - x1) / L * w;
    return `M${f(x1)} ${f(y1)}Q${f(mx + nx)} ${f(my + ny)} ${f(x2)} ${f(y2)}Q${f(mx - nx)} ${f(my - ny)} ${f(x1)} ${f(y1)}Z`;
  }
  const claws = (w) => [-1, 0, 1].map((k) => slash(330 + k * 14, 2, 254 + k * 14, 110, w)).join('');

  // Side-profile silhouettes: feet on y=0, facing +x, drawn at 2x.
  const legs = (c, d, sw) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"/>`;
  const SIL = {
    ant: (c) => `<g fill="${c}"><ellipse cx="6" cy="-6" rx="6" ry="4.5"/><ellipse cx="15" cy="-6.5" rx="4.2" ry="2.8"/><ellipse cx="22.5" cy="-7" rx="3.6" ry="3.2"/></g>` +
      legs(c, 'M13 -5L9 0M15 -5L15.5 0M17 -5L21 0M24 -9.5Q27 -14 30 -12', 1.6),
    beetle: (c) => `<path fill="${c}" d="M1 -2Q2 -15 14 -15.5Q25 -15 26 -5L26 -2ZM25 -10Q31 -10 31 -5Q30 -2 25 -3Z"/>` +
      legs(c, 'M7 -2L4 .5M13 -2L13 .5M19 -2L22 .5M30 -8L33 -12', 1.7),
    frog: (c) => `<path fill="${c}" d="M2 -1Q0 -12 9 -16Q17 -20 24 -18Q30 -16 30 -12Q29 -9 25 -9Q23 -6 26 -1ZM2 -1Q6 -10 14 -7Q16 -2 12 0L2 0Z"/><circle fill="${c}" cx="22" cy="-18.5" r="3.2"/>`,
    snake: (c) => legs(c, 'M1 -3C10 -3 12 -13 20 -13S30 -3 38 -3S45 -11 48 -11', 5) + `<ellipse fill="${c}" cx="50" cy="-11.5" rx="4.4" ry="3"/>`,
    fox: (c) => `<path fill="${c}" d="M0 -24Q6 -32 16 -25Q20 -22 24 -21L44 -22Q47 -26 49 -33L52 -26L55 -27L64 -22L63 -20L53 -18Q50 -14 49 -10L50 0L46 0L44 -10L42 -12L26 -12L24 -8L25 0L21 0L19 -10Q14 -14 12 -18Q6 -16 0 -24Z"/>`,
    wolf: (c) => `<path fill="${c}" d="M0 -30Q4 -36 14 -33L22 -32Q30 -36 46 -35L58 -34Q62 -40 64 -44L67 -37L70 -36L84 -30L83 -27L71 -25Q67 -22 66 -16L67 0L62 0L59 -14L56 -17L32 -17L29 -12L30 0L25 0L23 -14Q20 -20 20 -24Q10 -24 0 -30Z"/>`,
  };
  // [species, x on the letter tops, scale]: ant, beetle and frog on the P; snake and fox on the E; the wolf on the X.
  const CLIMB = [['ant', 110, .5], ['beetle', 127, .5], ['frog', 146, .54], ['snake', 187, .5], ['fox', 214, .55], ['wolf', 295, .6]];

  function markup() {
    const bh = 108 / 6;
    const bands = TIER.map((c, i) => `<rect x="-2" y="${f(100 - (i + 1) * bh)}" width="108" height="${f(bh - 1.2)}" fill="${c}"/>`).join('');
    const climb = CLIMB.map(([n, x, s], i) => `<g transform="translate(${x} 0) scale(${s})">${SIL[n](TIER[i])}</g>`).join('');
    return '<svg class="logo-mark" xmlns="http://www.w3.org/2000/svg" viewBox="-6 -32 356 152" aria-hidden="true" focusable="false">' +
      '<defs>' +
        `<filter id="apx-sh" x="-10%" y="-25%" width="120%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="3.5" flood-color="${SOIL}" flood-opacity=".75"/></filter>` +
        '<filter id="apx-glow" x="-60%" y="-30%" width="220%" height="160%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
        `<clipPath id="apx-a"><path clip-rule="evenodd" d="${A_OUT}${A_IN}"/></clipPath>` +
        `<mask id="apx-cut" maskUnits="userSpaceOnUse" x="-10" y="-40" width="370" height="170"><rect x="-10" y="-40" width="370" height="170" fill="#fff"/><path fill="#000" d="${claws(5.5)}"/></mask>` +
      '</defs>' +
      '<g filter="url(#apx-sh)">' +
        `<g clip-path="url(#apx-a)">${bands}</g>` +
        `<path fill="${BONE}" fill-rule="evenodd" mask="url(#apx-cut)" d="${P}${E}${X}"/>` +
        `<g class="logo-climb">${climb}</g>` +
      '</g>' +
      `<path class="logo-claws" filter="url(#apx-glow)" fill="${SPORE}" d="${claws(2.6)}"/>` +
      '</svg>';
  }

  A.Logo = { markup };
})();
