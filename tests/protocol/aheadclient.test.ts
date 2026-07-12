// Regression locks for discovered_bugs.md 2026-07-12 #2/#3: a client whose
// local record is AHEAD of the host (crash-lost tail, stale re-host) or from a
// DIFFERENT game (what-if branch in the same room) must be detected and
// reset-resynced instead of freezing forever.

import { describe, expect, it } from 'vitest';
import { MemoryHub } from '@protocol/memoryTransport';
import { createHostedGame, joinGame } from '@protocol/setup';
import { DEFAULT_SETTINGS, type LogCommand } from '@protocol/messages';
import type { EngineAdapter } from '@protocol/engineAdapter';
import { createGameEngine } from '@engine/adapter';
import type { GameState } from '@engine/types';

const SEED = '0123456789abcdef0123456789abcdef';

function identity(name: string) {
  return { name, engineVersion: '0.1.0', dataVersion: 'dv-test', roomCode: 'AHEAD', lobbyServer: 'memory' };
}

function engine(): EngineAdapter<GameState> {
  return createGameEngine() as unknown as EngineAdapter<GameState>;
}

const settings = {
  ...DEFAULT_SETTINGS,
  playerCount: 2,
  galaxySize: 'small' as const,
  startMode: 'average' as const,
};

/** Build a finished 3-turn log to fork from. */
async function playThreeTurns(): Promise<{ log: LogCommand[]; finalHash: string }> {
  const hub = new MemoryHub(2);
  const hosted = createHostedGame<GameState>({
    transport: hub.join(),
    engine: engine(),
    hostEngine: engine(),
    store: null,
    settings,
    identity: identity('Ann'),
  });
  const bob = joinGame<GameState>({ transport: hub.join(), engine: engine(), store: null, identity: identity('Bob') });
  await hub.settle();
  hosted.host.startGame(SEED);
  await hub.settle();
  for (let i = 0; i < 3; i++) {
    hosted.session.commitTurn();
    bob.commitTurn();
    await hub.settle();
  }
  const eng = engine();
  return { log: [...hosted.host.getLog()], finalHash: eng.hash(hosted.session.getState()!) };
}

describe('ahead-of-host clients', () => {
  it('a client ahead of a crash-resumed host is reset-resynced instead of freezing', async () => {
    const { log } = await playThreeTurns();
    // the host crashed before persisting its last turn: resume from a
    // truncated log (drop the trailing advance_turn)
    const lastAdvance = [...log].reverse().find((c) => c.kind === 'advance_turn')!;
    const truncated = log.filter((c) => c.seq < lastAdvance.seq);

    const hub = new MemoryHub(2);
    const hosted = createHostedGame<GameState>({
      transport: hub.join(),
      engine: engine(),
      hostEngine: engine(),
      store: null,
      settings,
      identity: identity('Ann'),
      resume: { gameId: `g-${SEED.slice(0, 16)}`, log: truncated },
    });
    // Bob resumes from his FULL local record — he is ahead of the host
    const eng = engine();
    let bobState: GameState | null = null;
    for (const c of log) {
      bobState = c.kind === 'game_start' ? eng.init(c.payload as never) : eng.apply(bobState!, c);
    }
    const bob = joinGame<GameState>({
      transport: hub.join(),
      engine: engine(),
      store: null,
      identity: identity('Bob'),
      resume: { gameId: `g-${SEED.slice(0, 16)}`, lastSeq: log[log.length - 1]!.seq, state: bobState },
    });
    let desyncs = 0;
    bob.subscribe((ev) => {
      if (ev.type === 'desync') desyncs++;
    });
    await hub.settle();

    // Bob was told to reset and refolded the host's (shorter) authoritative log
    expect(desyncs).toBeGreaterThan(0);
    const hostTurn = hosted.session.getState()!.turn;
    expect(bob.getState()!.turn).toBe(hostTurn);
    expect(engine().hash(bob.getState()!)).toBe(engine().hash(hosted.session.getState()!));

    // and the table is playable again: both commit, the turn advances
    hosted.session.commitTurn();
    bob.commitTurn();
    await hub.settle();
    expect(hosted.session.getState()!.turn).toBe(hostTurn + 1);
    expect(bob.getState()!.turn).toBe(hostTurn + 1);
  });

  it('a client resuming a DIFFERENT game for this room resets on the welcome gameId', async () => {
    const { log } = await playThreeTurns();
    const eng = engine();
    let staleState: GameState | null = null;
    for (const c of log) {
      staleState = c.kind === 'game_start' ? eng.init(c.payload as never) : eng.apply(staleState!, c);
    }

    // the room now hosts a FRESH game (different seed => different gameId)
    const seed2 = 'fedcba9876543210fedcba9876543210';
    const hub = new MemoryHub(2);
    const hosted = createHostedGame<GameState>({
      transport: hub.join(),
      engine: engine(),
      hostEngine: engine(),
      store: null,
      settings,
      identity: identity('Ann'),
    });
    const bob = joinGame<GameState>({
      transport: hub.join(),
      engine: engine(),
      store: null,
      identity: identity('Bob'),
      // Bob's tab auto-resumed the OLD game's record for this room
      resume: { gameId: `g-${SEED.slice(0, 16)}`, lastSeq: log[log.length - 1]!.seq, state: staleState },
    });
    await hub.settle();
    hosted.host.startGame(seed2);
    await hub.settle();

    // Bob dropped the stale branch and folded the new game from seq 0
    expect(bob.gameId).toBe(`g-${seed2.slice(0, 16)}`);
    expect(bob.getState()!.turn).toBe(hosted.session.getState()!.turn);
    expect(engine().hash(bob.getState()!)).toBe(engine().hash(hosted.session.getState()!));

    hosted.session.commitTurn();
    bob.commitTurn();
    await hub.settle();
    expect(bob.getState()!.turn).toBe(hosted.session.getState()!.turn);
  }, 30_000);
});
