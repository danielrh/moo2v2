# CRITICAL improvements

Random numbers should all be based on the identifier of the event kind of thing the turn number and some kind of seed. maybe sub-turn for combat. This will keep the random numbers aligned across players and will be critical for doing future plans where the game can freewheel until first contact.  All encounters must resolve exactly identically and events and leaders as well.

So we should systemically replace all random number generations with a function of the hash of the (turn, kind of random number, subsequence eg battle frame, ship/beam id,...)

We need to proactively detect desyncs by sending the hash alongside so that we can ensure the game remains synced.

# Discovered Bugs — MOO2v2 playthrough + code audit

Compiled 2026-07-10 by the bugfinder robot. Method: booted the real game headlessly
(solo vs the fair/parity bot) through ~40-turn playthroughs and targeted interactive
probes, ran the full test suite (331 pass / 2 skip — all green), and audited every
engine/protocol/storage/UI subsystem and the generated data tables against the
`mechanics/` rules docs and `src/engine/data/README.md`.

**How to read this.** Each item has a location, the evidence, a concrete in‑game
failure, and a status tag:

- **[VERIFIED]** — reproduced by executing the code (a scratch test, a live
  headless play session, or both). High confidence.
- **[CODE]** — confirmed by reading the code paths end to end; not separately executed.
- **[KNOWN‑UNFIXED]** — a bug already listed in `bugs.md` that is still broken in the
  current code (the rest of `bugs.md` I checked and found fixed — see the bottom).

Severity: **P0** game‑breaking (crash / save corruption / multiplayer desync / soft‑lock),
**P1** major playability or wrong core logic, **P2** balance / correctness, **P3**
cosmetic / UX / doc drift.

**63 findings** below plus a stub-ledger of ~50 do-nothing researchable techs. The numbered
list is grouped P0→P3 by subsystem; the protocol/storage findings (54–63) are collected at
the end but keep their own severity tags. **The single most serious bug lives there**:
finding 54 — after any game that had one battle, the host mis-records turn hashes, so
combat desyncs go undetected and any rejoining/fresh player is trapped in an endless
desync/full-log-resync loop (test-verified). Read it alongside the P0 list below.

---

## P0 — Game‑breaking

> Also effectively P0: **finding 54** (protocol) — undetected combat-turn desync + infinite
> resync loop for rejoiners; **finding 56** (protocol) — a host crash mid-broadcast reuses
> sequence numbers, freezing the game or corrupting a player's local save.

### 1. A ship design with a fractional or negative computer/shield permanently corrupts the game and soft‑locks the turn  [VERIFIED]
`src/engine/commands.ts:465` (`validateSaveDesign`) → `src/engine/shipdesign.ts:292‑347` → `src/engine/canonical.ts:26`

`validateSaveDesign` only checks the design *name* and the design count, then delegates
to `designStats`, which validates `computer`/`shield` **only when `> 0`** and only against
an upper tier bound — never that they are non‑negative integers. `computer`/`shield`
arrive as raw network JSON and are stored verbatim by `applySaveDesign`.

I submitted `save_design` with `computer: 0.5` through the live UI. It was **ACCEPTED**,
and the game immediately threw an uncaught
`Error: canonical: non-integer number 0.5 at $.empires[0].designs[1].computer`
from `App.svelte` on the next render (the top bar computes a state hash every update).
The turn could no longer advance — the screenshot shows *"Committed ✓ (2/2)"* frozen on
*Turn 1* — and `[session] persistence error: … non-integer number 0.5` fired too, so the
game can no longer be saved either. Because the command is in the replay log, the
`.moo2save` is permanently unloadable.

A negative shield instead yields `SHIELD_POOL[-1] === undefined → NaN` shields; in combat
`dmg = max(0, dmg - NaN) = NaN`, `NaN > 0` is false, so the ship takes **zero damage**
from all non‑piercing weapons, and the NaN persists into state and crashes hashing at the
next turn boundary. In a P2P game a single malformed `save_design` from any client wedges
the authoritative host for everyone. **Fix:** require `Number.isInteger` and `>= 0` (and
`<= tier`) for `computer` and `shield` in the validator.

### 3. `diplo_propose` validation mutates game state → first proposal desyncs multiplayer  [VERIFIED]
`src/engine/commands.ts:685` → `src/engine/diplomacy.ts:19` (`relationOf` lazily pushes+sorts into `state.relations`)

`state.relations` starts empty and entries are created lazily by `relationOf`, which
**mutates state inside the validator**. The host validates every submission against its live
authoritative state; other clients apply accepted log commands without validating, and
`applyPropose` never calls `relationOf`. So the first‑ever proposal between two empires
inserts a phantom `relations` entry on the host + proposer only. Verified at runtime:
`validate(state, {kind:'diplo_propose'…})` grew `state.relations` 0→1 and changed the
state hash. The next `hash_report` mismatches → `desync_notice`. Even a *rejected* proposal
(e.g. "too many open proposals") triggers it. **In‑game:** the first time any player opens
diplomacy and proposes anything to another empire, the game desyncs. **Fix:** validators
must be pure; move relation creation into the applier (or read without inserting).

### 4. Malformed command payloads throw out of the host instead of being rejected  [VERIFIED]
`src/engine/commands.ts` validators call string/array methods on unvalidated fields; host calls `validate()` unguarded at `src/protocol/host.ts:510`

Several validators assume payload field types. `set_build_queue` with `items: [123]` reaches
`parseDesignItem(123)` → `TypeError: itemId.startsWith is not a function`; `save_design`
with `specials: 5` reaches `design.specials.includes` → TypeError. The contract is
`string | null`, and `host.ts:510` (`onSubmit`) has no try/catch, nor do the transports wrap
their message callbacks. One crafted `cmd_submit` throws out of the host's command path
rather than being cleanly rejected. **Fix:** type‑guard payloads at the top of each
validator (or wrap `validate`/`apply` in the host with a try/catch that rejects the command).

