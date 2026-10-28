/* Apex audio: Minecraft sound effects and music (see tools/build-audio.py), driven entirely by game events.
   WebAudio buffers decoded from the inlined data URIs, so it works on file:// too. Sounds near the player are
   panned and quieted by distance, with +-8% pitch variation. Missing data or a failed decode just stays silent. */
(function () {
  'use strict';
  const A = window.Apex = window.Apex || {};
  const MUTE_KEY = 'apex.mute';

  let ac = null, master = null, sfxBus = null, musicBus = null;
  const buffers = {};             // id -> [AudioBuffer]
  const musicLists = { game: [], boss: [] };   // decoded tracks per playlist
  let musicSrc = null, musicKey = null, musicList = 'game', musicIdx = 0;
  const last = {};                // id -> last play time (rate limits)
  let muted = false, comboTimer = 0, comboMax = 0, dyingTimers = [];

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }

  function decodeAll(table, into) {
    Object.keys(table || {}).forEach((id) => {
      table[id].forEach((uri, i) => {
        try {
          const bin = atob(uri.slice(uri.indexOf(',') + 1)), buf = new Uint8Array(bin.length);
          for (let k = 0; k < bin.length; k++) buf[k] = bin.charCodeAt(k);
          ac.decodeAudioData(buf.buffer, (b) => into(id, i, b), () => {});
        } catch (e) { /* skip this one */ }
      });
    });
  }

  function ensure() {
    if (ac) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ac = new AC(); } catch (e) { return false; }
    master = ac.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ac.destination);
    sfxBus = ac.createGain(); sfxBus.gain.value = 0.8; sfxBus.connect(master);
    musicBus = ac.createGain(); musicBus.gain.value = 0.32; musicBus.connect(master);
    decodeAll(A.SOUND_DATA, (id, i, b) => { (buffers[id] = buffers[id] || [])[i] = b; });
    decodeAll(A.MUSIC_DATA, (id, i, b) => { (musicLists[id] = musicLists[id] || [])[i] = b; if (musicKey && !musicSrc && id === musicList) startTrack(); });
    return true;
  }

  function init() {
    const F = (A.G && A.G.flags) || {};
    muted = !!F.mute || lsGet(MUTE_KEY) === '1';
    API.muted = muted;
    listen();
  }

  // Browsers only allow audio after a user gesture; core calls this on the first key or pointer press.
  function unlock() {
    if (!ensure()) return;
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    if (!musicKey) setMusic(A.G && A.G.mode === 'title' ? 'menu' : 'game');
  }

  function toggleMute() {
    muted = !muted;
    API.muted = muted;
    lsSet(MUTE_KEY, muted ? '1' : '0');
    if (master) master.gain.setTargetAtTime(muted ? 0 : 1, ac.currentTime, 0.05);
    return muted;
  }

  /** play(id, {vol, pitch, x, y, gap}): x/y place the sound in the world relative to the player. */
  function play(id, o) {
    o = o || {};
    if (!ac || muted || ac.state !== 'running') return;
    const list = buffers[id];
    if (!list || !list.length) return;
    const now = ac.currentTime;
    if (o.gap && last[id] && now - last[id] < o.gap) return;
    last[id] = now;
    const b = list[Math.floor(Math.random() * list.length)];
    if (!b) return;
    let vol = o.vol == null ? 1 : o.vol, pan = 0;
    const G = A.G, p = G && G.player;
    if (o.x != null && p && G.cam) {
      const viewH = (A.H || 800) / (G.cam.zoom || 1);
      const dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy);
      vol *= Math.max(0, 1 - d / (viewH * 1.1));
      pan = Math.max(-1, Math.min(1, dx / (viewH * 0.8)));
      if (vol < 0.03) return;
    }
    const s = ac.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = (o.pitch || 1) * (0.92 + Math.random() * 0.16);
    const g = ac.createGain(); g.gain.value = vol;
    let node = g;
    if (pan && ac.createStereoPanner) { const pn = ac.createStereoPanner(); pn.pan.value = pan; g.connect(pn); node = pn; }
    s.connect(g); node.connect(sfxBus);
    s.start();
  }

  // ---- music: a looping playlist of calm game tracks (quieter while dying and on menus); the boss has its own
  function startTrack() {
    const list = (musicLists[musicList] || []).filter(Boolean);
    if (!ac || !list.length) return;
    const b = list[musicIdx % list.length];
    musicIdx++;
    const s = ac.createBufferSource();
    s.buffer = b;
    s.connect(musicBus);
    s.onended = () => { if (musicSrc === s) { musicSrc = null; setTimeout(() => { if (!musicSrc && musicKey) startTrack(); }, 4000); } };
    s.start();
    musicSrc = s;
  }
  function setMusic(key) {
    if (!ensure()) return;
    musicKey = key;
    const list = key === 'boss' ? 'boss' : 'game';
    if (list !== musicList) {   // switch playlists: drop the current track
      musicList = list; musicIdx = 0;
      if (musicSrc) { const s = musicSrc; musicSrc = null; try { s.onended = null; s.stop(); } catch (e) { /* already stopped */ } }
    }
    const level = key === 'boss' ? 0.5 : key === 'menu' ? 0.22 : key === 'quiet' ? 0.12 : 0.32;
    musicBus.gain.setTargetAtTime(level, ac.currentTime, 0.6);
    if (!musicSrc) startTrack();
  }

  // ---- event wiring
  const GROWL = {
    beetle: 'growl_bug', spider: 'growl_bug', centipede: 'growl_bug', dragonfly: 'growl_bug',
    skink: 'growl_mid', frog: 'growl_mid', shrew: 'growl_mid', weasel: 'growl_mid', snake: 'growl_mid', fox: 'growl_mid', lynx: 'growl_mid',
    wolf: 'growl_wolf', wolverine: 'growl_hog', boar: 'growl_hog', bear: 'growl_big', heron: 'swoop', hawk: 'swoop',
  };
  const isP = (e) => !!(e && e.isPlayer);

  function listen() {
    const on = A.on;
    if (!on) return;
    on('playerEat', (d) => {
      const p = A.G.player, f = d && d.food;
      const rel = p && f ? f.mass / Math.max(0.1, p.mass) : 0.3;
      play(rel < 0.15 ? 'eat_tiny' : rel < 0.5 ? 'eat' : 'eat_big', { vol: rel < 0.15 ? 0.55 : 0.75, pitch: rel < 0.15 ? 1.15 : 1 });
      comboMax = Math.max(comboMax, (d && d.combo) || 0);
      clearTimeout(comboTimer);
      comboTimer = setTimeout(() => { if (comboMax >= 5) play('burp', { vol: 0.5 }); comboMax = 0; }, 2400);
    });
    on('growth', (d) => play('orb', { vol: 0.22, pitch: 0.7 + 0.8 * ((d && d.growth) || 0), gap: 0.08 }));
    on('evolveReady', () => play('chime', { vol: 0.7 }));
    on('evolve', () => { play('levelup', { vol: 0.6 }); play('evolve', { vol: 0.55 }); });
    on('windup', (d) => { if (d && isP(d.target) && d.e) play(GROWL[d.e.sp] || 'growl_mid', { vol: 0.75, x: d.e.x, y: d.e.y, gap: 0.3 }); });
    on('lunge', (d) => { const e = d && d.e; if (e && (e.sp === 'hawk' || e.sp === 'heron')) play('swoop', { vol: 0.6, x: e.x, y: e.y, gap: 0.5 }); });
    on('threatNear', (d) => { if (d && d.e && d.e.target === A.G.player) play('heartbeat', { vol: 0.45, gap: 1.2 }); });
    on('dash', (d) => { if (isP(d && d.e)) play('dash', { vol: 0.5, gap: 0.15 }); });
    on('bite', (d) => { if (isP(d && d.e)) play('bite', { vol: d.hits && d.hits.length ? 0.7 : 0.35, gap: 0.1 }); });
    on('damage', (d) => { if (d && isP(d.target)) play('hit', { vol: 0.75, gap: 0.12 }); });
    on('abilityUse', (d) => {
      const e = d && d.e;
      if (!isP(e)) return;
      const id = String(d.id || (e.ability && e.ability.id) || '');
      if (id === 'spray') play(e.sp === 'wolf' ? 'growl_wolf' : 'spit', { vol: 0.8, pitch: e.sp === 'wolf' ? 0.7 : 1 });
      else if (id === 'tongue') play(e.sp === 'frog' ? 'tongue' : 'dash', { vol: 0.75 });
      else if (id === 'charge') play('dash', { vol: 0.8, pitch: 0.75 });
      else if (id === 'roll') play('roll', { vol: 0.8 });
      else if (id === 'web') play('web', { vol: 0.8 });
      else if (id === 'tail') play('pop', { vol: 0.7 });
    });
    on('mishapStart', () => play('mishap', { vol: 0.45 }));
    on('playerDeath', () => play('death', { vol: 0.8 }));
    on('rebirth', () => play('hatch', { vol: 0.8 }));
    on('victory', () => { play('levelup', { vol: 0.7 }); play('chime', { vol: 0.6 }); });
    on('uiClick', () => play('ui', { vol: 0.45, gap: 0.05 }));
    // the boss: everything at once
    on('bossArrive', () => { play('horn', { vol: 0.9 }); play('thunder', { vol: 0.8 }); setTimeout(() => play('emerge', { vol: 0.9 }), 900); setTimeout(() => play('boss_roar', { vol: 1 }), 1600); setMusic('boss'); });
    on('bossWindup', (d) => {
      const k = d && d.kind;
      if (k === 'charge') play('boss_roar', { vol: 0.85, pitch: 1.05, gap: 0.3 });
      else if (k === 'slam') play('boss_roar', { vol: 0.9, pitch: 0.8 });
      else if (k === 'roar') play('boss_charge', { vol: 0.9 });
      else if (k === 'phaseRoar') { play('boss_roar', { vol: 1, pitch: 0.85 }); play('thunder', { vol: 0.6 }); }
      else if (k === 'swipe') play('growl_big', { vol: 0.8, pitch: 0.7 });
    });
    on('bossAttack', (d) => {
      const k = d && d.kind;
      if (k === 'slam') { play('slam', { vol: 1 }); play('slam', { vol: 0.7, pitch: 0.7 }); }
      else if (k === 'roar') play('sonic', { vol: 0.9 });
      else if (k === 'charge') play('dash', { vol: 0.9, pitch: 0.55 });
      else if (k === 'swipe') play('bite', { vol: 0.9, pitch: 0.6 });
    });
    on('damage', (d) => { if (d && d.target && d.target.boss) play('boss_hurt', { vol: 0.75, pitch: 0.8, gap: 0.35 }); });
    on('bossStun', () => play('slam', { vol: 0.6, pitch: 1.3 }));
    on('bossEnrage', () => { play('enrage', { vol: 0.9 }); play('thunder', { vol: 0.9 }); });
    on('thunder', () => play('thunder', { vol: 0.75 }));
    on('bossDeath', () => { play('boss_death', { vol: 1 }); play('levelup', { vol: 0.6, pitch: 0.8 }); setMusic('menu'); });
    on('modeChange', (d) => {
      const to = d && d.to;
      dyingTimers.forEach(clearTimeout); dyingTimers = [];
      if (to === 'dying') {   // the decomposers: compost, moss, roots, sculk
        setMusic('quiet');
        [['compost', 700], ['moss', 1500], ['roots', 2300], ['sculk', 3100]].forEach(([id, ms]) => dyingTimers.push(setTimeout(() => play(id, { vol: 0.7 }), ms)));
      } else if (to === 'title' || to === 'victory' || to === 'paused') setMusic('menu');
      else if (to === 'play' || to === 'intro') setMusic('game');
    });
    document.addEventListener('click', (ev) => { if (ev.target && ev.target.closest && ev.target.closest('[data-sfx]')) play('ui', { vol: 0.45, gap: 0.05 }); }, true);
  }

  function stats() {
    return { state: ac ? ac.state : 'none', sfx: Object.keys(buffers).length, music: musicLists.game.filter(Boolean).length, boss: musicLists.boss.filter(Boolean).length, list: musicList, muted };
  }

  const API = { init, unlock, setMusic, play, toggleMute, stats, muted: false };
  A.Audio = API;
})();
