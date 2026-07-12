// Start modes rework (bugs.md 2026-07-10 follow-up):
//   - pre-warp (the early start) no longer begins with a free colony ship
//   - new "advanced" start: identical developed empires covering ~1/3 of the
//     map in total, identical worlds system-for-system inside the regions,
//     every planet half full, freighters covering the food runs, 5 scouts at
//     the frontier — while the free 2/3 of the map stays organic.

import { describe, expect, it } from 'vitest';
import { gameEngine } from '@engine/adapter';
import { hashCanonical } from '@engine/canonical';
import { colonyMaxPop, colonyOutput, colonyPopUnits } from '@engine/economy';
import { fieldById, FIELD_ROWS, APPLICATION_ROWS } from '@engine/data/index';
import { STAR_COUNTS, starDistance } from '@engine/galaxy';
import { availableFields, fieldListedCost } from '@engine/research';
import { advanceTurn } from '@engine/pipeline';
import type { GameState, GameStateSettings, Planet } from '@engine/types';

const SEED = 'aaaabbbbccccddddeeeeffff00001111';

function newGame(startMode: GameStateSettings['startMode'], races: [string, string] = ['solari', 'solari']): GameState {
  return gameEngine.init({
    seed: SEED,
    settings: {
      galaxySize: 'medium',
      startMode,
      playerCount: 2,
      modes: { creativeVariant: false, pickBidding: false, stickyBuild: false, antarans: false, randomEvents: false },
      battleOrdersTimeoutMs: 1000,
      debugCommands: false,
    },
    players: [
      { id: 0, name: 'A', raceJson: JSON.stringify({ presetId: races[0] }) },
      { id: 1, name: 'B', raceJson: JSON.stringify({ presetId: races[1] }) },
    ],
    dataVersion: 'test',
  });
}

/** A player's colonized stars ordered home-first then by distance from home
 * (the same order advancedStart claims them in). */
function regionStars(s: GameState, owner: number): number[] {
  const homePlanet = s.planets.find((p) => p.homeworldOf === owner)!;
  const home = s.stars.find((st) => st.id === homePlanet.starId)!;
  const starIds = [
    ...new Set(
      s.colonies
        .filter((c) => c.owner === owner)
        .map((c) => s.planets.find((p) => p.id === c.planetId)!.starId),
    ),
  ];
  return starIds.sort((a, b) => {
    const sa = s.stars.find((st) => st.id === a)!;
    const sb = s.stars.find((st) => st.id === b)!;
    return starDistance(home, sa) - starDistance(home, sb) || a - b;
  });
}

function worldSpecs(s: GameState, starId: number): string {
  const spec = (p: Planet) =>
    [p.orbit, p.body, p.sizeClass, p.climate, p.minerals, p.gravity, p.special ?? ''].join('|');
  return s.planets
    .filter((p) => p.starId === starId)
    .sort((a, b) => a.orbit - b.orbit || a.id - b.id)
    .map(spec)
    .join(' ; ');
}