### 5. Second battle in the same turn is un‑orderable; the game locks ~60 s and resolves it with default orders  [VERIFIED] [KNOWN‑UNFIXED — bugs.md "two fights in the same turn"]
`src/ui/screens/GameShell.svelte:73‑79`

```js
return auth.pendingBattles.find((b) => b.attacker === me || b.defender === me) ?? null;
```

`find()` returns the *first* pending battle involving me even after I've locked its orders
(battles stay in `pendingBattles` until they all resolve together). The orders dialog then
shows *"Orders locked. Waiting for the enemy…"* forever and battle #2's dialog never
appears; meanwhile every non‑battle command is rejected (`'battles are being resolved'`).
The host waits for `battles.every(ordered)` that never comes and falls back to the 60 s
`battleOrdersTimeoutMs`, resolving battle #2 with `DEFAULT_ORDERS`.

I reproduced this exactly in a live session: spawned fleets at two monster stars, committed,
and the turn took **64 213 ms** to advance (≈ the 60 s timeout) with dialog #2 stuck on
"Waiting for the enemy…". This is the user‑reported "second fight locks the game for several
minutes… no way to select the strategy." Four independent code reviews landed on the same
line. **Fix:** select the first pending battle whose *own‑side* orders slot is still null.

---

## P1 — Major playability / wrong core logic

### 6. Five researchable building techs can never be built — the research is silently wasted  [VERIFIED]
`src/engine/data/index.ts:71` (`CURATED_BUILDABLES`), `src/engine/items.ts:168` (`canQueue`)

`space_port`, `pollution_processor`, `armor_barracks`, `recyclotron`, and `robotic_factory`
are researchable applications with live effect handlers wired in code
(`economy.ts:147` armor_barracks morale, `effects.ts:206` robotic_factory +prod,
`effectsMap.ts:129` space_port money, etc.) — but **none of them is in the buildables
table**, so `canQueue` returns `unknown item <id>` and they never appear in the build list.
Verified directly: all five are `isApp=true, isBuildable=false`. A standard race can pick
"Space Port" (+50% BC) or "Pollution Processor" (halves pollution) as its single field
target, pay the full field cost, and receive a building it can never construct. The effect
code for them is unreachable dead code. **Fix:** add buildable rows for the five (as was done
for terraforming/gaia).

### 7. Disruptor Cannon, Proton Torpedo, and Plasma Torpedo can never be mounted (id‑join bug)  [VERIFIED]
`src/engine/shipdesign.ts:128‑142` (`knownWeapons`)

`knownWeapons` joins weapon rows to their granting application by `w.id` or `w.id + 's'`.
The weapon ids are `disrupter` / `proton_torpedo` / `plasma_torpedo`, but the granted
application ids are `disruptor_cannon` / `proton_torpedoes` / `plasma_torpedoes`
(`proton_torpedo` + `'s'` = `proton_torpedos` ≠ `proton_torpedoes`). Verified by granting
all 191 applications: `knownWeapons` still omits exactly these three. Three flagship weapons
(4 500 / 4 500 / 10 000‑RP research targets) can never be put on a ship, and the designer/AI
never offer them. **Fix:** normalize the id mapping (explicit weapon→application table, or
fix the pluralization).

### 8. `classId 5` special weapons are designable, cost hull space, show DPS — and never fire  [VERIFIED]
`src/engine/combat.ts:536‑683` (firing loop has no `classId 5` branch)

The combat firing loop handles beams (0), missiles/torpedoes (1/2), and craft (4), skips
bombs (3) — and silently ignores **classId 5** entirely. Researchable classId‑5 weapons —
`anti_missile_rocket`, `stellar_converter` (400 dmg / 500 space), `plasma_web`, `pulsar`,
`black_hole_generator`, `stasis_field`, `gyro_destabilizer`, `tractor_beam`,
`spatial_compressor` — pass design validation, consume space and cost, and are advertised
with DPS by `designDps`, but fire **zero shots**. Verified: a full 400‑tick battle with both
sides armed only with `plasma_web`/AMR ended 0‑shots, stalemate. A player who beelines
Stellar Converter builds a doomstar whose main gun does literally nothing while the designer
claims huge DPS. `anti_missile_rocket` is even marked "implemented" in the effect ledger.
**Fix:** implement (or explicitly reject at design time) each classId‑5 weapon.

### 9. Overkill "dead‑on‑paper" check double‑counts this tick's damage → ships stop firing at ~half HP  [VERIFIED]
`src/engine/combat.ts:524‑531` and `:631`

`applyDamage` already subtracts damage from `t2.shield/armor/structure` **before**
`hurtThisTick` is compared against those same (now‑reduced) pools — so every point of beam
damage is counted twice when deciding "is this target already dead this tick?" Reproduced:
two 60‑dmg guns vs a 100‑HP defender — the first leaves it at 40 HP, the second declares it
overkilled (60 ≥ 40) and retargets; nobody dies that tick. In‑game, concentrated fleet fire
dithers across targets the moment any one has taken ≥ half its remaining HP, delaying kills
battle‑wide — the opposite of the documented "focus fire" intent. **Fix:** compare against
pools snapshotted at tick start, or don't add applied beam damage to `hurtThisTick` (the
pools already reflect it).

### 10. Enemy outposts are indestructible and permanently block colonization — no counter exists  [VERIFIED]
`src/engine/ground.ts:43`, `src/engine/battles.ts:543`, `src/engine/pipeline.ts:168`, `src/engine/commands.ts:336`

