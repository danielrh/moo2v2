// Engine: the pure, deterministic game core.
//
// Layer rules (enforced by scripts/check-boundaries.mjs):
// - No imports from outside src/engine (zero runtime dependencies).
// - No sources of nondeterminism; randomness comes only from the seeded PRNG.

export const ENGINE_VERSION = '0.10.0'; // init+research change: pre_warp is now the classic MOO2 primitive age — ONLY Engineering pre-completed (colony base/star base/marine barracks buildable turn 1), everything else (computers, lasers, drives, colony ships) researched from scratch, opening with the classic eight fields at list price (the seeded cost multiplier now exempts the whole opening set). Default start mode is now "average" (MOO2 normal opening: 2 scouts + a colony ship; average/advanced head-starts otherwise unchanged). Adds debug unlockAllTech (all fields+apps, gated on debugCommands). 0.9.x replays diverge at init, so old saves load snapshot-first.

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
