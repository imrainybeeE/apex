# Apex — handoff

**Apex** is a top-down food-chain browser game (Feeding Frenzy × Hungry Shark × Spore cell stage). You start as an ant, eat what's smaller, escape what's bigger, evolve up six tiers, and keep a real food web in balance. It ends with a boss fight in a winter valley. It's a private project for the user, their friends and a teacher. The user is **playtesting it live** and will put a single-file build on Google Sites for the teacher.

Read this file, then `docs/DESIGN.md`. In DESIGN.md, the **M1.5 — Rework** and **M2 — Land path decisions** sections are binding and win over older sections.

---

## 0. Do this next

**The boss rework the user asked for (all four design answers are below; don't ask them again).** The user says the fight is unbalanced: phases 1–2 are too easy.

1. **Phase 2 opens with the 360 attack.** The slam ring is the only 360° attack. When phase 2 starts (hp ≤ 66%), go from `phaseRoar` straight into `slamWind` instead of `stalk`. Force one more slam the first time hp drops to ≤ 50%: set a flag and take it at the next `pickAttack`.
2. **Ancient amber before the final phase.** When hp first reaches ≤ 33%, don't enrage yet:
   - The boss roars and backs off (invulnerable, not attacking).
   - A glowing **amber shard with ancient DNA** (a trapped mosquito inside) streaks down from the sky with a thunder and impact flash. It lands in reach of the player, not under the boss.
   - The player touches it and **evolves into the ancient form**: wolf → **dire wolf** (`direwolf`), bear → **short-faced bear** (`shortface`). Use the evolve FX, give a bigger body, and heal to full.
   - That **calls in a pack of 3 allies**: gray wolves for the wolf, grizzlies for the bear. They run in from the edge with a howl or roar and fight the boss for the whole final phase. Boss attacks can knock them out.
   - No soft-lock: the amber always lands somewhere reachable, and the boss waits until it's taken. Show a short tip ("Ancient amber! Grab it.").
3. **Final phase: hard but fair.** Then phase 3 enrages as now, but harder: the boss heals to about 45% hp, windups get shorter, charges chain up to 3, slams come more often, and it targets allies too. With the pack it should be tougher than today, and a careless player dies on Normal.
4. **Ancient art at the Old One's quality** (the user's words: "make the ancient wolf the same great quality"). Brief one **Opus** agent for this, owning `js/shapes-ancient.js` (new) and the `VARIANTS` table in `js/shapes-boss.js`. Its index.html tag is already in.
   - **Dire wolf**: a new `A.Shapes.direwolf` plan plus `A.LOOKS.direwolf`, registered from that file. Heavier and broader than the gray wolf, with a huge skull and jaws, a thick ruff, a frosted coat and small eyes. Poses: walk, bite (`biteT`), howl (ability active), hurt.
   - **Short-faced bear**: an `arctodus` variant of the cave bear plan (`A.LOOKS.shortface`, `plan: 'cavebear', variant: 'arctodus'`). Long legs, a short broad face, a tawny coat, and no scars or ember eyes.
   - The agent must show 2–3 variants side by side first, verify in game with `?tier=t6_valley&sp=direwolf` (or `sp=shortface`), use one browser launch per screenshot pass, and run no smoke tests, no commits and no subagents.
