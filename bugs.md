- [x] Wormhole shouldn't be visible till you visit the planet or your scanners show the planet
  — done: wormhole lines (and the partner halo) only draw once an endpoint star was visited OR falls inside your scanner envelope. This also finally gives scanner techs a real effect: every colony and parked ship scans 2 parsecs, +1 parsec per scan point (Space +2 / Neutron +5 / Tachyon +7); scanned systems also show ship activity.

- [x] Wormhole transit should be 1 turn
  — verified: the engine already resolves wormhole moves in exactly 1 turn regardless of distance/speed (movement.ts travelTurns; covered by tests/unit/wormhole.test.ts). Nothing to change.

- [x] Colony can't be 0 pop
  — done: a colony starved below one whole colonist unit dies (colony_died) instead of lingering at "0/12". Bombing/invasion/transport paths already kept ≥1 unit. Engine behavior change → ENGINE_VERSION bumped to 0.5.0 (old saves load snapshot-first, per the save-compat contract).

- [x] Text tick colonies to bulk-select — done: hint reads "tick colonies to bulk-select".
- [x] Remove plus and minus buttons — done (drag replaced them).
- [x] Planet tag button way too big — done: the +tag control is a tiny transparent "+".
- [x] Pop change estimate should update when workers are moved
  — done: the growth projection now uses THIS turn's planned jobs — it simulates the empire-wide food distribution (freighters, chartered haulers, blockades) on the planned state, so moving farmers changes the estimate instantly instead of one turn late. (The pipeline itself is unchanged; only the projection reads live values.)
- [x] Button to hide tags part of column — done: 🏷 toggle in the bar (persists).
- [x] Search should also find planet names not just tag — done: the filter matches star/system names too (colony names already matched).

- [x] How will captured colonists work. How do we distinguish them
  — answered + fixed: captured colonists keep their own race group on the colony (flip owner with unrest on invasion; unrest = −25% output until they assimilate at 1/N chance per turn by government). They now render as their own citizen icons with a violet ring (red-gray while in unrest) and a tooltip naming their race. Critically, job dragging was rewritten to be group-aware — reassigning YOUR people no longer clobbers (or gets rejected by) foreign groups, presets already distributed across groups, and captured colonists can be dragged/shuttled as their own race.

- [x] If you select multiple colonies we should allow bulk queue (back or front)
  — done: "⤴ queue next for all…" (right after each colony's current build) and "⤵ queue last for all…" joined the existing "set build for all…".

- [x] Name your empire when custom
  — done: the custom-race field is labeled "empire name" (it always became Empire.raceName); the in-game header now shows "👤 you · YourEmpire" and the Empires tab already listed it.

- [x] Battle simulator should also be in the ship design screen and work on wip ships
  — done: "⚗ Simulate" in the Designer opens the Battle Lab with the exact work-in-progress fit (no save needed, 3 copies) vs every enemy type you've met in battle — or a mirror of itself before first contact.

- [x] We need to have retrofit ships with new designs of the same class and scrap ships. Use the same moo formula for retrofits
  — done: Fleets tab "⟳ retrofit…" per warship — rebuilds it to another design of the SAME hull class at a colony with a star base (or better) in that system. MOO2 formula: cost = newCost − oldCost, minimum ¼ of the new design's cost, paid in production through that colony's build queue (refit:<ship>:<design> item); completion swaps the design and repairs the hull; if the ship sails away mid-refit, half comes back as BC. Scrapping now returns ¼ of build cost in BC for ALL ships including designed warships (previously warships scrapped for 0).

- [x] Ensure terraforming and planetary construction works correctly
  — verified with a new suite (tests/unit/terraform.test.ts) through the real build pipeline: chains desert→arid→terran, tundra→swamp→terran, ocean→terran; cost 250 + 250·steps; hostile/energized never terraformable; gaia (Habitat Transformation) terran-only; max pop rises. One doc/code mismatch fixed: the docs say "barren becomes desert OR tundra" — the code always picked desert; now deterministic per planet (both branches reach terran in 3 steps). habitat_domes works (+2 max pop); artificial_planet remains an explicit deferred stub.

- [x] And the tech that gives new skill picks. How does this work
  — answered + implemented: it's **Trait Reassignment** (Trans Adaptation field, ecology, 7500 RP). Per the docs it grants 4 additional pick points, once, to remove disadvantages or add advantages (never governments). Now a real command + a "🧬 Trait Reassignment" panel on the Empires tab when researched; traits resolve dynamically from picks so the respec applies immediately. Flaws costing more than 4 (e.g. repulsive −6) can't be shed — the budget is a hard 4.

- [x] Planets should show the leader in gray letters and what the features are for production
  — done: the assigned governor's name appears in gray next to the colony name; the planet cell shows special-feature icons (🥇 gold / 💎 gems / 🏺 artifacts) and its hover now explains everything in production terms (minerals → prod per worker, gravity penalty, special bonuses).

- [x] + and − removed; citizen icons always overlap with negative kerning (tighter as counts grow).

---
Verification (2026-07-10): `npm test` 310 passed (46 files — new suites: retrofit, terraform, traitreassign, multirace, zeropop, wormhole-visibility), `MOO2_BALANCE=1` combat envelope, `svelte-check` 0 errors, `npm run build`, and the full Playwright suite 8/8 (incl. solo-standalone and play-by-mail) all pass. ENGINE_VERSION 0.4.0 → 0.5.0 (behavioral changes); the golden save fixture confirmed old saves fall back to snapshot-first loading exactly as designed.
