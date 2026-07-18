// Marine system: barracks train garrison counters, transports launch with a
// boarded squad, and post-battle landings happen only via the invade order.

import { describe, expect, it } from 'vitest';
import { gameEngine } from '@engine/index';
import { setRelation } from '@engine/battles';
import { trainMarines } from '@engine/ground';
import { marinesOf, MARINES_PER_TRANSPORT } from '@engine/economy';
import { canQueue } from '@engine/items';
import { advanceTurn, resolveCombat } from '@engine/pipeline';
import type { GameState, TurnEvent } from '@engine/types';

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

describe('marine training', () => {
  it('a barracks colony defaults to a full squad and trains to its cap', () => {
    const state = newGame();
    const home = state.colonies.find((c) => c.owner === 0 && c.buildings.includes('marine_barracks'))!;
    expect(marinesOf(home)).toBe(4); // old-save/new-game default: one squad per barracks
    home.marines = 0;
    state.turn = 5;
    trainMarines(state);
    expect(home.marines).toBe(1); // +1 per barracks on training turns
    state.turn = 6;
    trainMarines(state);
    expect(home.marines).toBe(1); // off-cadence turns train nothing
    home.marines = 4;
    state.turn = 10;
    trainMarines(state);
    expect(home.marines).toBe(4); // capped at 4 per barracks
  });
});

describe('transport marine gate', () => {
  it('queueing a transport needs a full squad, counting queued transports', () => {
    const state = newGame();
    const home = state.colonies.find((c) => c.owner === 0 && c.buildings.includes('marine_barracks'))!;
    home.marines = MARINES_PER_TRANSPORT;
    expect(canQueue(state, home, 'transport')).toBeNull();
    home.queue.push({ item: 'transport' });
    expect(canQueue(state, home, 'transport')).toMatch(/marines/); // squad already promised
    home.marines = MARINES_PER_TRANSPORT - 1;
    home.queue = [];
    expect(canQueue(state, home, 'transport')).toMatch(/marines/);
  });

  it('a completed transport boards the squad from the garrison', () => {
    const state = newGame();
    const home = state.colonies.find((c) => c.owner === 0 && c.buildings.includes('marine_barracks'))!;
    home.marines = 4;
    home.queue = [{ item: 'transport' }];
    home.storedProd = 100000; // completes this turn
    advanceTurn(state);
    if (state.phase === 'battle_orders') resolveCombat(state);
    const transport = state.ships.find((s) => s.owner === 0 && s.shipKind === 'transport');
    expect(transport?.marines).toBe(4);
    expect(state.colonies.find((c) => c.id === home.id)!.marines).toBe(0);
  });
});

describe('invade battle order', () => {
  function stageBattle(state: GameState): { colonyId: number; starId: number } {
    setRelation(state, 0, 1, 'war');
    const target = state.colonies.find((c) => c.owner === 1 && !c.outpost)!;
    const starId = state.planets.find((p) => p.id === target.planetId)!.starId;
    // defender loses its fleet and star base; attacker parks a warship +
    // marine lift there so the pass is a sure win
    state.ships = state.ships.filter((s) => !(s.owner === 1 && (s.shipKind === 'design' || s.shipKind === 'scout')));
    target.buildings = target.buildings.filter((b) => b !== 'star_base');
    const design = state.empires.find((e) => e.id === 0)!.designs[0]!;
    state.ships.push({
      id: state.nextId++,
      owner: 0,
      shipKind: 'design',
      designId: design.id,
      location: { kind: 'star', starId },
      cargoPopUnits: 0,
      cargoRace: 0,
      dmgStructure: 0,
      dmgArmor: 0,
    });
    for (let i = 0; i < 10; i++) {
      state.ships.push({
        id: state.nextId++,
        owner: 0,
        shipKind: 'transport',
        designId: null,
        location: { kind: 'star', starId },
        cargoPopUnits: 0,
        cargoRace: 0,
        dmgStructure: 0,
        dmgArmor: 0,
        marines: 4,
      });
    }
    return { colonyId: target.id, starId };
  }

  function fightWith(state: GameState, invade: boolean): TurnEvent[] {
    const res = advanceTurn(state);
    expect(state.phase).toBe('battle_orders');
    const battle = state.pendingBattles.find((b) => b.attacker === 0 && b.defender === 1)!;
    battle.ordersA = { stance: 'charge', priority: 'nearest', retreatThresholdPct: 0, bombard: false, invade };
    const res2 = resolveCombat(state);
    return [...res.events, ...res2.events];
  }

  it('marines stay aboard after a won battle unless invade was ordered', () => {
    const state = newGame();
    const { colonyId } = stageBattle(state);
    const events = fightWith(state, false);
    expect(events.some((e) => e.kind === 'ground_battle')).toBe(false);
    expect(state.colonies.find((c) => c.id === colonyId)!.owner).toBe(1); // held
    expect(state.ships.some((s) => s.owner === 0 && s.shipKind === 'transport')).toBe(true);
  });

  it('the invade order lands the marines and captures the colony', () => {
    const state = newGame();
    const { colonyId } = stageBattle(state);
    const events = fightWith(state, true);
    expect(events.some((e) => e.kind === 'ground_battle')).toBe(true);
    const colony = state.colonies.find((c) => c.id === colonyId)!;
    expect(colony.owner).toBe(0); // 40 marines vs a starting garrison
    expect(colony.marines).toBeGreaterThan(0); // survivors garrison the prize
    // the landing force was spent
    expect(state.ships.some((s) => s.owner === 0 && s.shipKind === 'transport')).toBe(false);
  });
});
