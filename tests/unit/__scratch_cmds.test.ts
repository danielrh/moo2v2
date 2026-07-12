import { describe, expect, it } from 'vitest';
import { gameEngine } from '@engine/adapter';
import type { GameState } from '@engine/types';

const SEED = 'aaaabbbbccccddddeeeeffff00001111';

function newGame(debug = false): GameState {
  return gameEngine.init({
    seed: SEED,
    settings: {
      galaxySize: 'medium',
      startMode: 'average',
      playerCount: 2,
      modes: { creativeVariant: false, pickBidding: false, stickyBuild: false, antarans: false, randomEvents: false },
      battleOrdersTimeoutMs: 1000,
      debugCommands: debug,
    },
    players: [
      { id: 0, name: 'A', raceJson: JSON.stringify({ presetId: 'solari' }) },
      { id: 1, name: 'B', raceJson: JSON.stringify({ presetId: 'solari' }) },
    ],
    dataVersion: 'test',
  });
}

const cmd = (playerId: number, kind: string, payload: unknown, turn = 1) => ({ turn, playerId, kind, payload });

describe('propose giveBc corruption', () => {
  it('accepts a non-gift proposal with a fractional giveBc and corrupts the hash', () => {
    const s = newGame();
    // non_aggression validates giveBc only for gift_bc; giveBc is unchecked here
    const c = cmd(0, 'diplo_propose', { to: 1, kind: 'non_aggression', giveBc: 0.5 });
    const err = gameEngine.validate(s, c);
    console.log('validate non_aggression giveBc=0.5 =>', err);
    expect(err).toBeNull(); // BUG: malformed payload accepted
    const next = gameEngine.apply(s, c);
    const prop = next.proposals.find((p) => p.from === 0 && p.to === 1)!;
    console.log('stored proposal.giveBc =', prop.giveBc);
    expect(prop.giveBc).toBe(0.5); // fractional value written into authoritative state
    // the canonical hasher now throws -> soft-lock + unsavable + desync
    expect(() => gameEngine.hash(next)).toThrow(/non-integer/);
  });

  it('control: same proposal without giveBc hashes fine', () => {
    const s = newGame();
    const c = cmd(0, 'diplo_propose', { to: 1, kind: 'non_aggression' });
    expect(gameEngine.validate(s, c)).toBeNull();
    const next = gameEngine.apply(s, c);
    expect(() => gameEngine.hash(next)).not.toThrow();
  });

  it('also via NaN giveBc and non-string giveApp on a trade proposal', () => {
    const s = newGame();
    const c1 = cmd(0, 'diplo_propose', { to: 1, kind: 'trade', giveBc: Number.NaN });
    console.log('validate trade giveBc=NaN =>', gameEngine.validate(s, c1));
    if (gameEngine.validate(s, c1) === null) {
      expect(() => gameEngine.hash(gameEngine.apply(s, c1))).toThrow();
    }
    const c2 = cmd(0, 'diplo_propose', { to: 1, kind: 'trade', giveApp: 0.25 });
    console.log('validate trade giveApp=0.25 =>', gameEngine.validate(s, c2));
    if (gameEngine.validate(s, c2) === null) {
      expect(() => gameEngine.hash(gameEngine.apply(s, c2))).toThrow();
    }
  });
});

describe('finding-3 regression: propose validator is pure', () => {
  it('validate does not mutate state.relations', () => {
    const s = newGame();
    const before = s.relations.length;
    gameEngine.validate(s, cmd(0, 'diplo_propose', { to: 1, kind: 'non_aggression' }));
    expect(s.relations.length).toBe(before); // peekRelation must not insert
  });
});

describe('debug_add_bc / debug_set_pop store unchecked numbers (debug-gated)', () => {
  it('debug_add_bc with fractional amount corrupts hash when debug is on', () => {
    const s = newGame(true);
    const c = cmd(0, 'debug_add_bc', { amount: 0.5 });
    console.log('validate debug_add_bc amount=0.5 =>', gameEngine.validate(s, c));
    expect(gameEngine.validate(s, c)).toBeNull();
    const next = gameEngine.apply(s, c);
    expect(() => gameEngine.hash(next)).toThrow(/non-integer/);
  });
});

describe('coverage sanity: malformed payloads are rejected, not thrown', () => {
  it('set_jobs with groups:[null] is caught by validateCommand try/catch', () => {
    const s = newGame();
    const col = s.colonies.find((c) => c.owner === 0)!;
    const err = gameEngine.validate(s, cmd(0, 'set_jobs', { colonyId: col.id, groups: [null] }));
    console.log('validate set_jobs groups:[null] =>', err);
    expect(typeof err).toBe('string'); // rejected string, no throw out of host
  });
  it('save_design with computer:0.5 is rejected', () => {
    const s = newGame();
    const err = gameEngine.validate(
      s,
      cmd(0, 'save_design', { name: 'X', hull: 'frigate', computer: 0.5, shield: 0, specials: [], weapons: [] }),
    );
    console.log('validate save_design computer:0.5 =>', err);
    expect(typeof err).toBe('string');
  });
});
