import { describe, expect, it } from 'vitest';
import { MemoryHub } from '@protocol/memoryTransport';
import { stubEngine, type StubState } from '@protocol/engineAdapter';
import { createHostedGame, joinGame } from '@protocol/setup';
import { DEFAULT_SETTINGS, type GameSettings } from '@protocol/messages';

const SEED = '0123456789abcdef0123456789abcdef';

function identity(name: string) {
  return {
    name,
    engineVersion: '0.1.0',
    dataVersion: 'dv-test',
    roomCode: 'ROOM',
    lobbyServer: 'memory',
  };
}

async function twoPlayerGame(settings: Partial<GameSettings>) {
  const hub = new MemoryHub(2);
  const t0 = hub.join();
  const t1 = hub.join();
  const hosted = createHostedGame<StubState>({
    transport: t0,
    engine: stubEngine,
    store: null,
    settings: { ...DEFAULT_SETTINGS, playerCount: 2, ...settings },
    identity: identity('Host'),
  });
  const client = joinGame<StubState>({
    transport: t1,
    engine: stubEngine,
    store: null,
    identity: identity('Client'),
  });
  await hub.settle();
  return { hub, hosted, client };
}

describe('auto-turn option (bug: fast-forward the early game)', () => {
  it('fast-forwards to the configured turn after the first all-commit', async () => {
    const { hub, hosted, client } = await twoPlayerGame({ autoTurnUntil: 7 });
    hosted.host.startGame(SEED);
    await hub.settle();

    client.commitTurn();
    await hub.settle();
    expect(hosted.session.getState()!.turn).toBe(1); // still waiting on host

    hosted.session.commitTurn();
    await hub.settle();
    // one all-commit advanced turn 1, then auto-advance carried it to 7
    expect(hosted.session.getState()!.turn).toBe(7);
    expect(client.getState()!.turn).toBe(7);
    expect(stubEngine.hash(hosted.session.getState()!)).toBe(stubEngine.hash(client.getState()!));
    expect(client.getCommitted()).toEqual([]);

    // past the target, normal commit flow resumes: one advance per all-commit
    client.commitTurn();
    hosted.session.commitTurn();
    await hub.settle();
    expect(hosted.session.getState()!.turn).toBe(8);
  });

  it('is off by default', async () => {
    const { hub, hosted, client } = await twoPlayerGame({});
    hosted.host.startGame(SEED);
    await hub.settle();
    client.commitTurn();
    hosted.session.commitTurn();
    await hub.settle();
    expect(hosted.session.getState()!.turn).toBe(2);
  });

  it('resumes fast-forwarding when a host restarts mid-run', async () => {
    const { hub, hosted, client } = await twoPlayerGame({ autoTurnUntil: 9 });
    hosted.host.startGame(SEED);
    await hub.settle();
    client.commitTurn();
    hosted.session.commitTurn();
    await hub.settle();
    expect(hosted.session.getState()!.turn).toBe(9);

    // simulate a resume from a log that stopped short of the target: the
    // fast-forward continues without any new commits
    const log = hosted.host.getLog();
    const advances = log.filter((c) => c.kind === 'advance_turn');
    const cut = log.indexOf(advances[2]!) + 1; // log through turn 3's advance
    hosted.host.close();
    hub.leave(0);
    await hub.settle();
    const t0 = hub.rejoinSlot(0);
    const resumed = createHostedGame<StubState>({
      transport: t0,
      engine: stubEngine,
      store: null,
      settings: { ...DEFAULT_SETTINGS, playerCount: 2, autoTurnUntil: 9 },
      identity: identity('Host'),
      resume: { gameId: 'g-0123456789abcdef', log: [...log.slice(0, cut)] },
    });
    await hub.settle();
    expect(resumed.session.getState()!.turn).toBe(9);
    // client had already folded to 9; both agree
    expect(stubEngine.hash(resumed.session.getState()!)).toBe(stubEngine.hash(client.getState()!));
  });
});