No mechanic can remove a hostile outpost: invasion skips outposts, bombardment skips them,
sabotage/meteor filter them out, they have no pop to starve, and there's no abandon/raze
command. Meanwhile `colonize`/`build_outpost` reject any planet that already has a colony
record. So an opponent who drops a cheap outpost ship on the system's Gaia/ultra‑rich world
denies that planet to *everyone* for the rest of the game, with no possible response even
under total military dominance. Outposts of an eliminated empire persist forever too.
**Fix:** allow bombardment/invasion (or a raze command) to destroy an undefended outpost.

### 11. Monster seeding cuts the guaranteed home‑to‑home colonizable path in 50–90 % of games  [VERIFIED]
`src/engine/npc.ts:194‑202` violating the invariant declared at `src/engine/galaxy.ts:236`

The generator spends "bridge" stars to guarantee every player can reach every other by
hopping colonizable systems ≤ 4 pc apart. Monster seeding only exempts homeworlds, Orion,
and artificial bridge stars — so it happily drops keepers on natural cut‑vertex systems of
that hop graph. Measured across seeds: the home‑to‑home colonizable chain is **cut in
15–27 of 30 games** depending on size/players (up to 90 % on medium/4p and huge/4p), and
~7–9 % of homeworlds start with **zero** unguarded colonizable systems within fuel range —
that player cannot expand at all until researching fuel tech or improbably killing a keeper
with starting ships. An asymmetric, game‑deciding start. **Fix:** exclude cut‑vertex/bridge
stars of the connectivity graph from monster seeding, and re‑verify connectivity after
seeding.

### 12. Homeworld placement fallback ignores spacing → 6–8‑player small/medium maps spawn homes ~1.5 pc apart  [VERIFIED]
`src/engine/galaxy.ts:428‑431`

```js
if (!bestSpread) { bestSpread = nonHole.slice(0, empireTraits.length); } // NOT max-distance
```

The comment promises a greedy max‑distance pick; the code just takes the first N stars in
(random) placement order. This fallback fires in **40/40 small‑6p, 40/40 small‑8p, 39/40
medium‑8p** runs, producing minimum home‑pair distances as low as **1.5 pc** while other
players sit 9 pc+ apart — turn‑1 scout contact and a lopsided colony rush for two unlucky
players. Homeworld *quality* is equalized but position fairness is destroyed. **Fix:**
implement the greedy farthest‑point selection the comment describes.

### 13. Eliminated empires keep functional "ghost" fleets that blockade, fight, and can invade forever  [VERIFIED]
`src/engine/pipeline.ts:496‑505` (S12) vs `src/engine/commands.ts:812` (resign) / `src/engine/diplomacy.ts:95` (surrender)

Conquest elimination sets `empire.eliminated = true` and nothing else; unlike resign (which
scrubs ships/colonies/proposals) or surrender (which transfers them), the dead empire's ships
stay in play. `detectBattles`, `isBlockaded`, and `resolveInvasions` never check
`eliminated`. Verified: after an empire lost its last colony and was marked eliminated, its
warship still sat over the winner's homeworld and `isBlockaded()` returned true — halving
farm/prod and cutting food deliveries indefinitely, with no owner able to move or disband it.
Pre‑loaded transports of a dead empire would also still auto‑invade. **Fix:** on S12
elimination, remove (or neutralize) the empire's ships as resign/surrender already do.

### 14. `evade_retreat` teleports the whole fleet to the lowest‑id colony in exactly one turn, ignoring distance and fuel  [CODE]
`src/engine/battles.ts:426‑438` (and the noncombatant path at `:459‑470`)

```js
const home = state.colonies.find((c) => c.owner === empire.id && !c.outpost); // lowest id, not nearest
ship.location = { kind:'transit', … arrivalTurn: state.turn + 1 };            // always next turn
```

`state.colonies` is sorted by id, so "retreat toward nearest own colony" actually sends the
fleet to the usually‑homeworld lowest‑id colony, and `arrivalTurn: turn + 1` means it arrives
next turn no matter how far away home is (normal movement is distance‑based). Retreat from a
battle deep in enemy territory teleports your fleet — plus its noncombat train — home in one
turn: free strategic fast‑travel and an exploit when combined with retreat‑to‑decline‑a‑fight.
**Fix:** pick the genuinely nearest reachable colony and use `travelTurns` for the ETA.

---

## P2 — Balance / correctness

### 15. Starvation, growth‑center, and housing bonuses are applied per race‑group instead of per colony  [VERIFIED] [KNOWN‑UNFIXED — bugs.md "food should not starve below 1 pop", multi‑race case]
`src/engine/economy.ts:513‑528`

`groupGrowthK` runs per pop group and applies the **colony‑wide** food‑lack penalty
(`inc -= 50*foodLack`), the +100k growth‑center flat, and the housing bonus to *each* group
with no per‑group share. So an N‑race colony starves N× as fast and grows N× as fast. Worst
case verified through `advanceTurn`: a colony with two 1000K groups and 1 food lack drops
*both* to 950K → `colonyPopUnits === 0` → the whole colony is culled the next turn, defeating
the "last colonist survives on scraps" guard that works for single‑race colonies. Conquered
(multi‑race) colonies both starve out and boom at multiplied rates. **Fix:** compute the
food/growth/housing terms once per colony and split them across groups by population share.

### 16. Command points from orbital bases are double‑counted (and all three bases stack)  [VERIFIED]
`src/engine/movement.ts:64,80‑84` + `src/engine/data/effectsMap.ts:113‑115`

`commandPoints` adds a hardcoded `BASE_CP` (star_base 1 / battle_station 2 / star_fortress 3)
**and** the same buildings' `cp_flat` effect modifiers (2 / 4 / 6). Net: star base +3,
battle station +6, star fortress +9 — 1.5× the documented CP table and matching neither the
comment (1/2/3) nor the data (2/4/6). With no upgrade/exclusivity gate, one colony can hold
all three at once for +18 CP. Everyone supports ~50 %+ more fleet than designed, so the
CP‑overage BC penalty rarely bites. **Fix:** drop `BASE_CP` and rely on the `cp_flat`
modifiers (or vice‑versa), and gate the bases as mutually‑exclusive upgrades.

