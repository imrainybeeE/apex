# APEX — build plan

## Context
Fresh project in `~/Downloads/BIOLOGYGAMEFUN` (empty). Build **Apex**: a Feeding Frenzy / Hungry Shark / Spore-cell-stage game. Start as a tiny ant, eat smaller things, avoid bigger ones, evolve up the food chain. Dying returns you to the soil: decomposers break you down, and you're reborn one tier lower. A real food web pushes back if you over- or under-hunt. A clean run takes about 10 minutes. It's for private play with friends and a teacher, not for the public.

Decisions from Q&A:
- Top-down, **Spore style**: cell-stage depth look, visible part upgrades bought with DNA, and a **creature editor** between tiers.
- **Three paths** split after Pond Edge: Land (→ wolf/bear), Sky (→ golden eagle), Sea (→ orca/shark). 6 tiers per run, 12 tiers total.
- Death: **drop one tier, keep 40% growth**, then pick a new species from that tier. Parts and DNA carry over.
- Eco: **real food web + mishaps** (famine, boom, disease, barren, predator surge), plus a harmony meter that multiplies score.
- **Desktop + touch.** **Minecraft SFX and music** from the user's Prism Launcher assets (private use only).
- Install Playwright + headless Chromium for testing (user approved).

## Approach
- Plain HTML + Canvas 2D + DOM HUD. Classic `<script>` files share a global `window.Apex` namespace, so `index.html` runs by double-click (file://) and over http. No build step and no runtime deps.
- All art is drawn in code from **body plans** (insect, quadruped, bird, fish…) driven by per-species look params, so ~80 species stay feasible.
- Modules talk through an **event bus** and one shared state object `Apex.G`. That lets ~15 agents write separate files in parallel against the contract in the Appendix.
- Sounds: a script copies a curated set from `~/Library/Application Support/PrismLauncher/assets` (index `32.json`, 4,871 sounds, all on disk) and converts them to mp3 with ffmpeg. SFX are inlined as base64 in `js/sound-data.js` (WebAudio works on file://). Music plays through `<audio>` from `assets/music/`.

## Execution (milestones, usage-aware)

Rules: Sonnet writes code from tight briefs; Haiku does mechanical chores (sound extraction, data entry); Opus (main session) only orchestrates, runs checks, and does short reviews. No Opus subagents and no Workflow fan-outs. Each milestone ends with a playable build that passes `node tools/check.mjs smoke`, then pauses so the user can play and react before the next one.

**Step 0 — done**: Playwright + Chromium installed; `tools/stubcheck.mjs`, `tools/shot.mjs`, `.claude/launch.json`, this doc.

**M1 — playable slice (shared tiers)**
- Scope: T1–T3 (Leaf Litter → Undergrowth → Pond Edge). Full core loop, real food web + mishaps, decomposer death + roguelite rebirth, evolve cards, title/HUD/intro/pause/victory, Playwright harness.
- Pond Edge is temporarily the final tier (`final: true`, `next: []`): full growth there starts the final hold → victory. No editor, parts, or audio yet; `openEditor` falls back to closing immediately.
- 9 Sonnet agents in parallel on separate files:
  1. core — `index.html`, `js/core.js`
  2. config + eco — `js/config.js` (T1–T3 + their species only), `js/eco.js`
  3. ai — `js/ai.js`
  4. shapes-inverts — `js/shapes-inverts.js` (T1–T3 inverts + plants)
  5. shapes-vertebrates — `js/shapes-land.js` (frog, skink, snake, shrew, weasel) and `js/shapes-air-water.js` (heron, tadpole)
  6. world — `js/world.js` (dispatcher, depth layers, litter/undergrowth/pond)
  7. fx — `js/fx.js`
  8. ui — `js/ui.js`, `css/style.css`
  9. harness — `tools/check.mjs`
- Then one Sonnet integration agent runs smoke + sim and fixes cross-module errors. I verify in the browser pane.

**M2 — Land path + sound**: t4_meadow, t5_forest, t6_valley (species, biomes); the Pond path-choice cards (Land only enabled until M3); the real final hold on the valley; Minecraft audio (Haiku curates + extracts, Sonnet writes `audio.js`); a balance pass with the sim bots.

**M3 — Sky + Sea paths**: the 6 remaining tiers, 6 biomes (`js/biomes-sky-sea.js`), ~35 species, all three path columns at Pond.

**M4 — Spore editor + parts**: DNA, `js/parts.js`, `js/editor.js` + `css/editor.css`, part visuals on every body plan.

**M5 — polish + share**: visual passes at desktop and mobile, balance all paths, file:// check, `apex-share.zip`.

## Verification
- `node tools/check.mjs smoke`: zero console/page errors. Visits all 12 tiers. Forces death→rebirth, evolve→editor→hatch, every mishap type, and victory. Covers both desktop and mobile viewports and a file:// load.
- `node tools/check.mjs sim` targets:
  - **Balanced bot**: each path finishes in 8–12 min gameplay time with 0–4 deaths and average harmony ≥ 50.
  - **Greedy bot**: triggers ≥ 1 famine per run, and its average harmony is ≥ 15 below balanced.
  - **Passive bot**: triggers boom or disease.
- Manual check in the browser pane: input feels instant, there's feedback on eat and hit, R restarts from any mode, Esc pauses, M mutes, touch steering and dash work at 390×844, and nothing soft-locks.

## Cut / risks
- Cut: terrain collision, saving mid-run, difficulty settings, multiplayer, real flight or swim physics (altitude is visual only), and naming per species (one creature name per run).
- Risks: balancing 12 tiers in one pass (the sim bots mitigate this); 15 parallel writers drifting off the contract (the integrate loop mitigates this); Safari audio (mp3 conversion mitigates this). Minecraft audio is Mojang's, so the zip stays private.

---

# Appendix A — Game design

**Loop**: steer (mouse/touch toward pointer, or WASD/arrows) → eat anything with `r < myR × eatRatio` (0.92 base) → energy refills, growth bar fills, and DNA is earned → at full growth you evolve (pick the next species, then the editor) → the next tier has new prey and new predators. Hunters bigger than you can eat you, but they telegraph first: windup 0.35s (red flash + growl), then lunge ×2.3 speed for 0.35s, then recover 0.8s. **Dash** (Space / click / touch button): ×2.6 speed for 0.25s, 1.1s cooldown, costs 4 energy.

**Energy**: max 100, drains `tier.drain × drainMul` per second; eating restores `min(30, mass×2.5+3)`. After 4s at 0 you starve, so you can't win by hiding.

**Growth**: `growth += food.mass / tier.growthNeeded`. Radius is `12 × (1 + (tier.maxScale−1) × growth)`, with maxScale 1.7 (2.6 in final tiers). Mid-size creatures (r 13–18) become edible during the tier, Feeding Frenzy-style. Mass = r²/16.

**Death (roguelite)**: eaten or starved → `dying` mode, a 4.5s decomposition you can skip after 1.5s. The corpse greys, glowing fungal hyphae grow over it, bacteria specks and decomposer critters swarm, and the body dissolves into nutrient sparks that flow into nearby producers (eco gets a fertility boost). The water variant is marine snow on the seabed; the sky variant has the body fall to the ground. Then an egg or sprout cracks open → `rebirthChoice` offers 2 cards (the lower tier's `players`, or T1's if you were already in T1) → you start that tier at 40% growth. Parts and DNA are kept.

**Evolve**: growth ≥ 1 → `evolveChoice` (slow-mo 0.15, cards for `tier.next` players). At Pond Edge that's 6 cards in Land/Sky/Sea columns. Picking one plays a 1.6s transition (DNA helix swirl, radial burst, camera zooms out ×3, whiteout) → `editor` (+15 DNA) → Hatch → `intro` (2.2s card; 3s grace: invulnerable, hunters ignore you) → `play`.

**Final tier**: at full growth, `G.final = true`. Nothing can eat you now. Keep harmony ≥ 55 for 45 cumulative seconds while hunger still drains, so you must eat, but carefully → `victory`. This is the trophic-cascade lesson (wolves/willows, eagles/marmots, orcas/kelp).

**Score**: `mass × 10 × (1 + combo×0.1) × harmonyMult` (harmony <40 → ×1, 40–75 → ×2, >75 → ×3). The combo grows if you eat again within 2.2s. A run timer counts gameplay only (not title, editor, or pause).

**Parts (DNA)**: earned at `mass × 0.6 × dnaMul`, plus 15 per evolve and 15 at run start. Costs are 12/24/40 for levels 1/2/3. Species innate parts are a free level 1.

| part | slot | effect / level | look |
|---|---|---|---|
| jaws | mouth | eatRatio +0.035 | mandibles / beak / toothy jaw by plan |
| eyes | head | vision (zoom-out) +8%, threat-arrow range | bigger, extra eyes |
| spikes | back | 1 armor charge (absorbs a bite, knockback); recharge 30/22/15s | spikes / plates / shell |
| limbs | sides | speed +7% | legs (land), fins (water), wings (air) |
| tail | rear | dash cooldown −15%, dash distance +10% | longer tail / fluke / tail feathers |
| gut | core | energy drain −12%, DNA +15% | glowing belly spots |
| camo | skin | hunter detection radius −15% | pattern overlay (spots / stripes / bands) |

**Eco model (eco.js, ticks every 1s)**:
- **Producers** are static entities with `amount` 0–1. They regrow +0.02/s × fertility, and grazers touching them eat 0.15/s. `producerLevel` = average amount. Carrion and player deaths give +fertility for 20s.
- **Grazer births per species**: `rG·N·(1−N/K)` with rG≈0.05 and `K = n0 × 2.0 × clamp(producerLevel×1.25, .25, 1.25)`. So with no player predation, prey overshoots: **the player is the keystone predator**. Spawn offscreen near kin/producers. At N=0, a "migration" brings 2 back after 12s, so nothing is a permanent softlock. Grazers starve 3%/s if producerLevel < .25.
- **Hunters**: each tracks `hungerT`. A hunter dies after 50s unfed and becomes carrion. With fed ≥ 3 and N < 2.5·n0 it breeds. Satiated hunters (ate < 6s ago) rest. Hunters eat smaller grazers or hunters, and the player when `canEat`.
- **Caps**: species ≤ 2.6·n0; total ≤ 230 entities.
- **Harmony**: for each animal species, ratio = N/n0, and deviation is how far outside the band [0.6, 1.45] it sits (÷0.6). Producers use the band [.45, 1]. `harmony = 100 × (1 − min(1, meanDev×1.4))`, smoothed.
- **Mishaps** (max 2 active, 25s cooldown per type; titles and text are per tier in config, with defaults):

| type | trigger (sustained 4s) | effect | ends |
|---|---|---|---|
| famine | total grazers < .45·Σn0 | hunters desperate (speed ×1.25, detect ×1.5, prefer player, red eyes); energy drain ×1.4 | > .65 for 4s |
| boom | a grazer species > 1.75·n0 | that species swarms; grazing ×2 → producers fall | < 1.4·n0 |
| disease | boom species > 2.0·n0 for 8s | 35% of it sick (green); eating sick = poisoned 6s (drain ×3, speed ×.75, green tint); sick die 4%/s | < 1.3·n0 |
| barren | producerLevel < .3 | grazers starve; desaturated world | > .5 |
| surge | hunters > 1.7·Σn0 | banner; more predators roam | < 1.3 |

**Visual direction (Spore cell stage × nature doc)**:
- **Creatures**: saturated but natural palettes, soft gradient shading, glossy highlights. Big expressive eyes with specular dots, blinking, and eyes that look toward the target. Squash and stretch on bite and hop, idle breathing.
- **Depth layers by habitat**:
  - *water*: giant blurred silhouettes of next-tier creatures drift below a semi-transparent surface.
  - *land*: huge out-of-focus shadows of giants pass overhead at low alpha, plus blurred foreground grass/leaf blades.
  - *air*: the ground far below scrolls with parallax, and clouds sit above.
  - *all*: a drifting "tiny specks" layer of previous-tier creatures.
  - Pre-render blurred sprites; never per-frame `ctx.filter` or `shadowBlur` per entity.
- **Ground and light**: rich seeded procedural textures (tiled ~1024px offscreen canvases), dappled light, ambient particles (pollen, dust, plankton, snow), vignette, and a biome color grade. Low harmony desaturates and browns the world; high harmony makes it lusher.
- **UI tokens**:
  - Fonts: **Fredoka** (display) + **Nunito** (body) from Google Fonts, system-ui fallback.
  - Colors: `--ink #07110d`, `--panel rgba(9,20,16,.66)`, `--line rgba(220,255,240,.10)`, `--text #EAF5EF`, `--muted #9FB5AA`, `--grow #C6F25A`, `--harmony #3BE3C3`, `--danger #FF4F64`, `--dna #BFF6FF`, `--warn #F2E35C`.
  - Radii 6/10/14; spacing 4/8/12/16/24/32/48; type 12/14/16/20/28/40/96.
  - Panels are dark glass with backdrop blur. Buttons are chunky with a 10px radius and a bottom shadow (not pills).
- **Avoid**: cream/off-white backgrounds, purple gradients, pill buttons, monospace or numbered "01/02" labels, serif display fonts, Inter/Roboto display, terracotta/amber UI accents, lorem ipsum.

**Controls**:
- Mouse steers toward the pointer, or WASD/arrows. Space or left-click dashes.
- 1/2/3… pick cards, Enter hatches.
- R restarts instantly from any mode (keeps the creature design, skips the first editor). Esc/P pauses, M mutes (persisted).
- Touch: drag to steer relative to the player, plus a dash button and a pause button.

**Screens (ui.js)**:
- **Title**: live attract-mode world behind blurred glass, "APEX" logo, Play, How to play, per-path completion badges and best times.
- **HUD**:
  - Top-left: portrait (live mini canvas), name, latin name, tier and path.
  - Top-center: food-chain strip of roster portraits (edible = chartreuse, danger = coral, locked = dim) over the growth bar, with a DNA counter beside it.
  - Bottom-left: energy bar (pulses below 25%).
  - Bottom-right: harmony ring plus mini population bars per species with a healthy band (collapsible on mobile).
  - Top-right: score, combo, time, deaths.
- **Overlays**: mishap banners (title + one-line cause), tier intro card (what to eat and avoid, plus a real fact), final-hold timer, pause.
- **Choice and result screens**: evolve/rebirth cards (portrait, name, path, innate part, fact), death captions synced to decomposition ("Eaten by a Wolf Spider" → "The decomposers move in…" → "+N nutrients returned to the soil" → "Something stirs…"), and victory (path ending + cascade epilogue + lineage portraits in your colors/parts + stats + Play again).

**Editor (editor.js)**:
- Full-screen. A big animated creature sits center with glowing slot markers. On the left is a part palette (7 cards: preview, cost, level pips, description); drag onto a slot, or tap a card to auto-place. On the right are stat bars (Speed, Bite, Armor, Vision, Stealth, Stamina, Dash) with hover delta.
- Below: color swatches (body/accent/pattern, ~12 each plus "Natural colors", which is the default) and pattern type (none/spots/stripes/bands).
- Name input (≤18 chars), DNA counter, Hatch (Enter).
- Innate parts are shown locked. Parts removed in the same session are refunded. Pointer events, so it works on touch.

**Audio (Minecraft, curated)**:
- **Eating**: eat by size (frog/eat high-pitched for tiny, random/eat, ravager/bite or panda/bite for big, dolphin/eat underwater), burp at combo end, orb ticks rising with growth.
- **Progress**: levelup + amethyst chimes + respawn_anchor/charge on evolve.
- **Threats**: warden heartbeat when a hunter targets you nearby; telegraph growls (spider/say, wolf/growl, fox/aggro, polarbear/warning, hoglin/angry, guardian for sea); sweep or phantom/swoop for dash; splash in water.
- **Mishaps and death**: guardian/curse + cave ambience on mishaps; death sounds; composter/fill + sculk + moss + hanging_roots for decomposition; turtle egg_hatched / frogspawn hatch for rebirth.
- **UI and music**: hud_bubble for UI; amethyst place in the editor. Music: menu/mutation (title), music/game tracks per land/sky tier, music/game/water/* for the sea path, crossfaded via two `<audio>` elements, plus underwater ambience in sea tiers.
- **Mixing and playback**: positional pan and volume by distance from the player, pitch variation ±8%. Unlock on first gesture. If decode fails, play nothing silently. Keep total SFX under 4 MB.

---

# Appendix B — Contract

**Files and load order** (index.html): `css/style.css`, `css/editor.css`, then `js/config.js`, `sound-data.js`, `core.js`, `eco.js`, `ai.js`, `shapes-inverts.js`, `shapes-land.js`, `shapes-air-water.js`, `parts.js`, `world.js`, `biomes-sky-sea.js`, `fx.js`, `audio.js`, `ui.js`, `editor.js`, then inline `Apex.boot()` on `load`.
- Every file is wrapped as `(function(){'use strict'; const A = window.Apex = window.Apex || {}; … })();`.
- **No cross-module calls at load time.** Setup goes in `init()`, which `boot` calls.
- Guard optional calls: `A.X && A.X.fn && A.X.fn()`.
- Gameplay randomness uses `A.rand()` (seeded mulberry32). Cosmetic randomness may use `Math.random`.

**Units**: per-tier world units. The world is the square [0, tier.world] (default 2600). Player base r = 12. Angles are radians with 0 = +x. The camera is `{x, y, zoom (px/unit), shakeX, shakeY}`, and the view height in units is `player.r × 18 × visionMul`.

**Entity**:
```
{ id, sp, def:SPECIES[sp], ro:rosterEntry, role:'producer'|'grazer'|'hunter', beh, x,y,vx,vy, angle, r, mass, speed,
  state, stateT, target, tx,ty, hungerT, fed, sick, desperate, alive, age, phase /*core: += |v|·dt/r*/, biteT, hurtT,
  alt /*0..1 visual*/, amount /*producers*/, isPlayer, pal /*null|{body,accent,pattern,patternType}*/, parts /*null|{jaws:0..3,…}*/, rs:{} /*render scratch*/ }
player also: growth, energy, dna, armor, armorT, dashT, dashCdT, invulnT, poisonT, stats{speedMul,eatRatio,visionMul,armorMax,armorRecharge,dashCdMul,dashDistMul,drainMul,stealthMul,dnaMul}
```

**`Apex.G`**:
```
{ mode:'title'|'editor'|'intro'|'play'|'evolveChoice'|'evolving'|'dying'|'rebirthChoice'|'victory'|'paused', prevMode,
  path:null|'land'|'sky'|'sea', tierId, tier, time, tierTime, entities:[], player, cam, score, combo, comboT, deaths, dna,
  creature:{name, pal|null, parts:{jaws,eyes,spikes,limbs,tail,gut,camo}}, lineage:[{sp,tierId,pal,parts,outcome}],
  eco:{pops,n0,producerLevel,harmony,mishaps:[{type,sp,t,title,text}],fertility}, final, finalHold,
  stats:{eaten,bySp,maxCombo,mishaps,harmonySum,harmonyN}, choices:[{sp,tierId,path}], deathInfo:{cause,killerSp,x,y,sp,r,pal,parts,habitat},
  flags:{autoplay,bot,debug,headless,speed,seed,skipEditor,mute}, timeScale, hitstopT, transT }
```

**Events** (`A.on(name, fn)`, `A.off`, `A.emit(name, payload)`): `modeChange{from,to}` `runStart` `tierStart{tierId,sp}` `eat{eater,food}` `playerEat{food,points,dna,combo}` `graze{e,producer}` `playerHit{by}` `playerDeath{cause,killer}` `decomposeDone` `rebirth{sp,tierId}` `dash{e}` `windup{e,target}` `lunge{e}` `dive{e,tx,ty}` `threatNear{e,dist}`(≤1/s) `starving` `poisoned` `growth{growth}`(steps of .05) `evolveReady{choices}` `evolve{from,to,path}` `mishapStart{type,title,text,sp}` `mishapEnd{type}` `extinct{sp}` `migration{sp}` `birth{e}` `finalStart` `victory{path}` `restart` `pause{paused}` `uiClick` `editorOpen` `editorPlace{part,level}` `editorDone`

**core.js API**: `boot() update(dt) render() newRun() startTier(tierId, sp, {growth}) spawn(sp, ro, x, y, opts)→e kill(e, cause, killer) query(x, y, r, filter)→[] canEat(a, b) choose(sp) openEditor(opts) closeEditor() setMode(m) togglePause() restart() rand() randRange(a,b) pick(arr) worldToScreen(x,y) screenToWorld(x,y) playerStats(creature, sp)→stats nextChoices(tierId)→[{sp,tierId,path}] lowerTier(tierId)→tierId drawCreature(ctx, e, t) drawPortrait(ctx, sp, size, {pal,parts,t})`.
- Also exposes `A.input{x,y,wx,wy,dirX,dirY,pointerDown,touch,dashQueued}`, `A.canvas`, `A.ctx`, `A.W`, `A.H`, `A.DPR`.
- Fixed step 1/60 (max 5 steps per frame), render on rAF. Step order: input/bot → `AI.update` each NPC → integrate + clamp to the world → collisions/eating (spatial grid) → `Eco.tick` → mode timers → `FX.update`.
- Render order: `World.drawDepthBelow` → `World.drawBack` → entities (producers, then by alt, then r) with `drawCreature`, then `FX.drawOverlay` per entity → `FX.drawWorld` → `World.drawFront` → `World.drawDepthAbove` → `FX.drawScreen`, then `UI.update(G, dt)`. In `dying` mode, `FX.drawDecompose`; in `evolving`, `FX.drawEvolve`.
- `drawCreature`: draw the shadow from `look.len/wid`, offset by alt (skip if `look.noShadow`), then translate + rotate. If `Shapes[plan].worldSpace`, pass ctx in world space instead. Then `Shapes[look.plan](ctx, e, t, look)`, then `Parts.draw`. A missing look falls back to a colored blob with eyes.
- **Debug**: `A.debug={setTier(id,sp), killPlayer(), fillGrowth(), forceMishap(type), win(), simulate(maxSec,{bot,path,seed})→report}`. URL params: `?tier=&sp=&autoplay=1&bot=balanced|greedy|passive&seed=&speed=&debug=1&skipEditor=1&mute=1`.

**Other modules**:
- **Eco**: `initTier(G)` (spawns initial populations), `tick(G,dt)`, `onEat(eater,food)`, `onDeath(e,cause)`, `harmonyMult()`, `statusOf(sp)→'low'|'ok'|'high'`.
- **AI**: `update(e,dt,G)`, `bot(G,dt)→{dx,dy,dash}`. Bots:
  - *balanced*: prefers species over target.
  - *greedy*: goes for the nearest best value.
  - *passive*: eats only when energy < 30.
  - All bots avoid threats and dash on windup.
  - Behaviors: `static wander graze hop flit swarm school herd scurry flock crawl drift chase stalk ambush pack dive charge`.
- **Shapes** (3 files): register `A.Shapes[plan]=fn(ctx,e,t,look)` (body faces +x, sized by e.r, uses `e.pal` overrides, animates with `e.phase/biteT/hurtT/state`) and `A.LOOKS[sp]={plan, len, wid, …plan params, pal:{…defaults}, habitat, noShadow?}` for every species they own. A plan sets `.worldSpace=true` to draw chained bodies from `e.rs.trail`.
- **Parts**: `draw(ctx,e,look,t)`, `slots(look)→{mouth,head,back:[],sides:[],tail}` (from look.len/wid), `stats(parts,innate)→partial stats`. Limb style follows `look.habitat` (land/water/air).
- **World**: `init() build(tier) drawDepthBelow/drawBack/drawFront/drawDepthAbove(ctx,cam,t)` plus `A.Biomes[id]={habitat, palette:{bg,grade,fog}, build(tier,rng)→st, back(ctx,cam,t,st), front(ctx,cam,t,st)}`.
- **FX**: `init() update(dt) drawWorld(ctx,cam,t) drawScreen(ctx,t) drawOverlay(ctx,e,t) drawDecompose(ctx,cam,t,deathInfo,p) drawEvolve(ctx,p) burst(x,y,o) text(x,y,s,o) shake(a) flash(c,a)`. Also draws offscreen threat arrows and edible/danger rings.
- **Audio**: `init() unlock() setMusic(key) play(id,{vol,pitch,x,y}) toggleMute()`.
- **UI**: `init() update(G,dt)`. Cards call `A.choose(sp)`; Play calls `A.newRun()`.
- **Editor**: `init() open(G,{sp,firstTime})`. It writes `G.creature`, then calls `A.closeEditor()`.

---

# Appendix C — Content

**Tiers** (`depth, path, biome, players [innate part], next`). Roster entries are `sp role beh r n0`; role g = grazer, h = hunter, p = producer. Mid (edible after growth) entries are marked *. Starting values: growthNeeded d1 55 → d6 130 (+15/depth), drain 1.4, world 2600. Speeds are u/s: player 150; tiny grazers 50–90; flitters 140–170; mid 90–120; hunters 110–135 (cruise at 60%).

- **t1_litter** (1, shared, litter): ant[limbs], pillbug[spikes] → t2_under. p: seed, fungus · g: mite 3, springtail 4 hop, aphid 5 graze, caterpillar* 14 · h: beetle 20 chase, spider 24 stalk, centipede 40 ambush (n0 1).
- **t2_under** (2, shared, undergrowth): spider[jaws], beetle[spikes] → t3_pond. p: clover, fungus · g: aphid 4, ant 6 swarm, fly 5 flit, caterpillar 8, pillbug 9, cricket* 14 hop, worm* 16 · h: skink 24 chase, frog 26 ambush, shrew 34 chase.
- **t3_pond** (3, shared, pond): frog[tail], skink[limbs] → t4_meadow / t4_marsh / t4_river. p: reeds, lilypad · g: fly 3, cricket 6, tadpole 6 school, worm 7, spider 8, beetle 9, dragonfly* 14 flit, grasshopper* 16 hop · h: weasel 28 chase, snake 30 stalk, heron 50 ambush.
- **t4_meadow** (4, land): snake[camo], weasel[limbs] → t5_forest. p: grass · g: grasshopper 4, frog 8 hop, skink 8, mouse 9 scurry, vole 10, songbird* 14 flock, rabbit* 17 hop · h: fox 32 stalk, hawk 40 dive.
- **t5_forest** (5, land): fox[gut, omni], lynx[camo] → t6_valley. p: berries · g: mouse 4, squirrel 7, snake 8, rabbit 9, grouse* 13 flock, hare* 16 · h: wolverine 30 chase, wolf 32 pack, bear 55 charge.
- **t6_valley** (6, land, maxScale 2.6, final): wolf[limbs], bear[spikes, omni]. p: willow · g: hare 5, fox 9, boar 13, deer 14 herd, elk* 22 herd · h: wolf 24 pack, bear 28 charge.
- **t4_marsh** (4, sky): kingfisher[tail], swallow[limbs] → t5_canopy. p: reeds, lilypad · g: fly 3, dragonfly 6, tadpole 5, minnow 7 school, frog 9, vole 10, crayfish* 14 crawl, trout* 16 school · h: pike 30 ambush, hawk 34 dive, heron 45 ambush.
- **t5_canopy** (5, sky): hawk[eyes], owl[camo] → t6_cliffs. p: berries · g: songbird 5 flock, mouse 5, bat 6 flit, squirrel 7, snake 9, grouse* 13, rabbit* 16 · h: marten 28 chase, eagle 40 dive.
- **t6_cliffs** (6, sky, 2.6, final): eagle[jaws], gyrfalcon[limbs]. p: grass · g: pika 4, marmot 8, ptarmigan 9 flock, hare 10, fox 12, goat* 20 herd · h: eagle 26 dive, lynx 28 stalk.
- **t4_river** (4, sea): pike[tail], otter[limbs] → t5_kelp. p: waterweed, lilypad · g: tadpole 4, minnow 5 school, crayfish 8 crawl, frog 9, duckling 12, trout* 16 school · h: otter 28 chase, pike 30 ambush, heron 42 ambush.
- **t5_kelp** (5, sea): seal[limbs], seaotter[gut] → t6_ocean. p: kelp · g: urchin 4 crawl (grazes kelp: urchin boom → "Urchin Barren"), herring 6 school, crab 7 crawl, squid 10, salmon* 16 school · h: shark 36 chase, orca 50 pack.
- **t6_ocean** (6, sea, 2.6, final): orca[jaws], shark[eyes]. p: plankton (drifting) · g: sardine 4 school, jellyfish 6 drift, squid 8, tuna 12 school, turtle 14, seal 16, dolphin* 20 pack · h: orca 26 pack, shark 28 chase.

Config sets n0 per entry (tiny grazers 14–24, mid 5–8, hunters 1–3, producers 12–20), plus name, latin, fact, and per-tier mishap flavor (e.g. "Aphid Plague", "Willow Collapse", "Urchin Barren", "Famine in the Canopy"). `PATHS` holds name, color, blurb, ending, and cascade text.

**Species → shape owner** (body plan):
- **inverts**:
  - insect: ant, beetle, aphid, fly, cricket, grasshopper, dragonfly, springtail
  - other plans: arachnid (spider, mite), isopod (pillbug), segmented (centipede, caterpillar, worm), crustacean (crayfish, crab), urchin, cephalopod (squid), jelly (jellyfish)
  - plant (variants): seed, fungus, clover, reeds, lilypad, grass, berries, willow, waterweed, kelp, plankton, carrion
- **land**: quadruped (shrew, mouse, vole, weasel, rabbit, hare, squirrel, fox, lynx, wolverine, wolf, bear, boar, deer, elk, marten, pika, marmot, goat, otter), frog, lizard (skink), serpent (snake).
- **air-water**: bird (heron, hawk, songbird, grouse, kingfisher, swallow, owl, eagle, gyrfalcon, ptarmigan, duckling, bat as a membrane-wing variant), fish (tadpole, minnow, trout, pike, herring, salmon, sardine, tuna), shark, cetacean (orca, dolphin), pinniped (seal, seaotter), turtle.

---

# Appendix D — Clarifications (binding for all modules)

**Draw-space conventions**
- `World.drawDepthBelow/drawBack/drawFront/drawDepthAbove` and `FX.drawWorld/drawScreen/drawDecompose/drawEvolve` receive ctx in CSS-pixel **screen space** (transform already = DPR scale). Place world things with `sx = (x − cam.x)·cam.zoom + A.W/2 + cam.shakeX`, `sy = (y − cam.y)·cam.zoom + A.H/2 + cam.shakeY`.
- For world-space drawing call `A.applyCam(ctx, cam)`, which core defines as `ctx.setTransform(D·z,0,0,D·z, D·(A.W/2 − cam.x·z + cam.shakeX), D·(A.H/2 − cam.y·z + cam.shakeY))` with `D = A.DPR`, `z = cam.zoom`. You may inline the same formula. Restore with `ctx.setTransform(D,0,0,D,0,0)`.
- `Shapes[plan](ctx,e,t,look)`: origin at the entity center, rotated by `e.angle`, 1 unit = 1 world unit. Plans flagged `.worldSpace = true` get world space instead (after applyCam) and draw at `e.x, e.y`.
- `Parts.draw(ctx,e,look,t)`: same entity-local rotated frame as a normal shape (core re-translates for worldSpace plans).
- `FX.drawOverlay(ctx,e,t)`: origin at the entity center, **not rotated**, world units.

**Bodies and palettes**
- A body roughly fills an ellipse with semi-axes `(look.len·e.r, look.wid·e.r)`, head toward +x. Collision radius is `e.r`. Typical len 1.1–1.8, wid 0.5–1.0. Core's soft shadow uses this ellipse (offset by alt).
- `look.pal = {body, belly, accent, dark, eye}` hex strings. A player's custom `e.pal = {body, accent, pattern, patternType:'none'|'spots'|'stripes'|'bands'}` overrides body/accent. Patterns are drawn by Parts. `e.pal === null` means natural colors.

**Habitat, flight, eco flags**
- `tier.habitat` (set in config): litter, undergrowth, pond, meadow, forest, valley = `'land'`; marsh, canopy, cliffs = `'air'`; river, kelp, ocean = `'water'`. `look.habitat` is the species' own visual habitat.
- A player in an `'air'` tier gets `alt = CFG.AIR_ALT` (0.35, visual only). Hunters with beh `'dive'` use alt for gameplay: alt > 0.5 cannot eat or be eaten.
- `G.eco.flags = {famine, boomSp, diseaseSp, barren, surge}`. Eco writes them; ai/core/fx/world/audio read them. Eco sets `e.desperate = true` on hunters during famine and `e.sick = true` during disease.
- Every entity has `e.lastAte` (G.time of its last meal, −999 initially). A hunter is satiated when `G.time − e.lastAte < CFG.SATIATED_TIME` (6).

**Motion and modes**
- AI sets `e.vx/e.vy` (desired velocity in units/s; AI handles its own speed caps), `e.angle` (smoothed facing) and `e.state`. Core integrates position, keeps entities inside `[r, world − r]`, and advances `e.phase` (`+= |v|·dt/r`), `stateT`, `age`, `biteT`, `hurtT`.
- `G.transT` = seconds spent in the current mode (reset by every `setMode`). Durations: `CFG.INTRO_TIME`, `CFG.EVOLVE_TIME`, `CFG.DECOMPOSE_TIME`.
- Producers: role `'producer'`, beh `'static'` (plankton `'drift'`), `e.amount` 0..1 drawn as fullness. Eco spawns species `'carrion'` (a producer that decays).
- Camera: view height in world units = `CFG.VIEW_R_MULT · (12 + (player.r − 12)·0.55) · visionMul`, so the player visibly grows within a tier. `cam.zoom = A.H / viewHeight`.
- No script may throw when another module is missing; fall back quietly.

**Config shapes (config.js defines all of these)**
- `A.CFG` keys: PLAYER_BASE_R, PLAYER_SPEED, VIEW_R_MULT, EAT_RATIO, ENERGY_MAX, DASH_MULT, DASH_TIME, DASH_CD, DASH_COST, LUNGE_MULT, WINDUP, LUNGE_TIME, RECOVER, STARVE_GRACE, COMBO_WINDOW, HARMONY_BAND, PRODUCER_BAND, K_MULT, RG, HUNTER_STARVE, HUNTER_BREED_FED, SATIATED_TIME, SPECIES_CAP_MULT, MAX_ENTITIES, MIGRATION_DELAY, RESPAWN_GROWTH, START_DNA, EVOLVE_DNA, DNA_PER_MASS, PART_COSTS, DECOMPOSE_TIME, DECOMPOSE_SKIP, INTRO_TIME, GRACE, EVOLVE_TIME, FINAL_HOLD, FINAL_HARMONY, WORLD, MISHAP_COOLDOWN, MAX_MISHAPS, MISHAP_SUSTAIN, ARMOR_RECHARGE ([0,30,22,15]), POISON_TIME, AIR_ALT.
- `A.PARTS[id] = {name, slot, desc, levels:[t1,t2,t3], effect:{stat: perLevel}}` for ids jaws, eyes, spikes, limbs, tail, gut, camo.
  - Stats: speedMul (+), eatRatio (+, added to CFG.EAT_RATIO), visionMul (+), armorMax (spikes: 1 at any level), armorRecharge (CFG.ARMOR_RECHARGE[level]), dashCdMul (−), dashDistMul (+), drainMul (−), dnaMul (+), stealthMul (−).
  - Effective level = `min(3, bought + innate)`.
- `A.SPECIES[sp] = {name, latin, fact, playable?, innate?:{part:1}, omni?}`.
- `A.TIERS[id] = {id, depth, path, biome, habitat, name, blurb, players, next, prev, maxScale, growthNeeded, drain, world, final, roster:[{sp, role, beh, r, n0, speed}], mishaps:{type:{title,text}}}`. `A.TIER_START = 't1_litter'`.
- `A.PATHS[path] = {name, color, blurb, ending, cascade}`. `A.MISHAP_DEFAULTS[type] = {title, text}` (text may contain `{sp}`).
- Sound ids belong to audio.js. Other modules trigger sounds only through events.

---

# M1.5 — Rework after first playtest (binding; supersedes earlier UI, controls and pacing notes)

Playtest verdict: core movement, creatures and world art are good; everything around them is not. Problems: the UI is cluttered boxes, there's no onboarding, it's far too fast, the pond tier collapses (harmony crashes, predators stop being a threat), you can't fight back, and attacking is just "touch smaller things". Must work in Windows browsers (Chrome, Edge, Firefox).

## Pacing
- **Full 6-tier run ≈ 15 min**: about 2–2.5 min per tier plus the final hold. The M1 slice (t1–t3 + hold) is about 7 min.
- Balanced bot targets: each tier ≥ 110s and ≤ 170s before evolving; slice 6–8 min; 1–4 deaths across 3 seeds total (at least 1); harmony avg ≥ 55.

## Combat (core.js, ai.js, config.js, eco.js)
- **Health**: every animal has `hp`/`maxHp` with `maxHp = CFG.HP_PER_MASS × mass` (player too). Producers have no hp.
- **Eating stays instant** on contact for anything with `r < myR × eatRatio`. This is the Feeding Frenzy feel.
- **Bite** (left click / Space; touch: bite button):
  - A 0.12s forward snap (×1.6 speed) hits the arc in front of the mouth (60°, reach ≈ 1.4·r). Cooldown `CFG.BITE_CD` (0.45s).
  - Damage = `CFG.BITE_DMG × player.mass^0.5 × (1 + 0.25·jawsLvl)`.
  - Valid targets: any animal up to `CFG.FIGHT_RATIO` (1.35) × your r. Bigger ones take 15% damage and knock you back.
  - A target brought to 0 hp dies and leaves a **carcass**, a producer-like food (`sp: 'carcass'`, amount = its mass). You eat it on contact for its full mass. This is how you take down mid-size prey and fight off predators.
  - Emits `bite{e, hits:[...]}` and `damage{target, amount, by}`.
- **Predators deal damage instead of instant death**:
  - Lunge contact does `CFG.PRED_DMG × hunter.mass^0.5`, with a 0.6s invulnerability window afterward. An apex ≥ 2× your r still kills in about 1–2 hits.
  - A hunter that takes ≥ 35% of its maxHp in a short window flinches (0.5s stun), and at < 30% hp it flees.
  - The player regenerates 2% maxHp/s after 4s without damage, while energy > 30%.
  - Armor (spikes) absorbs one hit as before.
  - Death happens at hp 0 or by starvation.
- **Species ability** (E / right click; touch: ability button), one per playable species, in `SPECIES[sp].ability = {id, cd, ...}`. Core implements the mechanics and fx draws them:

  | species | ability | effect | cd |
  |---|---|---|---|
  | ant | formic spray | cone 90°/3r: damage + slow 40% for 2s | 8s |
  | pillbug | roll up | 2s invulnerable, speed ×0.5, attackers knocked back | 10s |
  | spider | web throw | web disc at the pointer (r 3·r) slows everything in it 70% for 5s | 9s |
  | beetle | horn charge | 0.4s ram ×2.4 speed: stun 1s + damage on hit | 8s |
  | frog | tongue snatch | pulls the nearest edible within 6r in and eats it; stuns a non-edible 0.6s | 6s |
  | skink | tail drop | drops a wriggling decoy that hunters chase for 3s; you get +40% speed for 1.5s | 12s |

- **Angry neutrals**: bumping (with speed) into an animal that is neither food nor a threat makes it `angry` for 6s. It chases you and nips for `CFG.NIP_DMG × √depth` damage, scaling up in later tiers (every tier starts the player at the same size, so full depth scaling killed in a few bumps). AI state `angry`; fx shows a small anger mark.
- **Controls** (final): mouse steers; left click / Space = bite; Shift / right click = dash; E / Q = ability; Tab (hold) = ecosystem view; hold R (0.7s) to restart during play, R restarts at once on menus; Esc/P pause, M mute. Backquote (`) opens the dev menu. Touch: drag steers, with on-screen Bite / Dash / Ability buttons.
- **New player and entity fields**: `hp, maxHp, biteCdT, ability:{id, cd, cdT, activeT}, stunT, slowT, angryT, flinchT`.
- **New events**: `bite, damage, abilityUse{e,id}, angry{e}, flinch{e}, carcass{e}, tutorialStep{id}`.

