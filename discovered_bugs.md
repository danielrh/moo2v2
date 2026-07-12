# Discovered Bugs — MOO2v2 (golden list)

Updated **2026-07-12 (fix pass)** by the bugfinder robot. The 39-finding audit list
published earlier today has been worked through: **every numbered finding is fixed**
(or, where the right fix was a decision, decided and documented). The full unit +
protocol + storage suites pass (439 passed / 2 skipped, including 30 new regression
locks in `tests/unit/bugfixes20260712.test.ts` and `tests/protocol/aheadclient.test.ts`),
`tsc --noEmit` and `svelte-check` are clean. ENGINE_VERSION stays 0.10.0 (same
unreleased version, per its changelog comment); older saves load snapshot-first.

**New behavior implemented with this pass (user spec):** retreat/fuel-range rules —
a ship that arrives at a star beyond its fuel range fights any battle there first,
then automatically retreats to the nearest own colony; losing a colony/outpost that
anchored a ship's range triggers the same auto-retreat at that turn's end
(`pipeline.ts` s10_strandedRetreat, `ship_stranded_retreat` event); battle retreats
always fall back to the genuinely nearest own colony — unless the ship is already at
one of its own colony stars, in which case it stays (`battles.ts retreatDestination`).
Stranded ships that DO get manual orders may only move back toward the supply
network (`commands.ts validateMove`).

---

## Open items (not bugs — decisions and documented caveats)

### A. Fast-phase caveats (async-until-contact)
- Pre-contact battles are NPC-only by construction and are auto-resolved with
  `DEFAULT_ORDERS` by the fast pump — a player attacking a monster lair gets no
  battle-orders dialog until first contact. Inherent to the mode; surface it in the
  lobby help if players are confused.
- With `randomEvents` on, the victim POOL for each turn's event spans all empires,
  so one empire's elimination pre-contact shifts everyone's event outcomes (a
  preview-divergence coupling; mode-gated, off by default). Event *effects* and
  *visibility* are now correctly scoped to the victim. Antaran raids, the council,
  espionage, and the leader market are now contact-gated, so this pool is the last
  remaining pre-contact coupling.
- Two empires that each hired the same leader before ANY contact both keep them
  (the pre-contact market is per-empire by design; skills are per-empire and this
  is harmless). Post-contact the market is global again.

### B. Data decisions (documented in `src/engine/data/README.md`)
- `spatial_compressor` is Antaran-only (`mechanics/unresearchable.md`) and
  `stellar_converter` is the planet-destroyer split from the starlight-projector
  name collision: both have combat behavior but deliberately no application row, so
  players cannot research or mount them. Revisit only as a content decision.
- The effect ledger (`effectsMap.ts`) still carries ~45 `stub:` entries for
  Phase-6 content (ground-combat gear, movement/comm/scan techs, governments,
  hyper-advanced grants, telepathic/omniscient/stealthy_ships picks). These are
  researchable-but-inert by design until their phases land; the ledger itself was
  corrected this pass (fighter bays, repulsive, pulsar/plasma web/gyro destabilizer
  are implemented and now marked so).

