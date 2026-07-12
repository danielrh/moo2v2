# Discovered Bugs — MOO2v2 (golden list)

Updated **2026-07-12** by the bugfinder robot. Method: full re-validation of every finding
from the 2026-07-10 sweep against the current tree (each referenced code path re-read end to
end; most verdicts additionally pinned with throwaway vitest probes against the real engine),
plus a fresh focused audit of the named risk areas: the savegame system, combat resolution
and retreat behavior, the fast-start (async-until-contact) transition, determinism and RNG
labels, entity ids, multiple same-turn battles, and every subsystem that has had a previous
critical bug (id fences, battle outcome application, bombardment). The full unit + protocol +
storage suites pass on this tree (399 passed / 2 skipped).

**Housekeeping from the 2026-07-10 list.** The top "CRITICAL improvements" section is done
(label-derived RNG streams via `rngFor` and per-turn `hash_report`/`desync_notice` are both
implemented) and 43 findings were verified FIXED in the current code and removed to keep this
list golden: 1, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 16, 17, 18, 19, 20, 22, 23, 25, 27, 29,
31, 32, 34, 38, 39, 41, 42, 43, 45, 46, 48, 49, 50, 52, 53, 54, 58, 59, 60, 61, 62. Seven old
findings survive in reduced form and are carried below with their residue: 11 → #12, 15 → #11,
24 → #15, 26 → #25, 37 → #19, 51 → #26, 56 → #3.

**How to read.** Each item has a location, the mechanism, a concrete in-game failure, and a
status tag: **[VERIFIED]** — reproduced by executing the code (scratch test or headless run);
**[CODE]** — confirmed by reading the code paths end to end, not separately executed.
Severity: **P0** game-breaking (crash / save corruption / desync / soft-lock), **P1** major
playability or wrong core logic, **P2** balance / correctness, **P3** cosmetic / minor / doc.

---

## P0 — Game-breaking

### 1. `diplo_propose` stores unchecked `giveBc`/`giveApp`/`wantApp` for non-gift kinds — one malformed proposal permanently corrupts every peer's state  [VERIFIED]
`src/engine/commands.ts` — `validatePropose` (~:777) vs `applyPropose` (~:810-822)