## Pond tier fix
At t3_pond, harmony crashes and predators stop being a threat. Hunters probably starve, or prey crashes after the density change. Diagnose with the sim and fix it so pond hunters (snake, weasel, heron) stay present and dangerous all tier, and harmony is recoverable by balanced play.

## Tutorial (guided first minute, t1_litter)
- Steps advance on actions, never on timers alone. Each step is a short hint bubble anchored near the player plus one world highlight:
  1. Move (a glowing target ring to reach).
  2. Eat ("Glowing outline = food"; a few slow mites spawned close).
  3. Grow (the growth ring around you fills).
  4. Bite (a caterpillar too big to swallow: bite it down, then eat the carcass).
  5. Danger (a beetle spawns and telegraphs: "Red outline can eat you. When it flashes, dash away (Shift)").
  6. Ability ("Press E: formic spray").
  7. Harmony, triggered the first time any species leaves its healthy band ("Wiping out one species starves its predators. They'll come for you.").
- Skippable (Esc in the tutorial: "Skip tutorial"). Done flag stored in `localStorage 'apex.tutorial'`.
- Predators can't kill during steps 1–4; the beetle in step 5 deals reduced damage.
- In later tiers, contextual one-time tips appear the first time something new happens (first mishap, first death, evolve screen, first angry neutral).

