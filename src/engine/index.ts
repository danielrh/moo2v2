// Engine: the pure, deterministic game core.
//
// Layer rules (enforced by scripts/check-boundaries.mjs):
// - No imports from outside src/engine (zero runtime dependencies).
// - No sources of nondeterminism; randomness comes only from the seeded PRNG.

export const ENGINE_VERSION = '0.10.0'; // init+research change (improvements.md): pre_warp is the classic MOO2 primitive age — ONLY Engineering pre-completed (colony base/star base/marine barracks buildable turn 1), everything else researched from scratch; the homeworld starts with a star base in EVERY non-advanced mode, pre-warp included. Research now discovers on a hidden per-game line uniform on (listed, 2×listed] shared by all empires — the UI shows listed costs, "~N turns" estimates, and "% chance to discover" odds. Default start mode is "average" (2 scouts + a colony ship). Adds debug unlockAllTech (gated on debugCommands). Bugfix pass (same unreleased version, discovered_bugs.md 2026-07-12): combat retreat overhaul (warp-out countdown, formation corner escape, standoff stands when it cannot outrun, dissipater-pinned ships fight), retreats stay at an own-colony star and stranded ships auto-retreat to the nearest colony, natives/splinter-colony specials generate with founding effects, Orion placement preserves the hop graph, colony_base/gaia duplicates refund, invasion losses land on 1-unit groups, multi-race last-colonist cull fixed, pre-contact isolation (espionage/council/leader market/Antaran raids gated on contact), NPC/random-event broadcasts scoped to participants, monster armor damage persists. 0.9.x replays diverge at init, so old saves load snapshot-first.

export * from './types';
export * from './ids';
export * from './canonical';
export * from './hash';
export * from './isqrt';
export * from './imath';
export { Rng, rngFor, isValidMasterSeed, type MasterSeed } from './rng';
export * from './race';
export * from './galaxy';
export * from './economy';
export * from './research';
export * from './effects';
export * from './items';
export * from './movement';
export * from './terraform';
export * from './leaders';
export * from './npc';
export * from './ground';
export * from './espionage';
export * from './diplomacy';
export * from './commands';
export * from './shipdesign';
export * from './shipstyles';
export * from './combat';
export * from './battles';
export * from './pipeline';
export * from './adapter';
export * as selectors from './selectors';