`validatePropose` type-checks `giveBc` only inside the `kind === 'gift_bc'` branch and
`giveApp`/`wantApp` only inside `tech_exchange` — but `applyPropose` copies all three into the
stored proposal **unconditionally** (`giveBc: p.giveBc ?? 0`, `giveApp: p.giveApp ?? null`,
`wantApp: p.wantApp ?? null`). A proposal of any *other* kind smuggles them into
`state.proposals`, which is part of the canonically hashed state. Verified: payloads
`{to:1, kind:'non_aggression', giveBc:0.5}`, `{to:1, kind:'trade', giveBc:NaN}`, and
`{to:1, kind:'trade', giveApp:0.25}` all validate as accepted; the poison is applied on
**every** peer (appliers don't re-validate), so the next `hashCanonical` throws
`canonical: non-integer number` on all of them — turn advancement soft-locks, persistence
fails, and because the command is in the replay log the `.moo2save` is permanently
unloadable. Identical corruption class to old finding 1 (`save_design`), which *is* fixed.
**Fix:** make the applier total (`giveBc: p.kind === 'gift_bc' ? p.giveBc : 0`, null the app
fields for non-exchange kinds) and/or reject in the validator whenever the fields are present
but not a non-negative safe integer / string, regardless of kind.

---

## P1 — Major playability / wrong core logic

### 2. A client that is AHEAD of the host is never detected — permanent silent freeze or cross-game log grafting on rejoin  [VERIFIED]
`src/protocol/host.ts:345-347` (hello resync gate), `src/protocol/session.ts:359-384` (welcome ignores gameId), `src/protocol/setup.ts:44` (fresh host's gameId is `''`), `src/ui/net.ts:92-124` (auto-resume)

`onHello` resyncs only when `haveSeq < host.lastSeq`; a hello with `haveSeq >=` gets nothing,
`resync_request` filters `seq > haveSeq` so it also returns nothing, and the `welcome`
handler never compares game identity. So a client whose local record is ahead of — or from a
different branch than — the host's never learns it. Real triggers, all in supported flows:
(a) finding #3's crash window losing an `advance_turn`; (b) play-by-mail stale re-host: the
next lock holder re-hosts an older save (replay-latest import keeps the **same gameId**,
`src/ui/saveload.ts:100-105`) while a returning player's tab auto-resumes a further-along
local record; (c) what-if branch load: the rebased branch has a new gameId in the same room,
and a returning player's tab auto-resumes its old game for that room code. Verified for (a)
and (c): the stuck player's End Turn is silently dropped (`host.ts` commit turn mismatch),
every order rejects with `command for turn X, current Y`, no desync notice ever fires, manual
resync is a no-op, reload resumes the same fork — the table waits on them forever. Worse
(traced in code): in the (c) variant where the live branch's log is *longer*, the resync tail
of game Y folds onto game X's state and is **persisted into X's stored log** until the
eventual desync flips gameId — the original game's local record is grafted with foreign
commands and its export fails verification. **Fix:** (1) in `onHello`, when
`msg.haveSeq > lastSeq`, send a reset resync (full log/snapshot + a drop-local-state flag)
instead of silence; (2) give `welcome` a real `gameId` (set it in `startGame` via
`gameIdFromSeed`) and have the session discard its resume state and refold from seq 0 on
mismatch, persisting only after `game_start` establishes the right gameId.

### 3. Host broadcasts before persisting — a crash in that window reissues seqs and forks the table (residue of old finding 56)  [VERIFIED]
`src/protocol/host.ts:512-518` (accept folds + sends synchronously), `src/protocol/session.ts:527-537, 615-624` (async persist chain)

The DB-corruption half of old finding 56 is fixed (`appendCommands` is an idempotent upsert,
`src/storage/repo.ts:161-198`), and an ordinary desync now detects and self-heals thanks to
the fixed turn-hash bookkeeping. But the host still broadcasts `cmd_accept` before its own
persist chain reaches OPFS. If the unpersisted tail contains an `advance_turn`/`resolve_combat`,
the resumed host is a turn **behind** its surviving clients — which is exactly the undetectable
ahead-client state of finding #2 (verified end to end: reused seq dropped as duplicate, client
permanently one turn ahead, commits silently dropped, no desync notice, no recovery).
**Fix:** persist (at least turn-advancing commands) before broadcasting, plus finding #2's
ahead-detection as the safety net.

### 4. `save_design` accepts base hulls — tech-free, zero-command-point star-fortress "ships" on turn 1  [VERIFIED]
`src/engine/shipdesign.ts:286-289` (base hulls exempt from availability), `src/engine/commands.ts:535-563` (no hull restriction), `src/engine/movement.ts:118` + `data/generated.ts` (`CP_USAGE` has no base-hull rows)

`designStats` deliberately skips the `availableHulls` check for base hulls so `baseDesign`
can use them — but `validateSaveDesign` imposes no hull check of its own. Verified:
`save_design {hull:'star_base'}` and `{hull:'star_fortress'}` validate on a fresh game; the
designs are queueable and build normal mobile ships. Consequences: 400-space (star_base) and
1600-space (star_fortress) hulls with **no research gate** (a battleship is 250 space behind
a tier gate, a doomstar 1200 behind `doom_star_construction`), costing **0 command points**
(no `CP_USAGE` entry), moving at full strategic speed, and fighting as heavy gun platforms.
**Fix:** reject hulls not in `availableHulls(empire)` in `validateSaveDesign` (or give
`designStats` an `allowBaseHulls` flag that only `baseDesign`/`baseToCombat` set).

### 5. Killing the Guardian silently deletes every orbital base from your defense battles (death-ray auto-fit over-space)  [VERIFIED]
`src/engine/npc.ts:491` (grant), `src/engine/data/index.ts:92-105` (death_ray row: space 250, techId 999), `src/engine/shipdesign.ts:385-393` (`baseDesign` best-beam sort), `src/engine/battles.ts:294-295` (over-space base → null)

`baseDesign` arms bases with the highest-damage known beam; after `guardianReward` grants
`death_ray` (max dmg 100, space 250, and `techId 999` passes the `techId !== 0` filter; no
application row means no miniaturization either), it becomes the top pick. 6×death_ray on a
star base is 1610/400 space, so `designStats` returns an over-space error and `baseToCombat`
returns **null** — from that moment every star base, battle station, star fortress, missile
base, and ground battery of the victor simply doesn't show up in battles. The game's biggest
PvE prize makes your colonies undefendable. **Fix:** make `baseDesign` fit weapon counts to
the hull's space (`count = min(desired, floor(free/spaceEach))`, fall back to the next-best
beam), and/or have `baseToCombat` degrade gracefully instead of returning null.

