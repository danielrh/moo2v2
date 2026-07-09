import { describe, expect, it } from 'vitest';
import { gameEngine } from '@engine/index';
import { applyCommand, validateCommand } from '@engine/commands';
import { fieldCost, fieldCostMultiplierPct, fieldGrantsAll } from '@engine/research';
import { colonyOutput } from '@engine/economy';
import { FIELD_ROWS, applicationsOfField } from '@engine/data/index';
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
      debugCommands: true,
    },
    players: [
      { id: 0, name: 'A', raceJson: JSON.stringify({ presetId: 'solari' }) }, // non-creative
      { id: 1, name: 'B', raceJson: JSON.stringify({ presetId: 'solari' }) },
    ],
    dataVersion: 'test',
  });
}

function advance(state: GameState): GameState {
  const next = gameEngine.apply(state, { turn: state.turn, playerId: -1, kind: 'advance_turn', payload: {} });
  if (next.phase === 'battle_orders') {
    return gameEngine.apply(next, { turn: next.turn, playerId: -1, kind: 'resolve_combat', payload: {} });
  }
  return next;
}

describe('tier-1 research grants every application (bug: basic fields should research all 3)', () => {
  it('a non-creative empire completing a tier-1 field learns all of its applications', () => {
    let state = newGame();
    const chemistry = FIELD_ROWS.find((f) => f.id === 'chemistry')!;
    expect(fieldGrantsAll(chemistry)).toBe(true);
    // no target application required for a grants-all field
    expect(
      validateCommand(state, {
        turn: state.turn,
        playerId: 0,
        kind: 'set_research',
        payload: { fieldNum: chemistry.num, targetApp: null },
      }),
    ).toBeNull();
    applyCommand(state, { turn: state.turn, playerId: 0, kind: 'set_research', payload: { fieldNum: chemistry.num, targetApp: null } });
    state.empires[0]!.research.accumRP = chemistry.cost; // completes on the next resolution
    state = advance(state);
    const known = state.empires[0]!.knownApps;
    for (const app of applicationsOfField('chemistry')) {
      expect(known).toContain(app.id);
    }
  });

  it('higher-tier fields still grant only the chosen target', () => {
    const advanced = FIELD_ROWS.find((f) => f.id === 'advanced_construction');
    expect(advanced && fieldGrantsAll(advanced)).toBe(false);
  });
});

describe('same-turn fleet re-ordering (bug: cannot re-order fleets before commit)', () => {
  it('a move order placed this turn can be re-routed and cancelled', () => {
    const state = newGame();
    const ship = state.ships.find((s) => s.owner === 0)!;
    const home = (ship.location as { starId: number }).starId;
    const reachable = state.stars.filter(
      (s) => s.id !== home && validateCommand(state, { turn: state.turn, playerId: 0, kind: 'move_ships', payload: { shipIds: [ship.id], destStarId: s.id } }) === null,
    );
    expect(reachable.length).toBeGreaterThanOrEqual(2);
    const [first, second] = reachable;

    applyCommand(state, { turn: state.turn, playerId: 0, kind: 'move_ships', payload: { shipIds: [ship.id], destStarId: first!.id } });
    expect(ship.location.kind).toBe('transit');

    // re-route to a different destination in the same turn
    expect(
      validateCommand(state, { turn: state.turn, playerId: 0, kind: 'move_ships', payload: { shipIds: [ship.id], destStarId: second!.id } }),
    ).toBeNull();
    applyCommand(state, { turn: state.turn, playerId: 0, kind: 'move_ships', payload: { shipIds: [ship.id], destStarId: second!.id } });
    expect((ship.location as { to: number }).to).toBe(second!.id);
    expect((ship.location as { from: number }).from).toBe(home);

    // cancel by ordering it back to its origin
    applyCommand(state, { turn: state.turn, playerId: 0, kind: 'move_ships', payload: { shipIds: [ship.id], destStarId: home } });
    expect(ship.location).toEqual({ kind: 'star', starId: home });
  });
});

describe('sell_building (bug: be able to sell buildings)', () => {
  it('sells for half cost, one per colony per turn, and resets next turn', () => {
    let state = newGame();
    const colony = state.colonies.find((c) => c.owner === 0)!;
    expect(colony.buildings).toContain('star_base');
    const bcBefore = state.empires[0]!.bc;
    expect(
      validateCommand(state, { turn: state.turn, playerId: 0, kind: 'sell_building', payload: { colonyId: colony.id, buildingId: 'star_base' } }),
    ).toBeNull();
    applyCommand(state, { turn: state.turn, playerId: 0, kind: 'sell_building', payload: { colonyId: colony.id, buildingId: 'star_base' } });
    expect(colony.buildings).not.toContain('star_base');
    expect(state.empires[0]!.bc).toBeGreaterThan(bcBefore);
    // second sale the same turn is rejected
    expect(
      validateCommand(state, { turn: state.turn, playerId: 0, kind: 'sell_building', payload: { colonyId: colony.id, buildingId: 'marine_barracks' } }),
    ).toMatch(/already sold/);
    state = advance(state);
    const after = state.colonies.find((c) => c.id === colony.id)!;
    expect(after.soldThisTurn).toBe(false);
  });
});
