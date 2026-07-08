// Sealed-bid pick auction (pick-bidding optional mode), run in the lobby
// between "start" and game_start:
//
// 1. The host resolves everyone's race config and finds CONTESTED picks —
//    positive-cost, non-government picks chosen by two or more players.
// 2. commit phase: every holder of a contested pick sends
//    hash(canonical({bids, nonce})) — a sealed bid per contested pick they
//    hold. Bids are in pick points, min = the pick's base cost.
// 3. reveal phase: after all commits (or timeout), holders reveal
//    {bids, nonce}; the host verifies each against its commit hash.
// 4. resolution: highest VALID bid wins each pick (ties -> lowest playerId);
//    the winner pays their bid (the premium over base cost must fit their
//    remaining budget or the bid is invalid); losers lose the pick. A pick
//    with no valid bids stays with everyone (failed auction, documented).
//    The outcome is embedded in the game_start payload for the permanent log.

import { hashCanonical } from '@engine/canonical';
import { resolveRaceConfig } from '@engine/adapter';
import { pickById, validatePicks, GOVERNMENTS, MAX_POSITIVE_PICKS } from '@engine/data/index';

export interface AuctionOutcome {
  pickId: string;
  winner: number | null;
  price: number;
}

export function bidHash(bids: Record<string, number>, nonce: string): string {
  return hashCanonical({ bids, nonce });
}

export function resolvedPicks(raceJson: string | null): { picks: string[]; raceName: string } {
  return resolveRaceConfig(raceJson);
}

/** Contested = positive-cost non-government picks held by >= 2 players. */
export function findContested(players: Array<{ id: number; raceJson: string | null }>): Record<string, number[]> {
  const holders = new Map<string, number[]>();
  for (const p of players) {
    for (const pick of resolvedPicks(p.raceJson).picks) {
      const row = pickById.get(pick);
      if (!row || row.cost <= 0) continue;
      if ((GOVERNMENTS as readonly string[]).includes(pick)) continue;
      holders.set(pick, [...(holders.get(pick) ?? []), p.id]);
    }
  }
  const contested: Record<string, number[]> = {};
  for (const [pick, ids] of holders) {
    if (ids.length >= 2) contested[pick] = ids.sort((a, b) => a - b);
  }
  return contested;
}

/** Max premium a player can pay over base costs given the 10-point budget. */
export function budgetSlack(raceJson: string | null): number {
  const { picks } = resolvedPicks(raceJson);
  const v = validatePicks(picks);
  return Math.max(0, MAX_POSITIVE_PICKS - v.cost);
}

export interface ResolveInput {
  contested: Record<string, number[]>;
  players: Array<{ id: number; raceJson: string | null }>;
  reveals: Map<number, { bids: Record<string, number>; nonce: string }>;
  commits: Map<number, string>;
}

export interface ResolveResult {
  outcomes: AuctionOutcome[];
  /** playerId -> adjusted raceJson (losers' contested picks removed) */
  players: Record<string, string>;
}

export function resolveAuction(input: ResolveInput): ResolveResult {
  const outcomes: AuctionOutcome[] = [];
  const losses = new Map<number, Set<string>>(); // player -> picks lost
  const premiumSpent = new Map<number, number>();

  for (const pickId of Object.keys(input.contested).sort()) {
    const holders = input.contested[pickId]!;
    const base = pickById.get(pickId)?.cost ?? 0;
    let winner: number | null = null;
    let best = -1;
    for (const id of holders) {
      const reveal = input.reveals.get(id);
      const commit = input.commits.get(id);
      if (!reveal || !commit) continue; // never committed/revealed: forfeits
      if (bidHash(reveal.bids, reveal.nonce) !== commit) continue; // tampered
      const bid = reveal.bids[pickId];
      if (!Number.isSafeInteger(bid) || bid! < base) continue; // below reserve
      const slack = budgetSlack(input.players.find((p) => p.id === id)?.raceJson ?? null);
      const premium = bid! - base + (premiumSpent.get(id) ?? 0);
      if (premium > slack) continue; // cannot afford the premium
      if (bid! > best || (bid === best && (winner === null || id < winner))) {
        best = bid!;
        winner = id;
      }
    }
    if (winner === null) {
      // failed auction: everyone keeps the pick
      outcomes.push({ pickId, winner: null, price: 0 });
      continue;
    }
    premiumSpent.set(winner, (premiumSpent.get(winner) ?? 0) + (best - base));
    outcomes.push({ pickId, winner, price: best });
    for (const id of holders) {
      if (id === winner) continue;
      losses.set(id, new Set([...(losses.get(id) ?? []), pickId]));
    }
  }

  const players: Record<string, string> = {};
  for (const p of input.players) {
    const { picks, raceName } = resolvedPicks(p.raceJson);
    const lost = losses.get(p.id);
    const finalPicks = lost ? picks.filter((x) => !lost.has(x)) : picks;
    players[String(p.id)] = JSON.stringify({ picks: [...finalPicks].sort(), raceName });
  }
  return { outcomes, players };
}
