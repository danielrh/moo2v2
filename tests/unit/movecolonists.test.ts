import { describe, expect, it } from 'vitest';
import { gameEngine } from '@engine/index';
import { applyCommand, validateCommand } from '@engine/commands';
import { colonyMaxPop } from '@engine/economy';
import type { Colony, GameState } from '@engine/types';

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

/** settle the guaranteed sibling world in the home system for player 0 */
function withSecondColony(state: GameState): { home: Colony; second: Colony } {
  const home = state.colonies.find((c) => c.owner === 0)!;
  const homeStar = state.planets.find((p) => p.id === home.planetId)!.starId;
  const sibling = state.planets.find((p) => p.starId === homeStar && p.id !== home.planetId && p.body === 'planet')!;
  const second: Colony = {
    id: state.nextId++,
    planetId: sibling.id,
    owner: 0,
    name: 'Second',
    groups: [{ race: 0, popK: 2000, farmers: 0, workers: 2, scientists: 0, unrest: false }],
    buildings: [],
    queue: [],
    storedProd: 0,
    stickyInvested: {},
    boughtThisTurn: false,
    foodLackPrev: 0,
    prodLackPrev: 0,
    housingPPPrev: 0,
    outpost: false,
  };
  state.colonies.push(second);
  state.colonies.sort((a, b) => a.id - b.id);
  return { home, second };
}

const cmd = (state: GameState, payload: unknown) => ({
  turn: state.turn,
  playerId: 0,
  kind: 'move_colonists',
  payload,
});

describe('move_colonists (bug: no transports needed for in-system movement)', () => {
  it('moves a colonist between same-system colonies', () => {
    const state = newGame();
    const { home, second } = withSecondColony(state);
    const before = Math.floor(home.groups[0]!.popK / 1000);
    const c = cmd(state, { fromColonyId: home.id, toColonyId: second.id, race: 0, count: 1 });
    expect(validateCommand(state, c)).toBeNull();
    applyCommand(state, c);
    expect(Math.floor(home.groups[0]!.popK / 1000)).toBe(before - 1);
    expect(Math.floor(second.groups[0]!.popK / 1000)).toBe(3);
    // jobs stay consistent with unit counts on both ends
    const g = home.groups[0]!;
    expect(g.farmers + g.workers + g.scientists).toBe(Math.floor(g.popK / 1000));
    const s = second.groups[0]!;
    expect(s.farmers + s.workers + s.scientists).toBe(3);
  });

  it('needs no freighters for in-system moves (MOO2 exception)', () => {
    const state = newGame();
    const { home, second } = withSecondColony(state);
    state.empires[0]!.freighters = 0;
    expect(validateCommand(state, cmd(state, { fromColonyId: home.id, toColonyId: second.id, race: 0, count: 1 }))).toBeNull();
  });

  it('cross-system moves ride freighters: 5 per colonist, travel time, then arrival', () => {
    const state = newGame();
    const { home } = withSecondColony(state);
    const other = state.colonies.find((c) => c.owner === 1)!;
    other.owner = 0; // pretend we own a colony in another system
    const homeStar = state.stars.find((s) => s.id === state.planets.find((p) => p.id === home.planetId)!.starId)!;
    const otherStar = state.stars.find((s) => s.id === state.planets.find((p) => p.id === other.planetId)!.starId)!;
    // link them by wormhole so fuel range cannot interfere (1-turn trip)
    homeStar.wormholeTo = otherStar.id;
    otherStar.wormholeTo = homeStar.id;

    const move = cmd(state, { fromColonyId: home.id, toColonyId: other.id, race: 0, count: 1 });
    // no freighters: rejected with a reason that explains itself
    state.empires[0]!.freighters = 0;
    expect(validateCommand(state, move)).toContain('free freighters');
    // with a fleet: the colonist boards and 5 freighters go busy
    state.empires[0]!.freighters = 5;
    expect(validateCommand(state, move)).toBeNull();
    const before = Math.floor(home.groups[0]!.popK / 1000);
    const otherBefore = Math.floor(other.groups[0]!.popK / 1000);
    applyCommand(state, move);
    expect(Math.floor(home.groups[0]!.popK / 1000)).toBe(before - 1);
    expect(state.popTransits!.length).toBe(1);
    // all freighters busy: a second convoy is refused until they return
    expect(validateCommand(state, cmd(state, { fromColonyId: home.id, toColonyId: other.id, race: 0, count: 1 }))).toContain(
      'free freighters',
    );
    // arrival: 1 turn later the colonist steps off and the freighters free up
    const after = gameEngine.apply(state, { turn: state.turn, playerId: -1, kind: 'advance_turn', payload: {} });
    const final = after.phase === 'battle_orders'
      ? gameEngine.apply(after, { turn: after.turn, playerId: -1, kind: 'resolve_combat', payload: {} })
      : after;
    const otherAfter = final.colonies.find((c) => c.id === other.id)!;
    const units = otherAfter.groups.reduce((n, g) => n + Math.floor(g.popK / 1000), 0);
    expect(units).toBe(otherBefore + 1);
    expect(final.popTransits ?? []).toHaveLength(0);
  });

  it('never abandons the source colony and respects destination capacity', () => {
    const state = newGame();
    const { home, second } = withSecondColony(state);
    const units = Math.floor(home.groups[0]!.popK / 1000);
    expect(validateCommand(state, cmd(state, { fromColonyId: home.id, toColonyId: second.id, race: 0, count: units }))).toContain(
      'last colonist',
    );
    const cap = colonyMaxPop(state, second);
    second.groups[0]!.popK = cap * 1000; // already full
    second.groups[0]!.workers = cap;
    expect(validateCommand(state, cmd(state, { fromColonyId: home.id, toColonyId: second.id, race: 0, count: 1 }))).toContain(
      'full',
    );
  });

  it('outposts cannot receive colonists', () => {
    const state = newGame();
    const { home, second } = withSecondColony(state);
    second.outpost = true;
    expect(validateCommand(state, cmd(state, { fromColonyId: home.id, toColonyId: second.id, race: 0, count: 1 }))).toContain(
      'outposts',
    );
  });
});