## UI design system (ui.js, style.css, fx.js overlays)

**Brief**: a biology food-chain game played by friends and a teacher. The interface should teach the one rule, "smaller is food, bigger is danger, keep the web alive", and otherwise get out of the way. The creature is the interface.

**Color** (meaning-bound, never decorative):
- `--soil #1B1612` (menu backdrop tint)
- `--film rgba(232,244,236,.86)` (pale dew-film glass for menu cards, with dark ink)
- `--ink #14261D` (text on film)
- `--leaf #8FD14F` (food / growth)
- `--venom #FF5A5F` (danger / damage)
- `--spore #7FE8D4` (harmony / DNA)
- `--pollen #F2D94E` (score, combo, ability ready)
- `--bone #EFE8DA` (text drawn over the world)

**Type**:
- **Bricolage Grotesque** (variable, 600–800, slightly condensed) for the wordmark, tier titles and big numbers.
- **Atkinson Hyperlegible** (400/700) for everything you read: hints, cards, captions. It's legible for teachers and kids and renders cleanly on Windows ClearType.
- Scale: 13 / 15 / 18 / 24 / 34 / 52 / 120. Sentence case everywhere: no all-caps labels, no eyebrow labels, no middle-dot meta strings, no arrow-suffixed buttons.

**In-world HUD** (drawn by fx around the player, world space, scales with the creature):
- Growth ring: a thin leaf-green arc around the body that fills; it pulses when full.
- Health: a venom-red inner arc, shown only when damaged, fading 3s after regen completes.
- Hunger: the creature dims and the ring gets a slow pollen pulse below 30% energy, with a soft heartbeat glow below 15%.
- Ability: a short pollen arc outside the growth ring, behind the creature, that grows from its middle as the cooldown recovers, glows with a pollen ping when ready, and flares while active.
- Bite: a crescent flash in front of the mouth; hits spark.
- Damage numbers: small, venom, only for hits you take or big hits you land.
- Edible: a leaf outline on edible creatures near you. Danger: a venom outline, plus a pulsing red rim during windup.

