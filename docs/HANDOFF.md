# Apex — handoff

You are picking up **Apex**, a top-down food-chain browser game (Feeding Frenzy × Hungry Shark × Spore cell stage). You start as an ant, eat smaller things, avoid bigger ones, evolve up the chain, and die into the soil to be reborn one tier lower. A real food web pushes back if you over- or under-hunt.

It's a private project for the user, their friends, and a teacher, on a one-week timeline that started 2026-10-22. The player-facing goal: a full 6-tier run takes about 15 minutes, works on desktop and touch, and runs in Windows browsers.

Read this file first, then `docs/DESIGN.md`. DESIGN.md is the full spec: Appendix A is the design, B is the module contract, C is the content, D holds the binding clarifications, and **M1.5 — Rework** is the current, binding direction. Where they disagree, M1.5 wins.

---

## 1. How the user wants you to work

- **Run these skills first.** Before any game work session: `principle-experience-first` and `principle-sequence-verifiable-units`. Before any UI work: also `frontend-design:frontend-design` and `exhaust-the-design-space`. All are installed in ~/.claude/skills or as plugins.
- **No subagent swarms and no Workflow runs.** You may spawn a subagent when it genuinely helps, without announcing it. Never fan out many at once.
  - History: the M1 build used 9–15 parallel agents. The user called it "infinite subagent hell", hit session limits, and lost trust.
- **Ask before visual or game-design decisions.** Even when the user says "full send", ask 2–4 short questions with the question tool, offering concrete options. The user corrected this explicitly.
- **Watch usage.** Prefer small, verified steps over big speculative rewrites.
- **Batch screenshots in one browser session.** Each headless Chromium launch flashes a Claude-logo icon in the macOS Dock. A screenshot loop across agents alarmed the user. Use one Playwright script that takes many shots, not `tools/shot.mjs` in a loop.
- **Minecraft audio** is in every build, including the one the user puts on Google Sites for the teacher. The user decided the site is private enough; the sounds are Mojang's, so don't put a build on open public hosting without asking.
- **Installing test tooling is pre-approved** (Playwright browsers etc.).
- **User's general rules** are in `~/.claude/CLAUDE.md`: lead with outcomes, run real checks before saying done, follow the frontend rules (avoid list, screenshot-critique passes), and stick to the game rules (one-key restart, no soft-locks).

## 2. Run and check

```
python3 -m http.server 8642          # or open index.html directly (file:// works)
node tools/check.mjs smoke           # 35 steps: modes, combat, abilities, tutorial, mobile, file://; exit 1 on any error
node tools/check.mjs sim --runs 2 --paths shared   # headless balance sims, 3 bots, prints PASS/FAIL per target
node tools/check.mjs shots           # desktop + mobile screenshots of every screen into shots/
node tools/ui-shots.mjs <round> [names] [--desktop|--mobile]   # the UI critique pass: every screen and HUD state
                                     # (busy combat, eco view, tutorial, intro, evolve, death, final hold) at
                                     # 1440x900 + 390x844, one browser launch, into shots/ui/r<round>/
python3 tools/pair.py shots/ui/r<round> <outDir>   # desktop|mobile side-by-side pairs, cheap to review
node tools/ring-check.mjs [outDir]   # close-ups of the player's rings frozen in states (cooling, ready, active,
                                     # hurt + hungry), ant and frog, desktop + mobile
node tools/stubcheck.mjs <files> --eval "<js>"     # load scripts in a Node vm with stubbed browser APIs
node tools/build-single.mjs          # dist/apex.html: the whole game in one file (playtesters, Google Sites)
node tools/windows-check.mjs         # dist/apex.html in Chromium + Firefox at DPR 1/1.25/1.5: errors, right-click dash,
                                     # context menu blocked, Segoe UI fallback; shots in shots/win/
node tools/scratch/sweep.mjs '<json configs>' [bots] [seeds]   # balance sweeps with in-page overrides (scratch, gitignored)
```

- **URL flags**: `?tier=t1_litter|t2_under|t3_pond`, `&sp=ant`, `&autoplay=1`, `&bot=balanced|greedy|passive`, `&seed=1`, `&speed=2`, `&debug=1` (fps + populations), `&skipEditor=1`, `&mute=1`, `&tutorial=0|1`.
- **In-page debug API**: `Apex.debug.{setTier, killPlayer, fillGrowth, forceMishap(type), win, simulate(sec,{bot,path,seed}), tutorialAdvance}`.
- **Browser pane**: `.claude/launch.json` defines the `apex` server on port 8642.
- **Installed test browsers**: Playwright Chromium. Run `npx playwright install firefox` for Windows-like Firefox checks.