### C. Corrections to the earlier audit
- Old finding #36's second half (rngFor label-join ambiguity) was a **false
  finding**: the separator is a NUL byte (`'\0'`), which the audit tooling rendered
  as a space. Labels cannot realistically contain NUL; no change needed. The
  locale-dependent `knownWeapons` sort (the finding's first half) was real and is
  fixed (charcode compare).

---

## Fixed ledger — 2026-07-12 pass (39/39)

| # | Finding | Fix (main site) |
|---|---|---|
| 1 | `diplo_propose` rider-field hash poison (P0) | validator types riders for every kind; applier stores them kind-gated (`commands.ts`) |
| 2 | Ahead-of-host client never detected → permanent freeze / log grafting (P1) | hello compares `haveSeq` both ways + unstarted-room stale-record reset (`host.ts onHello`); hash-report fork tripwire (`onHashReport`); welcome `gameId` mismatch → session hard reset + full refold (`session.ts`); stale room rows abandoned (`ensureGameRow`) |
| 3 | Broadcast-before-persist crash window (P1) | ordered outbox: host session ingests first, `persistBarrier` (wired to `session.flush()`) completes before remotes see turn-advancing commands (`host.ts drainOutbox`, `setup.ts`) |
| 4 | `save_design` accepted base hulls (P1) | `validateSaveDesign` requires `availableHulls` membership |
| 5 | Guardian's death_ray broke every base auto-design (P1) | `baseDesign` fits weapon counts to hull space, falls through to next-best; `baseToCombat` bolt-ons fitted too |
| 6 | Espionage vs never-met empires, no contact trip (P1) | `validateSpyOrders` requires met; stale orders cleared in `resolveEspionage`; caught spies create a relations entry (contact); contact helpers moved to leaf `contact.ts` |
| 7 | Leader market coupled empires pre-contact (P2) | offer pools/expiry/hire validation per-empire until `anyEmpireContact` (`leaders.ts`, `commands.ts`) |
| 8 | Council convened among strangers (P2) | convening waits for contact (date slides +5); votes for unmet candidates rejected (`diplomacy.ts`, `commands.ts`) |
| 9 | Antaran raid targeting coupled pre-contact (P2) | raids defer (+5) until first contact; solo games unaffected (`npc.ts`) |
| 10 | Invasion losses couldn't hit 1-unit groups (P2) | kill loop takes whole units down to group extinction (colony still keeps 1 total); events report applied deaths (`ground.ts`) |
| 11 | Multi-race last-colonist cull (P2) | colony survives on ≥1000K TOTAL popK (`pipeline.ts` s1) |
| 12 | Orion could cut the hop graph (~3% of maps, also monster-free) (P2) | Orion candidates walked farthest-first through `monsterPlacementOk` (`npc.ts`) |
| 13 | Formation ground into corners (P2) | shared `backAwayFrom` helper with corner punch-out for standoff AND formation (`combat.ts`) |
| 14 | Threshold retreat saved 0/34 ships (P2) | `RETREAT_WARP_TICKS` disengage countdown (warp out where you stand); standoff stands and fights when it cannot outrun the pursuer (`combat.ts`) |
| 15 | Stranded-ship fuel guard was dead code (P2) | `validateMove` rewritten: in-range origins need in-range destinations; stranded origins only move strictly nearer the network |
| 16 | Duplicate colony_base/gaia burned production (P2) | `canQueue` projects queued entries; completions into nothing refund (`items.ts`, `pipeline.ts`) |
| 17 | bigStart starved from turn 1 (P2) | farmers only where viable + advancedStart-style food balancing + covering freighter pool (`adapter.ts bigEmpireStart`) |
| 18 | `visibleTo:-1` leaks pre-contact intel (P2) | NPC battle summaries → participants; monster_slain/guardian_defeated → victor; antaran raid/withdraw/raze → target; random events → victim (`battles.ts`, `npc.ts`). PvP battles, council, victory stay galactic news by design |
| 19 | Guided-munition impacts invisible (P3) | viewer draws arrival: shield fizzle, hull flash, kill highlight, and a distinct evade pop for misses (`BattleViewer.svelte`) |
| 20 | Dissipater-pinned retreaters ground the wall (P3) | pinned sides never flip to evade; pinned evade orders fight like hold (`combat.ts`) |
| 21 | Pre-warp bases were weaponless phantoms (P3) | empty-arsenal `baseDesign` falls back to the starter-kit laser |
| 22 | colony_base founding skipped debris salvage (P3) | shared `applyFoundingSpecials` used by every founding path (colonize, colony_base, advanced/big starts) |
| 23 | stellar_converter/spatial_compressor unmountable (P3) | documented as deliberate data decisions (`data/README.md`; see Open items B) |
| 24 | obsolete_design left refit queue items (P3) | refits toward the obsoleted design stripped too (`commands.ts`) |
| 25 | Natives / Splinter Colony never generated (P3) | generated (`galaxy.ts rollSpecial`, natives climate-gated) and implemented: natives are a farm-only `NATIVE_RACE` group with neutral traits that never leaves (jobs/moves/transport rules); splinter adds +3 owner pop at founding; both clamp to max pop |
| 26 | Bridge stars rarely violated MIN_STAR_DIST (P3) | wider candidate search + max-clearance fallback; mirror copies use MIN_STAR_DIST (`galaxy.ts`) |
| 27 | Loknar hireable without killing the Guardian (P3) | excluded from ordinary offer pools (`leaders.ts`) |
| 28 | Spies stole synthetic hyper_advanced markers (P3) | stealables filtered to real application ids (`espionage.ts`) |
| 29 | Known extra-research head burned its cost (P3) | known heads dropped without RP; the turn's RP banks (`research.ts`; purchases at listed price is intentional under the discovery-line model) |
| 30 | Colony leaders granted fleet combat speed (P3) | tactics filtered to ship officers like every other combat skill (`leaders.ts`) |
| 31 | Surrender left the dead court's leader offers (P3) | scrubbed in `executeSurrender` (`diplomacy.ts`) |
| 32 | event_boom overfilled colonies (P3) | boom respects `colonyMaxPop`; event visibility scoped (victim pool coupling documented as caveat A) (`npc.ts`) |
| 33 | Antaran armor damage reset between fights (P3) | `MonsterUnit.dmgArmor` persists (optional field, save-compatible) (`npc.ts`, `battles.ts`) |
| 34 | Debug numeric payloads unchecked (P3) | per-kind bounds in `validateDebug` (`commands.ts`) |
| 35 | MemoryGameStore rejected reissued seqs (P3) | last-writer-wins upsert mirroring the sqlite store (`memory.ts`; pin test updated) |
| 36 | Locale-dependent `knownWeapons` sort (P3) | charcode compare (`shipdesign.ts`); rngFor half was a false finding (see C) |
| 37 | `retract()` dead code with broken fast semantics (P3) | removed; replaced by a comment explaining why un-submit needs a host-side message first (`session.ts`) |
| 38 | Pre-warp starting star base spec/code drift (P3) | fixed by the user's `9a2ff75` (star base pre-built in every non-advanced mode) |
| 39 | "pre-built starter frigate" comment drift (P4) | comment now says the frigate DESIGN is granted, no ship spawned (`adapter.ts`) |

Method note: fixes verified by the regression files named in the header plus the
existing suites (combat/battle/protocol/storage). Anything future audits find goes
back into this file as numbered findings; keep the ledger when pruning them.