describe('start modes: the free colony ship', () => {
  it('pre-warp: one scout, NO colony ship, only the construction basics known', () => {
    const s = newGame('pre_warp');
    for (const owner of [0, 1]) {
      expect(s.ships.filter((x) => x.owner === owner && x.shipKind === 'scout')).toHaveLength(1);
      expect(s.ships.filter((x) => x.owner === owner && x.shipKind === 'colony_ship')).toHaveLength(0);
    }
    // classic MOO2 primitive start: ONLY Engineering is pre-completed — the
    // colony base is buildable right away, everything else is researched.
    expect(s.empires[0]!.completedFields).toEqual([fieldById.get('engineering')!.num]);
    expect(s.empires[0]!.knownApps).toContain('colony_base');
    expect(s.empires[0]!.knownApps).toContain('star_base');
    expect(s.empires[0]!.knownApps).not.toContain('electronic_computer');
    expect(s.empires[0]!.knownApps).not.toContain('laser_cannon');
    expect(s.empires[0]!.knownApps).not.toContain('colony_ship');
  });

  it('pre-warp opens with the classic eight research choices at LISTED price', () => {
    const s = newGame('pre_warp');
    const empire = s.empires[0]!;
    // the research screen shows list prices; actual discovery happens on the
    // hidden line in (listed, 2×listed] (improvements.md)
    const choices = availableFields(empire).map((f) => [f.id, fieldListedCost(empire, f)]);
    // the exact MOO2 pre-warp research screen (fields sorted by num)
    expect(choices).toEqual([
      ['advanced_engineering', 80], // anti-missile rockets, fighter bays, reinforced hull
      ['advanced_magnetism', 250], // class I shield, mass driver, ECM jammer
      ['military_tactics', 150], // space academy
      ['astro_ecology', 80], // hydroponic farm, habitat domes
      ['chemistry', 50], // nuclear missile, fuel cells, titanium armor
      ['electronics', 50], // electronic computer
      ['nuclear_fission', 50], // nuclear drive, nuclear bomb
      ['physics', 50], // laser cannon, laser rifle, space scanner
    ]);
  });

  it('average is the MOO2 normal opening: two scouts + a colony ship', () => {
    const s = newGame('average');
    for (const owner of [0, 1]) {
      expect(s.ships.filter((x) => x.owner === owner && x.shipKind === 'scout')).toHaveLength(2);
      expect(s.ships.filter((x) => x.owner === owner && x.shipKind === 'colony_ship')).toHaveLength(1);
    }
    // average still begins with the tier-1 basics researched
    expect(s.empires[0]!.knownApps).toContain('colony_base');
  });

  it('average opens with the classic eight research choices (Electronics done, Optronics not)', () => {
    const s = newGame('average');
    const empire = s.empires[0]!;
    // the tier-1 roots + Cold Fusion are complete…
    expect(empire.knownApps).toContain('electronic_computer');
    expect(empire.knownApps).toContain('colony_ship');
    expect(empire.knownApps).toContain('freighters');
    // …and nothing beyond them: these all sit in the eight opening choices
    expect(empire.knownApps).not.toContain('optronic_computer');
    expect(empire.knownApps).not.toContain('research_lab');
    expect(empire.knownApps).not.toContain('deuterium_fuel_cells');
    expect(empire.knownApps).not.toContain('class_i_shield');
    expect(empire.knownApps).not.toContain('space_academy');
    const choices = availableFields(empire).map((f) => [f.id, fieldListedCost(empire, f)]);
    // the exact MOO2 average research screen (fields sorted by num)
    expect(choices).toEqual([
      ['advanced_engineering', 80], // anti-missile rockets, fighter bays, reinforced hull
      ['advanced_fusion', 250], // fusion drive, fusion bomb, augmented engines
      ['advanced_magnetism', 250], // class I shield, mass driver, ECM jammer
      ['advanced_metallurgy', 250], // deuterium fuel cells, tritanium armor
      ['military_tactics', 150], // space academy
      ['astro_ecology', 80], // hydroponic farm, habitat domes
      ['fusion_physics', 150], // fusion beam, fusion rifle
      ['optronics', 150], // research lab, optronic computer, dauntless guidance system
    ]);
  });
});

describe('debug: unlock all tech', () => {
  const init = (unlockAllTech: boolean, debugCommands: boolean): GameState =>
    gameEngine.init({
      seed: SEED,
      settings: {
        galaxySize: 'small',
        startMode: 'pre_warp',
        playerCount: 2,
        modes: { creativeVariant: false, pickBidding: false, stickyBuild: false, antarans: false, randomEvents: false },
        battleOrdersTimeoutMs: 1000,
        debugCommands,
        unlockAllTech,
      },
      players: [
        { id: 0, name: 'A', raceJson: JSON.stringify({ presetId: 'solari' }) },
        { id: 1, name: 'B', raceJson: JSON.stringify({ presetId: 'solari' }) },
      ],
      dataVersion: 'test',
    });

  it('completes every field and knows every application when enabled with debug', () => {
    const s = init(true, true);
    for (const e of s.empires) {
      expect(e.completedFields.length).toBe(FIELD_ROWS.length);
      const missing = APPLICATION_ROWS.map((a) => a.id).filter((id) => !e.knownApps.includes(id));
      expect(missing).toEqual([]);
    }
  });

  it('is ignored unless debugCommands is also on', () => {
    const prewarp = [fieldById.get('engineering')!.num];
    // unlock requested but debug off -> normal pre-warp (engineering only)
    expect(init(true, false).empires[0]!.completedFields).toEqual(prewarp);
    // debug on but unlock off -> also normal pre-warp
    expect(init(false, true).empires[0]!.completedFields).toEqual(prewarp);
  });
});

