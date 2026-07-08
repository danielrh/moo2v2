// Engine: the pure, deterministic game core.
//
// Layer rules (enforced by scripts/check-boundaries.mjs):
// - No imports from outside src/engine (zero runtime dependencies).
// - No sources of nondeterminism: Math.random, Date, performance, transcendental
//   Math functions. Randomness comes only from the seeded PRNG in rng.ts.

export const ENGINE_VERSION = '0.1.0';