### 17. Freighters haul 5× the documented food, and the top‑bar "freighters needed" stat uses the other convention  [VERIFIED]
`src/engine/pipeline.ts:204`, `src/engine/selectors.ts:83,274`

`power.md` specifies 1 food per freighter (5 per fleet). The engine feeds deficits at
`freeFreighters * 5` — i.e. 5 food per freighter, 25 per fleet. Yet
`selectors.ts:274` rounds the displayed requirement up to fleets assuming 1 food/freighter.
So the UI says you need 10 freighters to cover a 7‑food deficit while one 5‑freighter fleet
actually covers 25 — the displayed requirement is 5× the real one and food logistics are 5×
cheaper than designed. **Fix:** pick one convention (docs say 1 food/freighter) and use it in
both the pipeline and the selector.

### 18. Production banks up forever on an empty build queue → instant Star Fortress exploit  [VERIFIED]
`src/engine/pipeline.ts:260,276`

`colony.storedProd += out.prodToQueue` runs unconditionally; the trailing comment says
"production stored on an empty queue evaporates (classic behavior: keep it)" but nothing ever
zeroes `storedProd` when the queue is empty. Verified: `storedProd` grows every turn with
`queue: []`. Leave a colony idle 30 turns, then queue a Star Fortress and it completes
instantly (banked prod also collapses the buy cost toward 0). **Fix:** decide and implement —
either evaporate stored prod on an empty queue, or cap it — the code and its own comment
currently disagree.

### 19. Bombardment can erase a 1‑pop colony from orbit despite the "last unit survives" guard  [VERIFIED]
`src/engine/battles.ts:567‑575`

The `grp.popK > 1000` kill branch is checked **before** the last‑unit guard, so a group
holding one whole unit plus a growth fraction (popK 1001–1999, the normal state) has its only
unit killed, leaving a fraction that `pipeline.ts:163` wipes next turn (`colony_died`).
Verified: a group at 1500K → bombardment `popKilled:1` → 500K → colony gone. Bombing any
1‑pop colony destroys it with no invasion, which the design explicitly forbids. **Fix:** apply
the `colonyPopUnits <= 1` guard before the kill branch.

### 20. Bombardment only ever damages `groups[0]` → multi‑race colonies are bomb‑proof  [VERIFIED]
`src/engine/battles.ts:569`

Every 60 % "kill population" chunk targets `colony.groups[0]` only. Once the first group is at
1 unit, further pop damage fizzles even when other groups hold huge populations (and the
`<= 1` early‑break is also never reached, so the barrage silently burns). Verified: a colony
with groups `[1000K, 9000K]` took 150 bomb damage and lost **0** pop. Bombarding a conquered
colony whose original‑race group is small does nothing every turn regardless of bomb tonnage.
**Fix:** distribute bombardment across all groups (largest first).

### 22. Low‑gravity worlds impose no penalty on anyone — planet gravity `low` is a complete no‑op  [VERIFIED]
`src/engine/race.ts:95‑100` (consumed at `economy.ts:238`)

`gravitySteps` returns `diff <= 0 ? 0 : diff`, so a normal‑G race on a low‑G world (one step
off preference) takes 0 penalty. Per F14 it should be −25 % per colonist. Verified: colony
output on a low‑G world is byte‑identical to normal‑G for a normal‑G race, and gravity is read
nowhere else — the whole low‑gravity downside players weigh when colonizing is secretly free.
**Fix:** penalize gravity below preference symmetrically with gravity above it.

### 23. Beam‑volley retarget fallback fires outside weapon range and firing arc  [VERIFIED]
`src/engine/combat.ts:587‑595` with `:783‑786`

When no enemy passes the range+arc filter, `pickTarget`'s fallback returns the nearest enemy
anyway and the rest of the burst fires at it with no range/arc re‑check. Verified: after three
in‑range defenders died to a 5‑gun volley, shots 4–5 hit a defender at 454 u — beyond the
448 u long band — with a non‑heavy beam; the same path lets short‑range `pd`‑modded guns and
rear‑arc violations hit anywhere. Aggravated by finding 9 (premature "saturation" triggers the
fallback more often). **Fix:** keep the range/arc constraint on the fallback target.

### 24. `move_ships` fuel check tests only destination‑vs‑network, never the ship's actual origin→destination hop  [VERIFIED]
`src/engine/commands.ts:275‑283` → `src/engine/movement.ts:48`

`inRange` only asks "is the destination within fuel range of *some* colony/outpost." The
distance the ship must traverse is never bounded. Verified: a scout stranded 21 pc from home
(fuel range 4 pc) in deep space was cleared to fly to the home star. Ships can relocate
anywhere adjacent to the supply network regardless of how far out they are. May be partly by
design, but there is no fuel gate on stranded ships as the docs imply. **Fix:** also require
the origin to be within range (or bound the per‑turn hop distance).

### 25. `unload_transports` has no destination population‑cap check → colonies overfilled past max pop  [VERIFIED]
`src/engine/commands.ts:619‑652`

`validateUnloadTransports` checks ownership/kind/location but never `colonyMaxPop`, unlike
`move_colonists` which does. Verified: a colony at cap 12 reached 14 units after unloading a
2‑unit transport. Lets a player pack colonies above their climate/size ceiling. **Fix:** clamp
the unload to available room (as `move_colonists` and the freighter‑landing path do).

### 26. Documented planet specials (gem/gold deposits, natives, splinter colony, space debris) are never generated  [VERIFIED]
`src/engine/galaxy.ts:283,299,502,523` — every planet gets `special: null` except the artifacts homeworld and Orion

