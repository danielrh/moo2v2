# MOO2v2 Master Plan & Checklist

This file is the canonical, resumable to-do list for the project. Any developer (or AI model,
on any machine) should be able to continue the work from this file plus the repo. Keep it
current: check items off as they land, and record deviations in place.

Requirements source: `prompt.md`. Mechanics source: `mechanics/` (keep its safe-terminology
names: Ecology, Energized/Hostile climates, Stellar Safety Shield, etc.). All art and prose in
this project are original — procedural sprites, our own descriptions. Never import assets or
text from the original game.

## What we are building

A browser 4X game with Master of Orion 2's rules and mechanics (economy, tech tree, race
picks, colonies, ships) — **except combat and the Creative trait, which are redesigned** — in
100% TypeScript:

- **P2P multiplayer** over [lobbylink](https://github.com/danielrh/lobbylink) WebRTC. The room
  creator (lobbylink `selfId 0`) is the **permanent host** (sequencer). Public signaling server:
  `https://pqrstuvw.xyz/lobbylink` (its allowlist already includes `http://localhost:5173` for
  local vite dev and `danielrh.github.io`).
- **SQLite persistence** (sqlocal + kysely over OPFS in browser; better-sqlite3 in node tests).
  The database records *everything that has happened*: an append-only, host-ordered command log
  plus periodic snapshots. Replaying the log reproduces the exact game state.
- **Spreadsheet-first UI**: a system-wide editable grid of all colonies is the primary screen;
  turns are simultaneous (WEGO) and advance when all players commit.
- **Point-to-point FTL**: ships travel star-to-star within fuel range; no per-system gates
  (except actual gate technologies).
- **One-pass visual combat**: automatic battle where the attacker makes a single pass through
  long/medium/short range bands; sprites + effects; pre-battle orders only (stance, targeting,
  retreat threshold); 2 players per battle; full playback under a minute and skippable.
  Balanced so equal-tech fleets take partial (20–40%) damage per pass, not devastation.
- **Optional modes**: (a) *creative-variant* — Creative races don't get all field applications
  free; they may research each application individually, paying each item's RP cost, min 1 turn
  each; (b) *pick bidding* — sealed-bid auctions (commit–reveal) for contested race picks, paid
  in pick points; winner pays their bid as the pick's cost, losers can't take it; (c) *sticky
  build progress* — switching build items keeps invested progress on the old item instead of
  transferring points.
- **No NPC empires.** Scripted bots exist only for headless testing.

## Architecture (decision register)

1. **Event-sourced deterministic lockstep.** A game = static-data version + settings + seed +
   host-ordered command log. The host assigns a gapless global `seq` to every command
   (including its own) and broadcasts; every peer folds commands identically.
   `replay(log) == state`, always.
2. **System commands live in the same log** under `playerId −1`: `game_start`,
   `auction_result`, `advance_turn`, `battle_orders_final`, `resolve_combat`, `seat_change`.
   Replay is a pure fold — no out-of-band state transitions.
3. **Determinism rules** (load-bearing invariant):
   - Engine is integer-only. Fixed-point 1/256 units in combat; exact integer `isqrt`.
   - Banned in `src/engine`: `Math.random`, `Math.sin/cos/tan/atan2/pow/exp/log`, `Date`,
     `performance`, float-valued sim quantities. Enforced by ESLint + `scripts/check-boundaries.mjs`.
   - PRNG: sfc32, with derived per-turn/per-subsystem streams.
   - Entities get monotonic integer ids; all iteration in id order; canonical JSON
     serialization (sorted keys) + pure-TS xxhash64 state hash every turn.
4. **Single npm package**, layered `src/` with an import-boundary check:
   `engine` (pure TS, zero runtime deps) ← `protocol` ← `storage`; `ui` may import all;
   nothing imports `ui` or `headless`.
5. **Engine↔UI boundary**: `GameSession` facade (in `protocol`) + `engine/selectors.ts` for all
   displayed math. UI reads immutable state snapshots + a version counter (Svelte 5
   `$state.raw`); optimistic command application is synchronous. The Svelte app is fully
   replaceable; headless bots consume the same selectors.
6. **Storage schema** (kysely): `games`, `game_players`, `commands` (canonical history),
   `snapshots` (gzip, every 10 turns), `turn_hashes`, `turn_events` (report feed),
   `battle_replays`, `chat_messages`, `prefs`, `schema_migrations`. Load = latest snapshot +
   replay tail. Save export/import = JSON envelope (also the manual re-host path).
7. **Net protocol** (JSON envelope over lobbylink `sendReliable` only): `hello/welcome`
   (engine/data/protocol version check), `lobby_update`, `race_config`, auction
   `commit/reveal`, `cmd_submit/accept/reject`, `commit_turn/uncommit/commit_status`,
   `hash_report/desync_notice/resync_request/resync_data` (app-chunked > 8 MiB),
   `chat_send/deliver`. lobbylink already covers membership, reconnect (resume tokens +
   seat claim), reliable ordered delivery ≤ 16 MiB, ICE rebuild — do not reimplement.
8. **Turn pipeline** (WEGO; follows `mechanics/game_mechanics.md` §01 twelve-step order with
   §04 colony order; population growth consumes the previous turn's food surplus):
   S0 freeze orders/derive RNG → S1 population → S2 colony output + empire rollup →
   S3 build advance (sticky mode hook) → S4 research (pre-selected target application;
   creative/uncreative; creative-variant purchases) → S5 spawn/refit/repair →
   S6 fleet movement → S7 encounters (pairwise battles) → **S8 async battle-orders sub-phase**
   (60 s timeout defaults; others read-only) → S9 combat resolve + persist replays →
   S10 bombardment/invasion/blockades → S11 upkeep (spies, leaders, events, Antarans,
   monsters, council) → S12 victory check → S13 end turn (events, hash, snapshot).
   Research target apps are pre-selected when research starts so resolution never prompts.
9. **Pluggable effects**: declarative `Modifier[]` records on data rows for ~80% of
   picks/buildings/techs (integer accumulator: `floor(flat × (100 + pct) / 100)`), plus a
   registry of coded `EffectHandler`s (hooks: colonyOutput, empireUpkeep, combatShipInit,
   combatTick, onBuildComplete, onTechGranted, movement) for true specials. A coverage test
   requires every tech application to map to modifiers, a handler, or an explicit stub —
   the stub ledger is the remaining-work queue.
10. **Combat model**: 2D battlefield 512×384 in 1/256 fixed-point; 10 logical ticks/s,
    400-tick cap. Range bands short/medium/long (≤ 96/224/448 units): damage ×100/70/40%,
    to-hit +10/0/−20. Attacker enters at x=0 drifting +x; defender deployed near x=384 with
    starbase/planet behind. Orders per design-group: stance ∈ charge / hold_range / standoff /
    evade_retreat, target priority, fleet retreat threshold. The pass ends when attackers cross
    the defender line, a side is destroyed/retreats, or the tick cap hits; survivors remain
    in-system (sieges take multiple turns by design). A single `COMBAT_PACE` scalar is tuned by
    the balance harness. **Replay = {initial combat state, orders, seed}**; the viewer re-runs
    the same sim and interpolates to 60 fps (pixi.js), with play/2×/4×/skip.
11. **Formula gaps** (marked 🔍 below): the mechanics docs omit some MOO2 arithmetic (growth
    curve, morale table, pollution, buy-cost, tax slider, component space/cost tables,
    miniaturization, map-gen odds, spy formula, leader magnitudes, council rules, Antaran
    cadence). Source each from community references (MOO2 Book / strategy wiki / 1.50 parameter
    docs) in the phase that consumes it. Where sources conflict: decide, document in
    `src/engine/data/README.md`, lock with a golden test.

## How to run (once scaffolded)

```bash
npm install
npm run dev                 # vite on http://localhost:5173 (COOP/COEP headers enabled)
scripts/run-lobby-server.sh # local Go signaling server on http://127.0.0.1:8787
npm test                    # boundaries + data + unit + protocol + storage (fast)
npm run test:game           # headless full-game bot suites
npm run test:e2e            # Playwright: 2 real browsers + local lobbylink + real WebRTC
```

Local play: two browser profiles/tabs → both open http://localhost:5173 → create/join the same
room code (server field: local `http://127.0.0.1:8787` or default public server).

---

## Phased checklist

### Phase 0 — Scaffold ✅ when: dev serves app; `npm test` green; local lobby server handshake OK

- [x] PLAN.md written to repo (this file)
- [x] package.json + tsconfig (strict) + vite + Svelte 5 + path aliases (@engine/@protocol/@storage/@ui)
- [x] COOP/COEP headers in vite dev + preview (needed by sqlocal/OPFS) — verified `crossOriginIsolated === true` in e2e smoke
- [x] Vendor lobbylink TS client → `vendor/lobbylink/` (commit in SOURCE_COMMIT; provenance README + `scripts/update-lobbylink.sh`)
- [x] Directory skeleton (`src/engine|protocol|storage|ui|headless`, `tests/`, `e2e/`)
- [x] `scripts/check-boundaries.mjs` (imports + banned APIs) wired into `npm test`
- [x] Engine determinism bans enforced by check-boundaries.mjs (deviation: no separate ESLint — the script covers both layering and banned APIs; add ESLint later only if needed)
- [x] Dev deps installed: vitest, @playwright/test, better-sqlite3, typescript, svelte-check (sql.js deferred to the fallback-dialect task)
- [x] Runtime deps: svelte, pixi.js, sqlocal, kysely
- [x] `scripts/run-lobby-server.sh` (go run, port 8787, origins for 5173/4173) — verified healthz + config.json
- [x] Playwright config (system Chrome channel, --no-sandbox --disable-dev-shm-usage, serial) + passing smoke test

### Phase 1 — Data foundations + SQLite (prompt item 1) ✅ when: data suite cross-checks all counts/costs vs mechanics docs; a command log written+replayed in browser (OPFS) AND node; hash goldens stable node+chromium

- [ ] `src/engine/data/`: picks + governments (from game_mechanics §02), buildings (§04 table),
      tech fields (82, linked-list integrity), techs (~180), tech applications with effect
      metadata scaffold (~190 from tech/technology_effects.md), hulls, weapons + weapon mods
      (§06), command points/ranges, races (13 stock), leaders (roster; magnitudes 🔍 Phase 6),
      monsters, antarans, planet specials, climates/sizes/minerals/gravity constants
- [ ] 🔍 Non-weapon component tables (armor/shields/computers/drives/specials space+cost by hull size) — source + transcribe
- [ ] Data bug resolutions documented in `src/engine/data/README.md` (tech_id 24 duplicate, tech_id 0 placeholders, duplicate "Starlight Projector")
- [ ] `rng.ts` (sfc32 + stream derivation), `isqrt.ts`, `hash.ts` (xxhash64), `canonical.ts` (sorted-key JSON bytes)
- [ ] `DATA_VERSION` = runtime hash of canonical tables
- [ ] Kysely schema + migrations; `createDatabase(env)` factory: sqlocal (browser) / better-sqlite3 (node); sql.js fallback stub acceptable until Phase 8
- [ ] Repositories: appendCommands/readLog/snapshots/turnHashes/turnEvents/battleReplays/chat/prefs
- [ ] Save export/import JSON envelope
- [ ] Data validation test suite (counts, costs, linked-list, cross-file consistency)
- [ ] Browser OPFS smoke (Playwright): open dev route, write+read+replay a log via sqlocal

### Phase 2 — Multiplayer core (prompt item 2) ✅ when: two real browsers via local lobbylink advance a stub game in lockstep with hash checks; tab reload resumes via resume-token + resync

- [ ] `protocol/transport.ts`: NetTransport interface; `lobbylinkTransport.ts` adapter; `memoryTransport.ts` fake
- [ ] Host sequencer (gapless seq, host self-submit) + client apply loop
- [ ] `hello`/`welcome`/version-reject handshake
- [ ] `cmd_submit/accept/reject` + optimistic apply/rollback in `GameSession`
- [ ] `commit_turn`/`uncommit_turn`/`commit_status`; `advance_turn` as system command over a stub sim (counter + hash)
- [ ] `hash_report`/`desync_notice`/`resync_request`/`resync_data` (gzip snapshot + command tail; chunk > 8 MiB)
- [ ] Chat send/deliver + persistence
- [ ] Reconnect/rejoin/seat-claim handling; host-pause UX stub ("waiting for host")
- [ ] Protocol vitest suite over memory transport (sequencing, rollback, resync, rejoin)
- [ ] Playwright e2e smoke: create/join/advance/reload with real WebRTC through local Go server

### Phase 3 — Simulation core (prompt item 3) ✅ when: 2-bot 50-turn determinism (replay==live hash); 20-turn economy golden; node-vs-browser hash parity; 2 humans can play an economy-only game

- [ ] Galaxy generation from seed (🔍 star-class/planet distribution odds; homeworld setup)
- [ ] GameState types + canonical serialize/deserialize + hash integration
- [ ] Command set: set_jobs, set_build_queue, buy_production, rename_colony, set_tax_rate,
      set_research, queue_extra_research, create_design/obsolete_design, move_ships,
      set_fleet_policy, colonize, build_outpost, scrap_ship, board_transports, commit metadata,
      debug commands (flag-gated, logged)
- [ ] Pipeline S0–S6 + S11-lite (event buffer) + S13
- [ ] Colony economy per §04 order: jobs → gravity/climate → raw output → picks → buildings/
      leaders → government/morale → pollution/cleanup → net; empire rollup (tax, trade goods,
      freighters, maintenance, CP overage, deficits)
      (🔍 growth curve, 🔍 morale table, 🔍 pollution arithmetic, 🔍 tax slider, 🔍 buy-cost curve, 🔍 freighter/food rules)
- [ ] Research S4: field progression, pre-selected target app, creative (vanilla = all apps),
      uncreative (seeded random app), **creative-variant mode**, hyper-advanced repeatables
- [ ] **Sticky-build mode** semantics in S3 + queue commands; production overflow; buyout
- [ ] Colonization/outposts; point-to-point FTL with fuel range; command points; maintenance
- [ ] `selectors.ts` for every number the UI shows (income, ETAs, turns-to-build, ranges)
- [ ] Headless bot driver + expander/techer policies (`src/headless`)
- [ ] UI v1: colonies spreadsheet (columns, inline jobs/build editing, commit bar), galaxy map
      (pan/zoom/move orders), research screen, minimal empire screen
- [ ] Determinism suites: fuzz replay, snapshot-restore equivalence, node-vs-browser parity

### Phase 4 — Combat (prompt item 4) ✅ when: battle fixtures golden-locked; 20–40% equal-tech damage envelope passes; e2e battle renders and skips in 2 browsers; multi-turn sieges work headless

- [ ] 🔍 Miniaturization curve + any remaining component data for the designer
- [ ] Design → combat stats via effects registry (combatShipInit)
- [ ] Tick sim: stance movement, bands, to-hit/damage pipeline (§07 order), shields
      absorb/regen, armor, structure, crippled (<⅓ structure), missiles/torpedoes/fighters as
      targetable projectiles, point defense, retreat, one-pass termination, outcome application
- [ ] S7 encounter detection (pairwise ordering; 3+ empires queue across turns)
- [ ] S8 battle-orders protocol (orders dialog, 60 s host timeout → default orders, battle_orders_final, resolve_combat)
- [ ] S9 outcomes + replay persistence; S10 bombardment/invasion/ground combat/blockades
- [ ] Ship designer UI; fleets sheet; pre-battle orders dialog
- [ ] Pixi battle viewer: interpolation, beams/missiles/explosions VFX, band rings, controls (play/2×/4×/skip)
- [ ] Procedural sprite generation (hull silhouettes by size class, empire colors)
- [ ] Balance harness (archetype fleets × tech tiers × stances × seeds → damage envelope CSV) + COMBAT_PACE tuning

### Phase 5 — Pluggable subsystems (prompt item 5) ✅ when: coverage test shows every tech application implemented or explicitly stubbed; earlier goldens unchanged except intended diffs

- [ ] Modifier interpreter + ModAccumulator (documented integer stacking)
- [ ] Migrate Phase-3 hardcoded economy modifiers to declarative data
- [ ] Handlers batch 1 — economy/building specials (cloning, terraforming chain, gravity generators, trade/morale buildings, replicators…)
- [ ] Handlers batch 2 — combat specials (cloak, damper field, tractor, assault shuttles, teleporter, stellar converter, reflection field…)
- [ ] Handlers batch 3 — movement/scan/misc (gates, wormholes, scanners/stealth, telepathic, transdimensional)
- [ ] All race picks from racepicks.md wired end-to-end
- [ ] Effects coverage test + stub ledger

### Phase 6 — Full game systems ✅ when: headless 4-player 200-turn game exercises everything with stable hashes; each victory condition reachable in a scripted fixture

- [ ] Leaders: hire/assign/level (🔍 skill magnitudes, costs, spawn frequency)
- [ ] Espionage (🔍 success/detection formula), sabotage/steal outcomes as turn events
- [ ] Diplomacy: proposals/treaties/trade/research pacts/tech exchange/surrender; human-to-human only
- [ ] Galactic Council (🔍 vote timing/weights/thresholds) + diplomatic victory
- [ ] Random events (option-gated); monsters roaming + guarded systems; Orion + Guardian
- [ ] Antarans (🔍 attack cadence/scaling) + Antaran-conquest victory path
- [ ] Victory/loss: conquest, council, Antaran, concession, optional score/time; endscreen

### Phase 7 — UI completion + modes polish ✅ when: full game start→victory by 2 humans, spreadsheet-first; auction e2e passes; all screens keyboard-navigable

- [ ] Spreadsheet v2: multi-select bulk ops, named build templates, filters, sortable columns, totals footer, drag-paint jobs, dirty/ack indicators
- [ ] Lobby/setup polish: full race picker with budget validation; sealed-bid auction UI (commit → reveal → results → losers re-pick); mode toggles with help text
- [ ] Map v2: fuel-range shading, fog/intel states, blockade badges
- [ ] Reports timeline (turn_events, filters), replay list (rewatch battles)
- [ ] Diplomacy screen + chat dock (all + DM tabs)
- [ ] Empire screen (tax slider, leaders, spies); saves manager (export/import); help/glossary
- [ ] Creative-variant purchase UI; sticky-build progress indicators

### Phase 8 — Hardening + performance ✅ when: 500-turn fuzz soak clean; desync drill recovers via resync; 8-player ~70-star turn < 2 s; snapshot < 8 MiB gzip; e2e matrix green twice consecutively

- [ ] Desync drills (inject corruption → auto-resync UX)
- [ ] Host-loss pause/resume drill; seat replacement (claimAfterMs) e2e; re-host from exported save
- [ ] Selector memoization; spreadsheet virtualization audit; snapshot size budget test
- [ ] Error surfaces: version-reject, OPFS-unavailable fallback (sql.js in-memory + export banner), transport-loss states
- [ ] sql.js kysely dialect (if not done earlier)

### Phase 9 — Deploy + handoff ✅ when: playable at public URL between two machines via pqrstuvw.xyz/lobbylink; a fresh dev/VM can resume from the repo alone

- [ ] Static production build (base path config); coi-serviceworker (or equivalent) for OPFS cross-origin isolation on static hosts
- [ ] Default server pqrstuvw.xyz/lobbylink + custom-server field
- [ ] README: setup, local lobby server, test suites, architecture map
- [ ] `src/engine/data/README.md`: formula decisions + remaining 🔍 log
- [ ] Final PLAN.md status sync

## Verification

- Phase gates above; `npm test` must stay green throughout (vitest maxWorkers ≤ 2; e2e serial — sandbox has 2 CPUs).
- Determinism invariants: replay-from-log == live hash; node == browser hash sequences; snapshot-restore == continuous run.
- Human check per milestone: `npm run dev` + `scripts/run-lobby-server.sh`, two browser profiles, play.

## Risk notes

- OPFS needs cross-origin isolation → COOP/COEP dev headers now; service-worker shim for static hosting; per-game DB filenames (OPFS handles are exclusive per file).
- lobbylink reliable cap 16 MiB → gzip snapshots + app-chunk > 8 MiB + size budget test.
- Playwright + WebRTC in sandbox → proven earliest (Phase 2 smoke); system Chrome `channel:'chrome'` + `--no-sandbox`.
- Host trust: commit–reveal for sealed bids; malicious-host reordering accepted for friendly play (documented); full logs on every peer enable evidence + re-hosting.
- lobbylink upstream: no changes required (vendored client covers membership/reliability/reconnect). If a genuine need appears, patch upstream generically — never game-specific.
