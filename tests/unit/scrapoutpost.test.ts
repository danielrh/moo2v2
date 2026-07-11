// bugs.md: outposts can be scrapped from the map menu (25 BC salvage).
import { expect, it } from 'vitest';
import { gameEngine } from '@engine/index';
import { applyCommand, validateCommand } from '@engine/commands';
import type { GameState } from '@engine/types';

const SEED = 'aaaabbbbccccddddeeeeffff00001111';

it('scrap_outpost removes the outpost and salvages 25 BC', () => {
  const state: GameState = gameEngine.init({
    seed: SEED,
    settings: { galaxySize: 'small', startMode: 'average', playerCount: 2, modes: { creativeVariant: false, pickBidding: false, stickyBuild: false, antarans: false, randomEvents: false }, battleOrdersTimeoutMs: 1000, debugCommands: false },
    players: [{ id: 0, name: 'A', raceJson: null }, { id: 1, name: 'B', raceJson: null }],
    dataVersion: 'test',
  });
  const planet = state.planets.find((p) => !state.colonies.some((c) => c.planetId === p.id))!;
  state.colonies.push({
    id: 777, planetId: planet.id, owner: 0, name: 'OP', groups: [], buildings: [], queue: [],
    storedProd: 0, stickyInvested: {}, boughtThisTurn: false, foodLackPrev: 0, prodLackPrev: 0,
    housingPPPrev: 0, outpost: true,
  });
  state.colonies.sort((a, b) => a.id - b.id);
  const bc = state.empires[0]!.bc;

  const bad = { turn: state.turn, playerId: 1, kind: 'scrap_outpost', payload: { colonyId: 777 } };
  expect(validateCommand(state, bad as never)).toBeTruthy(); // not owner

  const home = state.colonies.find((c) => c.owner === 0 && !c.outpost)!;
  const notOutpost = { turn: state.turn, playerId: 0, kind: 'scrap_outpost', payload: { colonyId: home.id } };
  expect(validateCommand(state, notOutpost as never)).toBeTruthy();

  const good = { turn: state.turn, playerId: 0, kind: 'scrap_outpost', payload: { colonyId: 777 } };
  expect(validateCommand(state, good as never)).toBeNull();
  applyCommand(state, good as never, []);
  expect(state.colonies.some((c) => c.id === 777)).toBe(false);
  expect(state.empires[0]!.bc).toBe(bc + 25);
});
