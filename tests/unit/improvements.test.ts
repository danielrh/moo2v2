// improvements.md: the measured early pre-warp reference game. A Unification
// + Lithovore + Repulsive empire on the standard 12-max homeworld with 8 pop
// (4 workers / 4 scientists) must reproduce this math EXACTLY:
//   - 12 net production (12 worker + 6 unification − 6 pollution) and 12 RP
//   - colony base (200) => 17 turns; star base (400) => 34 turns at 12/turn
//   - the homeworld starts with a star base even in pre-warp
//   - population: +73k/turn at 8/12, the 9th unit lands on press 14, +67k after
//   - a 1..4-worker colony on an abundant farming-dead world nets 5/7/10/12
//     production ("the rounding is real": 4.5 -> 5, 13.5-gross path -> 10)
//   - research discovers on a hidden line in (listed, 2×listed], shared by
//     every empire; the UI shows "(2% chance to discover)" at 138/150 +15/turn

import { describe, expect, it } from 'vitest';
import { gameEngine } from '@engine/adapter';
import { colonyMaxPop, colonyOutput, colonyPopUnits, groupGrowthK } from '@engine/economy';
import { buildableById, fieldById, validatePicks } from '@engine/data/index';
import { fieldCost, fieldListedCost, researchEtaTurns, researchOddsPct } from '@engine/research';
import { advanceTurn } from '@engine/pipeline';
import { empireSummary } from '@engine/selectors';
import { ceilDiv } from '@engine/imath';
import type { Colony, GameState } from '@engine/types';

const SEED = 'aaaabbbbccccddddeeeeffff00001111';
const PICKS = ['unification', 'lithovore', 'repulsive'];

function newGame(): GameState {
  return gameEngine.init({
    seed: SEED,
    settings: {
      galaxySize: 'small',
      startMode: 'pre_warp',
      playerCount: 2,
      modes: { creativeVariant: false, pickBidding: false, stickyBuild: false, antarans: false, randomEvents: false },
      battleOrdersTimeoutMs: 1000,
      debugCommands: false,
    },
    players: [
      { id: 0, name: 'A', raceJson: JSON.stringify({ picks: PICKS, raceName: 'Reference' }) },
      { id: 1, name: 'B', raceJson: JSON.stringify({ picks: PICKS, raceName: 'Mirror' }) },
    ],
    dataVersion: 'test',
  });
}

function homeOf(s: GameState, owner = 0): Colony {
  return s.colonies.find((c) => c.owner === owner)!;
}

function setJobs(c: Colony, workers: number, scientists: number): void {
  c.groups[0]!.farmers = 0;
  c.groups[0]!.workers = workers;
  c.groups[0]!.scientists = scientists;
}