**Screen HUD** (DOM, minimal, no boxes):
- **The food-chain ribbon (the one memorable element)** sits top-center: a thin horizontal strip of this tier's species icons, ordered by size, with a marker for you. Everything left of the marker glows leaf (food); everything right is venom (danger); the in-between "fight" zone is pale. As you grow, the marker slides right and icons cross from danger to food. That teaches the core rule. Icons are flat silhouettes tinted by zone; only the ones nearest your size (the biggest thing you can eat, anything you can fight, the next thing up) show real colours. On evolve, the ribbon unfurls downward into the evolve cards.
- **Top right**: score and time as bare bone-colored numbers with a soft text shadow.
- **Bottom center**: one small harmony dial (spore arc plus a number). The world grade does the rest.
- **Tab (hold)**: the ecosystem view, a clean food-web diagram of this tier (species nodes sized by population with healthy-band rings; arrows from prey to predator; red or green halos for low/high), so the eco system is understandable.
- **Touch**: three round thumb buttons bottom-right (bite largest), pause top-right.

**Menus** (title, intro, evolve, rebirth, pause, victory): dew-film glass cards with ink text over the live, slightly blurred world. Corner radii are hierarchical: 18px for screens and 10px for cards; buttons are 10px with a firm 2px bottom edge.
- **Title**: wordmark "Apex" set huge in Bricolage, bottom-left, with the attract world behind. One line: "Eat what's smaller. Escape what's bigger. Keep the forest floor alive." Buttons: Play, How to play. Best results go small, below.
- **Intro card**: a compact top banner (never centered over the player): tier name, "You are a black ant", and three ribbon icons.
- **Death**: the decomposition stays the hero, with a single caption line low on screen; rebirth cards come up from the soil edge.

