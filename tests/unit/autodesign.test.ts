// Default designs track research (user request 2026-07-12): every empire
// keeps one engine-maintained design per available hull class (design.auto),
// refitted with the best known computer, shield and beam/missile mix as
// technology lands (pipeline s11_defaultDesignRefresh).

import { describe, expect, it } from 'vitest';
import { gameEngine } from '@engine/adapter';
import { advanceTurn } from '@engine/pipeline';
import { applyCommand, validateCommand } from '@engine/commands';
import type { Empire, GameState } from '@engine/types';

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

const grant = (e: Empire, apps: string[]) => {
  e.knownApps = [...new Set([...e.knownApps, ...apps])].sort();
};
const autoOf = (e: Empire, hull: string) => e.designs.find((d) => d.auto && !d.obsolete && d.hull === hull);

describe('default designs track research', () => {
  it('init: every empire has an auto default per available hull, best-fitted', () => {
    const s = newGame();
    for (const e of s.empires) {
      const autos = e.designs.filter((d) => d.auto && !d.obsolete);
      expect(autos.map((d) => d.hull).sort()).toEqual(['destroyer', 'frigate']);
      const frig = autoOf(e, 'frigate')!;
      expect(frig.name).toBe('Patrol Frigate');
      expect(frig.computer).toBe(1); // electronic computer is average starting tech
      expect(frig.shield).toBe(0); // class I shield is a first-turn CHOICE, not a grant
      expect(frig.weapons).toEqual([{ weapon: 'laser_cannon', count: 2, mods: [] }]);
      expect(autoOf(e, 'destroyer')!.weapons[0]!.weapon).toBe('laser_cannon');
    }
  });

  it('new shield/computer/beam tech refreshes the defaults; the old fit is obsoleted and queued builds migrate', () => {
    const s = newGame();
    s.monsters = [];
    const e = s.empires[0]!;
    const oldFrig = autoOf(e, 'frigate')!;
    const home = s.colonies.find((c) => c.owner === 0)!;
    home.queue.push({ item: `design:${oldFrig.id}` });
    grant(e, ['class_i_shield', 'optronic_computer', 'fusion_beam']);
    advanceTurn(s);
    const frig = autoOf(e, 'frigate')!;
    expect(frig.id).not.toBe(oldFrig.id);
    expect(frig.name).toBe('Patrol Frigate'); // a refresh keeps the class name
    expect(frig.computer).toBe(2); // optronic
    expect(frig.shield).toBe(1); // class I
    expect(frig.weapons[0]!.weapon).toBe('fusion_beam');
    expect(oldFrig.obsolete).toBe(true);
    // the queued build now produces the refreshed design (no dropped production)
    expect(home.queue.some((q) => q.item === `design:${frig.id}`)).toBe(true);
    expect(home.queue.some((q) => q.item === `design:${oldFrig.id}`)).toBe(false);
    // the destroyer default refreshed too; the other empire (no new tech) did not
    expect(autoOf(e, 'destroyer')!.weapons[0]!.weapon).toBe('fusion_beam');
    expect(autoOf(s.empires[1]!, 'frigate')!.weapons[0]!.weapon).toBe('laser_cannon');
  });

  it('no churn while the best fit is unchanged', () => {
    const s = newGame();
    s.monsters = [];
    advanceTurn(s);
    const count = s.empires[0]!.designs.length;
    advanceTurn(s);
    expect(s.empires[0]!.designs.length).toBe(count);
  });

  it('player-saved designs are never touched by the refresh', () => {
    const s = newGame();
    s.monsters = [];
    const e = s.empires[0]!;
    const cmd = {
      turn: s.turn,
      playerId: 0,
      kind: 'save_design',
      payload: { name: 'My Custom', hull: 'frigate', computer: 0, shield: 0, specials: [], weapons: [{ weapon: 'laser_cannon', count: 1, mods: [] }] },
    };
    expect(validateCommand(s, cmd)).toBeNull();
    applyCommand(s, cmd);
    grant(e, ['fusion_beam']);
    advanceTurn(s);
    const mine = e.designs.find((d) => d.name === 'My Custom')!;
    expect(mine.obsolete).toBe(false);
    expect(mine.auto).toBeUndefined();
    expect(mine.weapons).toEqual([{ weapon: 'laser_cannon', count: 1, mods: [] }]);
    // while the auto frigate DID pick up the fusion beam
    expect(autoOf(e, 'frigate')!.weapons[0]!.weapon).toBe('fusion_beam');
  });

  it('a newly unlocked hull class gets a default design (cruiser mounts missiles too)', () => {
    const s = newGame();
    s.monsters = [];
    const e = s.empires[0]!;
    expect(autoOf(e, 'cruiser')).toBeUndefined();
    e.completedFields = [...e.completedFields, 21].sort((a, b) => a - b); // capsule construction
    advanceTurn(s);
    const cruiser = autoOf(e, 'cruiser')!;
    expect(cruiser.name).toBe('Cruiser');
    expect(cruiser.weapons.some((w) => w.weapon === 'laser_cannon')).toBe(true);
    // cruisers carry missile racks: the best known missile is fitted alongside
    expect(cruiser.weapons.some((w) => w.weapon === 'nuclear_missile')).toBe(true);
  });
});