describe('improvements.md reference game', () => {
  it('the race is a legal 10-point build and the homeworld is 12-max with 8 pop', () => {
    expect(validatePicks(PICKS)).toEqual({ ok: true, cost: 10, errors: [] });
    const s = newGame();
    const home = homeOf(s);
    expect(colonyMaxPop(s, home)).toBe(12);
    expect(colonyPopUnits(home)).toBe(8);
  });

  it('the homeworld starts with a star base even in pre-warp', () => {
    const home = homeOf(newGame());
    expect(home.buildings).toContain('star_base');
    expect(home.buildings).toContain('marine_barracks');
  });

  it('4 workers + 4 scientists: 12 net production (+6 uni −6 pollution) and 12 RP', () => {
    const s = newGame();
    const home = homeOf(s);
    setJobs(home, 4, 4);
    const out = colonyOutput(s, home);
    expect(out.pollution).toBe(6);
    expect(out.prod).toBe(12);
    expect(out.research).toBe(12);
  });

  it('colony base takes 17 turns and a star base 34 turns at 12 production', () => {
    expect(buildableById.get('colony_base')!.cost).toBe(200);
    expect(buildableById.get('star_base')!.cost).toBe(400);
    expect(ceilDiv(200, 12)).toBe(17);
    expect(ceilDiv(400, 12)).toBe(34);
  });

  it('population: +73k/turn at 8/12, the 9th unit lands on press 14, +67k after', () => {
    const s = newGame();
    const home = homeOf(s);
    setJobs(home, 4, 4);
    const growth = () => groupGrowthK(s, home, home.groups[0]!, colonyMaxPop(s, home), colonyPopUnits(home));
    expect(growth()).toBe(73);
    let unitAt = -1;
    for (let press = 1; press <= 16 && unitAt < 0; press++) {
      advanceTurn(s);
      if (colonyPopUnits(home) >= 9) unitAt = press;
    }
    expect(unitAt).toBe(14);
    expect(growth()).toBe(67);
  });

  it('workers on an abundant farming-dead world net 5/7/10/12 (the rounding is real)', () => {
    const s = newGame();
    const home = homeOf(s);
    const homePlanet = s.planets.find((p) => p.id === home.planetId)!;
    // the doc's "abundant toxic" second world: this engine's farming-dead
    // climate analog with the same medium size (pollution absorption 6)
    const planetId = s.nextId++;
    s.planets.push({
      id: planetId, starId: homePlanet.starId, orbit: 4, body: 'planet',
      sizeClass: 3, climate: 'barren', minerals: 'abundant', gravity: 'normal',
      special: null, homeworldOf: null, terraformSteps: 0,
    });
    const colony: Colony = {
      id: s.nextId++, planetId, owner: 0, name: 'Toxic I',
      groups: [{ race: 0, popK: 4000, farmers: 0, workers: 1, scientists: 0, unrest: false }],
      buildings: [], queue: [], storedProd: 0, stickyInvested: {},
      boughtThisTurn: false, foodLackPrev: 0, prodLackPrev: 0, housingPPPrev: 0,
      outpost: false,
    };
    s.colonies.push(colony);
    const prodAt = (workers: number) => {
      colony.groups[0]!.workers = workers;
      return colonyOutput(s, colony).prod;
    };
    expect(prodAt(1)).toBe(5); // 3 + 1.5 uni, rounded UP
    expect(prodAt(2)).toBe(7); // 6 + 3 − 2 pollution
    expect(prodAt(3)).toBe(10); // 9 + 4.5 − 4, rounded UP
    expect(prodAt(4)).toBe(12); // 12 + 6 − 6
  });

  it('research discovers on a hidden line in (listed, 2×listed], shared across empires', () => {
    const s = newGame();
    for (const id of ['electronics', 'optronics', 'engineering', 'cold_fusion']) {
      const f = fieldById.get(id)!;
      const listed = fieldListedCost(s.empires[0]!, f);
      expect(listed).toBe(f.cost);
      const line = fieldCost(s, s.empires[0]!, f);
      expect(line).toBeGreaterThan(listed);
      expect(line).toBeLessThanOrEqual(2 * listed);
      expect(fieldCost(s, s.empires[1]!, f)).toBe(line);
    }
  });

  it('the research screen math: ~7 turn estimate for electronics at 12 RP, 2% odds at 138/150 +15', () => {
    // fresh electronics (listed 50) at 12 RP/turn estimates ~7 turns to the
    // expected discovery (~75 RP), exactly the doc's "takes ~7 turns"
    expect(researchEtaTurns(50, 0, 12)).toBe(7);
    // the doc's odds reading: 138 spent on the 150-RP research lab, +15/turn
    expect(researchOddsPct(150, 138, 15)).toBe(2);
    // the odds surface through the empire summary for the UI
    const s = newGame();
    const home = homeOf(s);
    setJobs(home, 4, 5); // 5 scientists = 15 RP/turn once the 9th unit exists
    home.groups[0]!.popK = 9000;
    const opt = fieldById.get('optronics')!;
    s.empires[0]!.completedFields.push(fieldById.get('electronics')!.num);
    s.empires[0]!.research.fieldNum = opt.num;
    s.empires[0]!.research.targetApp = 'research_lab';
    s.empires[0]!.research.accumRP = 138;
    const summary = empireSummary(s, 0);
    expect(summary.researchListedCost).toBe(150);
    expect(summary.researchPerTurn).toBe(15);
    expect(summary.researchOddsPct).toBe(2);
  });

  it('a colony base founding on a farming-dead world lands its first unit as a WORKER', () => {
    const s = newGame();
    const home = homeOf(s);
    const homePlanet = s.planets.find((p) => p.id === home.planetId)!;
    // make the barren world the ONLY open planet in the home system
    s.planets = s.planets.filter((p) => p.starId !== homePlanet.starId || p.id === homePlanet.id);
    s.planets.push({
      id: s.nextId++, starId: homePlanet.starId, orbit: 4, body: 'planet',
      sizeClass: 3, climate: 'barren', minerals: 'abundant', gravity: 'normal',
      special: null, homeworldOf: null, terraformSteps: 0,
    });
    setJobs(home, 4, 4);
    home.queue.push({ item: 'colony_base' });
    for (let press = 0; press < 40 && s.colonies.filter((c) => c.owner === 0).length < 2; press++) {
      advanceTurn(s);
    }
    const settled = s.colonies.filter((c) => c.owner === 0).find((c) => c.id !== home.id);
    expect(settled).toBeDefined();
    const g = settled!.groups[0]!;
    expect(g.workers).toBe(1);
    expect(g.farmers).toBe(0);
  });
});
