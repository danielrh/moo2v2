// Auto-turn timer (bug: the old mode jumped 60 turns at once). New rule:
// turns ALWAYS advance one at a time; once every player except one has
// committed, the host waits settings.autoTurnSeconds for the laggard and
// then advances without them.

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function twoPlayerGame(settings: Partial<GameSettings>) {
  const hub = new MemoryHub(2);
  const hosted = createHostedGame<StubState>({
    transport: hub.join(),
    engine: stubEngine,
    store: null,
    settings: { ...DEFAULT_SETTINGS, playerCount: 2, ...settings },
    identity: identity('Host'),
  });
  const client = joinGame<StubState>({
    transport: hub.join(),
    engine: stubEngine,
    store: null,
    identity: identity('Client'),
  });
  await hub.settle();
  return { hub, hosted, client };
}

describe('auto-turn timer (all-but-one committed → countdown → single advance)', () => {
  it('advances exactly ONE turn after the timeout when one player lags', async () => {
    const { hub, hosted, client } = await twoPlayerGame({ autoTurnSeconds: 0.05 });
    hosted.host.startGame(SEED);
    await hub.settle();

    client.commitTurn(); // 1 of 2 committed: timer arms
    await hub.settle();
    expect(hosted.session.getState()!.turn).toBe(1);

    await sleep(120);
    await hub.settle();
    expect(hosted.session.getState()!.turn).toBe(2); // one turn, not a jump
    expect(client.getState()!.turn).toBe(2);
    expect(stubEngine.hash(hosted.session.getState()!)).toBe(stubEngine.hash(client.getState()!));

    // nothing further happens without new commits
    await sleep(120);
    await hub.settle();
    expect(hosted.session.getState()!.turn).toBe(2);
  });

  it('uncommitting below the threshold disarms the countdown', async () => {
    const { hub, hosted, client } = await twoPlayerGame({ autoTurnSeconds: 0.05 });
    hosted.host.startGame(SEED);
    await hub.settle();
    client.commitTurn();
    await hub.settle();
    client.uncommitTurn(); // back under all-but-one
    await hub.settle();
    await sleep(120);
    await hub.settle();
    expect(hosted.session.getState()!.turn).toBe(1);
  });

  it('a full table still advances immediately (no waiting)', async () => {
    const { hub, hosted, client } = await twoPlayerGame({ autoTurnSeconds: 5 });
    hosted.host.startGame(SEED);
    await hub.settle();
    client.commitTurn();
    hosted.session.commitTurn();
    await hub.settle();
    expect(hosted.session.getState()!.turn).toBe(2);
  });

  it('is off by default: a lone commit waits forever', async () => {
    const { hub, hosted, client } = await twoPlayerGame({});
    hosted.host.startGame(SEED);
    await hub.settle();
    client.commitTurn();
    await hub.settle();
    await sleep(120);
    await hub.settle();
    expect(hosted.session.getState()!.turn).toBe(1);
  });

  it('the countdown deadline reaches clients via commit_status', async () => {
    const { hub, hosted, client } = await twoPlayerGame({ autoTurnSeconds: 5 });
    hosted.host.startGame(SEED);
    await hub.settle();
    expect(client.getAutoTurnDeadline()).toBeNull();
    client.commitTurn();
    await hub.settle();
    const deadline = client.getAutoTurnDeadline();
    expect(deadline).not.toBeNull();
    expect(deadline! - Date.now()).toBeGreaterThan(3000);
    expect(deadline! - Date.now()).toBeLessThanOrEqual(5000);
    void hosted;
  });
});
