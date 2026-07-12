// Regression locks for the 2026-07-12 bugfix pass (discovered_bugs.md).
// Each describe() names the finding it pins.

import { describe, expect, it } from 'vitest';
import { gameEngine } from '@engine/adapter';
import { applyCommand, validateCommand } from '@engine/commands';
import { advanceTurn, resolveCombat } from '@engine/pipeline';
import { buildBattleInput, retreatDestination } from '@engine/battles';
import { resolveEspionage } from '@engine/espionage';
import { resolveInvasions } from '@engine/ground';
import { leaderCombatBonuses, leadersUpkeep, LEADERS } from '@engine/leaders';
import { diplomacyUpkeep } from '@engine/diplomacy';
import { applyResearch, grantApp } from '@engine/research';
import { baseDesign, designStats, knownWeapons } from '@engine/shipdesign';
import { runBattle, DEFAULT_ORDERS, RETREAT_WARP_TICKS, FIELD_W, FIELD_H, FP, type BattleInput, type CombatShipInit, type BattleOrders } from '@engine/combat';
import { rngFor } from '@engine/rng';
import { starDistance, HOP_RANGE_CP } from '@engine/galaxy';
import { colonyOutput, farmingViable } from '@engine/economy';
import { NATIVE_RACE, type GameState, type RelationEntry, type TurnEvent } from '@engine/types';

const SEED = 'aaaabbbbccccddddeeeeffff00001111';

function newGame(
  startMode: 'pre_warp' | 'average' | 'advanced' = 'average',
  over: Record<string, unknown> = {},
  seed = SEED,
): GameState {
  return gameEngine.init({
    seed,
    settings: {
      galaxySize: 'small',
      startMode,
      playerCount: 2,
      modes: { creativeVariant: false, pickBidding: false, stickyBuild: false, antarans: false, randomEvents: false },
      battleOrdersTimeoutMs: 1000,
      debugCommands: true,
      ...over,
    },
    players: [
      { id: 0, name: 'A', raceJson: JSON.stringify({ presetId: 'solari' }) },
      { id: 1, name: 'B', raceJson: JSON.stringify({ presetId: 'solari' }) },
    ],
    dataVersion: 'test',
  });
}

const peaceRelation = (a: number, b: number): RelationEntry => ({
  a,
  b,
  status: 'peace',
  peaceOfferedBy: [],
  treaties: { nap: false, alliance: false, trade: false, research: false },
});

describe('#1: diplo_propose rider fields cannot poison hashed state', () => {
  it('rejects stray non-integer riders on any kind and stores riders kind-gated', () => {
    const state = newGame();
    state.relations.push(peaceRelation(0, 1));
    for (const payload of [
      { to: 1, kind: 'non_aggression', giveBc: 0.5 },
      { to: 1, kind: 'trade', giveBc: NaN },
      { to: 1, kind: 'trade', giveApp: 0.25 },
    ]) {
      expect(
        validateCommand(state, { turn: state.turn, playerId: 0, kind: 'diplo_propose', payload }),
      ).not.toBeNull();
    }
    // a stray INTEGER rider on a non-gift kind validates (harmless) but must
    // not reach state: the applier is total
    const cmd = { turn: state.turn, playerId: 0, kind: 'diplo_propose', payload: { to: 1, kind: 'non_aggression', giveBc: 7 } };
    expect(validateCommand(state, cmd)).toBeNull();
    applyCommand(state, cmd);
    const prop = state.proposals[state.proposals.length - 1]!;
    expect(prop.giveBc).toBe(0);
    expect(prop.giveApp).toBeNull();
    expect(() => gameEngine.hash(state)).not.toThrow();
  });
});

describe('#4: save_design rejects base hulls', () => {
  it('star_base and star_fortress are not designable ships', () => {
    const state = newGame();
    for (const hull of ['star_base', 'star_fortress', 'battlestation']) {
      expect(
        validateCommand(state, {
          turn: state.turn,
          playerId: 0,
          kind: 'save_design',
          payload: { name: 'Fort', hull, computer: 0, shield: 0, specials: [], weapons: [{ weapon: 'laser_cannon', count: 1, mods: [] }] },
        }),
      ).toMatch(/hull not yet available/);
    }
  });
});