`mechanics/planet_specials.md` defines Gem Deposits (+10 BC), Gold Deposits (+5 BC), Space
Debris (+50 BC), Splinter Colony, Natives, and wild Ancient Artifacts — and `economy.ts:317`
implements the gem/gold payoffs — but galaxy generation never assigns any of them. Swept 30
huge games: the only special ever present is Orion's single `ancient_artifacts`. Players never
encounter this documented content; the gem/gold economy branches are dead code, and
`systemPrizeworthy`'s `special !== null` clause can never fire (so "monsters guard artifact
worlds" can't actually happen). **Fix:** assign specials during `rollPlanetSpecs`.

### 27. On battle turns, pre‑combat reports are dropped and combat events are duplicated (shared `gameEngine.lastEvents` singleton)  [VERIFIED]
`src/engine/adapter.ts:205,236‑244`; drained per‑advance at `src/protocol/session.ts:332`

`gameEngine` is a module singleton whose `lastEvents` every `GameSession` and `HostCore` on
the page share. The pausing `advance_turn`'s events (research_complete, building_complete,
starvation, battle_pending…) are drained and then overwritten by `resolve_combat`'s batch.
Verified via a protocol test: on a battle turn the host's event list **lost** `battle_pending`
and a same‑page client saw every combat event **doubled**. In‑game, on any turn with a battle
the Reports tab silently misses everything that happened before combat and the 🎉 research
toast never fires. **Fix:** give each session its own event buffer instead of a shared
singleton.

### 29. Duplicate queue entries crash the whole Colonies spreadsheet (`each_key_duplicate`)  [CODE]
`src/ui/screens/Spreadsheet.svelte:585` — `{#each row.queue…filter(!buildable) as q (q)}` keyed by item string

If the same non‑buildable item string appears twice behind the queue head, Svelte 5 throws
`each_key_duplicate` (in prod too), blanking the entire Colonies tab with no recovery but a
reload. Reachable via: two identical ship refits (no dup guard for `refit:` items), queuing
`spy` past the 10‑agent roster (flips spy out of `buildable`), or two `colony_base` when the
last free planet gets settled. (I could not trigger the refit path — that validator rejected
my duplicate — but the spy/colony_base paths remain.) **Fix:** de‑dupe the queue or key the
`#each` by index.

### 31. Rejected build‑queue and research edits are silent, and the Build dropdown face desyncs from the engine  [CODE]
`src/ui/screens/Spreadsheet.svelte:284,294,141` and `src/ui/screens/Research.svelte:38` — all ignore `submit()`'s `{error}`

Only `dropOnColony` surfaces command errors; `setBuild`/`appendBuild`/`bulkBuild`/`removeQueued`
and the research picker ignore the returned error. On local rejection `submit` returns without
bumping the version, so nothing re‑renders and the `<select>` keeps showing the user's choice
while the engine builds the old item. Triggers: after **Buy** the head is locked but the
dropdown stays enabled; a queue "poisoned" by a now‑invalid entry (settled‑out `colony_base`,
full spy roster, 12‑item cap) makes every whole‑queue rewrite fail — recreating the reported
"locked‑in queue" feel. **Fix:** surface `res.error` (as the colonist‑drop note already does).

### 32. MapView swallows every `move_ships` error, and a stale ship selection can wedge star selection  [CODE]
`src/ui/screens/MapView.svelte:146‑153`

With ships ticked, clicking any star always attempts a move and `return`s; on failure (out of
range, in transit, dead ship) there is no message anywhere and the clicked star isn't even
selected — the click just does nothing (the "no error message" flavor of the original
colonist‑drop bug). Worse, if ticked ships were destroyed in the turn's battle they no longer
appear in `shipsHere`, so there's no checkbox to untick them; every later star click submits
`no ship N`, fails silently, and star selection is dead until you switch tabs. **Fix:** show
`res.error` and prune invalid ids from `selectedShipIds`.

### 34. Host‑side command rejections (`cmd_reject`) are never surfaced anywhere in the UI  [CODE]
`src/protocol/session.ts:211` emits `{type:'rejected', reason}`; no UI consumer exists

Any command that passes optimistic local validation but loses a host‑side race (two players
hiring the same leader, a command arriving just after turn advance, competing colonize)
silently reverts the optimistic UI with no explanation. **Fix:** handle `rejected` in the
state store and show a transient note.

### 37. Missile/torpedo/fighter impacts and point‑defense intercepts are never drawn → "ship died with no visual cause"  [CODE] [KNOWN‑UNFIXED — bugs.md battleneg/battle0/battle1 screenshots]
`src/ui/battle/BattleViewer.svelte:160‑164`

The viewer skips every non‑beam shot event (`if (shot.classId !== 0) continue`) and every
shot without a target ship (PD intercepts use `to: -1`). Guided munitions render only as a
2–3 px dot that vanishes on impact, so a missile flies in, disappears, and the target's HP
drops or it pops with no visible cause; intercepted missiles just vanish. The engine *does*
emit a shot event for every hit, so this is purely a rendering gap — the surviving mechanism
behind the reported screenshots. **Fix:** draw an impact flash/tracer for classId 1/2/4 and
for PD (`to === -1`).

### 38. Every mobile space monster renders as a player Doom Star (hullIdx collision)  [VERIFIED]
`src/engine/npc.ts:128` (`hullIdx: … ? 9 : 6`) + `src/ui/battle/BattleViewer.svelte:67`

Non‑guardian monsters get `hullIdx 6`, which the viewer treats as the doom‑star sprite. So
amoebas, crystals, hydras, and Andromedan intruders all draw as oversized player‑style Doom
Stars with engine glow — I confirmed this visually (an amoeba renders as a green doomstar
sphere). Monster identity in battle is lost. **Fix:** give monsters distinct sprites keyed off
their `kind`.