5. **You implement the mechanics** (Sonnet-level work, or do it yourself):
   - `js/boss.js`: the amber state machine, amber drawing, allies, the phase 2 slams and the phase 3 tuning.
   - Allies are **owned by boss.js** (`fight.allies`), not put in `G.entities`, so eco, eating and AI never see them. Update them in `update()`. Draw them in world space with `A.applyCam` + `A.drawCreature(ctx, ally, t)`; an ally needs `{id, sp, x, y, vx, vy, angle, r, phase, rs:{}, hp, maxHp, hurtT, biteT, alive, state}`. Each boss attack's hit test must also hurt allies.
   - `js/core.js`:
     - `playerRadius()` should multiply by `p.rMul || 1` (it re-eases `p.r` every frame).
     - The ancient swap sets `p.sp`, `p.stats = A.playerStats(G.creature, sp)`, `p.ability` from `SPECIES[sp].ability`, `p.rMul ≈ 1.3`, and full hp.
     - `rebirthChoices()` in the boss branch must map an ancient species back to its base (`SPECIES[sp].ancientOf`), so a retry starts as the wolf or bear again.
   - `js/ui.js`: add `direwolf: 'howl', shortface: 'brace'` to `ICON_BY_SP`.
   - `js/audio.js`: reuse existing sounds on new events (thunder on the amber fall, evolve on pickup, a howl or roar when allies arrive).
   - The boss bot (`A.Boss.bot`) must walk to the amber, or `bossim` will stall.
6. **Retune with `node tools/bossim.mjs '[["normal",1],["normal",2,"bear"],["easy",1],["scary",1]]'`**.
   - Today: Normal wolf 91 s, bear 104–134 s, Easy 64 s, Scary 112 s.
   - Target: Normal about 110–150 s with at most 1 bot death, Easy shorter and won reliably, Scary may cost deaths.
   - Then shoot `node tools/boss-shots.mjs` (extend it with amber fall, evolve and allies) and do one headless boot of every tier with `tools/full-boot.mjs <file>`.
7. Commit each verified unit, `git push`, and `node tools/deploy-pages.mjs`. Rebuild both dist files, send them to the user, and update §4 here.

**Already done for this:** `SPECIES.direwolf` and `SPECIES.shortface` are in `js/config.js`, with `ancientOf`, facts and stronger howl/brace abilities; `validateConfig()` passes. The `<script src="js/shapes-ancient.js">` tag is in index.html and 404s harmlessly until the file exists. Nothing else for the rework exists yet.

After the rework, the leftovers in §5.

## 1. How the user wants you to work