describe('#5: death_ray does not break base auto-designs', () => {
  it('baseDesign fits weapon counts to the hull space after the Guardian prize', () => {
    const state = newGame();
    const e = state.empires[0]!;
    grantApp(e, 'death_ray');
    for (const hull of ['star_base', 'battlestation', 'star_fortress']) {
      const design = baseDesign(state, e, hull);
      expect(design.weapons.length).toBeGreaterThan(0);
      const stats = designStats(state, e, design);
      expect(typeof stats, `${hull}: ${String(stats)}`).not.toBe('string');
    }
  });
});

describe('#6/#28: espionage requires contact and steals only real applications', () => {
  it('rejects spy orders against a never-met empire and clears stale ones', () => {
    const state = newGame();
    expect(
      validateCommand(state, { turn: state.turn, playerId: 0, kind: 'set_spy_orders', payload: { target: 1, mode: 'sabotage' } }),
    ).toMatch(/not met/);
    // stale order from an old save: skipped and cleared, target untouched
    state.empires[0]!.spies = { count: 10, target: 1, mode: 'sabotage' };
    const before = JSON.stringify(state.colonies.filter((c) => c.owner === 1));
    resolveEspionage(state, []);
    expect(state.empires[0]!.spies.target).toBeNull();
    expect(JSON.stringify(state.colonies.filter((c) => c.owner === 1))).toBe(before);
  });

  it('synthetic hyper_advanced markers are never stolen', () => {
    const state = newGame();
    state.relations.push(peaceRelation(0, 1));
    const a = state.empires[0]!;
    const b = state.empires[1]!;
    b.knownApps = [...new Set([...a.knownApps, 'hyper_advanced_power'])].sort(); // only diff is synthetic
    a.spies = { count: 10, target: 1, mode: 'steal' };
    for (let t = 0; t < 30; t++) {
      resolveEspionage(state, []);
      state.turn++;
      a.spies.count = 10;
    }
    expect(a.knownApps).not.toContain('hyper_advanced_power');
  });
});

describe('#7: leader market is per-empire before first contact', () => {
  it("pre-contact, another empire's hire does not cancel my standing offer", () => {
    const state = newGame();
    state.leaderOffers.push({ empireId: 0, leaderId: 'ruola', priceBc: 10, expiresTurn: state.turn + 5 });
    state.empires[1]!.leaders.push({ leaderId: 'ruola', level: 1, xp: 0, colonyId: null });
    leadersUpkeep(state, []);
    expect(state.leaderOffers.some((o) => o.empireId === 0 && o.leaderId === 'ruola')).toBe(true);
    // and my hire still validates pre-contact
    state.empires[0]!.bc = 1000;
    expect(
      validateCommand(state, { turn: state.turn, playerId: 0, kind: 'hire_leader', payload: { leaderId: 'ruola' } }),
    ).toBeNull();
    // once contact exists the market is global again
    state.relations.push(peaceRelation(0, 1));
    leadersUpkeep(state, []);
    expect(state.leaderOffers.some((o) => o.empireId === 0 && o.leaderId === 'ruola')).toBe(false);
  });

  it('#27: Loknar never appears in the ordinary offer stream', () => {
    const state = newGame();
    state.relations.push(peaceRelation(0, 1));
    for (let t = 0; t < 300; t++) {
      leadersUpkeep(state, []);
      state.turn++;
    }
    expect(LEADERS.some((l) => l.id === 'loknar')).toBe(true); // he exists…
    expect(state.leaderOffers.every((o) => o.leaderId !== 'loknar')).toBe(true); // …but never walks in
  });
});

describe('#8: the council waits for first contact', () => {
  it('slides while everyone is a stranger, convenes after contact', () => {
    const state = newGame();
    state.council.nextVoteTurn = state.turn;
    diplomacyUpkeep(state, []);
    expect(state.council.pending).toBeNull();
    expect(state.council.nextVoteTurn).toBeGreaterThan(state.turn);
    state.relations.push(peaceRelation(0, 1));
    state.council.nextVoteTurn = state.turn;
    diplomacyUpkeep(state, []);
    expect(state.council.pending).not.toBeNull();
  });
});

