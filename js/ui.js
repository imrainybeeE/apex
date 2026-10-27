/* Apex UI. The creature is the interface: the in-world HUD lives in fx.js; this file builds the few DOM pieces
   around it. The food-chain ribbon (top centre) is the hero element, then bare score and time numbers, one small
   harmony dial, a Tab ecosystem view, tutorial hint bubbles and dew-film menus.
   Everything is built inside #ui in init(); update(G, dt) is cheap: per-frame work is only the sliding marker and
   the bubble position, the rest of the DOM is touched at ~10 Hz. Every combat/tutorial field is read defensively. */
(function () {
  'use strict';
  const A = window.Apex = window.Apex || {};

  const HUD_MODES = { intro: 1, play: 1, evolveChoice: 1 };
  const FAST_SCOPES = { evolve: 1, rebirth: 1, intro: 1 };   // big portraits redraw ~30 Hz, the rest ~10 Hz
  const SLOW_MS = 100, FAST_MS = 33, BANNER_MS = 4200, TIP_MS = 7500;
  const RING_LEN = 2 * Math.PI * 19;
  const BEST_KEY = 'apex.best';

  const ICONS = {
    bite: '<path d="M3 8.5l3 4 3-4 3 4 3-4 3 4 3-4M3 15.5l3-4 3 4 3-4 3 4 3-4 3 4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
    dash: '<path d="M5 6l6 6-6 6M12.5 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>',
    pause: '<path d="M8.5 5.5v13M15.5 5.5v13" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>',
    close: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
    spray: '<path d="M3 12l11-6v12z" fill="currentColor"/><circle cx="18" cy="8" r="1.5" fill="currentColor"/><circle cx="21" cy="12" r="1.5" fill="currentColor"/><circle cx="18" cy="16" r="1.5" fill="currentColor"/>',
    roll: '<circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M7.5 12a4.5 4.5 0 0 1 4.5-4.5M12 16.5A4.5 4.5 0 0 0 16.5 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
    web: '<path d="M12 3v18M3.5 7.5l17 9M3.5 16.5l17-9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/>',
    horn: '<path d="M5 18c0-6 4-12 14-12-1 8-5 13-10 13z" fill="currentColor"/>',
    tongue: '<path d="M4 15c5 0 8-1 12-5" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/><circle cx="18.5" cy="8" r="2.8" fill="currentColor"/>',
    tail: '<path d="M4 17c3-8 6 4 9-3s4-2 7-7" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/>',
    star: '<path d="M12 3l2.4 6 6.6.5-5 4.3 1.6 6.4L12 16.5 6.4 20.2 8 13.8 3 9.5 9.6 9z" fill="currentColor"/>',
    famine: '<path d="M3 11h18a9 9 0 0 1-18 0z M7 5c0 1.5 2 1.5 2 3M12 4c0 1.5 2 1.5 2 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    boom: '<path d="M12 20V6M6 12l6-6 6 6M5 20h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
    disease: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.5v9M7.5 12h9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
    barren: '<path d="M5 19C5 10 10 5 19 5c0 9-4 14-14 14zM5 19l8-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    surge: '<path d="M3 19l3.5-12 3.5 7 2-9 2 9 3.5-7L21 19z" fill="currentColor"/>',
  };
  // Tints for the mishap icon discs (deep enough to read on the pale film).
  const MISHAP_COLORS = { famine: '#8A6D00', boom: '#3F7A1C', disease: '#2E7D4F', barren: '#7A6A3D', surge: '#B8242B' };
  const ABILITY_ICON = { spray: 'spray', roll: 'roll', web: 'web', horn: 'horn', tongue: 'tongue', tail: 'tail' };
  const ABILITY_BY_SP = { ant: 'spray', pillbug: 'roll', spider: 'web', beetle: 'horn', frog: 'tongue', skink: 'tail' };
  const ABILITY_NAME = { spray: 'Formic spray', roll: 'Roll up', web: 'Web throw', horn: 'Horn charge', tongue: 'Tongue snatch', tail: 'Tail drop' };

  let G = null;          // latest game state
  let root = null;       // #ui
  const R = {};          // element refs
  const live = [];       // animated portrait canvases: {cv, ctx, sp, size, opts, scope}
  const scopesOn = {};   // which portrait scopes are on screen
  const S = {            // cached UI state (keys avoid rebuilding DOM)
    mode: null, lastSlow: 0, lastFast: 0, identKey: '', chainKey: '', introKey: '', cardsKey: {},
    deathKey: null, victoryBuilt: false, picked: false, scoreShown: 0, muted: false,
    chain: [], banners: { queue: [], cur: null, until: 0 },
    mark: 0, markTarget: 0, zoneFood: 0, zoneFight: 0, lastFrame: 0, slowFrames: 0,
    ecoPin: false, tabHeld: false, ecoOn: false, ecoKey: '', ecoNodes: [], ecoEdges: [], ecoHover: -1, ecoW: 0, ecoH: 0,
    tutKey: '', tutSize: null, tutX: null, tutY: null, tipId: null, tipUntil: 0, tipDone: {},
    abilityKind: '', thumbSeen: '',
  };

  // ---------- helpers ----------
  const cfg = (k, d) => (A.CFG && A.CFG[k] != null ? A.CFG[k] : d);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pretty = (id) => String(id || '').replace(/^t\d+_/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const sentence = (s) => { s = String(s == null ? '' : s); return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); };
  const lower = (s) => String(s == null ? '' : s).toLowerCase();
  const article = (name) => (/^[aeiou]/i.test(name) ? 'an ' : 'a ') + name;
  const spec = (sp) => (A.SPECIES && A.SPECIES[sp]) || { name: pretty(sp), latin: '', fact: '' };
  const spName = (sp) => sentence(spec(sp).name);
  const tierOf = (id) => (A.TIERS && A.TIERS[id]) || null;
  const tierName = (id) => { const t = tierOf(id); return t && t.name ? t.name : pretty(id); };
  const emit = (n, p) => { if (A.emit) A.emit(n, p); };
  const icon = (name, size) => `<svg class="ico" viewBox="0 0 24 24" width="${size || 20}" height="${size || 20}" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  const isTouch = () => !!(root && root.classList.contains('is-touch'));

  function fmtTime(s) {
    s = Math.max(0, Math.floor(s || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function fmtNum(n) { return Math.round(n || 0).toLocaleString('en-US'); }

  function el(tag, cls, html, parent) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    if (parent) parent.appendChild(n);
    return n;
  }
  // Write-through caches so the per-tick updates touch the DOM only when a value changes.
  function setText(n, s) { if (n && n._t !== s) { n._t = s; n.textContent = s; } }
  function setStyle(n, k, v) { if (n && n['_s' + k] !== v) { n['_s' + k] = v; n.style[k] = v; } }
  function flag(n, cls, on) {
    if (!n) return;
    const m = n._f || (n._f = {});
    on = !!on;
    if (m[cls] !== on) { m[cls] = on; n.classList.toggle(cls, on); }
  }
  /** Escape, then mark key names so they read as keys. */
  function richText(s) {
    const t = esc(s);
    if (/\[[^\]]{1,6}\]/.test(t)) return t.replace(/\[([^\]]{1,6})\]/g, '<kbd>$1</kbd>');   // explicit [Key] tokens
    return t
      .replace(/\b(Shift|Space|Tab|Esc|Enter)\b/g, '<kbd>$1</kbd>')
      .replace(/\b(Press |press |Hold |hold )([EQ])\b/g, '$1<kbd>$2</kbd>');
  }

  // ---------- portraits ----------
  function hashColor(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return 'hsl(' + (Math.abs(h) % 360) + ',55%,58%)';
  }
  function blob(ctx, sp, size) {
    const look = A.LOOKS && A.LOOKS[sp];
    const c = size / 2;
    ctx.fillStyle = (look && look.pal && look.pal.body) || hashColor(sp);
    ctx.beginPath(); ctx.ellipse(c, c, size * 0.38, size * 0.27, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(c + size * 0.22, c - size * 0.07, size * 0.07, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#14261D';
    ctx.beginPath(); ctx.arc(c + size * 0.24, c - size * 0.07, size * 0.035, 0, Math.PI * 2); ctx.fill();
  }
  function drawPortrait(it, t) {
    const ctx = it.ctx;
    if (!ctx) return;
    ctx.setTransform(it.dpr, 0, 0, it.dpr, 0, 0);
    ctx.clearRect(0, 0, it.size, it.size);
    const o = typeof it.opts === 'function' ? it.opts() : it.opts;
    try {
      if (A.drawPortrait) A.drawPortrait(ctx, it.sp, it.size, Object.assign({ t }, o));
      else blob(ctx, it.sp, it.size);
    } catch (e) { blob(ctx, it.sp, it.size); }
    if (it.tint) { // flat silhouette in one colour
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = it.tint;
      ctx.fillRect(0, 0, it.size, it.size);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  /** Create a portrait canvas of logical `size` px; CSS decides the displayed size. */
  function portrait(sp, size, scope, opts, cls) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cv = el('canvas', 'portrait ' + (cls || ''));
    cv.width = cv.height = Math.round(size * dpr);
    cv.setAttribute('aria-hidden', 'true');
    const it = { cv, ctx: cv.getContext && cv.getContext('2d'), sp, size, dpr, opts: opts || {}, scope, tint: null };
    cv._it = it;
    live.push(it);
    drawPortrait(it, now() / 1000);
    return cv;
  }
  function clearScope(scope) {
    for (let i = live.length - 1; i >= 0; i--) if (live[i].scope === scope) live.splice(i, 1);
  }
  function refreshPortraits(fast) {
    const t = now() / 1000;
    for (const it of live) {
      if (scopesOn[it.scope] && !!FAST_SCOPES[it.scope] === fast) drawPortrait(it, t);
    }
  }

  // ---------- creature info ----------
  function creatureOpts() {
    const c = (G && G.creature) || {};
    return { pal: c.pal || null, parts: c.parts || null };
  }
  function innateOf(sp) {
    const inn = spec(sp).innate;
    const id = inn && Object.keys(inn)[0];
    const part = id && A.PARTS && A.PARTS[id];
    return id ? { id, name: part ? part.name : pretty(id), desc: part ? part.desc : '' } : null;
  }
  function abilityKindOf(sp, id) {
    const s = lower(id);
    if (/formic|spray|acid/.test(s)) return 'spray';
    if (/roll|shell|ball/.test(s)) return 'roll';
    if (/web|silk/.test(s)) return 'web';
    if (/horn|charge|ram/.test(s)) return 'horn';
    if (/tongue|snatch|lick/.test(s)) return 'tongue';
    if (/tail|decoy|drop/.test(s)) return 'tail';
    return ABILITY_BY_SP[sp] || '';
  }
  function abilityOf(sp) {
    const ab = spec(sp).ability;
    if (!ab) return null;
    const kind = abilityKindOf(sp, ab.id);
    return { kind, name: ab.name ? sentence(ab.name) : (ABILITY_NAME[kind] || pretty(ab.id)) };
  }
  const eatRatioOf = (p) => (p.stats && p.stats.eatRatio) || cfg('EAT_RATIO', 0.92);
  const fightRatio = () => cfg('FIGHT_RATIO', 1.35);
  /** 'edible' | 'fight' | 'danger' | 'dim' for a roster entry relative to the player. */
  function statusOf(ro, p) {
    if (ro.r < p.r * eatRatioOf(p)) return 'edible';
    if ((ro.role === 'hunter' || ro.role === 'h') && ro.r * cfg('EAT_RATIO', 0.92) > p.r) return 'danger';
    if (ro.r <= p.r * fightRatio()) return 'fight';
    return 'dim';
  }
  const isProducer = (ro) => ro.role === 'producer' || ro.role === 'p';
  const isHunter = (ro) => ro.role === 'hunter' || ro.role === 'h';
  function rosterAnimals(tier) {
    return ((tier && tier.roster) || []).filter((r) => !isProducer(r)).slice().sort((a, b) => a.r - b.r);
  }
  function currentTier() { return (G && G.tier) || tierOf(G && G.tierId); }

  // ---------- build: title ----------
  const KEYS_DESKTOP = [
    ['Steer', 'Move the mouse, or use [W] [A] [S] [D] or the arrow keys.'],
    ['Bite', 'Left click or [Space].'],
    ['Dash', '[Shift] or right click.'],
    ['Ability', '[E] or [Q].'],
    ['Ecosystem view', 'Hold [Tab].'],
    ['Game', '[Esc] or [P] pauses, [M] mutes, [R] restarts.'],
  ];
  const TOUCH_KEYS = '<dt class="touch-copy">Steer</dt><dd class="touch-copy">Drag anywhere on the screen.</dd>' +
    '<dt class="touch-copy">Bite, dash, ability</dt><dd class="touch-copy">Use the round buttons at the bottom right.</dd>' +
    '<dt class="touch-copy">Ecosystem view</dt><dd class="touch-copy">Tap the harmony dial.</dd>' +
    '<dt class="touch-copy">Pause</dt><dd class="touch-copy">Tap the pause button at the top right.</dd>';
  const RULES = [
    ['leaf', 'Smaller than you is food. Touch it to eat it.'],
    ['fight', 'A bit bigger is a fight. Bite it down, then eat what it leaves.'],
    ['venom', 'Bigger is danger. A hunter flashes before it lunges, so dash away.'],
    ['spore', 'Keep the web alive. Wipe out one species and its predators come for you.'],
  ];
  function howHtml() {
    return '<div class="how-col"><h3>Controls</h3><dl class="keys">' +
      KEYS_DESKTOP.map((k) => '<dt class="kb">' + k[0] + '</dt><dd class="kb">' + richText(k[1]) + '</dd>').join('') +
      TOUCH_KEYS + '</dl></div>' +
      '<div class="how-col"><h3>The rules</h3><ul class="rules">' +
      RULES.map((r) => '<li><i class="swatch sw-' + r[0] + '"></i><span>' + esc(r[1]) + '</span></li>').join('') +
      '</ul></div>';
  }

  function buildTitle() {
    const s = R.title = el('section', 'screen title hit', '', root);
    s.innerHTML =
      '<div class="title-wrap">' +
        '<h1 class="logo">Apex</h1>' +
        '<p class="tagline">Eat what\'s smaller. Escape what\'s bigger. Keep the forest floor alive.</p>' +
        '<div class="title-actions">' +
          '<button class="btn primary big" data-sfx data-act="play">Play</button>' +
          '<button class="btn quiet" data-sfx data-act="how" aria-expanded="false" aria-controls="ui-how">How to play</button>' +
        '</div>' +
        '<div class="best" id="ui-best"></div>' +
      '</div>' +
      '<div class="how film hit" id="ui-how" role="dialog" aria-label="How to play">' +
        '<button class="x" data-act="how-close" aria-label="Close">' + icon('close', 18) + '</button>' +
        '<h2>How to play</h2><div class="how-cols">' + howHtml() + '</div>' +
      '</div>';
    R.best = s.querySelector('#ui-best');
    R.how = s.querySelector('#ui-how');
    R.howBtn = s.querySelector('[data-act="how"]');
    s.querySelector('[data-act="play"]').addEventListener('click', () => { if (A.newRun) A.newRun(); });
    R.howBtn.addEventListener('click', () => toggleHow());
    s.querySelector('[data-act="how-close"]').addEventListener('click', () => { toggleHow(false); R.howBtn.focus(); });
    s.addEventListener('keydown', (e) => { if (e.key === 'Escape' && R.how.classList.contains('open')) { e.stopPropagation(); toggleHow(false); R.howBtn.focus(); } });
  }
  function toggleHow(open) {
    const on = open == null ? !R.how.classList.contains('open') : open;
    R.how.classList.toggle('open', on);
    R.howBtn.setAttribute('aria-expanded', String(on));
  }

  function readBest() {
    try { return JSON.parse(localStorage.getItem(BEST_KEY)) || null; } catch (e) { return null; }
  }
  /** Records are written by core as {pathKey: {time, score, deaths, harmony}}. */
  function renderBest() {
    const all = readBest() || {};
    const recs = Object.keys(all).filter((k) => all[k] && typeof all[k] === 'object');
    if (!recs.length) { R.best.innerHTML = ''; return; }
    const score = Math.max.apply(null, recs.map((k) => all[k].score || 0));
    const time = Math.min.apply(null, recs.map((k) => all[k].time || Infinity));
    const harmony = Math.max.apply(null, recs.map((k) => all[k].harmony || 0));
    let h = '';
    if (score) h += '<span>Best score <b>' + fmtNum(score) + '</b></span>';
    if (isFinite(time)) h += '<span>Fastest finish <b>' + fmtTime(time) + '</b></span>';
    if (harmony) h += '<span>Best harmony <b>' + harmony + '</b></span>';
    const paths = A.PATHS || {};
    const done = Object.keys(paths).filter((k) => k !== 'shared' && all[k]).map((k) =>
      '<span class="done">' + esc(paths[k].name || pretty(k)) + ' finished in <b>' + fmtTime(all[k].time) + '</b></span>').join('');
    R.best.innerHTML = '<div class="best-row">' + h + '</div>' + (done ? '<div class="best-row">' + done + '</div>' : '');
  }

  // ---------- build: HUD ----------
  function buildHud() {
    const h = R.hud = el('section', 'screen hud', '', root);

    // ribbon (top centre)
    const rb = R.ribbon = el('div', 'ribbon', '', h);
    rb.setAttribute('role', 'img');
    rb.innerHTML =
      '<span class="rb-cap rb-cap-l">Food</span>' +
      '<div class="rb-main">' +
        '<div class="rb-beads"></div>' +
        '<div class="rb-thread"><i class="seg seg-food"></i><i class="seg seg-fight"></i><i class="seg seg-danger"></i></div>' +
        '<div class="rb-marker"><div class="rb-you"></div><i class="rb-caret"></i></div>' +
      '</div>' +
      '<span class="rb-cap rb-cap-r">Danger</span>';
    R.beads = rb.querySelector('.rb-beads');
    R.segFood = rb.querySelector('.seg-food');
    R.segFight = rb.querySelector('.seg-fight');
    R.segDanger = rb.querySelector('.seg-danger');
    R.marker = rb.querySelector('.rb-marker');
    R.you = rb.querySelector('.rb-you');

    // under the ribbon: final hold + mishap banners
    const under = R.under = el('div', 'under', '', h);
    R.final = el('div', 'final film', '', under);
    R.final.innerHTML = '<div class="final-line"><span class="final-title">Hold the balance</span><span class="final-left"></span></div>' +
      '<div class="meter"><i></i></div><div class="final-hint"></div>';
    R.finalFill = R.final.querySelector('.meter i');
    R.finalLeft = R.final.querySelector('.final-left');
    R.finalHint = R.final.querySelector('.final-hint');
    R.banners = el('div', 'banners', '', under);

    // top right: bare score and time
    const sc = R.scoreBlock = el('div', 'score-block', '', h);
    sc.innerHTML = '<div class="score-line"><span class="combo" aria-label="Combo"></span><strong class="score">0</strong></div><div class="time">0:00</div>';
    R.score = sc.querySelector('.score');
    R.combo = sc.querySelector('.combo');
    R.time = sc.querySelector('.time');

    // pause (touch)
    const pauseBtn = R.pauseBtn = el('button', 'pausebtn touch-only', icon('pause', 22), h);
    pauseBtn.setAttribute('aria-label', 'Pause');
    pauseBtn.addEventListener('click', () => { pauseBtn.blur(); if (A.togglePause) A.togglePause(); });

    // bottom centre: harmony dial (also opens the ecosystem view)
    const dial = R.dial = el('button', 'dial', '', h);
    dial.setAttribute('aria-label', 'Harmony. Show the ecosystem view');
    dial.innerHTML =
      '<span class="dial-ring"><svg viewBox="0 0 48 48" aria-hidden="true"><circle class="dial-bg" cx="24" cy="24" r="19"/>' +
      '<circle class="dial-fg" cx="24" cy="24" r="19" stroke-dasharray="' + RING_LEN.toFixed(2) + '" stroke-dashoffset="' + RING_LEN.toFixed(2) + '"/></svg>' +
      '<span class="dial-val">0</span></span><span class="dial-lbl">Harmony</span>';
    R.dialFg = dial.querySelector('.dial-fg');
    R.dialVal = dial.querySelector('.dial-val');
    dial.addEventListener('click', (e) => {
      S.ecoPin = !S.ecoPin;
      emit('uiClick');
      if (e.detail > 0) dial.blur();   // a mouse click must not keep focus, or Space would stop biting
    });

    // touch thumb buttons (bite largest)
    const th = R.thumbs = el('div', 'thumbs touch-only', '', h);
    R.bite = thumb(th, 'thumb-bite', 'bite', 'Bite', 'Bite', 'biteQueued', true);
    R.dash = thumb(th, 'thumb-dash', 'dash', 'Dash', '', 'dashQueued');
    R.abil = thumb(th, 'thumb-ability', 'spray', 'Ability', '', 'abilityQueued');
    R.abil.insertAdjacentHTML('afterbegin', '<svg class="cd" viewBox="0 0 64 64" aria-hidden="true"><circle class="cd-bg" cx="32" cy="32" r="29"/><circle class="cd-fg" cx="32" cy="32" r="29" stroke-dasharray="182.2" stroke-dashoffset="0"/></svg>');
    R.cdFg = R.abil.querySelector('.cd-fg');

    // tutorial and tip bubbles
    R.tut = bubble('tut', true);
    R.tip = bubble('tip', false);
  }

  function thumb(parent, cls, ic, label, text, inputKey, big) {
    const b = el('button', 'thumb ' + cls, icon(ic, big ? 30 : 26) + (text ? '<span class="thumb-txt">' + text + '</span>' : ''), parent);
    b.setAttribute('aria-label', label);
    b.setAttribute('data-ui', '');
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.blur();
      b.classList.add('down');
      if (A.input) A.input[inputKey] = true;
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => b.addEventListener(n, () => b.classList.remove('down')));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }

  function bubble(kind, skippable) {
    const b = el('div', 'bubble ' + kind, '', R.hud);
    b.innerHTML = '<div class="bubble-text"></div><div class="bubble-foot"></div><i class="bubble-tail"></i>';
    b.setAttribute('role', 'status');
    b._text = b.querySelector('.bubble-text');
    b._foot = b.querySelector('.bubble-foot');
    b._tail = b.querySelector('.bubble-tail');
    if (skippable) {
      const k = el('button', 'link', 'Skip tutorial', b._foot);
      k.setAttribute('data-ui', '');
      k.addEventListener('click', () => { if (A.Tutorial && A.Tutorial.skip) A.Tutorial.skip(); emit('uiClick'); });
      b._skip = k;
    } else {
      const k = el('button', 'link', 'Got it', b._foot);
      k.setAttribute('data-ui', '');
      k.addEventListener('click', () => { S.tipUntil = 0; emit('uiClick'); });
    }
    return b;
  }

  // ---------- build: ecosystem view ----------
  function buildEco() {
    const s = R.eco = el('section', 'screen eco', '', root);
    s.innerHTML =
      '<div class="eco-card film hit">' +
        '<header><h2>Who eats whom</h2><p class="eco-sub">Arrows point from food to eater. Keep every ring inside its healthy range.</p></header>' +
        '<canvas class="eco-canvas" aria-label="Food web of this area"></canvas>' +
        '<ul class="legend">' +
          '<li><i class="lg lg-band"></i>Healthy range</li>' +
          '<li><i class="lg lg-arrow"></i>Food to eater</li>' +
          '<li><i class="lg lg-low"></i>Too few</li>' +
          '<li><i class="lg lg-high"></i>Too many</li>' +
        '</ul>' +
        '<p class="eco-close"><span class="key-only">Release Tab to close.</span><span class="tap-only">Tap anywhere to close.</span></p>' +
      '</div>';
    R.ecoCv = s.querySelector('.eco-canvas');
    R.ecoCtx = R.ecoCv.getContext && R.ecoCv.getContext('2d');
    const pick = (e) => {
      const r = R.ecoCv.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let best = -1, bd = 1e9;
      S.ecoNodes.forEach((n, i) => { const d = Math.hypot(n.x - x, n.y - y); if (d < Math.max(n.rad, 22) && d < bd) { bd = d; best = i; } });
      return best;
    };
    R.ecoCv.addEventListener('pointermove', (e) => { S.ecoHover = pick(e); });
    R.ecoCv.addEventListener('pointerleave', () => { S.ecoHover = -1; });
    s.addEventListener('click', (e) => {
      if (e.target === R.ecoCv) { const i = pick(e); if (i >= 0) { S.ecoHover = S.ecoHover === i ? -1 : i; return; } }
      S.ecoPin = false;
    });
  }

  // ---------- build: intro / dying / pause / victory shells ----------
  function buildIntro() {
    const s = R.intro = el('section', 'screen intro', '', root);
    R.introCard = el('div', 'intro-banner film', '', s);
  }

  function buildDying() {
    const s = R.dying = el('section', 'screen dying', '', root);
    const box = el('div', 'dying-box', '', s);
    R.cap = el('p', 'cap', '', box);
    R.skip = el('p', 'skip-hint', '<span class="key-only">Press any key to skip</span><span class="tap-only">Tap to skip</span>', box);
  }

  function buildPause() {
    const s = R.pause = el('section', 'screen scrim hit', '', root);
    s.innerHTML =
      '<div class="pause-card film">' +
        '<h2>Paused</h2>' +
        '<div class="pause-actions">' +
          '<button class="btn primary big" data-sfx data-act="resume">Resume</button>' +
          '<div class="pause-more">' +
            '<button class="btn quiet" data-sfx data-act="skiptut" hidden>Skip tutorial</button>' +
            '<button class="btn quiet" data-sfx data-act="restart">Restart</button>' +
            '<button class="btn quiet" data-sfx data-act="mute">Sound: on</button>' +
          '</div>' +
        '</div>' +
        '<dl class="keys compact">' +
          KEYS_DESKTOP.map((k) => '<dt class="kb">' + k[0] + '</dt><dd class="kb">' + richText(k[1]) + '</dd>').join('') +
          TOUCH_KEYS +
        '</dl>' +
      '</div>';
    s.querySelector('[data-act="resume"]').addEventListener('click', () => { if (A.togglePause) A.togglePause(); });
    s.querySelector('[data-act="restart"]').addEventListener('click', () => { if (A.restart) A.restart(); });
    R.skipTut = s.querySelector('[data-act="skiptut"]');
    R.skipTut.addEventListener('click', () => {
      if (A.Tutorial && A.Tutorial.skip) A.Tutorial.skip();
      if (A.togglePause) A.togglePause();
    });
    R.muteBtn = s.querySelector('[data-act="mute"]');
    R.muteBtn.addEventListener('click', () => {
      const r = A.Audio && A.Audio.toggleMute ? A.Audio.toggleMute() : undefined;
      S.muted = typeof r === 'boolean' ? r : !S.muted;
      renderMute();
    });
  }
  function renderMute() {
    R.muteBtn.textContent = S.muted ? 'Sound: off' : 'Sound: on';
  }

  function buildVictoryShell() {
    const s = R.victory = el('section', 'screen scrim hit', '', root);
    R.victoryPanel = el('div', 'victory-card film', '', s);
  }

  function buildCardScreens() {
    // The evolve sheet hangs from the ribbon, like the ribbon unfurling downward.
    R.evolve = el('section', 'screen sheet-screen evolve', '', root);
    R.evolve.innerHTML =
      '<div class="unfurl film hit"><div class="unfurl-in">' +
        '<header class="cards-head"><h2>You\'ve outgrown this form</h2><p>Choose what you become next.</p></header>' +
        '<div class="cards"></div>' +
        '<p class="cards-foot key-only">Click a card, or press its number.</p>' +
      '</div></div>';
    R.evolveCards = R.evolve.querySelector('.cards');
    // Rebirth cards come up from the soil edge.
    R.rebirth = el('section', 'screen sheet-screen rebirth', '', root);
    R.rebirth.innerHTML =
      '<div class="soil-sheet film hit"><div class="soil-in">' +
        '<header class="cards-head"><h2>Rise again</h2><p class="rebirth-line"></p></header>' +
        '<div class="cards"></div>' +
      '</div></div>';
    R.rebirthCards = R.rebirth.querySelector('.cards');
    R.rebirthLine = R.rebirth.querySelector('.rebirth-line');
  }

  // ---------- evolve / rebirth cards ----------
  function ensureCards(kind) {
    const choices = G.choices || [];
    const key = kind + '|' + choices.map((c) => c.sp + '@' + c.tierId).join(',');
    if (S.cardsKey[kind] === key) return;
    S.cardsKey[kind] = key;
    S.picked = false;
    const host = kind === 'evolve' ? R.evolveCards : R.rebirthCards;
    clearScope(kind);
    host.innerHTML = '';
    if (kind === 'rebirth') {
      const low = choices[0] && choices[0].tierId;
      const pct = Math.round(cfg('RESPAWN_GROWTH', 0.4) * 100);
      R.rebirthLine.textContent = low ? 'You return to ' + lower(tierName(low)) + ' with ' + pct + '% of your growth.' : '';
    }
    const paths = [];
    choices.forEach((c) => { if (c.path && paths.indexOf(c.path) < 0) paths.push(c.path); });
    const grouped = paths.length > 1;
    host.classList.toggle('grouped', grouped);
    host.setAttribute('data-n', String(choices.length));
    let n = 0;
    if (grouped) {
      paths.forEach((pk) => {
        const info = (A.PATHS && A.PATHS[pk]) || {};
        const col = el('div', 'path-col', '', host);
        col.style.setProperty('--path', info.color || '#7FE8D4');
        el('div', 'path-head', '<span class="path-name">' + esc(info.name || pretty(pk)) + '</span>' + (info.blurb ? '<span class="path-blurb">' + esc(info.blurb) + '</span>' : ''), col);
        choices.filter((c) => c.path === pk).forEach((c) => col.appendChild(makeCard(c, n++, kind)));
      });
    } else {
      choices.forEach((c) => host.appendChild(makeCard(c, n++, kind)));
    }
  }

  function makeCard(ch, idx, kind) {
    const info = spec(ch.sp);
    const path = ch.path && A.PATHS && A.PATHS[ch.path];
    const card = el('div', 'card', '', null);
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('data-sfx', '');
    card.style.setProperty('--i', idx);
    const disabled = !!(ch.disabled || ch.locked);
    card.classList.toggle('disabled', disabled);
    if (disabled) card.setAttribute('aria-disabled', 'true');

    const innate = innateOf(ch.sp);
    const ab = abilityOf(ch.sp);
    const lines = [];
    if (innate) lines.push('<p class="card-line line-innate"><b>Starts with ' + esc(lower(innate.name)) + '.</b> ' + esc(innate.desc) + '</p>');
    if (ab) lines.push('<p class="card-line"><b>Ability:</b> ' + esc(ab.name) + '</p>');
    if (info.omni) lines.push('<p class="card-line"><b>Omnivore.</b> Eats plants as well as animals.</p>');

    const pw = el('div', 'card-portrait', '', card);
    pw.appendChild(portrait(ch.sp, 120, kind, () => ({ pal: null, parts: null }), 'p-card'));
    const body = el('div', 'card-body', '', card);
    body.innerHTML =
      '<div class="card-name">' + esc(spName(ch.sp)) + '</div>' +
      '<div class="card-latin">' + esc(info.latin) + (kind === 'rebirth' && ch.tierId ? '' : '') + '</div>' +
      lines.join('') +
      (kind === 'evolve' ? '<p class="card-fact">' + esc(info.fact) + '</p>' : '');
    card.setAttribute('aria-label', spName(ch.sp) + (path ? ', ' + path.name : ''));

    const pick = () => {
      if (disabled || S.picked) return;
      S.picked = true;
      card.classList.add('chosen');
      if (A.choose) A.choose(ch.sp);
    };
    card.addEventListener('click', pick);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    return card;
  }

  // ---------- intro banner ----------
  function beadRow(items, status) {
    const row = el('div', 'intro-beads');
    items.forEach((ro) => {
      const b = el('span', 'bead ' + status, '', row);
      b.title = spName(ro.sp);
      b.appendChild(portrait(ro.sp, 36, 'intro', {}, 'p-bead'));
    });
    return row;
  }
  function ensureIntro() {
    const p = G.player, tier = currentTier();
    if (!p || !tier) return;
    const key = G.tierId + '|' + p.sp + '|' + (G.creature && G.creature.name);
    if (key === S.introKey) return;
    S.introKey = key;
    clearScope('intro');
    const c = R.introCard;
    c.innerHTML = '';
    const roster = rosterAnimals(tier);
    const eat = roster.filter((ro) => statusOf(ro, p) === 'edible').slice(-2);
    const avoid = roster.filter((ro) => statusOf(ro, p) === 'danger').slice(0, 1);
    const info = spec(p.sp);
    const custom = G.creature && G.creature.name && lower(G.creature.name) !== lower(info.name);
    const who = custom ? 'You are ' + esc(G.creature.name) + ', ' + article(esc(lower(info.name))) : 'You are ' + article('<b>' + esc(lower(info.name)) + '</b>');
    const you = el('div', 'intro-you', '', c);
    you.appendChild(portrait(p.sp, 64, 'intro', creatureOpts, 'p-intro'));
    const txt = el('div', 'intro-text', '', c);
    el('h2', 'intro-tier', esc(tier.name || tierName(G.tierId)), txt);
    el('p', 'intro-who', who, txt);
    const rules = el('div', 'intro-rules', '', c);
    if (eat.length) { const g = el('div', 'intro-group', '<span>Eat</span>', rules); g.appendChild(beadRow(eat, 'edible')); }
    if (avoid.length) { const g = el('div', 'intro-group', '<span>Avoid</span>', rules); g.appendChild(beadRow(avoid, 'danger')); }
  }

  // ---------- dying caption ----------
  function ensureDeath() {
    const d = G.deathInfo;
    if (!d || S.deathKey === d) return;
    S.deathKey = d;
    const n = Math.round((d.r || 0) * (d.r || 0) / 8);
    const c = String(d.cause || '');
    let cause;
    if (/starv/i.test(c)) cause = 'You starved.';
    else if (d.killerSp) cause = 'Eaten by ' + article(lower(spec(d.killerSp).name)) + '.';
    else if (/poison/i.test(c)) cause = 'You were poisoned.';
    else cause = 'You fell.';
    S.deathLines = [cause, 'The decomposers move in.', '+' + n + ' nutrients return to the soil.', 'Something stirs.'];
  }
  function tickDying() {
    ensureDeath();
    const T = cfg('DECOMPOSE_TIME', 4.5), t = G.transT || 0;
    const marks = [0.02, 0.24, 0.5, 0.78];
    let cur = 0;
    marks.forEach((m, i) => { if (t >= m * T) cur = i; });
    const line = (S.deathLines && S.deathLines[cur]) || '';
    if (R.cap._line !== cur) {
      R.cap._line = cur;
      R.cap.classList.remove('on');
      void R.cap.offsetWidth;
      R.cap.textContent = line;
      R.cap.classList.add('on');
    }
    flag(R.skip, 'on', t >= cfg('DECOMPOSE_SKIP', 1.5));
  }

  // ---------- victory ----------
  function buildVictory() {
    S.victoryBuilt = true;
    clearScope('victory');
    const key = G.path || 'shared';
    const P = (A.PATHS && (A.PATHS[key] || A.PATHS.shared)) || {};
    const st = G.stats || {};
    const avg = st.harmonyN ? Math.round(st.harmonySum / st.harmonyN) : 0;
    const p = R.victoryPanel;
    p.style.setProperty('--path', P.color || '#7FE8D4');
    p.innerHTML =
      '<h2>' + esc(P.name || 'Apex') + '</h2><i class="vbar"></i>' +
      '<p class="ending">' + esc(P.ending || 'You reached the top of the food chain and kept the ecosystem in balance.') + '</p>' +
      (P.cascade ? '<div class="cascade"><h3>Why it worked</h3><p>' + esc(P.cascade) + '</p></div>' : '') +
      '<dl class="vstats">' +
        vstat('Time', fmtTime(G.time)) + vstat('Score', fmtNum(G.score)) + vstat('Deaths', G.deaths || 0) +
        vstat('Eaten', st.eaten || 0) + vstat('Mishaps', st.mishaps || 0) + vstat('Average harmony', avg) +
      '</dl>' +
      '<div class="lineage-wrap"><h3>Your lineage</h3><div class="lineage"></div></div>' +
      '<div class="victory-actions"><button class="btn primary big" data-sfx data-act="again">Play again</button>' +
      '<button class="btn quiet" data-sfx data-act="title">Back to title</button></div>';
    p.querySelector('[data-act="again"]').addEventListener('click', () => { if (A.restart) A.restart(); });
    p.querySelector('[data-act="title"]').addEventListener('click', () => { if (A.setMode) A.setMode('title'); });

    const lin = p.querySelector('.lineage');
    const entries = (G.lineage || []).slice();
    if (G.player) entries.push({ sp: G.player.sp, tierId: G.tierId, outcome: 'victory', pal: G.creature && G.creature.pal, parts: G.player.parts || (G.creature && G.creature.parts) });
    entries.forEach((en) => {
      const out = outcomeInfo(en.outcome);
      const node = el('div', 'lin-node ' + out.cls, '', lin);
      node.appendChild(portrait(en.sp, 72, 'victory', { pal: en.pal || null, parts: en.parts || null }, 'p-lin'));
      el('div', 'lin-name', esc(spName(en.sp)), node);
      el('div', 'lin-out', esc(out.label), node);
    });
  }
  function vstat(label, value) {
    return '<div class="vstat"><dt>' + label + '</dt><dd>' + value + '</dd></div>';
  }
  function outcomeInfo(o) {
    const s = String(o || '').toLowerCase();
    if (/starv/.test(s)) return { label: 'Starved', cls: 'bad' };
    if (/eat/.test(s)) return { label: 'Eaten', cls: 'bad' };
    if (/kill|death|died|fell/.test(s)) return { label: 'Fell', cls: 'bad' };
    if (/vict|win|final|apex|top/.test(s)) return { label: 'Reached the top', cls: 'top' };
    if (/evolv/.test(s)) return { label: 'Evolved', cls: 'good' };
    return { label: s ? pretty(s) : 'Evolved', cls: 'good' };
  }

  // ---------- mishap banners ----------
  function bannerType(type) { return MISHAP_COLORS[type] ? type : 'surge'; }
  function onMishapStart(ev) {
    if (!ev || !ev.type) return;
    const sp = ev.sp ? lower(spec(ev.sp).name) : '';
    const fix = (s) => String(s || '').replace(/\{sp\}/g, sp);
    S.banners.queue.push({ type: ev.type, title: sentence(fix(ev.title) || pretty(ev.type)), text: fix(ev.text) });
  }
  function onMishapEnd(ev) {
    if (!ev) return;
    const b = S.banners;
    b.queue = b.queue.filter((q) => q.type !== ev.type);
    if (b.cur && b.cur.type === ev.type) b.until = 0;
  }
  function tickBanners() {
    const b = S.banners, t = now();
    if (b.cur && t >= b.until) {
      const old = b.cur.node;
      b.cur = null;
      old.classList.add('out');
      setTimeout(() => { if (old.parentNode) old.parentNode.removeChild(old); }, 320);
    }
    if (!b.cur && b.queue.length) {
      const m = b.queue.shift();
      const k = bannerType(m.type);
      const node = el('div', 'banner film in', '', R.banners);
      node.style.setProperty('--tint', MISHAP_COLORS[k]);
      node.innerHTML = '<span class="banner-ico">' + icon(k, 20) + '</span>' +
        '<div class="banner-text"><div class="banner-title">' + esc(m.title) + '</div>' + (m.text ? '<div class="banner-line">' + esc(m.text) + '</div>' : '') + '</div>';
      b.cur = { type: m.type, node };
      b.until = t + BANNER_MS;
    }
  }
  function resetBanners() {
    const b = S.banners;
    b.queue = [];
    b.cur = null;
    b.until = 0;
    if (R.banners) R.banners.innerHTML = '';
  }

  // ---------- ribbon ----------
  function buildChain() {
    S.chainKey = G.tierId;
    clearScope('chain');
    R.beads.innerHTML = '';
    const list = rosterAnimals(currentTier());
    S.chain = list.map((ro) => {
      const cell = el('div', 'bead-cell', '', R.beads);
      const n = el('div', 'bead dim', '', cell);
      const cv = n.appendChild(portrait(ro.sp, 40, 'chain', {}, 'p-bead'));
      el('i', 'tick', '', cell);
      return { n, cell, ro, it: cv._it, st: '' };
    });
    layoutRibbon();
  }
  const SIL_TINT = { edible: '#8FD14F', danger: '#FF5A5F', dim: 'rgba(239, 232, 218, .55)' };
  const BEAD_NOTE = {
    edible: 'food, you can eat it', fight: 'bite it down, then eat what it leaves',
    danger: 'danger, it can eat you', dim: 'much bigger than you',
  };
  function layoutRibbon() {
    const w = R.ribbon.querySelector('.rb-main').clientWidth || 360;
    const n = Math.max(1, S.chain.length);
    const bead = clamp(Math.floor(w / n) - 4, 24, 38);
    R.ribbon.style.setProperty('--bead', bead + 'px');
    S.ribbonW = w;
  }
  /** Where a creature of radius rv sits on the thread (0..1), interpolated between the bead centres in log size. */
  function posFrac(rv) {
    const L = S.chain, n = L.length;
    if (!n) return 0.5;
    const x = (i) => (i + 0.5) / n;
    const lg = (a, b) => Math.log(Math.max(a, 0.01) / Math.max(b, 0.01));
    if (rv <= L[0].ro.r) return x(0) * clamp(1 - lg(L[0].ro.r, rv) / Math.log(3), 0, 1);
    for (let i = 0; i < n - 1; i++) {
      const a = L[i].ro.r, b = L[i + 1].ro.r;
      if (rv <= b) return x(i) + (x(i + 1) - x(i)) * (b > a ? clamp(lg(rv, a) / lg(b, a), 0, 1) : 0.5);
    }
    return x(n - 1) + (1 - x(n - 1)) * clamp(lg(rv, L[n - 1].ro.r) / Math.log(2), 0, 1);
  }
  function renderYou() {
    const p = G.player;
    clearScope('you');
    R.you.innerHTML = '';
    R.you.appendChild(portrait(p.sp, 36, 'you', creatureOpts, 'p-you'));
    const nm = (G.creature && G.creature.name) || spec(p.sp).name;
    R.you.title = 'You, ' + nm;
  }
  function tickRibbon() {
    const p = G.player;
    if (!p) return;
    const idKey = p.sp + '|' + (G.creature && G.creature.name);
    if (idKey !== S.identKey) { S.identKey = idKey; renderYou(); }
    if (G.tierId !== S.chainKey) buildChain();
    let foods = 0, dangers = 0;
    // Silhouettes tinted by zone; only the ones nearest your size keep their real colours:
    // the biggest thing you can eat, anything you can fight, and the next thing up.
    const sts = S.chain.map((c) => statusOf(c.ro, p));
    const near = sts.lastIndexOf('edible');
    let next = near + 1;
    while (next < sts.length && sts[next] === 'fight') next++;
    S.chain.forEach((c, i) => {
      const st = sts[i];
      if (st === 'edible') foods++; else if (st === 'danger') dangers++;
      const full = st === 'fight' || i === near || i === next;
      if (c.it) c.it.tint = full ? null : SIL_TINT[st];
      const key = st + (full ? '' : ' sil');
      if (c.st !== key) {
        c.st = key;
        c.cell.className = 'bead-cell ' + key;
        c.n.className = 'bead ' + st;
        c.n.title = spName(c.ro.sp) + ': ' + BEAD_NOTE[st];
      }
    });
    S.markTarget = posFrac(p.r);
    S.zoneFoodT = posFrac(p.r * eatRatioOf(p));
    S.zoneFightT = posFrac(p.r * fightRatio());
    R.ribbon.setAttribute('aria-label', 'Food chain. You can eat ' + foods + ' kinds of creature here and ' + dangers + ' can eat you.');
  }
  function frameRibbon(dt) {
    if (!S.chain.length || !G || !G.player) return;
    const k = S.reduce ? 1 : Math.min(1, dt * 5);
    S.mark += (S.markTarget - S.mark) * k;
    S.zoneFood += ((S.zoneFoodT == null ? S.markTarget : S.zoneFoodT) - S.zoneFood) * k;
    S.zoneFight += ((S.zoneFightT == null ? S.markTarget : S.zoneFightT) - S.zoneFight) * k;
    const m = (S.mark * 100).toFixed(2), a = (S.zoneFood * 100).toFixed(2), b = (S.zoneFight * 100).toFixed(2);
    setStyle(R.marker, 'left', m + '%');
    setStyle(R.segFood, 'width', a + '%');
    setStyle(R.segFight, 'left', a + '%');
    setStyle(R.segFight, 'width', (b - a).toFixed(2) + '%');
    setStyle(R.segDanger, 'left', b + '%');
  }

  // ---------- HUD tick ----------
  function tickHud() {
    const p = G.player;
    if (!p) return;
    tickRibbon();

    // score counts up toward the real value
    const target = G.score || 0;
    S.scoreShown += (target - S.scoreShown) * 0.4;
    if (Math.abs(target - S.scoreShown) < 1) S.scoreShown = target;
    const shown = Math.round(S.scoreShown);
    if (R.score._t !== fmtNum(shown)) {
      const up = shown > (R.score._n || 0);
      R.score._n = shown;
      setText(R.score, fmtNum(shown));
      if (up) { R.score.classList.remove('bump'); void R.score.offsetWidth; R.score.classList.add('bump'); }
    }
    const combo = G.combo || 0;
    setText(R.combo, combo >= 2 ? '×' + combo : '');
    setText(R.time, fmtTime(G.time));

    const eco = G.eco || {};
    const hv = clamp(eco.harmony || 0, 0, 100);
    const mult = A.Eco && A.Eco.harmonyMult ? A.Eco.harmonyMult() : (hv < 40 ? 1 : hv <= 75 ? 2 : 3);
    if (R.dialFg._h !== Math.round(hv)) {
      R.dialFg._h = Math.round(hv);
      R.dialFg.style.strokeDashoffset = (RING_LEN * (1 - hv / 100)).toFixed(2);
    }
    setText(R.dialVal, String(Math.round(hv)));
    R.dial.setAttribute('aria-label', 'Harmony ' + Math.round(hv) + ', scoring times ' + mult + '. Show the ecosystem view');
    flag(R.dial, 'bad', hv < 40);
    flag(R.dial, 'great', hv > 75);

    // final hold
    const hold = cfg('FINAL_HOLD', 45);
    flag(R.final, 'on', !!G.final);
    if (G.final) {
      const frac = clamp((G.finalHold || 0) / hold, 0, 1);
      const stalled = hv < cfg('FINAL_HARMONY', 55);
      setStyle(R.finalFill, 'transform', 'scaleX(' + frac.toFixed(3) + ')');
      setText(R.finalLeft, Math.ceil(hold - (G.finalHold || 0)) + ' seconds to go');
      flag(R.final, 'stalled', stalled);
      setText(R.finalHint, stalled ? 'Harmony is too low, so the timer is paused.' : 'Keep harmony above ' + cfg('FINAL_HARMONY', 55) + '. You still need to eat.');
    }

    // touch ability button: icon + cooldown
    const ab = p.ability;
    const kind = ab ? abilityKindOf(p.sp, ab.id) : '';
    flag(R.abil, 'none', !ab);
    if (ab) {
      if (S.abilityKind !== kind) {
        S.abilityKind = kind;
        const svg = R.abil.querySelector('svg.ico');
        if (svg) svg.innerHTML = ICONS[ABILITY_ICON[kind]] || ICONS.star;
        R.abil.setAttribute('aria-label', ABILITY_NAME[kind] || 'Ability');
      }
      const cd = +ab.cd > 0 ? +ab.cd : 1;
      const ready = !(+ab.cdT > 0);
      const f = ready ? 1 : clamp(1 - ab.cdT / cd, 0, 1);
      setStyle(R.cdFg, 'strokeDashoffset', (182.2 * (1 - f)).toFixed(1));
      flag(R.abil, 'ready', ready);
    }
  }

  // ---------- tutorial + tip bubbles ----------
  function frameBubbles(dt) {
    const tu = G && G.tutorial;
    const mode = G && G.mode;
    const play = mode === 'play' || mode === 'intro';
    const tutOn = !!(tu && tu.active && tu.text && play);
    flag(R.tut, 'on', tutOn);
    if (tutOn) {
      const key = String(tu.id) + '|' + tu.text;
      if (key !== S.tutKey) {
        S.tutKey = key;
        R.tut._text.innerHTML = richText(tu.text);
        flag(R.tut, 'pop', false); void R.tut.offsetWidth; flag(R.tut, 'pop', true);
        R.tut._skip.hidden = tu.canSkip === false;
        S.tutSize = null;
      }
      placeBubble(R.tut, dt);
    } else S.tutKey = '';

    // contextual one-time tips
    const tip = G && G.tip;
    if (tip && tip.text && tip.id !== S.tipId && !S.tipDone[tip.id]) {
      S.tipId = tip.id; S.tipDone[tip.id] = 1;
      S.tipUntil = now() + TIP_MS;
      R.tip._text.innerHTML = richText(tip.text);
      flag(R.tip, 'pop', false); void R.tip.offsetWidth; flag(R.tip, 'pop', true);
      R.tip._sz = null;
    }
    const tipOn = !!(tip && tip.text && now() < S.tipUntil && !tutOn && mode !== 'paused' && mode !== 'dying' && mode !== 'title' && mode !== 'victory');
    flag(R.tip, 'on', tipOn);
    flag(R.tip, 'docked', mode !== 'play' && mode !== 'intro');
    if (tipOn && (mode === 'play' || mode === 'intro')) placeBubble(R.tip, dt);
  }

  function placeBubble(b, dt) {
    const p = G.player, cam = G.cam;
    if (!p || !cam || !A.worldToScreen) return;
    const W = A.W || window.innerWidth, H = A.H || window.innerHeight;
    if (!b._sz || b._sz.w !== W) { b._sz = { w: W, bw: b.offsetWidth, bh: b.offsetHeight }; }
    const bw = b._sz.bw, bh = b._sz.bh;
    const s = A.worldToScreen(p.x, p.y);
    const rpx = p.r * (cam.zoom || 1);
    const gap = rpx * 1.5 + 34;
    let y = s.y - gap - bh, below = false;
    const top = Math.max(118, (S.underBottom || 0) + 10);
    if (y < top) { y = s.y + gap; below = true; }
    y = clamp(y, top, H - bh - 96);
    const x = clamp(s.x - bw / 2, 12, W - bw - 12);
    const k = b._px == null ? 1 : Math.min(1, dt * 12);
    b._px = b._px == null ? x : b._px + (x - b._px) * k;
    b._py = b._py == null ? y : b._py + (y - b._py) * k;
    b.style.transform = 'translate3d(' + b._px.toFixed(1) + 'px,' + b._py.toFixed(1) + 'px,0)';
    flag(b, 'below', below);
    setStyle(b._tail, 'left', clamp(s.x - b._px, 22, bw - 22).toFixed(1) + 'px');
  }

  // ---------- ecosystem view ----------
  function ecoLayout(W, H) {
    const tier = currentTier();
    const roster = (tier && tier.roster) || [];
    const ratio = cfg('EAT_RATIO', 0.92);
    const items = roster.map((ro) => ({ ro, sp: ro.sp, prod: isProducer(ro), hunt: isHunter(ro), level: 0 }));
    const prods = items.filter((i) => i.prod), grazers = items.filter((i) => !i.prod && !i.hunt), hunters = items.filter((i) => i.hunt);
    grazers.forEach((g) => { g.level = 1; });
    const edges = [];
    grazers.forEach((g) => prods.forEach((p) => edges.push({ from: p, to: g, faint: true })));
    const animals = items.filter((i) => !i.prod).sort((a, b) => a.ro.r - b.ro.r);
    animals.filter((a) => a.hunt).forEach((h) => {
      const prey = animals.filter((o) => o !== h && o.ro.r < h.ro.r * ratio).sort((a, b) => b.ro.r - a.ro.r).slice(0, 3);
      let lvl = 2;
      prey.forEach((o) => { edges.push({ from: o, to: h }); lvl = Math.max(lvl, o.level + 1); });
      h.level = lvl;
    });
    // rows bottom to top, split when a level has more nodes than fit
    const small = W < 520;
    const labelW = small ? 100 : 112;
    const perRow = Math.max(2, Math.floor(W / labelW));
    const levels = {};
    items.forEach((i) => { (levels[i.level] = levels[i.level] || []).push(i); });
    const rows = [];
    Object.keys(levels).map(Number).sort((a, b) => a - b).forEach((lv) => {
      const arr = levels[lv].sort((a, b) => a.ro.r - b.ro.r);
      const chunks = Math.ceil(arr.length / perRow), size = Math.ceil(arr.length / chunks);
      for (let c = 0; c < chunks; c++) rows.push(arr.slice(c * size, (c + 1) * size));
    });
    // node size shrinks when there are many rows, so labels never sit on the next row
    const maxR = clamp(Math.floor(((H - 40) / Math.max(rows.length, 1) - 30) / 2), 16, small ? 26 : 40);
    const padT = 6, padB = 26;
    const gapY = rows.length > 1 ? (H - padT - padB - maxR * 2 - 18) / (rows.length - 1) : 0;
    const gapX = Math.max(maxR * 2 + 8, labelW - 6), padX = Math.max(maxR, labelW / 2 - 4);
    rows.forEach((row, ri) => {
      const y = H - padB - maxR - 18 - ri * gapY;
      row.forEach((it, k) => { it.y = y; it.x = ((k + 0.5) / row.length) * W; it.want = it.x; });
      if (ri > 0) { // sit above the food each node eats, so the arrows stay short
        row.forEach((it) => {
          const xs = edges.filter((e) => e.to === it && e.from.x != null && !e.faint).map((e) => e.from.x);
          if (xs.length) it.want = 0.55 * (xs.reduce((a, b) => a + b, 0) / xs.length) + 0.45 * it.x;
        });
        row.sort((a, b) => a.want - b.want);
        row.forEach((it, k) => { it.x = Math.max(it.want, k ? row[k - 1].x + gapX : padX); });
        for (let k = row.length - 1; k >= 0; k--) {
          const hi = k === row.length - 1 ? W - padX : row[k + 1].x - gapX;
          if (row[k].x > hi) row[k].x = hi;
        }
        for (let k = 0; k < row.length; k++) if (k && row[k].x < row[k - 1].x + gapX) row[k].x = row[k - 1].x + gapX;
      }
    });
    S.ecoMaxR = maxR;
    S.ecoSmall = small;
    S.ecoNodes = items;
    S.ecoEdges = edges;
    S.ecoKey = G.tierId + '|' + W + 'x' + H;
  }
  const popRad = (n, maxN, maxR) => (maxR * 0.42) + maxR * 0.58 * Math.pow(clamp(n / Math.max(maxN, 1), 0, 1), 0.4);

  function drawEco() {
    const cv = R.ecoCv, ctx = R.ecoCtx;
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(cv.clientWidth), H = Math.round(cv.clientHeight);
    if (W < 40 || H < 40) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    if (S.ecoKey !== G.tierId + '|' + W + 'x' + H) ecoLayout(W, H);
    const eco = G.eco || {}, pops = eco.pops || {}, n0 = eco.n0 || {};
    const band = cfg('HARMONY_BAND', [0.6, 1.45]), pband = cfg('PRODUCER_BAND', [0.45, 1]);
    const t = now() / 1000;
    const maxR = S.ecoMaxR;
    let maxN = 1;
    S.ecoNodes.forEach((n) => { maxN = Math.max(maxN, (pops[n.sp] || 0), (n0[n.sp] || n.ro.n0 || 1) * 1.45); });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    S.ecoNodes.forEach((n) => {
      const N = pops[n.sp] || 0, base = n0[n.sp] || n.ro.n0 || 1, bd = n.prod ? pband : band;
      n.rad = popRad(N, maxN, maxR);
      n.r0 = popRad(bd[0] * base, maxN, maxR);
      n.r1 = popRad(bd[1] * base, maxN, maxR);
      n.st = (A.Eco && A.Eco.statusOf && A.Eco.statusOf(n.sp)) || (N / base < bd[0] ? 'low' : N / base > bd[1] ? 'high' : 'ok');
      n.N = N;
    });
    const hv = S.ecoHover;
    const hot = hv >= 0 && S.ecoNodes[hv] ? S.ecoNodes[hv] : null;
    // arrows
    S.ecoEdges.forEach((e) => {
      const a = e.from, b = e.to;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
      const x0 = a.x + ux * (a.rad + 4), y0 = a.y + uy * (a.rad + 4), x1 = b.x - ux * (b.r1 + 6), y1 = b.y - uy * (b.r1 + 6);
      const lit = hot && (hot === a || hot === b);
      const al = hot ? (lit ? 0.85 : 0.07) : (e.faint ? 0.16 : 0.42);
      ctx.strokeStyle = 'rgba(20,38,29,' + al + ')';
      ctx.fillStyle = 'rgba(20,38,29,' + al + ')';
      ctx.lineWidth = lit ? 2.2 : 1.4;
      const mx = (x0 + x1) / 2 - uy * d * 0.08, my = (y0 + y1) / 2 + ux * d * 0.08;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke();
      const ang = Math.atan2(y1 - my, x1 - mx), hs = 7;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - Math.cos(ang - 0.45) * hs, y1 - Math.sin(ang - 0.45) * hs);
      ctx.lineTo(x1 - Math.cos(ang + 0.45) * hs, y1 - Math.sin(ang + 0.45) * hs);
      ctx.closePath(); ctx.fill();
    });
    // nodes
    ctx.textAlign = 'center';
    S.ecoNodes.forEach((n, i) => {
      const dim = hot && hot !== n && !S.ecoEdges.some((e) => (e.from === hot && e.to === n) || (e.to === hot && e.from === n));
      ctx.globalAlpha = dim ? 0.4 : 1;
      // healthy band
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r1, 0, Math.PI * 2); ctx.arc(n.x, n.y, n.r0, 0, Math.PI * 2, true);
      ctx.fillStyle = 'rgba(30,138,120,.2)'; ctx.fill();
      ctx.strokeStyle = 'rgba(30,138,120,.75)'; ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r1, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      // low / high halo
      if (n.st === 'low' || n.st === 'high') {
        const c = n.st === 'low' ? '255,90,95' : '110,190,50';
        const pulse = 0.5 + 0.5 * Math.sin(t * 3 + i);
        ctx.strokeStyle = 'rgba(' + c + ',' + (0.35 + 0.3 * pulse) + ')';
        ctx.lineWidth = 7;
        ctx.beginPath(); ctx.arc(n.x, n.y, Math.max(n.rad, n.r1) + 6, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(' + c + ',.95)'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(n.x, n.y, Math.max(n.rad, n.r1) + 3, 0, Math.PI * 2); ctx.stroke();
      }
      // body
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.strokeStyle = 'rgba(20,38,29,.55)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.rad, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const ps = Math.max(18, n.rad * 1.7);
      ctx.save();
      ctx.translate(n.x - ps / 2, n.y - ps / 2);
      try { if (A.drawPortrait) A.drawPortrait(ctx, n.sp, ps, { t }); else blob(ctx, n.sp, ps); } catch (e) { blob(ctx, n.sp, ps); }
      ctx.restore();
      ctx.globalAlpha = dim ? 0.5 : 1;
      const lab = spName(n.sp);
      ctx.font = '700 ' + (S.ecoSmall ? 12 : 14) + 'px "Atkinson Hyperlegible", "Segoe UI", system-ui, sans-serif';
      const ly = n.y + Math.max(n.rad, n.r1) + (S.ecoSmall ? 13 : 17);
      ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(226,239,231,.95)';
      ctx.strokeText(lab + ' ' + Math.round(n.N), n.x, ly);
      ctx.fillStyle = '#14261D';
      ctx.fillText(lab + ' ' + Math.round(n.N), n.x, ly);
    });
    ctx.globalAlpha = 1;
  }

  // ---------- mode switching ----------
  function setScreen(mode) {
    if (!G) return;
    S.mode = mode;
    root.setAttribute('data-mode', mode || '');
    const showHud = !!HUD_MODES[mode];
    const on = (n, v) => n.classList.toggle('on', !!v);
    on(R.title, mode === 'title');
    on(R.hud, showHud);
    on(R.intro, mode === 'intro');
    on(R.evolve, mode === 'evolveChoice');
    on(R.rebirth, mode === 'rebirthChoice');
    on(R.dying, mode === 'dying');
    on(R.pause, mode === 'paused');
    on(R.victory, mode === 'victory');
    scopesOn.chain = scopesOn.you = showHud;
    scopesOn.intro = mode === 'intro';
    scopesOn.evolve = mode === 'evolveChoice';
    scopesOn.rebirth = mode === 'rebirthChoice';
    scopesOn.victory = mode === 'victory';

    if (mode === 'title') { renderBest(); resetBanners(); toggleHow(false); }
    if (mode === 'evolveChoice') { S.cardsKey.evolve = ''; ensureCards('evolve'); }
    if (mode === 'rebirthChoice') { S.cardsKey.rebirth = ''; ensureCards('rebirth'); }
    if (mode === 'intro') ensureIntro();
    if (mode === 'paused') {
      S.muted = !!((G.flags && G.flags.mute) || (A.Audio && A.Audio.muted));
      renderMute();
      R.skipTut.hidden = !(G.tutorial && G.tutorial.active);
    }
    if (mode === 'victory') buildVictory();
    if (mode !== 'victory') S.victoryBuilt = false;
    if (mode !== 'evolveChoice' && mode !== 'rebirthChoice') S.picked = false;
    if (mode !== 'play' && mode !== 'intro') S.ecoPin = false;
    if (showHud) { S.identKey = ''; S.chainKey = ''; }
    // Move focus into the new screen so the keyboard works straight away.
    const first = mode === 'title' ? R.title.querySelector('[data-act="play"]') : mode === 'paused' ? R.pause.querySelector('[data-act="resume"]') :
      mode === 'victory' ? R.victory.querySelector('[data-act="again"]') : null;
    if (first && !isTouch() && document.activeElement !== first) { try { first.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    else if (!first && document.activeElement && root.contains(document.activeElement) && document.activeElement.blur) document.activeElement.blur();
  }

  function detectTouch() {
    if (root.classList.contains('is-touch')) return;
    let t = false;
    try { t = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (e) { /* ignore */ }
    if ((A.input && A.input.touch) || t) root.classList.add('is-touch');
  }

  /** Blur is only an enhancement: Firefox, or any slow stretch, falls back to the solid film. */
  function watchPerf(dt) {
    if (S.solid) return;
    if (!(R.pause.classList.contains('on') || R.evolve.classList.contains('on') || R.victory.classList.contains('on') || R.eco.classList.contains('on'))) { S.slowFrames = 0; return; }
    S.slowFrames = dt > 0.026 ? S.slowFrames + 1 : Math.max(0, S.slowFrames - 2);
    if (S.slowFrames > 90) { S.solid = true; root.classList.add('solid-film'); }
  }

  // ---------- public ----------
  function init() {
    root = document.getElementById('ui');
    if (!root) {
      root = el('div', '', '', document.body);
      root.id = 'ui';
    }
    root.innerHTML = '';
    root.classList.add('apex-ui');
    try { S.reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* ignore */ }
    if (/firefox/i.test(navigator.userAgent || '')) { S.solid = true; root.classList.add('solid-film'); }

    buildTitle();
    buildHud();
    buildEco();
    buildIntro();
    buildCardScreens();
    buildDying();
    buildVictoryShell();
    buildPause();

    // Core ignores pointerdown on [data-ui] elements, so modal surfaces must not steer or bite.
    root.querySelectorAll('.hit').forEach((n) => n.setAttribute('data-ui', ''));
    // Every clickable element plays the UI sound.
    root.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('[data-sfx]')) emit('uiClick');
    });
    window.addEventListener('touchstart', () => root.classList.add('is-touch'), { passive: true, once: true });
    // Tab (hold) shows the ecosystem view. The combat module sets A.input.ecoView too; either one works.
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || !G) return;
      if (G.mode === 'play' || G.mode === 'intro') { e.preventDefault(); S.tabHeld = true; }
    });
    window.addEventListener('keyup', (e) => { if (e.key === 'Tab') S.tabHeld = false; });
    window.addEventListener('blur', () => { S.tabHeld = false; });
    window.addEventListener('resize', () => { if (S.chain.length) layoutRibbon(); S.ecoKey = ''; if (R.tut) R.tut._sz = R.tip._sz = null; });

    if (A.on) {
      A.on('modeChange', () => { G = A.G || G; if (G) setScreen(G.mode); });
      A.on('mishapStart', onMishapStart);
      A.on('mishapEnd', onMishapEnd);
      A.on('runStart', resetBanners);
      A.on('restart', resetBanners);
      A.on('tierStart', () => { resetBanners(); S.introKey = ''; });
    }
    detectTouch();
    G = A.G || null;
    if (G) setScreen(G.mode);
  }

  function update(g, dt) {
    G = g || A.G;
    if (!G || !root) return;
    dt = dt > 0 ? Math.min(dt, 0.1) : 1 / 60;
    if (G.mode !== S.mode) setScreen(G.mode);
    const t = now();
    watchPerf(dt);
    const hudOn = R.hud.classList.contains('on');
    if (hudOn) {
      frameRibbon(dt);
      frameBubbles(dt);
    }
    // ecosystem view (hold Tab, or the pinned toggle for touch)
    const ecoWanted = (G.mode === 'play' || G.mode === 'intro') && !!((A.input && A.input.ecoView) || S.tabHeld || S.ecoPin);
    if (ecoWanted !== S.ecoOn) {
      S.ecoOn = ecoWanted;
      R.eco.classList.toggle('on', ecoWanted);
      R.dial.setAttribute('aria-pressed', String(S.ecoPin));
      S.ecoKey = '';
    }
    if (S.ecoOn && t - (S.lastEco || 0) > 66) { S.lastEco = t; drawEco(); }

    if (t - S.lastFast >= FAST_MS) {
      S.lastFast = t;
      refreshPortraits(true);
    }
    if (t - S.lastSlow < SLOW_MS) return;
    S.lastSlow = t;
    detectTouch();
    refreshPortraits(false);
    const m = G.mode;
    if (hudOn) {
      tickHud(); tickBanners();
      const ub = R.under.firstChild && (R.final.classList.contains('on') || R.banners.firstChild) ? R.under.getBoundingClientRect().bottom : 0;
      S.underBottom = ub;
    }
    if (m === 'intro') ensureIntro();
    else if (m === 'dying') tickDying();
    else if (m === 'evolveChoice') ensureCards('evolve');
    else if (m === 'rebirthChoice') ensureCards('rebirth');
    else if (m === 'paused') R.skipTut.hidden = !(G.tutorial && G.tutorial.active);
    else if (m === 'victory' && !S.victoryBuilt) buildVictory();
  }

  A.UI = { init, update };
})();