### 39. A caught spy cancels a surviving spy's attempt (loop bound mutated mid‑iteration)  [VERIFIED]
`src/engine/espionage.ts:77,101`

The offensive‑spy loop is `for (i=0; i < empire.spies.count; i++)` and decrements
`empire.spies.count` when a spy is caught — shrinking the bound, so each exposure also robs a
*surviving* spy of its turn. With 3 spies and the first caught, only 2 attempts happen instead
of 3. Offensive espionage output is systematically below the documented "one attempt per spy."
**Fix:** snapshot the count before the loop.

### 41. Five weapon mods charge hull space and cost but do nothing in combat  [CODE]
`src/engine/shipdesign.ts:171‑186` vs the mods actually read in `combat.ts`

`env` (enveloping, +100 % space), `ovr` (overloaded, +50 %), `arm` (+25 %), `fst` (+25 %),
and `emg` (emissions guidance, **+300 %**) are offered on missiles/torpedoes/beams, accepted
by `fitWeapon`, and consume space/cost — but combat reads none of them and `designDps` ignores
them. A player pays quadruple space for an "emissions guidance" missile identical to the plain
one. **Fix:** implement the mods or remove them from `availableMods`.

### 42. Killing the Guardian grants `death_ray`, which matches no weapon/application — the prize is inert  [VERIFIED]
`src/engine/npc.ts:435` (`grantApp(empire, 'death_ray')`)

`death_ray` appears nowhere in the generated data. Verified: `knownWeapons({knownApps:
['death_ray']})` returns `[]`. The game's biggest PvE reward yields nothing mountable.
**Fix:** grant a real researchable/unresearchable weapon application id.

### 43. "Average" start is missing the tier‑1 root fields → can't build Colony Base or Star Base at game start  [VERIFIED]
`src/engine/adapter.ts:82‑88` grants only `STARTING_FIELD_NUMS.average`, which excludes roots 29/28/55/57/22

Verified: on an average‑start game `canQueue(colony,'colony_base')` → `colony_base not
researched`, same for `star_base` — the earlier *pre‑warp* start actually knows more basics.
Average‑start games can't settle in‑system or build star bases at new colonies until
back‑filling tier‑1 research, and the starter frigate uses lasers the empire doesn't "know."
(Default lobby mode is pre‑warp, so this only bites when "average" is selected.) **Fix:**
include the tier‑1 root fields in the average‑start grant.

### 45. Dragging farmer icons to another colony actually removes scientists from the source  [CODE]
`src/ui/screens/Spreadsheet.svelte:254‑269` sends only `{race,count}`; `commands.ts:1210` `normalizeJobsForGroup` strips scientists → workers → farmers

The UI implies you move the specific job you grabbed, but the engine just subtracts `count`
from the group's pop and re‑normalizes, always shedding scientists first. Grab 2 farmer icons,
drop them on another colony, and the source loses 2 scientists while its farmer count is
unchanged. **Fix:** either pass the source job so the engine vacates it, or relabel the UI so
it doesn't imply job‑specific movement.

### 46. Per‑hit shield‑flat reduction keeps applying after the shield generator is knocked out  [CODE]
`src/engine/combat.ts:823‑829` vs `:862`

A shield knockout zeroes the shield pool and stops regen (and the viewer hides the ring), but
`applyDamage` keeps subtracting `t.init.shieldFlat` from every hit because it never checks
`t.sysShield`. A Class X ship with "shields knocked out" still shrugs 10 points off every
incoming hit, so small weapons stay at the 0‑damage floor against a supposedly shieldless
target. **Fix:** zero `shieldFlat` when `t.sysShield` is set.


The engine's event channel only carries events from `advance_turn`/`resolve_combat`, so
signing an alliance, a trade pact, or accepting a **surrender that eliminates an empire**
notifies nobody — `Reports.svelte` has renderers for `treaty_signed`/`surrender` that can
never fire. The ignored error also means an accept that's now infeasible (war broke out, gift
funds spent) silently consumes the proposal with no transfer and no feedback. **Fix:** surface
these events and the error.

### 49. Extra terraforming steps queued past the top of the chain silently burn full production  [VERIFIED]
`src/engine/terraform.ts:27,40` + `src/engine/items.ts:174` + `src/engine/pipeline.ts:289`

`canQueue` validates against the *current* climate only, so `['terraforming','terraforming']`
passes on an ocean world; `terraformCost` never checks the climate and charges the second
step's full ~500 PP; `applyTerraformStep` returns null and the pipeline still emits a
`terraformed` event with `climate: null`. Queuing two terraform steps (a natural thing to do)
wastes hundreds of PP. **Fix:** re‑validate each terraform step against the projected climate,
or refund when the chain has topped out.

### 50. The −½‑food farming penalty pick is inert — a free +3 race‑design points  [VERIFIED]
`src/engine/race.ts:88‑92`

`farming1` (−1 half‑unit, refunds 3 picks) resolves through `truncHalf(-1) = -Math.floor(0.5)
= 0`, so `traits.farming === 0` — no penalty. Verified: `resolveTraits(['farming1']).farming
=== -0`. Every custom race can take it for +3 points with zero downside, distorting
multiplayer race‑building. **Fix:** apply the −0.5 with a floor of 1 food/farmer on
life‑bearing worlds, as the doc specifies.

### 51. Bridge stars ignore `MIN_STAR_DIST` → stars generated as close as 0.1 pc, visually stacked  [VERIFIED]
`src/engine/galaxy.ts:356‑365` (bridge insertion) — `served` radius is 20 cp but `MIN_STAR_DIST` is 150 cp