### 6. Espionage can target a never-met empire, mutates its state, and never trips the fast-start contact wire  [VERIFIED]
`src/engine/commands.ts:753-761` (`validateSpyOrders` checks only not-self + alive), `src/engine/espionage.ts:56-112`, `src/engine/selectors.ts:719-753` (`metEmpireIds`)

The fast-start mode's soundness rests on the invariant stated in `selectors.ts`/`adapter.ts`/
`ids.ts`: *while `empireContactPairs` is empty the empires cannot interact, so turns may
resolve asynchronously*. Espionage violates it: `set_spy_orders` against a never-met empire
validates, sabotage then destroys the target's buildings (steal takes their tech), the victim
receives `spy_caught`/`sabotage_suffered` events naming an empire it has never seen — and
contact never trips, because `metEmpireIds` derives contact only from colonies-at-explored-stars,
co-located ships, relations, and proposals (its own doc comment promises "their spies caught
yours…" counts as dealings, but the code never implements that). Verified over a 40-turn run:
buildings destroyed pre-contact while `empireContactPairs === []` throughout. In fast mode the
host keeps async-advancing while the victim's ahead-preview runs with buildings that
authoritatively no longer exist (silent own-slice divergence, rejected follow-up commands).
The stock UI only offers met targets, so this needs a bot or modified client — but the
codebase's own standard is host-authoritative validation against hostile clients.
**Fix:** require the target to be met in `validateSpyOrders` (put `metEmpireIds` in a leaf
module to avoid an import cycle), and make a caught spy create a relations entry so espionage
itself establishes contact.

---

## P2 — Balance / correctness

### 7. Leader offers are a cross-empire market pre-contact — one empire's hire cancels another's standing offer  [VERIFIED]
`src/engine/leaders.ts:191-193` (offer expiry via `hiredAnywhere`), `:217-231` (pool excludes globally hired leaders), `src/engine/commands.ts:867, 881-882`

Pre-contact, all empires compete for one 46-leader pool: A's hire expires B's standing offer
for the same leader, excludes them from B's future offer rolls (shifting which leader B's
per-empire RNG stream picks), and rejects B's already-validated hire at the fast-mode drain.
Verified: dual offers for the same leader, A hires, B's offer evaporates and B's hire
rejects, with `empireContactPairs === []` the whole time. In fast mode B can play up to 10
preview turns with a leader (and its bcFlat/rpFlat/combat bonuses) that silently vanishes on
the preview rebuild — a fast-start invariant violation, though self-correcting (the rejection
prevents authoritative divergence). **Fix:** during the fast phase make offer generation and
consumption per-empire (defer `hiredAnywhere` conflicts to the contact rewind), or exclude
leaders offered to others from pre-contact pools; at minimum document that pre-contact offers
are speculative.

### 8. The Galactic Council convenes at turn 25 among empires that have never met  [VERIFIED]
`src/engine/diplomacy.ts:187-201` (no contact check on convening), `:204-243` (tally, victory), `src/engine/commands.ts:1253-1260` (`validateVote` — no met gating)

Candidates are the two largest empires by global population; every alive empire may vote —
none of it gated on contact. Verified: two players idle 30 turns without ever meeting →
`council_convened` and a tallied `council_result` broadcast to everyone, and `cast_vote` for
the unmet empire validates. A diplomatic **victory** can therefore end a fast-start game
between players who never saw each other, and pre-contact previews compute different
candidates than the authoritative timeline (vote commands then reject as `not a candidate`).
`council_convened`/`council_result` also leak unmet empires' identities and vote weights.
**Fix:** gate convening on `empireContactPairs(state).length > 0` (slide `nextVoteTurn`
forward while pre-contact) and gate `cast_vote`/candidate visibility on met.

### 9. Antaran raid targeting couples every empire's fate to global population pre-contact  [VERIFIED]
`src/engine/npc.ts:335-346` (target = largest empire), `:349-359` (raid spawn; `antaran_raid` broadcast)

