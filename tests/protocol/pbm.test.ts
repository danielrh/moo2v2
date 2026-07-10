// Play-by-mail turn cycle at the protocol level: one player at a time hosts
// the game from the stored log, commits persist between sessions via the
// exported meta (seedCommitted), and the turn advances when the LAST player
// commits — all without both players ever being online together.

import { describe, expect, it } from 'vitest';
import { MemoryHub } from '@protocol/memoryTransport';
import { stubEngine, type StubState } from '@protocol/engineAdapter';
import { createHostedGame, joinGame } from '@protocol/setup';
import { DEFAULT_SETTINGS, type LogCommand } from '@protocol/messages';

const SEED = '0123456789abcdef0123456789abcdef';
const GID = 'g-0123456789abcdef';

function identity(name: string) {
  return {
    name,
    engineVersion: '0.1.0',
    dataVersion: 'dv-test',
    roomCode: 'PBM1',
    lobbyServer: 'memory',
  };
}

/** one "mail session": the named player re-hosts the log alone, seeds the
 * stored commits, optionally acts, commits, and mails back log + meta */
async function mailSession(
  name: string,
  log: LogCommand[],
  committed: number[],
  play: (session: ReturnType<typeof createHostedGame<StubState>>['session']) => void,
) {
  const hub = new MemoryHub(2);
  const hosted = createHostedGame<StubState>({
    transport: hub.join(),
    engine: stubEngine,
    store: null,
    settings: DEFAULT_SETTINGS,
    identity: identity(name),
    resume: { gameId: GID, log },
  });
  await hub.settle();
  hosted.host.seedCommitted(committed);
  await hub.settle();
  play(hosted.session);
  await hub.settle();
  hosted.session.commitTurn();
  await hub.settle();
  return {
    seat: hosted.session.playerId,
    turn: stubEngine.turnOf(hosted.session.getState()!),
    state: hosted.session.getState()!,
    log: [...hosted.host.getLog()],
    committed: hosted.host.getCommittedSeats(),
  };
}

describe('play by mail (bug: incremental progress, commits persisted between sessions)', () => {
  it('commits survive across sessions; the turn advances when the last player mails in', async () => {
    // the game is created once, live (this is where the save comes from)
    const hub = new MemoryHub(2);
    const hosted = createHostedGame<StubState>({
      transport: hub.join(),
      engine: stubEngine,
      store: null,
      settings: { ...DEFAULT_SETTINGS, playerCount: 2 },
      identity: identity('Alice'),
    });
    const bob = joinGame<StubState>({ transport: hub.join(), engine: stubEngine, store: null, identity: identity('Bob') });
    await hub.settle();
    bob.setRaceConfig('{}', true);
    await hub.settle();
    hosted.host.startGame(SEED);
    await hub.settle();
    const turn0 = stubEngine.turnOf(hosted.session.getState()!);
    let log = [...hosted.host.getLog()];
    let committed: number[] = [];

    // --- mail 1: Alice plays her half-turn and commits; turn must NOT advance
    const s1 = await mailSession('Alice', log, committed, (s) => s.submit('increment', { n: 2 }));
    expect(s1.seat).toBe(0); // name matching gives her seat back
    expect(s1.turn).toBe(turn0); // Bob is still outstanding
    expect(s1.committed).toEqual([0]); // partial progress persisted in meta
    log = s1.log;
    committed = s1.committed;

    // --- mail 2: Bob logs in later, Alice's commit still counts, turn advances
    const s2 = await mailSession('Bob', log, committed, (s) => s.submit('increment', { n: 3 }));
    expect(s2.seat).toBe(1);
    expect(s2.turn).toBe(turn0 + 1); // his commit completed the table
    expect(s2.state.counters['0']).toBe(2); // Alice's mailed-in orders applied
    expect(s2.state.counters['1']).toBe(3);
    expect(s2.committed).toEqual([]); // fresh turn: nobody committed yet
    log = s2.log;
    committed = s2.committed;

    // --- mail 3: Alice's next session resumes the NEW turn cleanly
    const s3 = await mailSession('Alice', log, committed, (s) => s.submit('increment', { n: 5 }));
    expect(s3.turn).toBe(turn0 + 1); // waiting on Bob again
    expect(s3.state.counters['0']).toBe(7);
    expect(s3.committed).toEqual([0]);
  });

  it('a re-login on the same turn sees the own commit and may uncommit to change orders', async () => {
    const hub = new MemoryHub(2);
    const hosted = createHostedGame<StubState>({
      transport: hub.join(),
      engine: stubEngine,
      store: null,
      settings: { ...DEFAULT_SETTINGS, playerCount: 2 },
      identity: identity('Alice'),
    });
    const bob = joinGame<StubState>({ transport: hub.join(), engine: stubEngine, store: null, identity: identity('Bob') });
    await hub.settle();
    bob.setRaceConfig('{}', true);
    await hub.settle();
    hosted.host.startGame(SEED);
    await hub.settle();

    const s1 = await mailSession('Alice', [...hosted.host.getLog()], [], () => {});
    expect(s1.committed).toEqual([0]);

    // Alice returns before Bob played: her stored commit is seeded back
    const hub2 = new MemoryHub(2);
    const again = createHostedGame<StubState>({
      transport: hub2.join(),
      engine: stubEngine,
      store: null,
      settings: DEFAULT_SETTINGS,
      identity: identity('Alice'),
      resume: { gameId: GID, log: s1.log },
    });
    await hub2.settle();
    again.host.seedCommitted(s1.committed);
    await hub2.settle();
    expect(again.host.getCommittedSeats()).toEqual([0]);
    again.session.uncommitTurn(); // changed her mind
    await hub2.settle();
    expect(again.host.getCommittedSeats()).toEqual([]);
  });

  it('stale commits from an already-advanced turn are ignorable by turn check', async () => {
    // the client only seeds when meta.turn matches the resumed turn; here we
    // assert seeding unknown seats is harmless (defensive)
    const hub = new MemoryHub(2);
    const hosted = createHostedGame<StubState>({
      transport: hub.join(),
      engine: stubEngine,
      store: null,
      settings: { ...DEFAULT_SETTINGS, playerCount: 2 },
      identity: identity('Alice'),
    });
    const bob = joinGame<StubState>({ transport: hub.join(), engine: stubEngine, store: null, identity: identity('Bob') });
    await hub.settle();
    bob.setRaceConfig('{}', true);
    await hub.settle();
    hosted.host.startGame(SEED);
    await hub.settle();
    hosted.host.seedCommitted([7, 99]); // nonsense seats: no crash, no advance
    await hub.settle();
    expect(hosted.host.getCommittedSeats()).toEqual([]);
    expect(stubEngine.turnOf(hosted.session.getState()!)).toBe(1);
  });
});