Across 540 generated galaxies, 216 star pairs are closer than 150 cp and the worst is 10 cp
(0.1 pc) — every violating pair involves a bridge star. On the map two star discs render on
top of each other (click ambiguity, illegible chart), and it inflates the documented star
counts by up to +10. **Fix:** skip bridge insertion when an existing star (of any kind) is
within `MIN_STAR_DIST`.

### 52. Trait Reassignment can't upgrade an advantage a tier  [CODE]
`src/engine/commands.ts:998‑1019`

Adding e.g. `attack3` while holding `attack2` violates exclusivity, and positive picks can't
be removed, so tier upgrades (a documented use of the reassignment tech) are impossible — only
adding new advantages / removing disadvantages works. **Fix:** allow replacing a lower tier of
the same pick family with a higher one.

### 53. Text / tooltip / doc drift (several)  [VERIFIED where noted]
- The per‑citizen tooltip still says drops only work on a "same‑system colony"
  (`Spreadsheet.svelte:536`) — cross‑system freighter transfers work now, so the tooltip
  actively tells users a working feature doesn't exist. **[VERIFIED]** in a live session.
- The Help panel still describes the removed ± job buttons
  (`GameShell.svelte:452` "± or drag a job count").
- The totals‑row growth figure is always green even when the empire's population is shrinking
  (`Spreadsheet.svelte:669` omits the `neg` class the per‑row cell has).
- The spectator banner prints raw internal battle ids (`GameShell.svelte:80,381`).
- DM chat shows every DM you sent in every thread (`GameShell.svelte:190`,
  unqualified `m.from === me`), and incoming DMs never surface while the recipient box is on
  "all".
- Three Advanced‑Government techs (`confederation`, `federation`, `galactic_unification`) have
  empty `effectSummary`, so their research tooltips are blank **[VERIFIED]** — the residue of
  `bugs.md` "technologies should be described" (mostly fixed via hover text elsewhere).
- Doc/decision‑log drift the audits flagged: README F7 says "No tax slider exists" but the tax
  slider is present and works (0–50 %) **[VERIFIED]**; leader‑offer constants (8 %/8‑turn)
  contradict README L4 (4 %/5‑turn); the CP comment (1/2/3) contradicts both the data and the
  code (see finding 16).

---

## Stub ledger — researchable techs/picks that currently do nothing

The effect ledger (`src/engine/data/effectsMap.ts`) marks these as `stub:` — they can be
researched (some for up to 25 000 RP) and grant an application, but have **no implemented
effect**. This is expected for post‑Phase‑6 content, but from a player's seat each is a
research choice that does nothing, and there is no in‑game signal that it's a placeholder.
Worth surfacing "not yet implemented" in the research UI. (Enumerated by the data audit; ~48
applications + 3–4 picks.)

- **Ground combat:** laser_rifle, fusion_rifle, powered_armor, anti_grav_harness,
  personal_shield, battleoids, phasor_rifle, plasma_rifle.