Whether B gets raided (a battle plus potential `antaranRaze` halving a colony) depends on A's
command-driven population. Verified: identical states differing only in A's pop flip
`raidTargetEmpire` between A and B pre-contact. In fast mode B's preview evaluates the raid
against a stale A — it either previews a raid that authoritatively lands on A (phantom
razing) or misses one that authoritatively hits B (a surprise battle auto-resolved by the
fast pump with default orders). Mode-gated (`antarans` off by default, first raid turn 25).
**Fix:** while `empireContactPairs` is empty, defer raids (push `nextRaidTurn`) or pick
targets per-empire; resume the global rule at contact.

### 10. Invasion civilian losses cannot be applied to 1-unit pop groups — multi-race colonies under-bleed and the battle report contradicts the state  [VERIFIED]
`src/engine/ground.ts:101-108`

`toKill` is correctly capped per colony (total − 1), but the kill loop only takes from groups
with `popK > 1000` — a 1-unit floor per **group**. A 3-race colony of one unit each reports
`civilianLosses = 2` in the `ground_battle` replay yet nobody dies. Same class as old finding
20 (bomb-proof multi-race colonies — fixed on the bombardment path), now on the invasion
path: conquered colonies systematically under-bleed. **Fix:** change the guard to
`g.popK >= 1000` (the per-colony cap and the `popK > 0` filter already protect the last
colonist), and derive the event's `civilianLosses` from actual deaths.

### 11. Old finding 15's residue: the "last colonist survives" guard fails multi-race colonies — they are culled outright  [VERIFIED]
`src/engine/pipeline.ts:148` (colony-wide ≥1000K floor) vs `:163-165` (cull when no group holds a whole unit)

The per-group starvation/growth multiplication is fixed (housing, growth flats, and food-lack
are split by population share in `economy.ts:498-543`). What remains: starvation losses are
floored so *total* popK stays ≥ 1000, but the cull rule requires some single group to hold a
whole 1000K unit. Verified through `advanceTurn`: a single-race colony (2000K, food lack)
survives at 1557K, while a two-race colony (1000K + 1000K, same colony-wide lack) has both
groups pushed to ~750-790K and dies (`colony_died`) despite total pop ≥ 1000K — reachable for
any 2-unit mixed colony (post-invasion or transport mix) with net-negative growth.
**Fix:** apply the whole-unit floor colony-wide (protect one whole unit in the largest group).

### 12. Old finding 11's residue: Orion placement bypasses the connectivity check — ~3% of maps start cut, and those maps are also monster-free  [VERIFIED]
`src/engine/npc.ts:212-232` (`placeOrion` unvalidated) vs `:173-201` (`monsterPlacementOk`, applied to every keeper roll but not Orion)

Keeper seeding now preserves the guaranteed home-to-home colonizable hop path (rolled back on
any placement that would cut it) — but Orion itself, the star farthest from every homeworld,
is seeded straight into the guarded set with no check. Measured across two independent sweeps
(180 games and 24 games): ~3-4% of maps have the hop graph cut, Orion is the cut vertex every
time, and — because the baseline graph is then already broken — every subsequent keeper roll
fails its check, so those games spawn **no roaming monsters at all** (repro seeds:
`deadbeefdeadbeefdeadbeefdeadbeef` medium/4p; `abcdef…0002` medium/2p). The "home with zero
unguarded reachable systems" case from the original finding is gone (0/180).
**Fix:** iterate Orion candidates by descending distance and take the first that passes
`monsterPlacementOk`.

### 13. Formation stance grinds into corners and field edges — the corner punch-out fix only went into standoff  [VERIFIED]
`src/engine/combat.ts` formation branch (~:437-445) vs the standoff corner handling (~:458-484)

