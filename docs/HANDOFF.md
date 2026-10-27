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
- **Minecraft audio** from the user's Prism Launcher install is planned (M2). It's private use only: keep any build with those sounds off public hosting.
- **Installing test tooling is pre-approved** (Playwright browsers etc.).
- **User's general rules** are in `~/.claude/CLAUDE.md`: lead with outcomes, run real checks before saying done, follow the frontend rules (avoid list, screenshot-critique passes), and stick to the game rules (one-key restart, no soft-locks).

## 2. Run and check

```
python3 -m http.server 8642          # or open index.html directly (file:// works)
node tools/check.mjs smoke           # 35 steps: modes, combat, abilities, tutorial, mobile, file://; exit 1 on any error
node tools/check.mjs sim --runs 2 --paths shared   # headless balance sims, 3 bots, prints PASS/FAIL per target
node tools/check.mjs shots           # desktop + mobile screenshots of every screen into shots/
node tools/stubcheck.mjs <files> --eval "<js>"     # load scripts in a Node vm with stubbed browser APIs
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
| `js/fx.js` | 2541 | particles, cues, threat arrows, decomposition sequence, evolve transition — **to be partly reworked into the in-world HUD** |
| `js/ui.js` + `css/style.css` | 1220 + ~500 | old box-style HUD and screens — **to be replaced** |
| `tools/check.mjs` | ~950 | smoke / sim / shots harness with a built-in static server |
| `tools/preview-*.html` | — | per-module preview pages (shapes, world, fx, ui) |

**Conventions** (Appendix D):
- Every file is wrapped in `(function(){'use strict'; const A = window.Apex = window.Apex || {}; …})()`.
- No cross-module calls at load time. Guard calls with `A.X && A.X.fn`.
- Gameplay randomness comes from `A.rand()`.
- World/FX draw functions get ctx in screen space; use `A.applyCam` for world space.
- Shapes draw entity-local, facing +x.

## 4. Where it stands (commit `aa91135`)

**Done and verified (smoke 35/35, 0 errors):**
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

**Playtest feedback (2026-10-23), still open:**
1. **UI is "absolutely terrible"**: cluttered corner boxes. It needs the M1.5 UI design system (not started).
2. **No onboarding.** The tutorial logic exists but has **no visuals yet**, because the UI agent was stopped before editing.
3. **Plays way too fast.** The target is about 15 min per full 6-tier run, so about 2–2.5 min per tier.
4. **Pond tier breaks**: harmony crashes, predators stop being a threat, and nobody kills you.

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

1. **UI overhaul (M1.5 "UI design system")**:
   - **Files**: `js/ui.js`, `css/style.css`, the cue and overlay parts of `js/fx.js`, and the fonts plus `js/tutorial.js` script tag in `index.html`. The tag is already present? Check; smoke shows the tutorial running, so it loads.
   - **Must have**:
     - The in-world HUD around the creature: growth ring, HP arc when hurt, hunger dim and pulse, ability orb, bite crescent, damage numbers, edible/danger outlines.
     - The **food-chain ribbon** as the one hero element (food | fight | danger zones with a sliding "you" marker; it unfurls into the evolve cards).
     - Bare score and time, a small harmony dial, and the Tab ecosystem food-web view.
     - Tutorial hint bubbles and highlights from `G.tutorial`, and tips from `G.tip`.
     - Touch Bite/Dash/Ability buttons.
     - Dew-film menus in Bricolage Grotesque + Atkinson Hyperlegible.
     - Visuals for the abilities: spray cone, roll glint, web disc, charge streak, tongue line, decoy, stun stars, anger mark.
   - **Process**: settle the ribbon and in-world rings with 2–3 quick prototypes first (see §6). Then build, take one batched screenshot pass at 1440×900 and 390×844, critique, fix, and repeat (max 5 passes).
   - Keep the old fx particles, decomposition and evolve sequences.
2. **Balance and pond fix**: hit the sim targets above. Diagnose the pond with `?tier=t3_pond&debug=1` plus the sim (hunter counts over time). Then re-run smoke.
3. **Windows check**: Playwright Chromium + Firefox at deviceScaleFactor 1, 1.25 and 1.5. Check right-click dash (contextmenu suppressed), font fallback (Segoe UI), and the backdrop-filter fallback. Real Windows can't be confirmed from macOS; say so.
4. **Hand a build to playtesters**: zip the folder (exclude `node_modules`, `shots`, `tools/scratch`); they double-click `index.html`.
5. **Then the milestones in DESIGN.md**:
   - M2: Land path + Minecraft audio + final hold on the valley.
   - M3: Sky + Sea.
   - M4: Spore editor + parts.
   - M5: polish + share.

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
- **Git**: the repo has commits `1db6372` (M1 + combat) and `aa91135` (working rule). Commit after each verified unit.
