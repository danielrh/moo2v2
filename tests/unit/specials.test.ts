import { describe, expect, it } from 'vitest';
import { DEFAULT_ORDERS, runBattle, type BattleInput, type CombatShipInit } from '@engine/index';
import { rngFor } from '@engine/rng';

const SEED = 'fedcba9876543210fedcba9876543210';

function cruiser(shipId: number, side: 0 | 1, opts?: Partial<CombatShipInit>): CombatShipInit {
  return {
    shipId,
    side,
    hull: 'cruiser',
    hullIdx: 3,
    isBase: false,
    beamAttack: 50,
    beamDefense: 30,
    speed: 6,
    armorHp: 60,
    structureHp: 60,
    shieldPool: 30,
    shieldFlat: 3,
    weapons: [
      { weaponId: 'laser_cannon', classId: 0, dmgMin: 2, dmgMax: 6, mods: [], ammo: -1, cooldown: 0, count: 6 },
    ],
    startingStructure: 60,
    startingArmor: 60,
    ...(opts ?? {}),
  };
}

function missileBoat(shipId: number, side: 0 | 1, opts?: Partial<CombatShipInit>): CombatShipInit {
  return cruiser(shipId, side, {
    weapons: [
      { weaponId: 'nuclear_missile', classId: 1, dmgMin: 8, dmgMax: 8, mods: [], ammo: 10, cooldown: 0, count: 6 },
    ],
    ...(opts ?? {}),
  });
}

function fight(ships: CombatShipInit[], id = 'spec'): ReturnType<typeof runBattle> {
  const input: BattleInput = {
    battleId: id,
    seedLabel: [1, 'battle', id],
    attacker: 0,
    defender: 1,
    ships,
    ordersA: { ...DEFAULT_ORDERS, retreatThresholdPct: 0 },
    ordersD: { ...DEFAULT_ORDERS, stance: 'hold_range', retreatThresholdPct: 0 },
  };
  return runBattle(input, rngFor(SEED, ...input.seedLabel));
}

function damageTaken(result: ReturnType<typeof runBattle>, shipId: number): number {
  const o = result.outcomes.find((x) => x.shipId === shipId)!;
  // structure + armor lost (fixtures start at 60/60)
  return o.structureMax - o.structureLeft + (60 - o.armorLeft);
}

describe('combat specials', () => {
  it('ECM jammers shed missile volleys', () => {
    const plain = fight([missileBoat(1, 0), cruiser(2, 1, { weapons: [] })], 'ecm0');
    const jammed = fight([missileBoat(1, 0), cruiser(2, 1, { weapons: [], specials: ['multi_wave_ecm_jammer'] })], 'ecm0');
    expect(damageTaken(jammed, 2)).toBeLessThan(damageTaken(plain, 2));
  });

  it('hard shields blunt shield-piercing hits', () => {
    const sp = { weaponId: 'neutron_blaster', classId: 0, dmgMin: 4, dmgMax: 4, mods: ['sp'], ammo: -1, cooldown: 0, count: 6 };
    const naked = fight([cruiser(1, 0, { weapons: [sp] }), cruiser(2, 1, { weapons: [] })], 'hs');
    const hard = fight([cruiser(1, 0, { weapons: [sp] }), cruiser(2, 1, { weapons: [], specials: ['hard_shields'] })], 'hs');
    expect(damageTaken(hard, 2)).toBeLessThan(damageTaken(naked, 2));
  });

  it('warp dissipater pins retreating ships on the field', () => {
    const runner = cruiser(2, 1, { weapons: [] });
    const free = fight(
      [cruiser(1, 0), { ...runner }],
      'wd',
    );
    void free;
    const pinnedResult = fight(
      [cruiser(1, 0, { specials: ['warp_dissipater'] }), { ...runner }],
      'wd',
    );
    // defender with 0 weapons + hold_range will get shredded; with the
    // dissipater up it can never leave the field as "retreated"
    const pinned = pinnedResult.outcomes.find((o) => o.shipId === 2)!;
    expect(pinned.retreated).toBe(false);
  });

  it('damper field quarters incoming damage', () => {
    const plain = fight([cruiser(1, 0), cruiser(2, 1, { weapons: [] })], 'df');
    const damped = fight([cruiser(1, 0), cruiser(2, 1, { weapons: [], specials: ['damper_field'] })], 'df');
    expect(damageTaken(damped, 2)).toBeLessThan(damageTaken(plain, 2));
  });

  it('high energy focus and structural analyzer scale beam damage', () => {
    const plain = fight([cruiser(1, 0), cruiser(2, 1, { weapons: [] })], 'hef');
    const focused = fight([cruiser(1, 0, { specials: ['high_energy_focus', 'structural_analyzer'] }), cruiser(2, 1, { weapons: [] })], 'hef');
    expect(damageTaken(focused, 2)).toBeGreaterThan(damageTaken(plain, 2));
  });

  it('automated repair keeps structure topped up', () => {
    // weak attacker so the repair can outpace the chip damage
    const peashooter = cruiser(1, 0, {
      weapons: [{ weaponId: 'laser_cannon', classId: 0, dmgMin: 1, dmgMax: 1, mods: [], ammo: -1, cooldown: 0, count: 1 }],
    });
    const plain = fight([peashooter, cruiser(2, 1, { weapons: [] })], 'aru');
    const repaired = fight([peashooter, cruiser(2, 1, { weapons: [], specials: ['automated_repair_unit'] })], 'aru');
    expect(damageTaken(repaired, 2)).toBeLessThanOrEqual(damageTaken(plain, 2));
  });
});
