import { describe, expect, it } from 'vitest';
import { gameEngine } from '@engine/index';
import { applyCommand, validateCommand } from '@engine/commands';
import { fieldCost, fieldGrantsAll } from '@engine/research';
import { FIELD_ROWS, applicationsOfField, fieldById, startingFieldNums } from '@engine/data/index';
import type { GameState } from '@engine/types';

const SEED = 'aaaabbbbccccddddeeeeffff00001111';

function newGame(): GameState {
  return gameEngine.init({
    seed: SEED,
    settings: {
      galaxySize: 'small',
      startMode: 'pre_warp', // the default mode where cold_fusion must be researched
      playerCount: 2,
      modes: { creativeVariant: false, pickBidding: false, stickyBuild: false, antarans: false, randomEvents: false },
      battleOrdersTimeoutMs: 1000,
      debugCommands: false,
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

describe('tech tree matches the mechanics docs (bug: Cold Fusion must research everything at once)', () => {
  it('the "(General)" grant-all set is exactly the five tier-1 roots + cold_fusion', () => {
    const general = FIELD_ROWS.filter((f) => fieldGrantsAll(f))
      .map((f) => f.id)
      .sort();
    expect(general).toEqual(['chemistry', 'cold_fusion', 'electronics', 'engineering', 'nuclear_fission', 'physics']);
  });

  it('cold_fusion holds colony ship, freighters, outpost ship, and transport', () => {
    const apps = applicationsOfField('cold_fusion')
      .map((a) => a.id)
      .sort();
    expect(apps).toEqual(['colony_ship', 'freighters', 'outpost_ship', 'transport']);
  });

  it('a non-creative pre-warp empire researching cold_fusion gets ALL four applications', () => {
    let state = newGame();
    // pre-warp starts must not already know the cold_fusion ships
    expect(startingFieldNums('pre_warp')).not.toContain(FIELD_ROWS.find((f) => f.id === 'cold_fusion')!.num);
    const cf = FIELD_ROWS.find((f) => f.id === 'cold_fusion')!;
    // pre-warp pre-completes ONLY Engineering (construction basics), so
    // cold_fusion's prerequisite (nuclear_fission) must be earned first.
    expect(state.empires[0]!.completedFields).toEqual([fieldById.get('engineering')!.num]);
    const research = (fieldNum: number) => {
      const cmd = { turn: state.turn, playerId: 0, kind: 'set_research', payload: { fieldNum, targetApp: null } };
      expect(validateCommand(state, cmd)).toBeNull();
      applyCommand(state, cmd);
      state.empires[0]!.research.accumRP = 10_000; // covers any cost multiplier
      state = advance(state);
    };
    research(cf.previous); // nuclear_fission
    expect(state.empires[0]!.completedFields).toContain(cf.previous);
    research(cf.num); // cold_fusion (grants-all; no target needed)
    const known = state.empires[0]!.knownApps;
    for (const app of ['colony_ship', 'freighters', 'outpost_ship', 'transport']) {
      expect(known).toContain(app);
    }
    expect(state.empires[0]!.completedFields).toContain(cf.num);
  });

  it('even grants-all basics have a hidden discovery line past list price (improvements.md)', () => {
    const state = newGame();
    for (const f of FIELD_ROWS.filter((x) => fieldGrantsAll(x))) {
      const line = fieldCost(state, state.empires[0]!, f);
      expect(line).toBeGreaterThan(f.cost);
      expect(line).toBeLessThanOrEqual(2 * f.cost);
    }
  });
});