describe('advanced start', () => {
  it('grants pre-warp tech plus Cold Fusion (colony ships + freighters buildable)', () => {
    const s = newGame('advanced');
    const cf = fieldById.get('cold_fusion')!;
    for (const e of s.empires) {
      expect(e.completedFields).toContain(cf.num);
      for (const app of ['colony_ship', 'freighters', 'outpost_ship', 'transport']) {
        expect(e.knownApps).toContain(app);
      }
    }
    // developed empires need no free colony ship
    expect(s.ships.filter((x) => x.shipKind === 'colony_ship')).toHaveLength(0);
  });

  it('empires are identical: same regions system-for-system, pops, freighters, scouts', () => {
    const s = newGame('advanced');
    const r0 = regionStars(s, 0);
    const r1 = regionStars(s, 1);
    expect(r0.length).toBe(r1.length);
    expect(r0.length).toBeGreaterThanOrEqual(2);
    // disjoint regions
    expect(r0.filter((id) => r1.includes(id))).toHaveLength(0);
    // the k-th system of each player carries identical worlds
    for (let k = 0; k < r0.length; k++) {
      expect(worldSpecs(s, r1[k]!), `system #${k}`).toBe(worldSpecs(s, r0[k]!));
    }
    // identical colony rosters (pop per matching planet), freighters, scouts
    const pops = (owner: number) =>
      s.colonies
        .filter((c) => c.owner === owner)
        .map((c) => colonyPopUnits(c))
        .sort((a, b) => a - b)
        .join(',');
    expect(pops(1)).toBe(pops(0));
    expect(s.empires[1]!.freighters).toBe(s.empires[0]!.freighters);
    for (const owner of [0, 1]) {
      expect(s.ships.filter((x) => x.owner === owner && x.shipKind === 'scout')).toHaveLength(5);
    }
  });

  it('the two regions together cover about a third of the galaxy', () => {
    const s = newGame('advanced');
    const total = regionStars(s, 0).length + regionStars(s, 1).length;
    const stars = STAR_COUNTS['medium'];
    expect(total).toBeGreaterThanOrEqual(Math.floor(stars * 0.25));
    expect(total).toBeLessThanOrEqual(Math.ceil(stars * 0.4));
  });

  it('every colonized planet is at least half full (founding specials may add a few)', () => {
    const s = newGame('advanced');
    for (const c of s.colonies) {
      const cap = colonyMaxPop(s, c);
      const half = Math.max(1, Math.floor(cap / 2));
      const units = colonyPopUnits(c);
      // natives (+2) / splinter colonies (+3) join at founding, capped at max
      expect(units, `colony ${c.name}`).toBeGreaterThanOrEqual(half);
      expect(units, `colony ${c.name}`).toBeLessThanOrEqual(Math.max(half + 3, Math.min(cap, half + 3)));
      expect(units, `colony ${c.name}`).toBeLessThanOrEqual(Math.max(half, cap));
    }
  });

  it('the freighter pool feeds the whole empire: no starvation on turn one', () => {
    const s = newGame('advanced');
    for (const e of s.empires) {
      let deficit = 0;
      for (const c of s.colonies) {
        if (c.owner !== e.id) continue;
        const net = colonyOutput(s, c).foodNet;
        if (net < 0) deficit += -net;
      }
      expect(e.freighters).toBeGreaterThanOrEqual(deficit);
      expect(e.freighters % 5).toBe(0);
    }
    const { events } = advanceTurn(s);
    expect(events.filter((ev) => ev.kind === 'starvation')).toHaveLength(0);
  });

  it('the five scouts sit at the frontier (farthest claimed systems)', () => {
    const s = newGame('advanced');
    for (const owner of [0, 1]) {
      const region = regionStars(s, owner);
      const frontier = new Set(region.slice(-5)); // farthest five (home-first order)
      const scouts = s.ships.filter((x) => x.owner === owner && x.shipKind === 'scout');
      expect(scouts).toHaveLength(5);
      for (const scout of scouts) {
        expect(scout.location.kind).toBe('star');
        if (scout.location.kind === 'star') {
          expect(frontier.has(scout.location.starId), `scout at star ${scout.location.starId}`).toBe(true);
        }
      }
    }
  });

  it('no monster keeper spawns inside a starting region', () => {
    const s = newGame('advanced');
    const owned = new Set([...regionStars(s, 0), ...regionStars(s, 1)]);
    for (const m of s.monsters) {
      expect(owned.has(m.starId), `monster ${m.kind} at star ${m.starId}`).toBe(false);
    }
  });

  it('regions stay identical system-for-system even with different races', () => {
    const s = newGame('advanced', ['solari', 'hivex']);
    const r0 = regionStars(s, 0);
    const r1 = regionStars(s, 1);
    expect(r0.length).toBe(r1.length);
    // k=0 is the home system (worlds differ only by race-driven homeworld
    // traits); every other system is stamped identical
    for (let k = 1; k < r0.length; k++) {
      expect(worldSpecs(s, r1[k]!), `system #${k}`).toBe(worldSpecs(s, r0[k]!));
    }
  });

  it('generation is deterministic', () => {
    const a = newGame('advanced');
    const b = newGame('advanced');
    expect(hashCanonical(b as unknown as Record<string, unknown>)).toBe(
      hashCanonical(a as unknown as Record<string, unknown>),
    );
  });
});
