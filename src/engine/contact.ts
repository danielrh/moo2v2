// Empire contact: who has met whom. LEAF module (imports types only) so that
// commands/espionage/leaders/diplomacy/npc can gate cross-empire interactions
// on contact without import cycles. This is also fast-start's soundness
// tripwire: while empireContactPairs(state) is empty the empires cannot
// interact, so the host may resolve turns asynchronously (host.ts fastPump).

import type { GameState } from './types';

/** Race discovery: empires you have actually met — you explored a star holding
 * one of their colonies, your forces share a star with theirs, or you already
 * have dealings (a relations entry or a proposal; espionage establishes a
 * relations entry when a spy is caught — espionage.ts). */
export function metEmpireIds(state: GameState, empireId: number): Set<number> {
  const met = new Set<number>([empireId]);
  const me = state.empires.find((e) => e.id === empireId);
  if (!me) return met;
  const explored = new Set(me.exploredStars);
  const starOfPlanet = new Map(state.planets.map((p) => [p.id, p.starId]));
  for (const c of state.colonies) {
    if (c.owner === empireId) continue;
    const starId = starOfPlanet.get(c.planetId);
    if (starId !== undefined && explored.has(starId)) met.add(c.owner);
  }
  const myStars = new Set<number>();
  for (const s of state.ships) {
    if (s.owner === empireId && s.location.kind === 'star') myStars.add(s.location.starId);
  }
  for (const c of state.colonies) {
    if (c.owner !== empireId) continue;
    const starId = starOfPlanet.get(c.planetId);
    if (starId !== undefined) myStars.add(starId);
  }
  for (const s of state.ships) {
    if (s.owner !== empireId && s.owner >= 0 && s.location.kind === 'star' && myStars.has(s.location.starId)) {
      met.add(s.owner);
    }
  }
  for (const r of state.relations) {
    if (r.a === empireId) met.add(r.b);
    if (r.b === empireId) met.add(r.a);
  }
  for (const p of state.proposals) {
    if (p.to === empireId) met.add(p.from);
    if (p.from === empireId) met.add(p.to);
  }
  return met;
}

/** Pairs of live empires that have met, in either direction (one side seeing
 * the other's colony counts). This is fast-start's contact tripwire: while it
 * is empty the empires cannot interact, so turns may resolve asynchronously. */
export function empireContactPairs(state: GameState): Array<[number, number]> {
  const alive = state.empires.filter((e) => !e.eliminated).map((e) => e.id);
  const met = new Map<number, Set<number>>();
  for (const id of alive) met.set(id, metEmpireIds(state, id));
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i]!;
      const b = alive[j]!;
      if (met.get(a)!.has(b) || met.get(b)!.has(a)) pairs.push([a, b]);
    }
  }
  return pairs;
}

/** True once ANY two live empires have met (or only one empire remains).
 * Pre-contact multiplayer must behave as isolated single-player timelines —
 * cross-empire couplings (shared leader pool, council votes, raid targeting
 * by global population) are deferred until this flips. Solo games (or games
 * reduced to one live empire) count as "in contact" so world actors (Antaran
 * raids, the council's absence) don't switch off entirely. */
export function anyEmpireContact(state: GameState): boolean {
  if (state.empires.filter((e) => !e.eliminated).length <= 1) return true;
  return empireContactPairs(state).length > 0;
}