## 3. Code map

Plain HTML + Canvas 2D + DOM, classic scripts sharing `window.Apex` (no build step, no runtime deps). The load order lives in `index.html`. Missing later-milestone files 404 harmlessly; smoke reports them as warnings.

| File | Lines | Owns |
|---|---|---|
| `index.html` | ~45 | canvas, `#ui`, `#editor-root`, fonts, script order, boot |
| `js/config.js` | 290 | `CFG` (all tunables incl. combat), `PARTS`, `SPECIES` (incl. `ability`), `TIERS` t1–t3, `PATHS`, `MISHAP_DEFAULTS`, `validateConfig()` |
| `js/core.js` | 1916 | loop, modes, input, camera, entities, spatial grid, eating, **combat** (hp, bite, carcass, predator damage, regen, abilities), progression, render orchestration, `debug.simulate` |
| `js/eco.js` | 588 | food web: grazing, logistic births, hunter starvation/breeding, harmony, mishaps (famine/boom/disease/barren/surge) |
| `js/ai.js` | 1232 | 17 behaviors, hunter windup→lunge→recover, flinch/flee/angry/decoy reactions, autoplay bots |
| `js/tutorial.js` | 258 | guided first minute in t1 (gameplay side); writes `G.tutorial`, contextual `G.tip` |
| `js/shapes-inverts.js` | 1359 | insect/arachnid/isopod/segmented/plant plans + 20 LOOKS |
| `js/shapes-land.js` | 1005 | quadruped/frog/lizard/serpent plans, `A.VKit` helpers |
| `js/shapes-air-water.js` | 439 | bird/fish plans (needs VKit, loads after land) |
| `js/world.js` | 2024 | World dispatcher, depth layers, biomes litter/undergrowth/pond, harmony grading |
| `js/fx.js` | ~2550 | particles, cues, threat arrows, decomposition sequence, evolve transition, and the **in-world HUD** (`drawOverlay`: growth ring, HP arc, hunger dim, ability arc, armor arcs, state marks, edible/danger outlines, tutorial highlight) |
| `js/ui.js` + `css/style.css` | ~1250 + ~570 | DOM HUD and screens: food-chain ribbon, score/time, harmony dial, Tab eco view, banners, tutorial/tip bubbles, touch thumbs, dew-film menus; publishes `A.UI.hudRects()` |
| `tools/check.mjs` | ~950 | smoke / sim / shots harness with a built-in static server |
| `tools/ui-shots.mjs`, `tools/ring-check.mjs`, `tools/pair.py` | — | UI screenshot passes (see §2) |
| `tools/preview-*.html` | — | per-module preview pages (shapes, world, fx, ui) |

**Conventions** (Appendix D):
- Every file is wrapped in `(function(){'use strict'; const A = window.Apex = window.Apex || {}; …})()`.
- No cross-module calls at load time. Guard calls with `A.X && A.X.fn`.
- Gameplay randomness comes from `A.rand()`.
- World/FX draw functions get ctx in screen space; use `A.applyCam` for world space.
- Shapes draw entity-local, facing +x.

## 4. Where it stands

**Done and verified (smoke 35/35, 0 errors):**
- **M1.5 UI (step 1) is done.** The user judged the current UI "pretty alright"; the playtest complaint was about the old corner boxes, which are gone. In place:
  - **Ribbon** (top centre): this tier's animals sorted by size on a food | fight | danger thread with a sliding "You" marker. Icons are zone-tinted silhouettes (leaf = food, venom = danger, pale = much bigger); only the biggest thing you can eat, anything you can fight, and the next thing up keep their real colours and a ring. It unfurls into the evolve cards.
  - **In-world rings** around the player: leaf growth ring, venom HP arc inside it when hurt, hunger dim + pollen pulse, bone armor arc in front, and the **ability charge as a short pollen arc behind the creature** (grows from its middle, glows + pings when ready, flares while active).
  - Bare score/time top right, harmony dial bottom centre (tap = eco view on touch), Tab eco view ("Who eats whom"), mishap banners and the final-hold panel under the ribbon, tutorial bubbles + highlights, one-time tips (they wait while a mishap banner is up), touch Bite/Dash/Ability thumbs + pause, dew-film menus, ability visuals.
  - Offscreen threat arrows keep off the HUD: ui.js reports HUD boxes via `A.UI.hudRects()` at 10 Hz and fx pulls each arrow inward along its direction until clear.
  - NPC health arcs only show in play/intro, so death and rebirth screens stay clean.
  - Latest critique screenshots: `shots/ui/r6/` (before: `r5/`).
