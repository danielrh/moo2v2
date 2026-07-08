import { describe, expect, it } from 'vitest';
import { gameEngine } from '@engine/index';
import { expanderBot, replayGame, runHeadlessGame } from '../../src/headless/bots';

const SEEDS = ['0123456789abcdef0123456789abcdef', 'fedcba9876543210fedcba9876543210'];

describe('headless full games: determinism invariants', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed.slice(0, 8)}: 40 turns, replay(log) == live state`, () => {
      const players = [
        { id: 0, name: 'A', raceJson: JSON.stringify({ presetId: 'cerebri' }), policy: expanderBot },
        { id: 1, name: 'B', raceJson: JSON.stringify({ presetId: 'hivex' }), policy: expanderBot },
      ];
      const run = runHeadlessGame({ seed, players, turns: 40 });
      expect(run.state.turn).toBeGreaterThan(10);

      // replay the exact log over a fresh init
      const replayed = replayGame(
        seed,
        players.map(({ id, name, raceJson }) => ({ id, name, raceJson })),
        run.state.settings,
        run.log,
      );
      expect(gameEngine.hash(replayed)).toBe(gameEngine.hash(run.state));

      // identical second live run
      const run2 = runHeadlessGame({ seed, players, turns: 40 });
      expect(run2.hashes).toEqual(run.hashes);

      // economies actually progressed (bots are functional)
      const colonies = run.state.colonies.filter((c) => !c.outpost);
      expect(colonies.length).toBeGreaterThanOrEqual(2);
      const totalApps = run.state.empires.reduce((s, e) => s + e.knownApps.length, 0);
      const startApps = replayGame(seed, players, run.state.settings, run.log.slice(0, 1));
      void startApps;
      expect(totalApps).toBeGreaterThan(2 * 15); // research advanced beyond the starting set
    });
  }

  it('apply() never mutates its input state', () => {
    const players = [
      { id: 0, name: 'A', raceJson: null, policy: expanderBot },
      { id: 1, name: 'B', raceJson: null, policy: expanderBot },
    ];
    const { state } = runHeadlessGame({ seed: SEEDS[0]!, players, turns: 3 });
    const before = gameEngine.hash(state);
    gameEngine.apply(state, { turn: state.turn, playerId: -1, kind: 'advance_turn', payload: {} });
    gameEngine.takeEvents();
    expect(gameEngine.hash(state)).toBe(before);
  });

  it('snapshot mid-game restores to an identical continuation', () => {
    const players = [
      { id: 0, name: 'A', raceJson: JSON.stringify({ presetId: 'lithor' }), policy: expanderBot },
      { id: 1, name: 'B', raceJson: JSON.stringify({ presetId: 'sauren' }), policy: expanderBot },
    ];
    const run = runHeadlessGame({ seed: SEEDS[1]!, players, turns: 20 });

    // rebuild to turn 10 boundary via log prefix, snapshot, then continue both ways
    const settings = run.state.settings;
    const advIdx: number[] = [];
    run.log.forEach((c, i) => {
      if (c.kind === 'advance_turn') advIdx.push(i);
    });
    const cut = advIdx[9]! + 1; // after 10 advances
    const prefix = run.log.slice(0, cut);
    const suffix = run.log.slice(cut);

    const atTen = replayGame(SEEDS[1]!, players, settings, prefix);
    const viaSnapshot = gameEngine.deserialize(gameEngine.serialize(atTen));
    let a = atTen;
    let b = viaSnapshot;
    for (const cmd of suffix) {
      a = gameEngine.apply(a, cmd);
      b = gameEngine.apply(b, cmd);
      gameEngine.takeEvents();
    }
    expect(gameEngine.hash(a)).toBe(gameEngine.hash(b));
    expect(gameEngine.hash(a)).toBe(gameEngine.hash(run.state));
  });
});
