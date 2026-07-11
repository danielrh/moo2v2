// Freewheeling (fast-start) saves must capture ONLY the committed synced
// turn — never the local preview turns a player has raced ahead into
// (bugs.md). The store records accepted commands + authoritative snapshots;
// the preview buffer must stay out of the exported envelope.
import { describe, expect, it } from 'vitest';
import { MemoryHub } from '@protocol/memoryTransport';
import { createHostedGame, joinGame } from '@protocol/setup';
import { DEFAULT_SETTINGS } from '@protocol/messages';
import type { EngineAdapter } from '@protocol/engineAdapter';
import { createGameEngine } from '@engine/adapter';
import { MemoryGameStore } from '@storage/memory';
import { verifySaveEnvelope } from '@storage/savefile';
import { canonicalParse } from '@engine/canonical';
import type { GameState } from '@engine/types';

const SEED = '0123456789abcdef0123456789abcdef';

function identity(name: string) {
  return { name, engineVersion: '0.1.0', dataVersion: 'dv-test', roomCode: 'FSAV', lobbyServer: 'memory' };
}
function engine(): EngineAdapter<GameState> {
  return createGameEngine() as unknown as EngineAdapter<GameState>;
}

describe('fast-mode saves', () => {
  it('exports the synced (slowest-player) turn, not the preview', async () => {
    const hub = new MemoryHub(2);
    const store = new MemoryGameStore();
    const hosted = createHostedGame<GameState>({
      transport: hub.join(),
      engine: engine(),
      hostEngine: engine(),
      branchEngine: engine(),
      store,
      settings: {
        ...DEFAULT_SETTINGS,
        playerCount: 2,
        galaxySize: 'small',
        startMode: 'average',
        fastStart: true,
        modes: { ...DEFAULT_SETTINGS.modes, antarans: false, randomEvents: false },
      },
      identity: identity('Ann'),
    });
    const joiner = joinGame<GameState>({
      transport: hub.join(),
      engine: engine(),
      branchEngine: engine(),
      store: null,
      identity: identity('Bob'),
    });
    await hub.settle();
    hosted.host.startGame(SEED);
    await hub.settle();

    const a = hosted.session;
    // Ann races 4 turns ahead; Bob never ends a turn → synced turn stays 1
    for (let i = 0; i < 4; i++) {
      a.endTurnFast();
      await hub.settle();
    }
    const previewTurn = a.getPlanned()!.turn;
    const syncedTurn = a.getState()!.turn;
    expect(previewTurn).toBeGreaterThan(syncedTurn); // she really is ahead

    await a.flush();
    await a.snapshotNow();
    const envelope = await store.exportGame(a.gameId!, {});
    const verified = verifySaveEnvelope(envelope);
    // the save is the committed synced turn — the preview stayed local
    expect(verified.turn).toBe(syncedTurn);
    const snapState = canonicalParse(envelope.snapshot!.stateJson) as { turn: number };
    expect(snapState.turn).toBe(syncedTurn);
    // and no logged command references a turn beyond the synced one
    for (const c of envelope.commands) {
      expect(c.turn).toBeLessThanOrEqual(syncedTurn);
    }
    void joiner;
  });
});