- **M1 slice**: shared tiers t1_litter → t2_under → t3_pond.
  - Pond is temporarily final: full growth starts a 45s "hold the balance" phase, then victory.
  - Core flows: evolve cards, decomposer death → rebirth one tier lower at 40% growth, mishaps, pause, restart, mobile, file://.
- **M1.5 combat**:
  - Health on every animal; bite (left click/Space); carcasses from kills.
  - Predators deal damage instead of instant kill (an apex ≥ 2× still kills fast); flinch and flee when wounded; regen.
  - 6 species abilities on E: ant spray, pillbug roll, spider web, beetle charge, frog tongue, skink tail decoy.
  - Angry neutrals.
  - New controls: Shift/right-click dash, E/Q ability, Tab eco view.
  - Tutorial logic: steps move → eat → grow → bite → danger → ability → harmony, skippable, remembered in `localStorage 'apex.tutorial'`.
  - The combat interface for the UI is in DESIGN.md M1.5 ("Combat" and the UI agent's field list): `hp, maxHp, biteCdT, stunT, slowT, angryT, flinchT, ability{id,cd,cdT,activeT}`, `G.zones`, `sp:'carcass'`/`'decoy'`, and the events `bite, damage, abilityUse, angry, flinch, carcass, tutorialStep`, plus `G.tutorial` and `G.tip`.

**Playtest feedback (2026-10-23):**
1. ~~UI is "absolutely terrible"~~: fixed by the M1.5 UI above.
2. ~~No onboarding~~: the tutorial has its bubbles, highlights and target ring.
3. **Plays way too fast**: partly fixed. growthNeeded 140/300/320, `CARCASS_GROWTH` 0.5, `RG` 0.02, hunters breed after 5 meals up to `HUNTER_BREED_CAP` 1.75×n0. Balanced bot: wins 3/3, tiers 28–160s (target 110–170s, high variance), harmony 57–89. Humans are slower than the bot; wait for the user's playtest before tuning further.
4. **Pond tier**: holds with balanced play, and now recovers after a greedy crash (harmony ~2 back to 55–66 within about 3 min of balanced play; test with `debug.simulate(sec, {tier:'t3_pond', bot:'greedy', botAfter:{t:150, bot:'balanced'}})`). Faster hunter starvation during famine was tried and did not help. Also by design nothing can eat you during the final hold, which playtesters read as "predators stop being a threat".

**Balance findings:** with longer tiers, famine was driven by hunters breeding (beetles/skinks doubling in 20s), not by the player. The balanced bot now skips scarce ('low') species while energy ≥ 35. Sim targets in `check.mjs` follow M1.5; still failing: the 110–170s tier window on some seeds, deaths (0 across seeds), surge in t3.

**Balance baseline after combat (sim, 2 seeds, shared path):**
- **Balanced bot**:
  - Wins in 1:39–3:32 with **0 deaths**.
  - Tier clears take **8–24s**: carcass mass makes growth far too fast.
  - Surge shows up in every run.
  - Pond takes 58–190s.
- **Greedy bot**: never escapes the pond, with harmony 3–4. That's the pond collapse.
- **Passive bot**: dies to dragonflies and weasels and triggers boom/famine.
- **Targets** (M1.5 Pacing):
  - Each tier 110–170s before evolving.
  - Slice 6–8 min.
  - 1–4 deaths across 3 seeds (at least 1).
  - Harmony avg ≥ 55.
  - Surge ≤ 1 per 3 runs.
  - Greedy ≥ 1 famine.
  - Passive boom or disease.
- The tunables are all in `CFG` and `TIERS[*].growthNeeded/drain/roster`. Likely levers:
  - growthNeeded ×3–4
  - carcass growth share (e.g. 40–60% of mass)
  - hunter n0 and breeding (`HUNTER_BREED_FED`, surge threshold)
  - pond hunter starvation (`HUNTER_STARVE`) and prey K
- World density was raised (`WORLD 1200`, `VIEW_R_MULT 26`) and should stay.

## 5. Next steps, in order

Each step ends with smoke passing and a commit.

1. ~~UI overhaul~~: done (see §4). For any later UI change, run `node tools/ui-shots.mjs <round>` before and after, review with `tools/pair.py`, then smoke.
2. **M2 is done (Land path + audio)**:
   - Pond Edge → t4 Spring Meadow → t5 Autumn Forest → t6 Winter Valley (final hold). Seasons, more realistic matte-fur land animals, and the ability mapping are recorded in DESIGN.md "M2 — Land path decisions".
   - Minecraft audio in every build (user's call): `python3 tools/build-audio.py` regenerates `js/sound-data.js` and `js/music-data.js`; `js/audio.js` maps game events to sounds.
   - Builds: `node tools/build-single.mjs` → `dist/apex.html` (3.5 MB, with music); `--no-music` → `dist/apex-lite.html` (1.3 MB) if Google Sites rejects the big one.
   - Balanced bot on the full run: 3/3 wins, 11.5–20 min, harmony 55–79. Angry-neutral nips scale with √depth (depth × 4 killed in a few bumps late on).
   - Known gaps: the valley creek is visual only (no collision); snow drifts read a little like soap bars; the wolf's howl uses the spray icon on the touch button; hawk, meadowlark and grouse look plain when resting.
3. **Playtest round (2026-10-28), done and committed**: hold-R restart, backquote dev menu (jump to any tier), easier tutorial caterpillar, first death per tier forgiven (same tier at 50%), difficulty modes on the title (Easy / Normal / Scary, `CFG.DIFFICULTY`), forest split into golden birch + pine zones with zoned animals (`World.zoneAt`, roster `zone`), neutrals only anger when rammed, bolder spray/musk/howl visuals, ability icons.
4. **Boss (works, tuned; art rejected)**: `js/boss.js`, The Old One (ancient cave bear) crashes into the Winter Valley hold at 15s. Runs with no errors; sims (normal) win in 80-91s as wolf, 104-134s as bear; easy 64s, scary 112s (`node tools/scratch/bossim.mjs`). **The user says the boss looks ugly** (it reads as a giant hamster: the generic quadruped plan with stripes).
   **NEXT, user-requested agent plan (user explicitly asked for these agents; still no swarms beyond this set):**
   - **Opus agent: boss design**, scary and tough. Give the cave bear its own draw plan (for example `A.Shapes.cavebear` in a new `js/shapes-boss.js`, loaded after shapes-land): a massive hunched silhouette with a shoulder hump, a heavy skull, a long snout with visible fangs, thick clawed forelimbs, matted fur edges (jagged outline, not a smooth tube), glowing cyan claw scars that brighten with damage, ember-red eyes, frost on the back, breath steam, and phase-3 enrage (raised hackles, red glow, cracked scars). Animate the gait, the rear-up for slam windups, the lunge pose during charges, the roar (jaws open, head up) and the stagger when stunned, all keyed off `G.boss.state` and the entity. Must read at any zoom on snow. Verify with one batched headless screenshot pass (see the pattern in tools/land-shots.mjs).
   - **Opus agent: title logo**, an extremely tough, nature-based logo for "Apex" that references the whole game: the food chain from ant to wolf and bear (silhouettes climbing the letters, or a chain of species), the four biomes (leaf litter, pond, seasons) and the cave bear boss. Deliver it as an inline SVG or a canvas-drawn mark in ui.js's title (replacing the plain Bricolage wordmark), crisp at 390px and 1440px, keyboard and screen-reader friendly (aria-label "Apex"). Run frontend-design first. Avoid the user's banned defaults (CLAUDE.md).
   - **Sonnet agents (2-3, separate files) to finish the game quickly from a detailed brief**, for example: (a) boss screenshot critique + fixes in boss.js telegraphs/UI only; (b) rebuild `dist/apex.html` + `dist/apex-lite.html` and a final screenshot pass of every screen via `tools/ui-shots.mjs` and `tools/land-shots.mjs`; (c) any remaining HANDOFF known gaps (creek visual-only, soap-bar snow drifts, resting birds). Each brief: exact files, done-means, one browser launch per pass, no smoke runs while the user playtests, no commits to files another agent owns.
   - Boss screenshot pass: `node tools/boss-shots.mjs` (arrival, chargeWind, stunned, slamWind, roarWind, enraged, death, victory; one launch, desktop + mobile). Written but not run yet.
5. **Dev server**: `.claude/launch.json` runs `tools/serve.py` (no-cache headers). The user plays in the browser pane at localhost:8642; stale cached CSS broke the dev menu and the difficulty buttons before this.
6. **Later**: M3 (Sky + Sea), M4 (editor + parts), M5 (polish). Firefox and real Windows are still unchecked.
7. **Windows check**: Chromium passes at DPR 1, 1.25 and 1.5 (`tools/windows-check.mjs`). Firefox is **not checked**: it fails to launch inside the Claude Code Bash sandbox, and running outside the sandbox was denied. The user can run `node tools/windows-check.mjs` in their own terminal. Real Windows (Edge, ClearType, GPU) can't be confirmed from macOS.

## 6. Pstack skills that fit the UI overhaul

The user asked which skills from `cursor/plugins` pstack suit this work style. Installed now: `principle-experience-first` and `principle-sequence-verifiable-units` (added 2026-10-27), plus the earlier `redesign-from-first-principles`, `exhaust-the-design-space`, `prototype`.

**Use these:**

| Skill | Why it fits here |
|---|---|
| `principle-redesign-from-first-principles` (installed) | The playtest verdict is that the old UI is the wrong shape, not the wrong colors. Redesign as if "the creature is the interface" had been an assumption from day one, instead of restyling the corner boxes. |
| `principle-exhaust-the-design-space` / `prototype` (installed) | The ribbon, in-world rings and Tab food-web view have no precedent in the codebase. Build 2–3 throwaway variants behind one switcher, take one batched screenshot, compare, then commit to one. Cheap, and it gives the user something concrete to react to. |
| `principle-subtract-before-you-add` | Delete the old panels before building new ones, so stale styles and DOM can't leak into the new design. |
| `principle-experience-first` | Judge everything by "can a first-time player understand it in 30 seconds", which is exactly the onboarding complaint. |
| `principle-sequence-verifiable-units` | Ship the overhaul in units that each end in a screenshot plus smoke: ribbon → in-world rings → menus → tutorial bubbles → touch → Windows. It matches the usage-aware, no-swarm style. |
| `principle-prove-it-works` | Never call a UI step done without a screenshot critique and a green smoke run. |
| `create-verification-skill` | One-time lever: generate a project-local "verify Apex" skill with a feature map (every mode, debug URL and screen), so each later check stops re-deriving the screenshot script. |
| `unslop` | For tutorial lines, tips, card copy and the title. The user's design rules ban AI-style copy tells. |
| `principle-minimize-reader-load` | Applies twice: a HUD readable at a glance, and keeping `ui.js` simple enough for the next session to read quickly. |

**Maybe:**
- `poteto-mode`, as the entry point for a rigorous session.
- `show-me-your-work`, to log design decisions to a TSV the user can review. It helps rebuild trust after the swarm episode.
- `bro`, for plain-language status updates.

**Avoid here:**
- `swarm`, `arena` and multi-model `interrogate`: parallel fan-outs, which the user has banned.
- `tdd`: UI work isn't test-first, and smoke already covers flows.
- `typescript-best-practices` and `principle-type-system-discipline`: the project is plain JS.
- `principle-migrate-callers-then-delete-legacy-apis`, `principle-make-operations-idempotent`, `why` and `recall`: not relevant to a one-week greenfield game.

## 7. Known issues and gotchas

- **Font loading in headless runs**: Google Fonts may not load in headless sandboxes, so judge typography in the browser pane.
- **Software-rendered perf**: headless Chromium uses software rendering, where creatures and world cost 20–60 ms/frame. Real-GPU fps has **not** been measured yet. Check in the browser pane with `?debug=1`.
- **World auto-quality**: `A.World.autoQuality` may drop quality under slow frames. Set it false for consistent screenshots.
- **Sick tint applied twice**: sick creatures are tinted by both the shapes and fx. Drop fx's blob and keep its bubbles.
- **Mobile intro card**: on mobile it covers the player. The M1.5 spec moves it to a compact top banner.
- **Parallel-build leftovers**: the role field in config has both short and long forms (core maps them), and the player's role is `'player'`.
- **Browser pane**: when the in-app browser pane is hidden it runs as a background page. The canvas reports 0×0, the game auto-pauses and runs very slowly, so don't judge visuals or timing there. Use the headless scripts in §2 instead (one browser launch each).
- **Frozen-time screenshots**: `ring-check.mjs` freezes time with `G.timeScale`, so particles freeze too. A yellow ring left over from the "ability ready" ping can show in later states; it's a test artifact.
- **Git**: no remote; work commits straight to `master`. Commit after each verified unit.