- **Combat specials:** dauntless_guidance_system, gyro_destabilizer, tractor_beam,
  stealth_field, pulsar, stasis_field, cloaking_device, plasma_web, sub_space_teleporter,
  time_warp_facilitator, phasing_cloak. *(several of these are also the classId‑5 "never
  fire" weapons of finding 8.)*
- **Boarding/marines:** security_stations, troop_pods, survival_pods, transporters.
- **Movement/comm/scan:** extended_fuel_tanks, subspace_communication, jump_gate,
  hyperspace_communication, sensors, star_gate.
- **Colony/economy:** scout_lab, android_farmers/workers/scientists, artificial_planet_construction,
  warp_interdictor, planetary_flux_shield, planetary_barrier_shield, artemis_system_net,
  xeno_psychology.
- **Governments:** confederation, imperium, federation, galactic_unification.
- **Hyper‑advanced (25 000 RP each):** all 8 `hyper_advanced_*` field grants are stubs — a
  25 000‑RP completion has zero effect.
- **Race picks:** `telepathic` (6 pts), `omniscient` (3), `stealthy_ships` (4) are fully
  inert; `cybernetic`/`subterranean`/`warlord` are only partially wired.
- Two ecology bombs (Death Spores / Bio‑Terminator equivalents) and the Wellness techs' second
  effect are treated as generic bombardment damage with none of their documented pop‑kill‑chance
  / morale / diplomacy mechanics (`battles.ts:551`).

The effect ledger is also **stale in the other direction** — `assault_shuttle`,
`fighter_bays`/`heavy_fighter_bays`, and the `repulsive` pick are marked stub but actually
work — so any "coverage %" derived from it is wrong both ways.

---

## Protocol / storage / play-by-mail server

Reviewed the lockstep protocol, browser/node storage, save files, and the Go PBM server
against the load-bearing `replay(log) == state` invariant. Most findings below are
**[VERIFIED]** with an executable protocol/storage test harness (multi-peer over the
in-memory transport + real node SQLite store; the harness was removed and the repo's own
`tests/protocol` + `tests/storage` suites still pass 13/13). Several are severe — the
first is effectively a P0.

### 54. Host turn-hash bookkeeping is wrong on battle turns → combat desyncs go undetected AND rejoining players enter an infinite desync/resync loop  [VERIFIED] — **P0**
`src/protocol/host.ts:444‑450, 604‑609`, `src/protocol/session.ts:329‑331`

When a battle is detected, `advance_turn` returns **without** incrementing `state.turn`
(it pauses in `battle_orders`; `resolve_combat` finishes the turn). But the host records
turn-boundary hashes as `hash(state)` keyed to `turnOf(state) - 1` on every `advance_turn`.
On a battle turn this (a) **overwrites the previous turn's correct boundary hash with a
mid-battle hash** (verified: `7f8a079384986ca8` → `fbdd766d70c393c1`), and (b) the turn
that `resolve_combat` actually completes **never gets a hash entry**, and `onHashReport`
skips missing entries — so a genuine desync on any combat turn is **never detected**. Worse
(c): any client that folds the log from scratch (new device, cleared storage, a mid-game
joiner) computes the *correct* hash for that turn, mismatches the host's overwritten entry,
and refolds — and `session.ts:330` resets `lastReportedTurn` on every `game_start` fold, so
the same mismatching report is re-sent forever. Verified: **35 desync notices after one
settle round, 105 after two**, while the client's state was byte-identical to the host's
the whole time. In-game: after any game that had a single battle, a rejoining/fresh player
is stuck re-downloading the full log over WebRTC in an endless "desync" churn, and real
combat-turn divergences between players silently slip through until save/export. **Fix:**
only record the boundary hash when `advance_turn` actually advances the turn, and hash the
turn `resolve_combat` completes; don't reset `lastReportedTurn` on refold.

### 56. A host crash between broadcasting a command and persisting it reuses sequence numbers → permanent silent stall, or a corrupted local log  [VERIFIED] — P1
`src/protocol/host.ts:455‑456, 303‑305`, `src/protocol/session.ts:294, 392‑401`, `src/storage/repo.ts:161‑177`

The host broadcasts `cmd_accept` synchronously but persists asynchronously to OPFS; a tab
crash in that window means the host resumes from a shorter log and **re-assigns
already-used seqs**. Verified both outcomes: (a) with default settings the host resumes a
turn behind, the client drops the reused-seq commands as "duplicates" and never folds, so
no `hash_report` is ever sent and **no desync is detected — the game freezes for everyone
with no error**; (b) with lost non-turn commands, play continues on colliding seqs and a
later fold triggers a resync that fixes the *live* state, but `appendCommands` is a plain
INSERT with no upsert and the error is swallowed (`persist()` continues), so the client DB
**permanently interleaves two branches** — `replay(storedLog) != state`, and a later resume
or `.moo2save` export fails verification with a cryptic "snapshot hash mismatch." **Fix:**
persist before broadcasting (or fsync the accepted command synchronously), and make
`appendCommands` an idempotent upsert that surfaces conflicts.

### 58. [KNOWN‑UNFIXED — bugs.md "Host offline warning is not accurate"] The "host offline" banner shows while the host is online and never clears  [VERIFIED] — P2
`src/ui/state.svelte.ts:52‑74` (root cause `vendor/lobbylink/index.js:667‑679`)

**Correction to my earlier read:** the 8 s debounce exists, but the banner is only ever
cleared by a `player-joined/rejoined(0)` *transport* event — nothing resets it when actual
host traffic (`cmd_accept`, `commit_status`, chat) keeps arriving. lobbylink fires
`player-left(0)` when the host's *signaling websocket* drops even though the WebRTC data
channel (all game traffic) is healthy, so if signaling stays down >8 s (lobby-server
restart, flaky WS) the "Host offline — the game is paused" banner is **permanent while the
game plays on normally** — exactly the user's report. **Fix:** clear/refresh the flag
whenever any host message reaches the session.

### 59. [KNOWN‑UNFIXED — bugs.md "the saved dialog sticks around for players"] The PBM "uploaded turn N ✓" note never clears  [VERIFIED] — P3
`src/ui/pbm.ts:196‑199, 215`, `src/ui/screens/GameShell.svelte:322‑325`

**Correction to my earlier read:** the *local* save toast auto-clears after 6 s
(`flashSaveNote`), but the PBM banner renders `pbm.note` unconditionally and `setNote` has
no expiry. Since an auto-upload happens on every commit, "uploaded turn N ✓" is pinned on
screen for the rest of the session — the sticky-save-dialog complaint, still live for PBM
games. **Fix:** give the PBM note the same timed clear as `flashSaveNote`.

### 60. PBM client ignores heartbeat/upload HTTP failures → silent lock loss, lost turns, forked games  [VERIFIED] — P2
`src/ui/pbm.ts:56‑73, 229‑244`, `server/pbm/pbm.go:308‑315`

`api()` resolves for any HTTP status, so a `423`/`401` heartbeat or upload response is
discarded (`.catch` only covers network errors); failed uploads are never retried; and
"📬 mail in & leave" runs its final upload, ignores the failure, and releases the lock
anyway. In-game: a laptop sleeps past the 180 s TTL → the lock expires → another player
takes it and re-hosts from the older save while the sleeper keeps playing an orphaned
branch, every upload silently 423-ing; "mail in & leave" then discards the whole session
and the next player resumes the stale save. Locks keyed by bare `name` also let a
same-named second tab renew or release someone else's lock. **Fix:** surface non-2xx PBM
responses, retry uploads, and don't release the lock on a failed final upload.

### 61. Commits accepted during the `battle_orders` sub-phase pre-commit the player for the next turn  [VERIFIED] — P2
`src/protocol/host.ts:532‑538`

`onCommit` checks `turn === currentTurn()` but not the phase; during `battle_orders` the
turn counter hasn't advanced, so a `commit_turn` that lands as a battle pops is stored and
**survives `resolve_combat` into the next planning phase** (only `advance_turn` clears
`committed`). With auto-turn or a fast opponent, the next turn can advance before that
player ever plans it. **Fix:** reject or clear commits made during `battle_orders`.

### 62. Post-restart chat is silently lost from the persisted record  [VERIFIED] — P3
`src/protocol/host.ts:63, 619‑635`, `src/storage/repo.ts:330‑344`

`chatSeq` lives only in HostCore memory (chat isn't in the command log), so a resumed host
reissues ids 0,1,2…; `appendChat` hits the `(game_id, id)` primary key and
`onConflict.doNothing()` silently drops the rows. Chat shows live but vanishes from the
saved record and any later reload for the rest of a resumed game. **Fix:** namespace chat
ids per host session, or upsert.