The standoff stance got explicit corner/edge handling ("cornered: punch out toward open
field"). Formation's back-away branch (`steer(target, -1)` when nearest < 140u) got none, so
formation ships near the field edge back straight into corners and sit there. Probe (6-ship
formation line vs chargers, 3 seeds): ships spent 57-69 **consecutive** ticks (~6-7 s of a
40 s battle) pinned inside a corner, every seed, while the formation side lost every battle.
This is the reported "huddle in the corner" misbehavior, still live for formation.
**Fix:** share standoff's corner/edge escape logic in formation's back-away branch.

### 14. Threshold retreat is a death sentence — across every probe scenario, 0 of 34 ships ordered to retreat by the HP threshold ever escaped  [VERIFIED]
`src/engine/combat.ts:356-366` (threshold flip), movement `off > 8 → travel = 0` (~:511), forward-arc weapons (~:625)

When fleet HP crosses `retreatThresholdPct` (default 25%), survivors flip to `evade_retreat`
mid-brawl: they must come about (stationary while pointing the wrong way), show their stern
(forward arcs never bear, so zero return fire), and outrun pursuers from point-blank range
under full fire. Probes: 4 frigates vs 6 titans, 10 frigates vs 8 titans, and mixed fleets —
every threshold-triggered retreater died before reaching any edge, in every seed (retreat
ordered from deployment, by contrast, escapes in 8-22 ticks). Related probe finding: a
standoff fleet slower than its enemy spends 60-75% of the battle facing *away* (backing off =
turning tail; there is no reverse thrust), taking fire with no reply — the reported "ships
turn away from the fight". Both make the 25% default threshold (also what fast-mode NPC
battles auto-resolve with) mostly a way to donate kills. **Fix directions:** let retreating
ships fire rear-arc/turret mounts and keep some speed while coming about; give disengaging
ships a speed burst; or adopt MOO2-style warp-out (a countdown, not an edge-reaching race);
for standoff, back away only while range can actually be maintained, else stand and fight.

### 15. Old finding 24, still live: `move_ships` has no working fuel gate for stranded ships — the new guard is unreachable dead code  [VERIFIED]
`src/engine/commands.ts:274-311` (`validateMove`)

A stranded-ship clause was added ("stranded ships can only limp back toward supply range")
but it can never fire: gate 1 already requires the destination to be in range of the support
network, and a stranded origin by definition is farther from the network than the fuel range,
so the rejection condition `toNet(dest) >= toNet(origin)` is always false by the time it is
reached. Verified in a real game: a scout 2826 cp from the network (range 400) was cleared
both to fly home (2826 cp hop) and laterally to another network-adjacent star 2678 cp away.
**Fix:** for stranded origins, skip the `inRange(dest)` shortcut and actually apply the
`toNet(dest) < toNet(origin)` comparison the code already contains (or bound per-hop length).

### 16. Duplicate `colony_base` / `gaia_transformation` queue entries silently burn full production  [VERIFIED]
`src/engine/items.ts:179-184` (`canQueue` checks current state only), `src/engine/pipeline.ts:318-356` (no-target completions return without refund)

Old finding 49 was fixed for terraforming (queue projection + completion refund) but not for
the other two projected items. Verified: `['colony_base','colony_base']` with one open planet
founds one colony and consumes 2×200 PP; `['gaia_transformation','gaia_transformation']` on a
terran world consumes 2×500 PP with one wasted — no refund, no event, either time (cross-colony
duplicates in one system hit the same hole). **Fix:** count queued entries in `canQueue` like
terraforming's `queuedSteps`, and mirror the terraforming refund in `completeItem`.

### 17. `bigStart` seeds farmers on farm-dead worlds and starves the empire from turn 1  [VERIFIED]
`src/engine/adapter.ts:676-686` (`bigEmpireStart`) vs the careful `advancedStart` (:396-399, food balancing, freighter pool)

`bigEmpireStart` assigns `farmers = ceil(units/2)` on every claimed planet with no
`farmingViable` check and grants zero freighters. Verified (pre_warp + bigStart, medium): 9 of
31 colonies start with farmers on worlds where nothing grows, 22 of 31 are food-negative,
freighters = 0 — mass turn-1 starvation; re-submitting a colony's *own starting* job
allocation is even rejected by `validateSetJobs` ("nothing grows here"), i.e. the start state
violates the engine's own invariant. **Fix:** reuse `advancedStart`'s viability check, food
balancing, and freighter sizing (or seed workers where `!farmingViable`).

### 18. Broadcast (`visibleTo: -1`) events leak pre-contact information and flicker as phantoms in fast-mode previews  [CODE]
`src/engine/battles.ts:565` (`battle_resolved` broadcast incl. NPC battles), `src/engine/npc.ts:333,359,383,402-483` (antaran + random events), diplomacy council events

NPC-battle summaries broadcast an unmet empire's fleet location, strength, and losses to
everyone; antaran raid / raze and all eight random events carry empire/colony payloads to all
seats; council events name unmet candidates. In fast mode these events hinge on other
empires' commands, so an ahead preview shows them appearing/disappearing across rebuilds.
**Fix:** route NPC-battle summaries and random events to participants only (as `battle_replay`
already does), or gate `-1` delivery on met.

---

