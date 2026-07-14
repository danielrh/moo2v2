import { describe, expect, it } from 'vitest';
import { canQueue, itemCost, resolveTraits, type Colony, type GameState } from '@engine/index';
import { advanceTurn } from '@engine/pipeline';

// Planetary construction (artificial_planet, unlocked by
// artificial_planet_construction): a colony project that converts an asteroid
// belt or gas giant in its system into a barren planet.

function makeState(opts?: { bodies?: Array<'asteroids' | 'gas_giant'>; known?: boolean }): GameState {
  const bodies = opts?.bodies ?? ['asteroids'];
  const colony: Colony = {
    id: 100,
    planetId: 10,
    owner: 0,
    name: 'Home',
    groups: [{ race: 0, popK: 8000, farmers: 4, workers: 4, scientists: 0, unrest: false }],
    buildings: ['marine_barracks'],
    queue: [],
    storedProd: 0,
    stickyInvested: {},
    boughtThisTurn: false,
    foodLackPrev: 0,
    prodLackPrev: 0,
    housingPPPrev: 0,
    outpost: false,
  } as unknown as Colony;
  const state = {
    turn: 1,
    seed: '0123456789abcdef0123456789abcdef',
    settings: {
      galaxySize: 'small',
      startMode: 'average',
      playerCount: 1,
      modes: { creativeVariant: false, pickBidding: false, stickyBuild: false, antarans: false, randomEvents: false },
      battleOrdersTimeoutMs: 1000,
      debugCommands: false,
    },
    nextId: 1000,
    stars: [{ id: 1, name: 'Alpha', x: 0, y: 0, color: 'yellow', wormholeTo: null }],
    planets: [
      { id: 10, starId: 1, orbit: 3, body: 'planet', sizeClass: 3, climate: 'terran', minerals: 'abundant', gravity: 'normal', special: null, homeworldOf: 0, terraformSteps: 0 },
      ...bodies.map((body, i) => ({
        id: 11 + i,
        starId: 1,
        orbit: 4 + i,
        body,
        sizeClass: 3,
        climate: 'barren',
        minerals: 'rich',
        gravity: 'normal',
        special: null,
        homeworldOf: null,
        terraformSteps: 0,
      })),
    ],
    empires: [
      {
        id: 0,
        name: 'Tester',
        raceName: 'Test Race',
        picks: ['dictatorship'],
        government: resolveTraits(['dictatorship']).government,
        bc: 1000,
        freighters: 0,
        research: { fieldNum: null, targetApp: null, accumRP: 0, extraQueue: [], extraAccumRP: 0, hyperLevels: {} },
        knownApps: opts?.known === false ? [] : ['artificial_planet_construction'],
        completedFields: [],
        exploredStars: [1],
        designs: [],
        spies: { count: 0, target: null, mode: 'steal' },
        leaders: [],
        eliminated: false,
      },
    ],
    colonies: [] as Colony[],
    ships: [],
    phase: 'planning',
    pendingBattles: [],
    relations: [],
    proposals: [],
    council: { nextVoteTurn: 25, pending: null },
    leaderOffers: [],
    winner: null,
    winType: null,
    monsters: [],
    replays: [],
    groundBattles: [],
    events: [],
  } as unknown as GameState;
  state.colonies.push(colony);
  return state;
}

describe('planetary construction project', () => {
  it('requires the tech and a convertible body in-system', () => {
    expect(canQueue(makeState({ known: false }), makeState({ known: false }).colonies[0]!, 'artificial_planet')).toMatch(/not researched/);
    expect(canQueue(makeState(), makeState().colonies[0]!, 'artificial_planet')).toBeNull();
    const noBodies = makeState({ bodies: [] });
    expect(canQueue(noBodies, noBodies.colonies[0]!, 'artificial_planet')).toMatch(/no asteroid belt or gas giant/);
  });

  it('refuses queuing more conversions than candidate bodies', () => {
    const state = makeState({ bodies: ['asteroids'] });
    state.colonies[0]!.queue.push({ item: 'artificial_planet' });
    expect(canQueue(state, state.colonies[0]!, 'artificial_planet')).toMatch(/only 1 convertible/);
  });

  it('converts an asteroid belt into a medium barren planet on completion', () => {
    const state = makeState({ bodies: ['asteroids'] });
    const colony = state.colonies[0]!;
    colony.queue.push({ item: 'artificial_planet' });
    colony.storedProd = (itemCost(state, 0, 'artificial_planet', colony) ?? 500) + 50;
    advanceTurn(state);
    const converted = state.planets.find((p) => p.id === 11)!;
    expect(converted.body).toBe('planet');
    expect(converted.climate).toBe('barren');
    expect(converted.sizeClass).toBe(3);
    expect(converted.minerals).toBe('rich'); // minerals carry over
  });

  it('converts a gas giant into a huge barren planet', () => {
    const state = makeState({ bodies: ['gas_giant'] });
    const colony = state.colonies[0]!;
    colony.queue.push({ item: 'artificial_planet' });
    colony.storedProd = (itemCost(state, 0, 'artificial_planet', colony) ?? 500) + 50;
    advanceTurn(state);
    const converted = state.planets.find((p) => p.id === 11)!;
    expect(converted.body).toBe('planet');
    expect(converted.sizeClass).toBe(5);
  });
});
