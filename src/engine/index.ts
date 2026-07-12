// Engine: the pure, deterministic game core.
//
// Layer rules (enforced by scripts/check-boundaries.mjs):
// - No imports from outside src/engine (zero runtime dependencies).
// - No sources of nondeterminism; randomness comes only from the seeded PRNG.

export const ENGINE_VERSION = '0.12.0'; // default designs track research: every empire keeps one engine-maintained default design per available hull class (design.auto; init grants the classic Patrol Frigate + a Destroyer). At end of turn, after research/espionage/trades land, the default is refitted with the best known computer, shield and beam/missile mix; the old version is obsoleted (ships in space keep their fit — upgrades still cost a refit) and queued builds/refits migrate to the refreshed design. Auto designs don't count against the 12-design limit. Replays from 0.11.0 diverge at init (the extra Destroyer design), so older saves load snapshot-first.

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