describe('#10: invasion civilian losses land on 1-unit groups', () => {
  it('multi-race colonies bleed, and the report matches the state', () => {
    const state = newGame();
    state.relations.push({ ...peaceRelation(0, 1), status: 'war' });
    const colony = state.colonies.find((c) => c.owner === 1)!;
    colony.groups = [
      { race: 1, popK: 1000, farmers: 1, workers: 0, scientists: 0, unrest: false },
      { race: 0, popK: 1000, farmers: 0, workers: 1, scientists: 0, unrest: false },
      { race: 5, popK: 1000, farmers: 0, workers: 1, scientists: 0, unrest: false },
    ];
    const planet = state.planets.find((p) => p.id === colony.planetId)!;
    // a big landing force with no defenders
    state.ships = state.ships.filter((s) => s.owner !== 1);
    for (let i = 0; i < 3; i++) {
      state.ships.push({
        id: 40_000_000 + i,
        owner: 0,
        shipKind: 'transport',
        designId: null,
        location: { kind: 'star', starId: planet.starId },
        cargoPopUnits: 2,
        cargoRace: 0,
        dmgStructure: 0,
        dmgArmor: 0,
      });
    }
    const events: TurnEvent[] = [];
    resolveInvasions(state, events);
    const ground = events.find((e) => e.kind === 'ground_battle')!;
    const reported = ground.payload['civilianLosses'] as number;
    const unitsLeft = colony.groups.reduce((s, g) => s + Math.floor(g.popK / 1000), 0);
    expect(3 - unitsLeft).toBe(reported); // deaths reported = deaths applied
    expect(unitsLeft).toBeGreaterThanOrEqual(1); // the colony keeps its last unit
  });
});

describe('#11: multi-race colonies keep their last colonist', () => {
  it('a two-race colony starved to fractions survives like a single-race one', () => {
    const state = newGame();
    const colony = state.colonies.find((c) => c.owner === 0)!;
    colony.groups = [
      { race: 0, popK: 1000, farmers: 1, workers: 0, scientists: 0, unrest: false },
      { race: 1, popK: 1000, farmers: 0, workers: 1, scientists: 0, unrest: false },
    ];
    colony.foodLackPrev = 10; // heavy starvation pressure
    const next = structuredClone(state);
    advanceTurn(next);
    const survived = next.colonies.some((c) => c.id === colony.id);
    expect(survived).toBe(true);
    const total = next.colonies.find((c) => c.id === colony.id)!.groups.reduce((s, g) => s + g.popK, 0);
    expect(total).toBeGreaterThanOrEqual(1000);
  });
});

describe('#12: Orion placement never cuts the home-to-home hop path', () => {
  it('the unguarded colonizable hop graph stays connected across seeds', () => {
    for (const seed of ['deadbeefdeadbeefdeadbeefdeadbeef', 'abcdefabcdefabcdefabcdefabcd0002', SEED]) {
      const s = gameEngine.init({
        seed,
        settings: {
          galaxySize: 'medium',
          startMode: 'average',
          playerCount: 4,
          modes: { creativeVariant: false, pickBidding: false, stickyBuild: false, antarans: false, randomEvents: false },
          battleOrdersTimeoutMs: 1000,
          debugCommands: false,
        },
        players: [0, 1, 2, 3].map((id) => ({ id, name: `P${id}`, raceJson: JSON.stringify({ presetId: 'solari' }) })),
        dataVersion: 'test',
      });
      const homeStars = new Set(
        s.colonies.map((c) => s.planets.find((p) => p.id === c.planetId)!.starId),
      );
      const guarded = new Set(s.monsters.map((m) => m.starId));
      const nodes = s.stars.filter(
        (st) => homeStars.has(st.id) || (!guarded.has(st.id) && s.planets.some((p) => p.starId === st.id)),
      );
      const parent = new Map<number, number>(nodes.map((n) => [n.id, n.id]));
      const find = (id: number): number => {
        let r = id;
        while (parent.get(r) !== r) r = parent.get(r)!;
        return r;
      };
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          if (starDistance(nodes[i]!, nodes[j]!) <= HOP_RANGE_CP) parent.set(find(nodes[i]!.id), find(nodes[j]!.id));
        }
      }
      const roots = new Set([...homeStars].map((id) => find(id)));
      expect(roots.size, `seed ${seed}`).toBe(1);
    }
  });
});

