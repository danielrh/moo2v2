// Resumed-game seat assignment (bug: players joining a game started from a
// save must get THEIR empire, matched by name, and a bot can stand in for an
// absent player).

import { describe, expect, it } from 'vitest';
import { MemoryHub } from '@protocol/memoryTransport';
import { stubEngine, type StubState } from '@protocol/engineAdapter';
import type { EngineAdapter } from '@protocol/engineAdapter';
import { createHostedGame, joinGame } from '@protocol/setup';
import { DEFAULT_SETTINGS, type LogCommand } from '@protocol/messages';
import { GameSession } from '@protocol/session';
import { gameEngine } from '@engine/adapter';
import type { GameState } from '@engine/types';
import { SoloBot } from '@ui/soloBot';

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

/** a 3-player stub game, returning the log to resume from */
async function playedThreePlayerLog(): Promise<LogCommand[]> {
  const hub = new MemoryHub(3);
  const hosted = createHostedGame<StubState>({
    transport: hub.join(),
    engine: stubEngine,
    store: null,
    settings: { ...DEFAULT_SETTINGS, playerCount: 3 },
    identity: identity('Alice'),
  });
  const bob = joinGame<StubState>({ transport: hub.join(), engine: stubEngine, store: null, identity: identity('Bob') });
  const carol = joinGame<StubState>({ transport: hub.join(), engine: stubEngine, store: null, identity: identity('Carol') });
  await hub.settle();
  bob.setRaceConfig('{}', true);
  carol.setRaceConfig('{}', true);
  await hub.settle();
  hosted.host.startGame(SEED);
  await hub.settle();
  bob.submit('increment', { n: 10 });
  carol.submit('increment', { n: 20 });
  await hub.settle();
  return [...hosted.host.getLog()];
}

describe('seat matching on resume (bug: joiners must see/keep their empire)', () => {
  it('players get their saved empire by name even when they join in a different order', async () => {
    const log = await playedThreePlayerLog();

    const hub = new MemoryHub(3);
    const resumed = createHostedGame<StubState>({
      transport: hub.join(),
      engine: stubEngine,
      store: null,
      settings: DEFAULT_SETTINGS,
      identity: identity('Alice'),
      resume: { gameId: 'g-0123456789abcdef', log },
    });
    // Carol connects FIRST this time (channel 1), Bob second (channel 2)
    const carol = joinGame<StubState>({ transport: hub.join(), engine: stubEngine, store: null, identity: identity('Carol') });
    const bob = joinGame<StubState>({ transport: hub.join(), engine: stubEngine, store: null, identity: identity('Bob') });
    await hub.settle();

    // name matching hands everyone their old seat, and the welcome tells them
    expect(resumed.session.playerId).toBe(0);
    expect(carol.playerId).toBe(2);
    expect(bob.playerId).toBe(1);

    // commands land on the right empire despite the swapped join order
    bob.submit('increment', { n: 1 });
    carol.submit('increment', { n: 2 });
    await hub.settle();
    const s = resumed.session.getState()!;
    expect(s.counters['1']).toBe(11); // Bob's empire
    expect(s.counters['2']).toBe(22); // Carol's empire
  });

  it('the host itself is matched by name (a non-host player can re-host from a save)', async () => {
    const log = await playedThreePlayerLog();
    const hub = new MemoryHub(3);
    const resumed = createHostedGame<StubState>({
      transport: hub.join(),
      engine: stubEngine,
      store: null,
      settings: DEFAULT_SETTINGS,
      identity: identity('Bob'), // Bob re-hosts the game he played as seat 1
      resume: { gameId: 'g-0123456789abcdef', log },
    });
    await hub.settle();
    expect(resumed.session.playerId).toBe(1);
    resumed.session.submit('increment', { n: 5 });
    await hub.settle();
    expect(resumed.session.getState()!.counters['1']).toBe(15);
  });

  it('an unknown name falls back to a free seat instead of stealing a claimed one', async () => {
    const log = await playedThreePlayerLog();
    const hub = new MemoryHub(3);
    createHostedGame<StubState>({
      transport: hub.join(),
      engine: stubEngine,
      store: null,
      settings: DEFAULT_SETTINGS,
      identity: identity('Alice'),
      resume: { gameId: 'g-0123456789abcdef', log },
    });
    const stranger = joinGame<StubState>({ transport: hub.join(), engine: stubEngine, store: null, identity: identity('Dave') });
    await hub.settle();
    expect([1, 2]).toContain(stranger.playerId); // never Alice's seat 0
  });
});

describe('bot substitution (bug: we should be able to sub in our bot for a player)', () => {
  it('a fair bot claims an absent seat by name, keeps the game moving, and hands it back', async () => {
    const hub = new MemoryHub(2);
    const engine = gameEngine as unknown as EngineAdapter<GameState>;
    const hosted = createHostedGame<GameState>({
      transport: hub.join(),
      engine,
      store: null,
      settings: { ...DEFAULT_SETTINGS, playerCount: 2, debugCommands: false, galaxySize: 'small', startMode: 'average' },
      identity: identity('Alice'),
    });
    const bob = joinGame<GameState>({ transport: hub.join(), engine, store: null, identity: identity('Bob') });
    await hub.settle();
    bob.setRaceConfig(JSON.stringify({ presetId: 'solari' }), true);
    await hub.settle();
    hosted.host.startGame(SEED);
    await hub.settle();
    expect(hosted.session.getState()!.turn).toBe(1);

    // Bob drops; Alice alone cannot advance the turn
    hub.disconnect(1);
    await hub.settle();
    hosted.session.commitTurn();
    await hub.settle();
    expect(hosted.session.getState()!.turn).toBe(1);

    // the bot helloes over a host-local link with Bob's name -> gets seat 1
    const link = hosted.host.createLocalLink();
    const botSession = new GameSession<GameState>({
      link,
      engine,
      store: null,
      playerId: -1,
      ...identity('Bob'),
    });
    const botOnBoard = new SoloBot({ session: botSession, mode: 'fair' });
    await hub.settle();
    expect(botSession.playerId).toBe(1);

    // the bot plays Bob's empire: turns advance on Alice's commit alone
    let turn = hosted.session.getState()!.turn;
    for (let i = 0; i < 3; i++) {
      hosted.session.commitTurn();
      await hub.settle();
    }
    turn = hosted.session.getState()!.turn;
    expect(turn).toBeGreaterThanOrEqual(3);

    // fair mode: not a single debug command in the log
    expect(hosted.host.getLog().some((c) => c.kind.startsWith('debug_'))).toBe(false);
    // and it plays for real: research chosen, colonies building
    const s = hosted.session.getState()!;
    expect(s.empires[1]!.research.fieldNum).not.toBeNull();
    const botColony = s.colonies.find((c) => c.owner === 1 && !c.outpost)!;
    expect(botColony.queue.length).toBeGreaterThan(0);

    // hand the seat back: releasing lets the returning Bob reclaim his empire
    botOnBoard.close();
    hosted.host.releaseSeat(1);
    hub.reconnect(1);
    bob.resendHello();
    await hub.settle();
    expect(bob.playerId).toBe(1);
    bob.submit('set_tax_rate', { pct: 10 });
    await hub.settle();
    expect(hosted.session.getState()!.empires[1]!.taxRatePct).toBe(10);
  });
});
