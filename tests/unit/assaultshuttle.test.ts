// Assault shuttles (bugs.md): researchable, designable, and effective —
// boarding craft launch like strike craft and cripple systems on contact.
import { it, expect } from 'vitest';
import { gameEngine } from '@engine/index';
import { runBattle, DEFAULT_ORDERS, type BattleInput, type CombatShipInit } from '@engine/combat';
import { rngFor } from '@engine/rng';
import { weaponById, appForWeapon } from '@engine/data/index';
import { designStats, knownWeapons } from '@engine/shipdesign';
import type { GameState } from '@engine/types';

const SEED = 'aaaabbbbccccddddeeeeffff00001111';

it('assault shuttles launch, board, and cripple systems', () => {
  const row = weaponById.get('assault_shuttle')!;
  expect(row.classId).toBe(4);
  const mk = (id: number, side: 0 | 1, weapons: CombatShipInit['weapons']): CombatShipInit => ({
    shipId: id, side, hull: 'cruiser', hullIdx: 3, isBase: false,
    beamAttack: 0, beamDefense: 0, speed: side === 0 ? 6 : 0,
    armorHp: 60, structureHp: 90, shieldPool: 30, shieldFlat: 2,
    weapons, startingStructure: 90, startingArmor: 60, specials: [],
  });
  const shuttleW = { weaponId: 'assault_shuttle', classId: 4, dmgMin: 0, dmgMax: 0, mods: [], ammo: 4, cooldown: 0, count: 4, arc: 'F' as const };
  const input: BattleInput = {
    battleId: 'lab', seedLabel: [1, 'lab'], attacker: 0, defender: 1,
    ships: [mk(1, 0, [shuttleW]), mk(2, 1, [])],
    ordersA: { ...DEFAULT_ORDERS }, ordersD: { ...DEFAULT_ORDERS, stance: 'hold_range' },
  };
  let sawShuttle = false;
  let sawKnockout = false;
  const res = runBattle(input, rngFor(SEED, 'lab'), (f) => {
    if (f.projectiles.some((p) => p.classId === 4 && p.w === 'assault_shuttle')) sawShuttle = true;
    if (f.ships.some((s) => s.id === 2 && s.sys !== '')) sawKnockout = true;
  });
  expect(sawShuttle).toBe(true);
  expect(sawKnockout).toBe(true);
  expect(res.outcomes.find((o) => o.shipId === 2)!.structureLeft).toBeLessThan(90);
});

it('assault shuttles are designable once their tech is known', () => {
  const state: GameState = gameEngine.init({
    seed: SEED,
    settings: { galaxySize: 'small', startMode: 'average', playerCount: 2, modes: { creativeVariant: false, pickBidding: false, stickyBuild: false, antarans: false, randomEvents: false }, battleOrdersTimeoutMs: 1000, debugCommands: false },
    players: [{ id: 0, name: 'A', raceJson: null }, { id: 1, name: 'B', raceJson: null }],
    dataVersion: 'test',
  });
  const e0 = state.empires[0]!;
  const app = appForWeapon('assault_shuttle');
  expect(app).toBeTruthy();
  if (!e0.knownApps.includes(app!.id)) e0.knownApps.push(app!.id);
  e0.knownApps.sort();
  expect(knownWeapons(e0).some((w) => w.id === 'assault_shuttle')).toBe(true);
  const stats = designStats(state, e0, {
    name: 'Boarder', hull: 'destroyer', computer: 0, shield: 0, specials: [],
    weapons: [{ weapon: 'assault_shuttle', count: 1, mods: [] }],
  });
  expect(typeof stats).not.toBe('string');
});