// ---------- combat behavior (#13, #14, #20) ----------

function frigate(shipId: number, side: 0 | 1, over: Partial<CombatShipInit> = {}): CombatShipInit {
  return {
    shipId,
    side,
    hull: 'frigate',
    hullIdx: 1,
    isBase: false,
    beamAttack: 50,
    beamDefense: 25,
    speed: 8,
    armorHp: 30,
    structureHp: 30,
    shieldPool: 0,
    shieldFlat: 0,
    weapons: [{ weaponId: 'laser_cannon', classId: 0, dmgMin: 1, dmgMax: 4, mods: [], ammo: -1, cooldown: 0, count: 2 }],
    startingStructure: 30,
    startingArmor: 30,
    specials: [],
    ...over,
  };
}

function titan(shipId: number, side: 0 | 1): CombatShipInit {
  return frigate(shipId, side, {
    hull: 'titan',
    hullIdx: 5,
    speed: 4,
    armorHp: 300,
    structureHp: 300,
    startingStructure: 300,
    startingArmor: 300,
    weapons: [{ weaponId: 'laser_cannon', classId: 0, dmgMin: 2, dmgMax: 6, mods: [], ammo: -1, cooldown: 0, count: 6 }],
  });
}

function probe(label: string, ships: CombatShipInit[], ordersA: BattleOrders, ordersD: BattleOrders) {
  const input: BattleInput = {
    battleId: label,
    seedLabel: [1, 'battle', label],
    attacker: 0,
    defender: 1,
    ships,
    ordersA,
    ordersD,
  };
  const corner = new Map<number, number>();
  const dwell = new Map<number, number>();
  const result = runBattle(input, rngFor(SEED, ...input.seedLabel), (f) => {
    for (const s of f.ships) {
      if (!(s.alive && !s.retreated && !s.crossed)) continue;
      const m = 48 * FP;
      const inCorner = (s.x <= m || s.x >= FIELD_W - m) && (s.y <= m || s.y >= FIELD_H - m);
      const d = inCorner ? (dwell.get(s.id) ?? 0) + 1 : 0;
      dwell.set(s.id, d);
      corner.set(s.id, Math.max(corner.get(s.id) ?? 0, d));
    }
  });
  return { result, corner };
}

const orders = (stance: BattleOrders['stance'], extra: Partial<BattleOrders> = {}): BattleOrders => ({
  stance,
  priority: 'nearest',
  retreatThresholdPct: 25,
  bombard: false,
  ...extra,
});

describe('#13: formation no longer grinds into corners', () => {
  it('no formation ship dwells in a corner for long', () => {
    for (let n = 0; n < 3; n++) {
      const ships = [
        ...[1, 2, 3, 4, 5, 6].map((i) => frigate(i, 0, { speed: i === 1 ? 3 : 9 })),
        ...[11, 12, 13, 14].map((i) => frigate(i, 1)),
      ];
      const { corner } = probe(`form-${n}`, ships, orders('formation', { retreatThresholdPct: 0 }), orders('charge', { retreatThresholdPct: 0 }));
      for (const [id, maxDwell] of corner) {
        expect(maxDwell, `ship ${id}`).toBeLessThan(30); // was 57-69 consecutive ticks
      }
    }
  });
});

describe('#14: threshold retreat actually saves ships (warp-out)', () => {
  it('a cautious retreat threshold gets survivors OUT of a losing fight', () => {
    let escapedTotal = 0;
    for (let n = 0; n < 3; n++) {
      const ships = [
        ...Array.from({ length: 6 }, (_, i) => titan(i + 1, 0)),
        ...Array.from({ length: 8 }, (_, i) => frigate(i + 11, 1, { speed: 9 })),
      ];
      // a 60% threshold flips while most of the fleet still lives — before
      // the warp-out fix, even these early retreaters were all run down
      // stern-first (0/34 escaped across every probed scenario)
      const { result } = probe(`thresh-${n}`, ships, orders('charge', { retreatThresholdPct: 0 }), orders('charge', { retreatThresholdPct: 60 }));
      escapedTotal += result.outcomes.filter((o) => o.side === 1 && o.retreated && !o.destroyed).length;
    }
    expect(escapedTotal).toBeGreaterThan(0);
    expect(RETREAT_WARP_TICKS).toBeGreaterThan(0);
  });
});

