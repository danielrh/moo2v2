// Engine: the pure, deterministic game core.
//
// Layer rules (enforced by scripts/check-boundaries.mjs):
// - No imports from outside src/engine (zero runtime dependencies).
// - No sources of nondeterminism; randomness comes only from the seeded PRNG.

export const ENGINE_VERSION = '0.11.0'; // init change: the "average" start is the classic MOO2 normal opening — the five tier-1 roots + Cold Fusion completed (electronic computer known, Optronics NOT), so the first research screen offers the classic eight: advanced engineering 80, advanced fusion 250, advanced metallurgy 250, military tactics 150, optronics 150, astro ecology 80, fusion physics 150, advanced magnetism 250. Average empires no longer begin with deuterium fuel cells (4 pc fuel range until researched), class I shields, fighter bays, space academies or research labs; average and advanced now share the same tech grant. Also in 0.10.1: the fuel/supply network extends through wormholes — a star whose wormhole partner is inside the network is itself in supply, so fleets at either end hold station instead of stranded-retreating. 0.10.x replays diverge at init for average games, so older saves load snapshot-first.

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