## P3 — Minor / cosmetic / hardening

### 19. Old finding 37's residue: guided-munition terminal impacts are still invisible  [CODE]
`src/ui/battle/BattleViewer.svelte:266` (`if (shot.classId !== 0) continue`)

Munitions now render in flight (`frame.projectiles` → missiles/torpedoes/fighters with
trails) and PD intercepts draw a tracer + pop at the downed projectile's position — the bulk
of the old finding is fixed. But the viewer still skips every non-beam *shot event*, so the
impact instant of classId 1/2/4 has no shield-fizzle, no hull flash, and no hit/miss
distinction — the `sh`/`kill` data combat emits for guided hits (combat.ts:934) is discarded,
and an ECM-evaded munition vanishes indistinguishably from a hit. **Fix:** draw impact/fizzle
effects for non-beam shot events instead of `continue`.

### 20. Warp-dissipater-pinned retreaters grind the field edge until dead instead of turning to fight  [VERIFIED]
`src/engine/combat.ts:322-325` (noRetreat), `:486-523` (evade movement + edge exit gate)

When a warp dissipater pins a side, ships flipped to `evade_retreat` keep steering into the
wall forever (probe: pinned ships sat clamped at the field edge for 100+ ticks, taking fire
without meaningfully replying, until dead). **Fix:** when `noRetreat[side]` is set, revert
`evade_retreat` survivors to hold/charge — pinned means fight, not hug the wall.

### 21. Pre-warp orbital bases are weaponless phantoms until the first weapon tech  [CODE]
`src/engine/battles.ts:293` (empty-arsenal base → null) vs the knowledge-free starter kits (`src/engine/adapter.ts:170-183`, scout laser in `battles.ts:186-199`)

A pre-warp empire can build a star base on turn 1 (Engineering grant) but knows no weapons,
so `baseDesign` yields an empty weapon list and the base simply doesn't participate in
battles — while scouts and the starter Patrol Frigate get knowledge-free lasers. A rushed
pre-warp colony defends with nothing but starter ships for its first ~6+ turns.
**Fix:** extend the starter-kit exemption to `baseDesign` (fall back to `laser_cannon` when
the arsenal is empty).

### 22. Settling via `colony_base` forfeits the space-debris salvage  [CODE]
`src/engine/pipeline.ts:325-356` vs `src/engine/commands.ts:396-400` and `src/engine/adapter.ts:401-405`

Colonize-by-ship and the advanced start convert `special:'space_debris'` to +50 BC on
founding; the `colony_base` completion path doesn't — the salvage is lost and an inert
special stays on the settled world. **Fix:** replicate the salvage in `completeItem`.

### 23. `stellar_converter` and `spatial_compressor` have real tech rows but no granting application — permanently unmountable  [VERIFIED]
`src/engine/data/` (present in TECH_ROWS/WEAPON_ROWS, absent from APPLICATION_ROWS)