describe('#20: dissipater-pinned ships fight instead of grinding the wall', () => {
  it('pinned retreaters never mark retreated and still shoot back', () => {
    const ships = [
      ...[1, 2, 3].map((i) => frigate(i, 0, { specials: ['warp_dissipater'] })),
      ...[11, 12, 13].map((i) => frigate(i, 1)),
    ];
    const input: BattleInput = {
      battleId: 'pin',
      seedLabel: [1, 'battle', 'pin'],
      attacker: 0,
      defender: 1,
      ships,
      ordersA: { ...DEFAULT_ORDERS, retreatThresholdPct: 0 },
      ordersD: orders('evade_retreat', { retreatThresholdPct: 0 }),
    };
    let defenderShots = 0;
    const result = runBattle(input, rngFor(SEED, ...input.seedLabel), (f) => {
      defenderShots += f.shots.filter((sh) => [11, 12, 13].includes(sh.from)).length;
    });
    expect(result.outcomes.filter((o) => o.side === 1).every((o) => !o.retreated)).toBe(true);
    expect(defenderShots).toBeGreaterThan(0); // they turned and fought
  });
});

describe('retreat destinations (user spec)', () => {
  it('a ship retreating at its own colony star stays; otherwise nearest colony', () => {
    const state = newGame();
    const home = state.colonies.find((c) => c.owner === 0)!;
    const homeStar = state.planets.find((p) => p.id === home.planetId)!.starId;
    expect(retreatDestination(state, 0, homeStar)).toBeNull(); // already at the nearest colony
    const elsewhere = state.stars.find((s) => s.id !== homeStar)!;
    const dest = retreatDestination(state, 0, elsewhere.id);
    expect(dest?.starId).toBe(homeStar);
    expect(dest!.arrivalTurn).toBeGreaterThan(state.turn);
  });

  it('a ship stranded beyond fuel range fights on arrival, then auto-retreats home', () => {
    const state = newGame();
    const home = state.colonies.find((c) => c.owner === 0)!;
    const homeStar = state.stars.find((s) => s.id === state.planets.find((p) => p.id === home.planetId)!.starId)!;
    // the farthest star, guaranteed beyond the 400cp base fuel range
    const far = [...state.stars].sort((a, b) => starDistance(homeStar, b) - starDistance(homeStar, a))[0]!;
    expect(starDistance(homeStar, far)).toBeGreaterThan(400);
    // a lone monster guards it: the stranded ship must FIGHT on arrival
    state.monsters = [{ id: 900001, kind: 'amoeba', starId: far.id, dmgStructure: 0 }];
    state.ships.push({
      id: 40_000_000,
      owner: 0,
      shipKind: 'design',
      designId: state.empires[0]!.designs[0]!.id,
      location: { kind: 'star', starId: far.id },
      cargoPopUnits: 0,
      cargoRace: 0,
      dmgStructure: 0,
      dmgArmor: 0,
    });
    state.ships.sort((a, b) => a.id - b.id);
    advanceTurn(state);
    expect(state.phase).toBe('battle_orders'); // it fought upon arrival
    const events = resolveCombat(state).events;
    const ship = state.ships.find((s) => s.id === 40_000_000);
    if (ship) {
      // survivor: automatically retreating to the nearest colony
      expect(ship.location.kind).toBe('transit');
      expect((ship.location as { to: number }).to).toBe(homeStar.id);
      expect(events.some((e) => e.kind === 'ship_stranded_retreat')).toBe(true);
    }
  });

  it('losing the range anchor sends ships home next turn', () => {
    const state = newGame();
    const home = state.colonies.find((c) => c.owner === 0)!;
    const homeStar = state.stars.find((s) => s.id === state.planets.find((p) => p.id === home.planetId)!.starId)!;
    const far = [...state.stars].sort((a, b) => starDistance(homeStar, b) - starDistance(homeStar, a))[0]!;
    // an outpost at the far star anchors the ship in range…
    state.colonies.push({
      id: 30_000_001,
      planetId: state.planets.find((p) => p.starId === far.id)?.id ?? state.planets[0]!.id,
      owner: 0,
      name: 'Anchor',
      groups: [],
      buildings: [],
      queue: [],
      storedProd: 0,
      stickyInvested: {},
      boughtThisTurn: false,
      foodLackPrev: 0,
      prodLackPrev: 0,
      housingPPPrev: 0,
      outpost: true,
    });
    state.colonies.sort((a, b) => a.id - b.id);
    const anchorPlanet = state.colonies.find((c) => c.id === 30_000_001)!.planetId;
    const anchorStar = state.planets.find((p) => p.id === anchorPlanet)!.starId;
    state.ships.push({
      id: 40_000_000,
      owner: 0,
      shipKind: 'design',
      designId: state.empires[0]!.designs[0]!.id,
      location: { kind: 'star', starId: anchorStar },
      cargoPopUnits: 0,
      cargoRace: 0,
      dmgStructure: 0,
      dmgArmor: 0,
    });
    state.ships.sort((a, b) => a.id - b.id);
    state.monsters = state.monsters.filter((m) => m.starId !== anchorStar); // no lair fight in this scenario
    advanceTurn(state);
    expect(state.ships.find((s) => s.id === 40_000_000)!.location.kind).toBe('star'); // in range: stays
    // …then the outpost is lost
    state.colonies = state.colonies.filter((c) => c.id !== 30_000_001);
    advanceTurn(state);
    const ship = state.ships.find((s) => s.id === 40_000_000)!;
    if (anchorStar !== homeStar.id && starDistance(homeStar, state.stars.find((s) => s.id === anchorStar)!) > 400) {
      expect(ship.location.kind).toBe('transit');
      expect((ship.location as { to: number }).to).toBe(homeStar.id);
    }
  });
});

