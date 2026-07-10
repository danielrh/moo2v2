import { describe, expect, it } from 'vitest';
import { gameEngine, SHIP_STYLES, shipStyleOf, detectBattles, buildBattleInput } from '@engine/index';
import { applyCommand, validateCommand } from '@engine/commands';
import type { GameState } from '@engine/types';

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
      debugCommands: true,
    },
    players: [
      { id: 0, name: 'A', raceJson: JSON.stringify({ presetId: 'solari' }) },
      { id: 1, name: 'B', raceJson: JSON.stringify({ presetId: 'solari' }) },
    ],
    dataVersion: 'test',
  });
}

function cmd(state: GameState, playerId: number, kind: string, payload: unknown) {
  return { turn: state.turn, playerId, kind, payload };
}

describe('set_ship_style (cosmetic fleet appearance)', () => {
  it('applies a valid style and rejects unknown ones', () => {
    const state = newGame();
    const c = cmd(state, 0, 'set_ship_style', { style: 'crescent' });
    expect(validateCommand(state, c)).toBeNull();
    applyCommand(state, c);
    expect(state.empires.find((e) => e.id === 0)!.shipStyle).toBe('crescent');
    expect(validateCommand(state, cmd(state, 0, 'set_ship_style', { style: 'flying_toaster' }))).toContain('unknown ship style');
    expect(validateCommand(state, cmd(state, 0, 'set_ship_style', {}))).toContain('unknown ship style');
  });

  it('defaults to a stable per-empire style when unset', () => {
    const state = newGame();
    for (const e of state.empires) {
      const def = shipStyleOf(e);
      expect(SHIP_STYLES.some((s) => s.id === def)).toBe(true);
      expect(shipStyleOf(e)).toBe(def); // stable
    }
    // chosen style wins over the default
    applyCommand(state, cmd(state, 1, 'set_ship_style', { style: 'halo' }));
    expect(shipStyleOf(state.empires.find((e) => e.id === 1)!)).toBe('halo');
  });

  it('round-trips through serialize/deserialize', () => {
    const state = newGame();
    applyCommand(state, cmd(state, 0, 'set_ship_style', { style: 'bulwark' }));
    const back = gameEngine.deserialize(gameEngine.serialize(state));
    expect(gameEngine.hash(back)).toBe(gameEngine.hash(state));
    expect(back.empires.find((e) => e.id === 0)!.shipStyle).toBe('bulwark');
  });
});

describe('save_design modelIdx (cosmetic model variant)', () => {
  const design = (modelIdx?: number) => ({
    name: 'Testbed',
    hull: 'frigate',
    computer: 0,
    shield: 0,
    specials: [],
    weapons: [{ weapon: 'laser_cannon', count: 1, mods: [] }],
    ...(modelIdx !== undefined ? { modelIdx } : {}),
  });

  it('persists a chosen variant and leaves it absent when not sent', () => {
    const state = newGame();
    applyCommand(state, cmd(state, 0, 'save_design', design(2)));
    applyCommand(state, cmd(state, 0, 'save_design', design()));
    const designs = state.empires.find((e) => e.id === 0)!.designs;
    expect(designs.at(-2)!.modelIdx).toBe(2);
    expect('modelIdx' in designs.at(-1)!).toBe(false);
  });

  it('rejects out-of-range variants', () => {
    const state = newGame();
    expect(validateCommand(state, cmd(state, 0, 'save_design', design(-1)))).toContain('bad model variant');
    expect(validateCommand(state, cmd(state, 0, 'save_design', design(99)))).toContain('bad model variant');
    expect(validateCommand(state, cmd(state, 0, 'save_design', design(3)))).toBeNull();
  });
});

describe('battle input snapshots fleet appearance', () => {
  it('carries style + modelIdx per combat ship', () => {
    const state = newGame();
    applyCommand(state, cmd(state, 0, 'set_ship_style', { style: 'gemini' }));
    applyCommand(state, cmd(state, 0, 'declare_war', { target: 1 }));
    const bHome = state.colonies.find((c) => c.owner === 1)!;
    const starId = state.planets.find((p) => p.id === bHome.planetId)!.starId;
    const designId = (owner: number) => state.empires.find((e) => e.id === owner)!.designs[0]!.id;
    applyCommand(state, cmd(state, 0, 'debug_spawn_ships', { starId, designId: designId(0), count: 2 }));
    applyCommand(state, cmd(state, 1, 'debug_spawn_ships', { starId, designId: designId(1), count: 1 }));
    const battles = detectBattles(state);
    expect(battles.length).toBe(1);
    const built = buildBattleInput(state, battles[0]!);
    const a = built.input.ships.filter((s) => s.side === 0 && !s.isBase);
    const d = built.input.ships.filter((s) => s.side === 1 && !s.isBase);
    expect(a.length).toBeGreaterThan(0);
    for (const s of a) {
      expect(s.style).toBe('gemini');
      expect(typeof s.modelIdx).toBe('number');
    }
    // defender never chose: falls back to their per-empire default
    for (const s of d.filter((x) => x.shipId < 1_000_000)) {
      expect(s.style).toBe(shipStyleOf(state.empires.find((e) => e.id === 1)!));
    }
  });
});