- **Skills first.** Before game work, run `principle-experience-first` and `principle-sequence-verifiable-units`. Before UI or visual work, also run `frontend-design:frontend-design` and `exhaust-the-design-space`.
- **Ask before visual or game-design decisions.** Use the question tool with 2–4 short questions and concrete options, even when the user says "full send". Numeric tuning toward targets already in DESIGN.md needs no question.
- **The user sends messages mid-turn while playtesting** (bugs, requests, short screenshots). Add each to the current work and don't drop earlier items. Their language is casual; just act on the substance.
- **No smoke runs while the user is playtesting** (they asked). Verify with targeted headless checks instead: one page load, the specific state, `pageerror` count.
- **One browser launch per screenshot pass.** Each headless Chromium launch flashes a Dock icon. Use one Playwright script that takes many shots, never a loop of launches.
- **Agents:** no swarms or Workflow runs; a single subagent is fine (§0 uses one Opus art agent). Always set `model` (Opus for design, Sonnet for implementation; never Fable).
- **Commit after each verified unit**, straight to `master` (no remote). End commits with the Co-Authored-By line from the system reminder.
- **Keep this file current** at every milestone (finished feature, new tier, playtest round).
- **Minecraft audio is in every build, including Google Sites** (the user's call: the site is private). It's Mojang's, so ask before any open public hosting.
- The user's general rules are in `~/.claude/CLAUDE.md`: lead with outcomes, real checks before "done", the frontend avoid-list, one-key restart, no soft-locks.

## 2. Run and check

```
python3 tools/serve.py 8642          # dev server with no-cache headers (.claude/launch.json "apex"); file:// also works
node tools/build-single.mjs          # dist/apex.html: whole game in one file, with music (~6 MB)
node tools/build-single.mjs --no-music   # dist/apex-lite.html (~2 MB) if Google Sites rejects the big one
node tools/full-boot.mjs <html>     # one launch: title, all six tiers, reach the boss; prints pageerrors
node tools/deploy-pages.mjs [--dry]  # build HEAD in a clean worktree, boot-check, push to the public Pages repo
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

- **GitHub**:
  - Source is in the private repo `imrainybeeE/apex` (remote `origin`, branch `master`); push after each commit.
  - The playable page is the public repo `imrainybeeE/apex-play` (`index.html` only, noindex), served at https://imrainybeee.github.io/apex-play/. Update it only with `tools/deploy-pages.mjs`.
  - The user chose to keep Minecraft audio there and treat the link as unlisted.
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
| `js/shapes-boss.js` | `A.Shapes.cavebear`: the Old One (poses from `G.boss.state`, cracking scars, frost) and, via `VARIANTS`, the grizzly (`LOOKS.bear`, `variant: 'grizzly'`) |
| `js/logo.js` + `css/logo.css` | title logo: inline SVG `A.Logo.markup()` (six-biome pyramid A, the climb on the letters, claw-torn X) |
| `js/shapes-air-water.js` | birds (heron, hawk, meadowlark, grouse; feathered rest and flight wings) and fish |
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
- **Boss**: The Old One, a shaggy hump-backed cave bear (shapes-boss.js), about 1.7× your size, with cracking cyan scars, ember eyes and a pose for every attack. Its telegraphs are striped and high-contrast on snow.
  - Sky darkens, horn, thunder; Warden, Ravager and Ender Dragon roars; C418 "Boss" music.
  - Sims (Normal): the wolf wins in 80–91 s, the bear in 104–134 s. Easy 64 s, Scary 112 s.
- **Pacing**: the balanced bot wins the full 6-tier run in about 11–20 min with harmony 55–79. Pond recovers after greedy play.
- **UI**: the title logo, a silhouette food-chain ribbon, rings around the creature, threat arrows that avoid the HUD, and the boss bar kept clear of pause on mobile.
- **Art**: the valley has wind-sculpted drifts and a dark open-water creek with irregular ice edges (tiled maps, about 10 MB). Birds have feathered wings. The grizzly is drawn by the cave bear plan.

## 5. Open items after the boss rework (ask before visual changes)

- The elk and deer depth-layer sprites in the valley look cartoonish and oversized.
- The rebirth card runs to the bottom edge of the screen on desktop.
- The eco view is crowded on mobile near the wolverine and gray wolf labels.
- There's a dark world-edge band at the meadow's left edge, and the world's dark edge shows in some boss shots.
- The boss sometimes spawns under the title card on arrival, and the `stunned` shot framing is off (test only).
- The creek's foam wakes read as beads up close. The creek costs about 8 ms/frame in software raster. Options are one glint layer always, or glints only at high zoom (check with the user first).
- Real-device checks the user hasn't done: Firefox, Windows, real-GPU fps, and the Google Sites embed size.

## 6. Known gaps and gotchas

- **Unchecked**: Firefox (it won't launch inside the Bash sandbox, and running outside was denied; the user can run `node tools/windows-check.mjs`), real Windows, real-GPU fps, and the Google Sites embed size limit.
- **Browser pane**: when hidden it auto-pauses, reports a 0×0 canvas and runs slowly. Use headless scripts for checks. Stale CSS caused bugs before `tools/serve.py`; if the user reports something unstyled, ask them to reload.
- **Sim targets** in `check.mjs` follow M1.5 (tiers 110–170 s). With Normal's ×1.25 growth, the bot clears some tiers faster. Humans are slower; wait for playtest feedback before retuning.
- **Pond/final hold**: by design nothing can eat you during the hold, except the boss.
- **Frozen-time screenshots** keep old particles (for example a ready-ping ring); that's a test artifact.
- **Later milestones**: M3 Sky + Sea paths (marsh, river and beyond; Pond's `next` lists only the meadow until then), M4 creature editor + parts, M5 polish.