describe('#15: stranded ships may only move back toward the supply network', () => {
  it('rejects lateral warps from beyond fuel range', () => {
    const state = newGame();
    const home = state.colonies.find((c) => c.owner === 0)!;
    const homeStar = state.stars.find((s) => s.id === state.planets.find((p) => p.id === home.planetId)!.starId)!;
    const byDist = [...state.stars].sort((a, b) => starDistance(homeStar, b) - starDistance(homeStar, a));
    const far = byDist[0]!;
    if (starDistance(homeStar, far) <= 400) return; // tiny map: nothing is stranded
    state.ships.push({
      id: 40_000_000,
      owner: 0,
      shipKind: 'scout',
      designId: null,
      location: { kind: 'star', starId: far.id },
      cargoPopUnits: 0,
      cargoRace: 0,
      dmgStructure: 0,
      dmgArmor: 0,
    });
    state.ships.sort((a, b) => a.id - b.id);
    // a destination FARTHER from the network than the origin must be refused
    const worse = byDist.find((s) => s.id !== far.id && starDistance(homeStar, s) >= starDistance(homeStar, far));
    if (worse) {
      expect(
        validateCommand(state, { turn: state.turn, playerId: 0, kind: 'move_ships', payload: { shipIds: [40_000_000], destStarId: worse.id } }),
      ).toMatch(/stranded ships/);
    }
    // moving strictly closer to the network is allowed
    const closer = byDist[byDist.length - 2]!;
    expect(
      validateCommand(state, { turn: state.turn, playerId: 0, kind: 'move_ships', payload: { shipIds: [40_000_000], destStarId: closer.id === far.id ? homeStar.id : closer.id } }),
    ).toBeNull();
  });
});