With all 191 applications granted, `knownWeapons` still omits both (the classId-5 combat
implementation exists and fires — they're just ungrantable). May be an intended data-ledger
decision (the starlight/stellar-converter split note); flagging so it's decided rather than
accidental. **Fix:** add application rows (or an explicit unresearchable note in the ledger).

### 24. `obsolete_design` leaves `refit:<ship>:<design>` queue entries alive  [CODE]
`src/engine/commands.ts:593-603`

Obsoleting strips `design:<id>` build items from queues but not refit items targeting the
obsoleted design; the refit then completes normally even though `canQueue` would refuse a new
one. **Fix:** strip matching refit items too.

### 25. Old finding 26's residue: Natives and Splinter Colony specials still never generate  [VERIFIED]
`src/engine/galaxy.ts:267-274` (`rollSpecial`: gold/gem/debris/wild-artifacts only)

Gem/gold/debris/wild-artifacts now roll (~5.8% of planets across 72 games) with live payoffs,
and `systemPrizeworthy`'s special clause works — but the two documented population specials
from `mechanics/planet_specials.md` remain unimplemented (0 across all sweeps).

### 26. Old finding 51's residue: bridge stars can still rarely violate `MIN_STAR_DIST`  [VERIFIED]
`src/engine/galaxy.ts:369-389` (nudge candidates, raw-point fallback at :389), `:711` (mirror copies only skip within 30 cp)

The main path now nudges bridges clear of existing stars (worst observed spacing improved
from 10 cp to ~113 cp), but two holes remain: the fallback places the bridge at the raw point
when all three candidates conflict, and mirror-mode bridge copies only skip within 30 cp, so
31-149 cp violations pass. Measured: 1 standard + 4 mirror violations across 72 games (vs 216
across 540 before). **Fix:** widen the candidate search instead of falling back to the raw
point; use `MIN_STAR_DIST` in the mirror copy check.

### 27. Loknar is in the ordinary leader-offer pool — the Guardian's unique bounty can be hired without ever visiting Orion  [CODE]
`src/engine/leaders.ts:217-231` (no exclusion), `src/engine/npc.ts:488-496` (guardianReward's free offer)

**Fix:** exclude `'loknar'` from `leadersUpkeep` offer pools.

### 28. Steal-mode espionage can exfiltrate synthetic `hyper_advanced_*` marker apps  [VERIFIED]
`src/engine/espionage.ts:83-88` (filters `target.knownApps`, which contains the synthetic grants from `research.ts:100-103`)

**Fix:** filter stealable apps to real application ids.

### 29. Creative-variant extra purchases ignore the seeded field-cost multiplier, and an already-known head still burns its full cost  [CODE]
`src/engine/research.ts:160-166` (uses `field.cost`, not `fieldCost`; grantApp no-ops but RP is deducted)

Extras cost list price while the field itself costs up to 2×, and a queued app acquired
meanwhile (stolen/traded) silently wastes the whole purchase. **Fix:** use `fieldCost` and
skip/refund already-known heads.

### 30. `leaderCombatBonuses.speedPct` lacks the `'ship'` kind filter  [CODE]
`src/engine/leaders.ts:158` (vs the filtered weaponry/helmsman/ordnance/fighter_pilot around it)

Colony leaders with the tactics skill grant fleet-wide combat speed, inconsistent with L2.
(Conversely, adding the filter makes their tactics skill dead weight that still bills salary —
decide and document.)

### 31. `executeSurrender` doesn't scrub the surrendering empire's leader offers  [CODE]
`src/engine/diplomacy.ts:112-145` (unlike resign and S12 elimination)

Harmless (offers expire ≤8 turns; hires by the dead empire reject) but inconsistent.

### 32. `event_boom` pushes a colony above max pop with no trim; random-event victim selection couples empires pre-contact  [CODE]
`src/engine/npc.ts:409-417` (boom), `:396-398` (victim pool shifts for everyone when any empire is eliminated)

**Fix:** clamp the boom to `colonyMaxPop`; treat the pre-contact coupling as part of the
fast-phase caveats below (mode-gated).

### 33. Antaran raiders' armor damage resets between fights  [CODE]
`src/engine/npc.ts:141` (`startingArmor: spec.armor`; only `dmgStructure` persists)

Mostly matters for the multi-turn Antaran home-fortress garrison. **Fix:** persist `dmgArmor`
on monsters like ships do.

### 34. `debug_add_bc` / `debug_set_pop` apply unchecked numeric payloads (debug games only)  [VERIFIED]
`src/engine/commands.ts:1269` (`validateDebug` checks only the flag)

`debug_add_bc {amount: 0.5}` in a debug game corrupts the canonical hash (same class as
finding 1, gated behind `debugCommands`). **Fix:** validate `amount`/`popK`/`count` as
bounded safe integers in a shared debug payload guard.

### 35. `MemoryGameStore.appendCommands` still throws on reissued seqs — the Save button breaks exactly when memory is the only persistence  [VERIFIED]
`src/storage/memory.ts:107-118` (throws `duplicate seq`) vs the fixed sqlite upsert (`src/storage/repo.ts:161-198`); pinned stale by `tests/storage/memstore.test.ts:90-93`

After a reused-seq crash-recovery (findings #2/#3), the sqlite-backed client's stored log
self-heals; the memory-backed client (the "no OPFS, Save is your lifeline" tab) keeps the dead
branch — every refold persist rejects into the swallowed persist chain, and `downloadSave`'s
verify fails with "snapshot hash mismatch". **Fix:** mirror repo.ts's last-writer-wins upsert
in memory.ts and update the pin test.

### 36. Determinism hardening: locale-dependent sort in `knownWeapons`; rngFor label-join ambiguity  [VERIFIED]
`src/engine/shipdesign.ts:143` (`sort((a,b) => a.id.localeCompare(b.id))`), `src/engine/rng.ts:95` (labels joined with `' '`)

`localeCompare` with no locale argument uses the user's locale; verified that the Czech
locale reorders this repo's id set ('ch' digraph collation). The current 45 weapon ids happen
not to contain a colliding pair, but the ordering feeds `baseToCombat`'s missile/beam picks
(ties broken by array order) — a cross-locale combat-input divergence waiting for the next
weapon whose id straddles a digraph. One-line fix: charcode compare. Similarly, `rngFor`
joins label parts with a space, so labels containing spaces would collide (`'a b','c'` ==
`'a','b c'`); every current label is space-free — add an assert to keep it that way.

### 37. `GameSession.retract()` is dead code with broken fast-phase semantics  [CODE]
`src/protocol/session.ts:211-222` (no callers anywhere)

In the fast phase the command it "retracts" was already sent and buffered by the host, which
will validate and apply it when its turn drains — a retract would create a phantom order that
still executes authoritatively. Nothing calls it today. **Fix:** delete it, or implement a
real host-side unsubmit before any UI adopts it.

### 38. Pre-warp starting star base: spec/code mismatch  [CODE]
`src/engine/adapter.ts:214` (star_base pre-built for `average` only) vs `improvements.md` ("The original planet starts with a starbase even in pre-warp")

The freshly committed pre-warp rework makes star_base *buildable* on turn 1 but only the
average start *pre-builds* one. The user-written play spec in improvements.md says the
pre-warp homeworld starts with one. Decide which is intended and align code or spec.

### 39. Comment drift: "everyone keeps the pre-built starter frigate"  [CODE]
`src/engine/adapter.ts:112-115`

No frigate ship is spawned in any mode — only the Patrol Frigate *design* is granted (tests
expect pre-warp = 1 scout, no frigate). The comment misleads; the code is as intended.

---

## Stub ledger — status refresh (2026-07-12)

The effect ledger (`src/engine/data/effectsMap.ts`) remains inaccurate **in both directions**,
so any coverage % derived from it is wrong:

- **Marked stub but actually working:** `fighter_bays` / `heavy_fighter_bays` (mountable via
  `CRAFT_BY_BAY`, launch and hit in combat, viewer draws them) and the `repulsive` pick
  (treaty refusal + halved leader offers are implemented). `assault_shuttle` was corrected.
- **Marked stub and now HALF-working:** `pulsar`, `plasma_web`, `gyro_destabilizer` — classId-5
  damage-dealers now fire like beams with real damage; only their signature special mechanics
  are missing. The research tooltip's blanket "⚠ not yet implemented" understates them and
  overstates fighter bays.
- **Correctly stubbed (sampled):** cloaking_device/phasing_cloak, stasis_field, tractor_beam
  (both now rejected at design time), security_stations, star_gate/jump_gate, android_farmers,
  and the telepathic/omniscient/stealthy_ships picks.
- ~45 other `stub:` entries (ground-combat gear, movement/comm/scan, governments,
  hyper-advanced grants) still research-able with no effect and no in-game "not implemented"
  signal beyond the research tooltip.

---

## Fast-start design caveats (documented behavior, not bugs — but worth surfacing in the UI)

- Pre-contact battles are NPC-only by construction and are **auto-resolved with
  `DEFAULT_ORDERS`** by the fast pump — a player attacking a monster lair (or defending
  against an Antaran raid) never gets to give battle orders until first contact, and with
  finding #14 the default 25% retreat threshold usually converts "retreat" into losses.
- With `antarans` or `randomEvents` enabled, world actors act on global state pre-contact, so
  an ahead preview can differ from the authoritative timeline (the fast-start fidelity test
  itself disables both modes). Findings #9/#32 propose deferrals; until then this is inherent.
- Monsters never blockade colonies (`isBlockaded` only counts ships) — a deviation from
  classic MOO2 worth a docs note.

---

## Verified-fixed classics worth regression tests (currently untested edges)

- The rejoin-after-battle desync loop (old finding 54) is fixed but has **no committed test**
  — the fix was verified with a throwaway probe (battle turn → rejoin from scratch → zero
  desync notices, identical hashes). Worth pinning in `tests/protocol/`.
- The pre-warp/average/advanced start-mode matrix and `unlockAllTech` debug flag were
  re-verified end to end after today's rework (opening research screen exactly the classic
  eight at list price; tier gating; starter kits; average superset — old finding 43 fixed).
