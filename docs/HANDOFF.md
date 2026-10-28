# Apex — handoff

**Apex** is a top-down food-chain browser game (Feeding Frenzy × Hungry Shark × Spore cell stage). You start as an ant, eat what's smaller, escape what's bigger, evolve up six tiers, and keep a real food web in balance. It ends with a boss fight in a winter valley. It's a private project for the user, their friends and a teacher. The user is **playtesting it live** and will put a single-file build on Google Sites for the teacher.

Read this file, then `docs/DESIGN.md`. In DESIGN.md, the **M1.5 — Rework** and **M2 — Land path decisions** sections are binding and win over older sections.

---

## 0. Do this next

The boss works and is tuned, but **the user said it looks ugly** (it reads as a giant hamster). The user asked for this exact agent set. It's an explicit exception to the no-swarm rule, so don't add more agents.

1. Load the `subagent-playbook` skill. Write each brief from §5 and launch the four agents in **one message**, each owning separate files.
2. While they run, don't touch their files. When each reports back, verify with its screenshots and a headless page load, then commit.
3. Rebuild `dist/apex.html` and `dist/apex-lite.html` and send them to the user.
4. Update this file (§4 and §5) at the end.

## 1. How the user wants you to work

- **Skills first.** Before game work, run `principle-experience-first` and `principle-sequence-verifiable-units`. Before UI or visual work, also run `frontend-design:frontend-design` and `exhaust-the-design-space`.
- **Ask before visual or game-design decisions.** Use the question tool with 2–4 short questions and concrete options, even when the user says "full send". Numeric tuning toward targets already in DESIGN.md needs no question.
- **The user sends messages mid-turn while playtesting** (bugs, requests, short screenshots). Add each to the current work and don't drop earlier items. Their language is casual; just act on the substance.
- **No smoke runs while the user is playtesting** (they asked). Verify with targeted headless checks instead: one page load, the specific state, `pageerror` count.
- **One browser launch per screenshot pass.** Each headless Chromium launch flashes a Dock icon. Use one Playwright script that takes many shots, never a loop of launches.
- **Agents:** normally no swarms or Workflow runs, and a single subagent is fine. The §5 set is the user's explicit request. Always set `model` (Opus for design, Sonnet for implementation; never Fable).
- **Commit after each verified unit**, straight to `master` (no remote). End commits with the Co-Authored-By line from the system reminder.
- **Keep this file current** at every milestone (finished feature, new tier, playtest round).
- **Minecraft audio is in every build, including Google Sites** (the user's call: the site is private). It's Mojang's, so ask before any open public hosting.
- The user's general rules are in `~/.claude/CLAUDE.md`: lead with outcomes, real checks before "done", the frontend avoid-list, one-key restart, no soft-locks.

## 2. Run and check

```
python3 tools/serve.py 8642          # dev server with no-cache headers (.claude/launch.json "apex"); file:// also works
node tools/build-single.mjs          # dist/apex.html: whole game in one file, with music (~6 MB)
node tools/build-single.mjs --no-music   # dist/apex-lite.html (~2 MB) if Google Sites rejects the big one
python3 tools/build-audio.py         # regenerate js/sound-data.js + js/music-data.js from the user's Minecraft assets
node tools/bossim.mjs '[["normal",1],["normal",2,"bear"],["easy",1],["scary",1]]'   # boss fight sims (fight only)
node tools/boss-shots.mjs            # boss screenshots: arrival, each telegraph, enraged, death, victory (NOT RUN YET)
node tools/land-shots.mjs <round> [names]   # every Land-path screen, 1440x900 + 390x844 -> shots/land/r<round>/
node tools/ui-shots.mjs <round> [names]     # every core UI screen and HUD state -> shots/ui/r<round>/
python3 tools/pair.py <shotsDir> <outDir>   # desktop|mobile side-by-side pairs, cheap to review
node tools/ring-check.mjs            # frozen close-ups of the player's rings
node tools/windows-check.mjs         # dist/apex.html in Chromium (+Firefox) at DPR 1/1.25/1.5
node tools/check.mjs smoke           # 35-step smoke (not during playtests); sim mode: node tools/check.mjs sim --runs 3
node tools/stubcheck.mjs <files> --eval "<js>"   # load scripts in a Node vm, e.g. to run validateConfig()
```

- **URL flags**:
  - Tiers: `?tier=t1_litter|t2_under|t3_pond|t4_meadow|t5_forest|t6_valley`, with `&sp=<species>`.
  - Testing: `&autoplay=1`, `&bot=balanced|greedy|passive`, `&seed=1`, `&speed=2`, `&debug=1`, `&skipEditor=1`, `&mute=1`.
  - Modes: `&tutorial=0|1`, `&diff=easy|normal|scary`.
- **Debug API**:
  - `Apex.debug.{setTier(id, sp), fillGrowth, killPlayer, win, forceMishap(type), tutorialAdvance}`.
  - `Apex.debug.simulate(sec, {bot, seed, tier, sp, growth, botAfter:{t, bot}})` returns a report including `harmonyTrace`.
  - Stats: `Apex.Boss.stats()`, `Apex.FX.stats()` (includes casts), `Apex.Audio.stats()`. `Apex.setDifficulty(d)`.
- **In game**:
  - Backquote (`` ` ``) opens the **dev menu**: jump to any tier and species (number keys 1–6), plus fill growth, kill, win and force famine.
  - **Hold R** restarts during play.
  - To reach the boss fast: dev menu → Winter Valley → Fill growth, then wait 15 s (or set `Apex.G.finalHold = 15`).
- For screenshots, set `Apex.World.autoQuality = false`. Freeze a moment with `Apex.G.timeScale = 0.0001`, which freezes particles too.

## 3. Code map

Plain HTML + Canvas 2D + DOM. Classic scripts share `window.Apex`, with no build step and no runtime dependencies. Load order is in `index.html`; missing later-milestone files (parts, editor, sky/sea biomes) 404 harmlessly.

| File | Owns |
|---|---|
| `js/config.js` | `CFG` (all tunables incl. `DIFFICULTY`, combat, `FORGIVE_GROWTH`, `RESTART_HOLD`), `SPECIES` (facts, abilities), `TIERS` t1–t6 (rosters, `zone` entries, `boss`), `PATHS`, `validateConfig()` |
| `js/core.js` | loop, modes, input (hold-R), camera, entities, eating/growth (× difficulty), combat, death (first death per tier forgiven), boss hooks, render order, `debug.simulate` |
| `js/eco.js` | food web: births, hunter breeding (`HUNTER_BREED_FED`, `HUNTER_BREED_CAP`), harmony, mishaps, zone-aware spawning |
| `js/ai.js` | animal behaviors, hunter telegraphs, angry neutrals (√depth nips), autoplay bots |
| `js/boss.js` | **The Old One**: arrival, 3 phases (charge lanes with miss-stun, swipe, slam ring, roar cone, enraged chains), telegraph drawing, sky darkening, death → victory, boss bot |
| `js/tutorial.js` | guided first minute (grow step counts meals; the bite caterpillar starts at 40% hp) |
| `js/shapes-inverts.js` | bugs, worms, plants (incl. grass, berries, willow) |
| `js/shapes-land.js` | quadruped/frog/lizard/serpent plans + land LOOKS (`matte` fur flag, `scars` marking, `cavebear` look) |
| `js/shapes-air-water.js` | birds (heron, hawk, meadowlark, grouse) and fish |
| `js/world.js` | biomes: litter, undergrowth, pond, spring meadow, autumn forest (birch + pine zones, `World.zoneAt`), winter valley (creek is visual only) |
| `js/fx.js` | particles, in-world HUD rings (growth, HP, ability arc), threat arrows (avoid `A.UI.hudRects()`), ability visuals, decomposition, evolve |
| `js/ui.js` + `css/style.css` | ribbon, score, harmony dial, eco view, banners, tips, touch thumbs, menus, difficulty picker, dev menu, hold-R bar, boss bar + title card |
| `js/audio.js` + `js/sound-data.js` + `js/music-data.js` | event-driven Minecraft SFX; music playlists `game` and `boss` (C418 "Boss", trimmed) |
| `tools/` | see §2; `tools/scratch/` is gitignored |

Conventions: wrap every file in an IIFE; no cross-module calls at load time (guard with `A.X && A.X.fn`); gameplay randomness via `A.rand()`; World/FX/Boss draw in screen space (`A.applyCam` for world space); shapes draw entity-local facing +x.

## 4. The game as it is now (all committed)

- **Tiers**: t1 Leaf Litter (ant, pillbug) → t2 Undergrowth (spider, beetle) → t3 Pond Edge (frog, skink) → t4 Spring Meadow (snake, weasel) → t5 Autumn Forest (fox, lynx; golden birch side and pine side with different animals) → t6 Winter Valley (wolf, bear). Valley full growth starts the 45 s "hold the balance"; the boss crashes in at 15 s.
- **Controls**: mouse or WASD steer; click/Space bite; Shift/right-click dash; E/Q ability; hold Tab eco view; hold R restart; Esc/P pause; M mute. Touch: drag plus Bite/Dash/Ability buttons.
- **Difficulty** (title, remembered):
  - Easy: growth ×1.5, your attacks +20%.
  - Normal (default): growth ×1.25, every attack +15%.
  - Scary: base values (`CFG.DIFFICULTY`).
- **Death**: the first death in a tier puts you back in the same tier at 50%; another death there drops a tier at 40%; a new tier resets this. Dying to the boss puts you back at full size for a fresh fight.
- **Boss**: legend-beast cave bear, about 1.7× your size, with glowing scars.
  - Sky darkens, horn, thunder; Warden, Ravager and Ender Dragon roars; C418 "Boss" music.
  - Sims (Normal): the wolf wins in 80–91 s, the bear in 104–134 s. Easy 64 s, Scary 112 s.
- **Pacing**: the balanced bot wins the full 6-tier run in about 11–20 min with harmony 55–79. Pond recovers after greedy play.
- **UI**: silhouette food-chain ribbon, rings around the creature, threat arrows that avoid the HUD, no-cache dev server.

## 5. Agent briefs (the user's plan; launch together)

Each brief must name its files, a done-means, "one browser launch per screenshot pass", "no smoke runs, no commits, no subagents", and an "Out" line. End each with Blocked on me / Changed / Found.

1. **Opus: boss redesign** (owns new `js/shapes-boss.js` and its `<script>` tag after shapes-land; may change `LOOKS.cavebear` and the `mark: 'scars'` code in shapes-land.js only).
   - **Goal**: scary and tough. A massive hunched silhouette with a shoulder hump and a heavy skull, a long snout with fangs, thick clawed forelimbs, and a jagged matted fur outline, not a smooth tube. Glowing cyan claw scars that brighten and crack with damage, ember eyes, frost on the back, breath steam.
   - **Poses**, keyed off `G.boss.state` and the entity:
     - walk
     - `chargeWind`: crouch and paw the ground
     - `charge`: a stretched lunge
     - `slamWind`: rearing up on its hind legs
     - `roarWind` / `phaseRoar`: head up, jaws open
     - `stunned`: stagger
     - phase 3: raised hackles and a red glow
   - **Readability**: must read on snow at any zoom. Run frontend-design and exhaust-the-design-space: 2–3 variants side by side first, then the best one.
   - **Verify** with `tools/boss-shots.mjs`.
2. **Opus: title logo** (owns the title markup in `js/ui.js` `buildTitle` plus new CSS for it, or a new `js/logo.js`).
   - **Goal**: an extremely tough, nature-based "Apex" mark that references the whole game: the climb ant → beetle → frog → snake → fox → wolf/bear, the biomes and seasons, and the cave bear.
   - **Format**: inline SVG or canvas; crisp at 390 px and 1440 px; `aria-label="Apex"`.
   - **Process**: run frontend-design first, follow the CLAUDE.md avoid-list, show 2–3 variants before finishing.
3. **Sonnet: boss pass** (owns `js/boss.js` telegraph drawing and the boss UI parts of ui.js/style.css only, after agent 1 lands, or coordinate by file).
   - Run `tools/boss-shots.mjs` and fix what reads poorly: telegraphs, the health bar on mobile next to the pause button, the title card.
   - Keep the fight numbers.
4. **Sonnet: finish-up** (owns `js/world.js` and `js/shapes-air-water.js`).
   - Fix the known gaps: snow drifts that look like soap bars in the valley, plain resting birds (hawk, meadowlark, grouse), and the creek (visual only; leave collision unless trivial).
   - Then run `tools/land-shots.mjs` and report.

After all of them: rebuild both dist files, do a headless boot check through all six tiers plus the boss, and send the files to the user.

## 6. Known gaps and gotchas

- **Unchecked**: Firefox (it won't launch inside the Bash sandbox, and running outside was denied; the user can run `node tools/windows-check.mjs`), real Windows, real-GPU fps, and the Google Sites embed size limit.
- **Browser pane**: when hidden it auto-pauses, reports a 0×0 canvas and runs slowly. Use headless scripts for checks. Stale CSS caused bugs before `tools/serve.py`; if the user reports something unstyled, ask them to reload.
- **Sim targets** in `check.mjs` follow M1.5 (tiers 110–170 s). With Normal's ×1.25 growth, the bot clears some tiers faster. Humans are slower; wait for playtest feedback before retuning.
- **Pond/final hold**: by design nothing can eat you during the hold, except the boss.
- **Frozen-time screenshots** keep old particles (for example a ready-ping ring); that's a test artifact.
- **Later milestones**: M3 Sky + Sea paths (marsh, river and beyond; Pond's `next` lists only the meadow until then), M4 creature editor + parts, M5 polish.