describe('#16: duplicate projected builds are blocked and refund if they slip through', () => {
  it('canQueue blocks a second gaia transformation and over-queued colony bases', () => {
    const state = newGame();
    const colony = state.colonies.find((c) => c.owner === 0)!;
    const planet = state.planets.find((p) => p.id === colony.planetId)!;
    planet.climate = 'terran';
    state.empires[0]!.knownApps = [...new Set([...state.empires[0]!.knownApps, 'gaia_transformation', 'colony_base'])].sort();
    expect(
      validateCommand(state, { turn: state.turn, playerId: 0, kind: 'set_build_queue', payload: { colonyId: colony.id, items: ['gaia_transformation', 'gaia_transformation'] } }),
    ).toMatch(/already queued/);
  });

  it('a colony_base completing into a full system refunds its production', () => {
    const state = newGame();
    const colony = state.colonies.find((c) => c.owner === 0)!;
    const planet = state.planets.find((p) => p.id === colony.planetId)!;
    // settle every open planet in the system so the base has no target
    for (const p of state.planets.filter((x) => x.starId === planet.starId && x.body === 'planet' && !state.colonies.some((c) => c.planetId === x.id))) {
      state.colonies.push({
        id: 30_000_100 + p.id,
        planetId: p.id,
        owner: 1,
        name: 'squat',
        groups: [{ race: 1, popK: 1000, farmers: 1, workers: 0, scientists: 0, unrest: false }],
        buildings: [],
        queue: [],
        storedProd: 0,
        stickyInvested: {},
        boughtThisTurn: false,
        foodLackPrev: 0,
        prodLackPrev: 0,
        housingPPPrev: 0,
        outpost: false,
      });
    }
    state.colonies.sort((a, b) => a.id - b.id);
    colony.queue = [{ item: 'colony_base' }];
    colony.storedProd = 10_000;
    const before = colony.storedProd;
    advanceTurn(state);
    const after = state.colonies.find((c) => c.id === colony.id)!.storedProd;
    expect(after).toBeGreaterThanOrEqual(before); // cost refunded (plus this turn's output)
  });
});

describe('#17: bigStart is fed', () => {
  it('no farmers on farm-dead worlds and freighters cover the deficit', () => {
    const state = newGame('pre_warp', { bigStart: true, galaxySize: 'medium' });
    for (const e of state.empires) {
      let deficit = 0;
      for (const c of state.colonies) {
        if (c.owner !== e.id || c.outpost) continue;
        if (!farmingViable(state, c)) {
          for (const g of c.groups) expect(g.farmers, `colony ${c.name}`).toBe(0);
        }
        const net = colonyOutput(state, c).foodNet;
        if (net < 0) deficit += -net;
      }
      expect(e.freighters).toBeGreaterThanOrEqual(deficit);
    }
  });
});

describe('#21/#38: pre-warp home star bases exist and fight with the starter laser', () => {
  it('the home defense platform joins battles with laser mounts', () => {
    const state = newGame('pre_warp');
    const home = state.colonies.find((c) => c.owner === 0)!;
    expect(home.buildings).toContain('star_base');
    const homeStarId = state.planets.find((p) => p.id === home.planetId)!.starId;
    state.relations.push({ ...peaceRelation(0, 1), status: 'war' });
    state.ships.push({
      id: 50_000_000,
      owner: 1,
      shipKind: 'scout',
      designId: null,
      location: { kind: 'star', starId: homeStarId },
      cargoPopUnits: 0,
      cargoRace: 1,
      dmgStructure: 0,
      dmgArmor: 0,
    });
    state.ships.sort((a, b) => a.id - b.id);
    const battle = { id: 'bT', starId: homeStarId, attacker: 1, defender: 0, ordersA: null, ordersD: null };
    const built = buildBattleInput(state, battle);
    const base = built.input.ships.find((s) => s.isBase);
    expect(base).toBeDefined();
    expect(base!.weapons.some((w) => w.weaponId === 'laser_cannon')).toBe(true);
  });
});

describe('#24: obsoleting a design strips refits toward it', () => {
  it('queued refit items to the obsoleted design are removed', () => {
    const state = newGame();
    const colony = state.colonies.find((c) => c.owner === 0)!;
    const designId = state.empires[0]!.designs[0]!.id;
    colony.queue = [{ item: `refit:123:${designId}` }, { item: 'housing' }];
    applyCommand(state, { turn: state.turn, playerId: 0, kind: 'obsolete_design', payload: { designId } });
    expect(state.colonies.find((c) => c.id === colony.id)!.queue.map((q) => q.item)).toEqual(['housing']);
  });
});

