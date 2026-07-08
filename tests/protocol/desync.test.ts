import { describe, expect, it } from 'vitest';
import { MemoryHub } from '@protocol/memoryTransport';
import { stubEngine, type StubState } from '@protocol/engineAdapter';
import { createHostedGame, joinGame } from '@protocol/setup';
import { DEFAULT_SETTINGS } from '@protocol/messages';

const SEED = '0123456789abcdef0123456789abcdef';

function identity(name: string) {
  return { name, engineVersion: '0.1.0', dataVersion: 'dv-test', roomCode: 'ROOM', lobbyServer: 'memory' };
}

describe('desync drill', () => {
  it('a corrupted client state is detected via hash_report and auto-recovers', async () => {
    const hub = new MemoryHub(2);
    const hosted = createHostedGame<StubState>({
      transport: hub.join(),
      engine: stubEngine,
      store: null,
      settings: { ...DEFAULT_SETTINGS, playerCount: 2 },
      identity: identity('Host'),
    });
    const client = joinGame<StubState>({
      transport: hub.join(),
      engine: stubEngine,
      store: null,
      identity: identity('Client'),
    });
    await hub.settle();
    hosted.host.startGame(SEED);
    await hub.settle();

    // play a clean turn
    hosted.session.submit('increment', { n: 3 });
    await hub.settle();
    hosted.session.commitTurn();
    client.commitTurn();
    await hub.settle();
    expect(client.getState()!.turn).toBe(2);

    // sabotage: silently corrupt the client's authoritative state
    const events: string[] = [];
    client.subscribe((ev) => events.push(ev.type));
    client.getState()!.totalCommands += 999;

    // the next turn boundary reports a wrong hash -> desync_notice -> resync
    hosted.session.commitTurn();
    client.commitTurn();
    await hub.settle();
    await hub.settle(); // notice -> resync_request -> resync_data

    expect(events).toContain('desync');
    expect(client.getState()).not.toBeNull();
    expect(client.getState()!.turn).toBe(hosted.session.getState()!.turn);
    expect(stubEngine.hash(client.getState()!)).toBe(stubEngine.hash(hosted.session.getState()!));
  });
});
