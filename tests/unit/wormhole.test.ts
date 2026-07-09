import { describe, expect, it } from 'vitest';
import { gameEngine } from '@engine/index';
import { validateCommand, applyCommand } from '@engine/commands';
import { inRange } from '@engine/movement';
import { moveOptions } from '@engine/selectors';
import type { GameState } from '@engine/types';

const SEED = 'aaaabbbbccccddddeeeeffff00001111';

function newGame(): GameState {
  return gameEngine.init({
    seed: SEED,
    settings: {
      galaxySize: 'small',
      startMode: 'average',
      playerCount: 2,
      modes: { creativeVariant: false, pickBidding: false, stickyBuild: false, antarans: false, randomEvents: false },
      battleOrdersTimeoutMs: 1000,
      debugCommands: false,
    },
    players: [
      { id: 0, name: 'A', raceJson: JSON.stringify({ presetId: 'solari' }) },
      { id: 1, name: 'B', raceJson: JSON.stringify({ presetId: 'solari' }) },
    ],
    dataVersion: 'test',
  });
}

/** wire a wormhole between the player's home star and the farthest star */
function rig(state: GameState) {
  const home = state.colonies.find((c) => c.owner === 0)!;
  const homeStar = state.stars.find(
    (s) => s.id === state.planets.find((p) => p.id === home.planetId)!.starId,
  )!;
  let far = state.stars[0]!;
  let best = -1;
  for (const s of state.stars) {
    const d = (s.x - homeStar.x) ** 2 + (s.y - homeStar.y) ** 2;
    if (d > best) {
      best = d;
      far = s;
    }
  }
  // clear any existing wormholes, then link home <-> far
  for (const s of state.stars) s.wormholeTo = null;
  homeStar.wormholeTo = far.id;
  far.wormholeTo = homeStar.id;
  const scout = state.ships.find((s) => s.owner === 0 && s.shipKind === 'scout')!;
  scout.location = { kind: 'star', starId: homeStar.id };
  return { homeStar, far, scout };
}

describe('wormhole transit without fuel range (bug: outposts beyond range via wormholes)', () => {
  it('allows moving through a wormhole to a star far outside fuel range', () => {
    const state = newGame();
    const { homeStar, far, scout } = rig(state);
    expect(inRange(state, 0, far)).toBe(false); // out of range on a small map corner
    const cmd = {
      turn: state.turn,
      playerId: 0,
      kind: 'move_ships',
      payload: { shipIds: [scout.id], destStarId: far.id },
    };
    expect(validateCommand(state, cmd)).toBeNull();
    applyCommand(state, cmd);
    expect(scout.location).toEqual({
      kind: 'transit',
      from: homeStar.id,
      to: far.id,
      departedTurn: state.turn,
      arrivalTurn: state.turn + 1, // wormholes are always 1 turn
    });
  });

  it('still rejects out-of-range moves that are not through a wormhole', () => {
    const state = newGame();
    const { homeStar, far, scout } = rig(state);
    // pick a different distant star with no wormhole from home
    let other = null;
    for (const s of state.stars) {
      if (s.id === homeStar.id || s.id === far.id) continue;
      if (!inRange(state, 0, s)) other = s;
    }
    if (!other) return; // map layout has everything in range: nothing to assert
    const err = validateCommand(state, {
      turn: state.turn,
      playerId: 0,
      kind: 'move_ships',
      payload: { shipIds: [scout.id], destStarId: other.id },
    });
    expect(err).toContain('out of fuel range');
  });

  it('moveOptions marks the wormhole partner reachable with 1 turn travel', () => {
    const state = newGame();
    const { homeStar, far } = rig(state);
    const opt = moveOptions(state, 0, homeStar.id).find((o) => o.starId === far.id)!;
    expect(opt.reachable).toBe(true);
    expect(opt.turns).toBe(1);
  });
});