describe('#25: natives and splinter colonies generate and integrate', () => {
  it('specials appear in generated galaxies and integrate at founding', () => {
    let natives = 0;
    let splinters = 0;
    for (let i = 0; i < 10 && (natives === 0 || splinters === 0); i++) {
      const s = newGame('average', { galaxySize: 'huge' }, i.toString(16).padStart(32, 'a'));
      natives += s.planets.filter((p) => p.special === 'natives').length;
      splinters += s.planets.filter((p) => p.special === 'splinter_colony').length;
    }
    expect(natives).toBeGreaterThan(0); // ~1% rolls: a 10-galaxy sweep is ample
    expect(splinters).toBeGreaterThan(0);

    // integration: found a colony on a natives world via the debug path
    const state = newGame();
    const planet = state.planets.find(
      (p) => p.body === 'planet' && !state.colonies.some((c) => c.planetId === p.id) && !['hostile', 'energized', 'barren'].includes(p.climate),
    )!;
    planet.special = 'natives';
    state.monsters = state.monsters.filter((m) => m.starId !== planet.starId);
    // colonize needs a colony ship at the star
    const ship = state.ships.find((s) => s.owner === 0 && s.shipKind === 'colony_ship')!;
    ship.location = { kind: 'star', starId: planet.starId };
    const cmd = { turn: state.turn, playerId: 0, kind: 'colonize', payload: { shipId: ship.id, planetId: planet.id } };
    expect(validateCommand(state, cmd)).toBeNull();
    applyCommand(state, cmd);
    const colony = state.colonies.find((c) => c.planetId === planet.id)!;
    const nativesGroup = colony.groups.find((g) => g.race === NATIVE_RACE);
    expect(nativesGroup).toBeDefined();
    expect(nativesGroup!.workers + nativesGroup!.scientists).toBe(0); // farm-only
    expect(planet.special).toBeNull();
    // natives never leave
    expect(
      validateCommand(state, {
        turn: state.turn,
        playerId: 0,
        kind: 'move_colonists',
        payload: { fromColonyId: colony.id, toColonyId: state.colonies.find((c) => c.owner === 0 && c.id !== colony.id)!.id, race: NATIVE_RACE, count: 1 },
      }),
    ).toMatch(/natives/);
  });
});

describe('#29: an already-known extra-research head burns no RP', () => {
  it('drops known heads and banks the turn RP instead', () => {
    const state = newGame();
    const e = state.empires[0]!;
    e.research.extraQueue = [e.knownApps[0]!]; // already known
    e.research.extraAccumRP = 0;
    e.research.accumRP = 0;
    e.research.fieldNum = null;
    applyResearch(state, e, 55, rngFor(SEED, 1, 'research', 0), []);
    expect(e.research.extraQueue).toHaveLength(0);
    expect(e.research.accumRP).toBe(55); // banked, not burned
  });
});

describe('#30: only ship officers grant combat speed', () => {
  it('a colony leader with tactics contributes no fleet speed', () => {
    const state = newGame();
    const colonyTactician = LEADERS.find((l) => l.kind === 'colony' && l.skills.some((s) => s.skill === 'tactics'));
    const shipTactician = LEADERS.find((l) => l.kind === 'ship' && l.skills.some((s) => s.skill === 'tactics'));
    const e = state.empires[0]!;
    if (colonyTactician) {
      e.leaders = [{ leaderId: colonyTactician.id, level: 3, xp: 0, colonyId: null }];
      expect(leaderCombatBonuses(e).speedPct).toBe(0);
    }
    if (shipTactician) {
      e.leaders = [{ leaderId: shipTactician.id, level: 3, xp: 0, colonyId: null }];
      expect(leaderCombatBonuses(e).speedPct).toBeGreaterThan(0);
    }
  });
});

describe('#34: debug payloads are validated', () => {
  it('fractional debug_add_bc is rejected even in debug games', () => {
    const state = newGame();
    expect(
      validateCommand(state, { turn: state.turn, playerId: 0, kind: 'debug_add_bc', payload: { amount: 0.5 } }),
    ).toMatch(/bad amount/);
    expect(
      validateCommand(state, { turn: state.turn, playerId: 0, kind: 'debug_add_bc', payload: { amount: 100 } }),
    ).toBeNull();
  });
});

describe('#36: knownWeapons ordering is locale-independent', () => {
  it('sorts by charcode', () => {
    const state = newGame();
    const ids = knownWeapons(state.empires[0]!).map((w) => w.id);
    const sorted = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(ids).toEqual(sorted);
  });
});