**Principles**: teach through the world, not text. Show text only when it teaches something new. One bold element (the ribbon); everything else stays quiet. Keyboard focus is visible, `prefers-reduced-motion` is respected, and it works at 390px.

## Windows
- Test in Playwright Chromium + Firefox at DPR 1, 1.25 and 1.5.
- Use `pointer` events with `pointerType`; `contextmenu` prevented on the canvas (right-click = dash); no Mac-only key names; avoid `backdrop-filter` jank (fallback solid film on Firefox when slow).
- Fonts load with a system fallback stack (`"Atkinson Hyperlegible", "Segoe UI", system-ui, sans-serif`).

---

# M2 — Land path decisions (from user, binding)
- **Seasons**: t4 Spring Meadow (fresh grass, wildflowers), t5 Autumn Forest (fallen leaves, berries), t6 Winter Valley (frost, snow patches, willows). The run ends in early winter.
- **Land animal art is more realistic** than the bugs: natural proportions, longer snouts, smaller eyes, and bigger animals get smaller eyes.
- **Abilities for the land players** reuse the six mechanics: weasel Pounce (charge), snake Musk spray (spray), fox Mouse pounce (snatch, drawn as a leap), lynx Ambush leap (charge), wolf Howl (wide cone slow, drawn as sound arcs), bear Brace (roll: 2s untouchable, knockback).
- **Audio**: Minecraft sounds in every build, including the Google Sites one (the user's call: the site is private).
- Pond Edge is no longer final; t6 Winter Valley is the final hold. Marsh and river (sky and sea) come in M3.

# Working rule (from user, binding)
No subagent swarms and no Workflow runs. Spawning a single subagent when it genuinely helps is fine, no need to announce it.

## Skills to run first (from user, binding)
- **Before any game work session**: run the `principle-experience-first` and `principle-sequence-verifiable-units` skills (installed in ~/.claude/skills).
- **Before any UI work**: also run `frontend-design:frontend-design` and `exhaust-the-design-space`.
