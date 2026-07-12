import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, gameEngine } from '@engine/index';
import { DATA_VERSION } from '@engine/data/index';
import { decodeSaveFile, encodeSaveFile, verifySaveEnvelope } from '@storage/savefile';
import { openNodeStore } from '@storage/node';
import { MemoryGameStore } from '@storage/memory';
import { expanderBot, runHeadlessGame } from '../../src/headless/bots';

const SEED = 'fedcba9876543210fedcba9876543210';

/** persist an identical short real game into BOTH stores */
async function buildBoth() {
  const players = [
    { id: 0, name: 'Alice', raceJson: JSON.stringify({ presetId: 'cerebri' }), policy: expanderBot },
    { id: 1, name: 'Bob', raceJson: JSON.stringify({ presetId: 'hivex' }), policy: expanderBot },
  ];
  const run = runHeadlessGame({ seed: SEED, players, turns: 8 });
  const gameId = `g-${SEED.slice(0, 16)}`;
  const meta = {
    gameId,
    engineVersion: ENGINE_VERSION,
    dataVersion: DATA_VERSION,
    protocolVersion: 1,
    settings: run.state.settings as unknown,
    seed: SEED,
    localPlayerId: 0,
    lobbyServer: 'http://127.0.0.1:8787',
    roomCode: 'TABTWO',
  };
  const roster = players.map((p) => ({ id: p.id, name: p.name }));
  const gameStart = {
    seq: 0,
    turn: 0,
    playerId: -1,
    kind: 'game_start',
    payload: {
      seed: SEED,
      settings: run.state.settings,
      players: players.map((p) => ({ id: p.id, name: p.name, raceJson: p.raceJson })),
      dataVersion: DATA_VERSION,
    } as unknown,
  };
  const rest = run.log.map((c, i) => ({ seq: i + 1, turn: c.turn, playerId: c.playerId, kind: c.kind, payload: c.payload }));
  const liveHash = gameEngine.hash(run.state);

  const mem = new MemoryGameStore();
  const sql = await openNodeStore();
  for (const store of [mem, sql] as const) {
    await store.createGame(meta, roster);
    await store.appendCommands(gameId, [gameStart, ...rest]);
    await store.saveSnapshot(gameId, run.state.turn, rest.length, gameEngine.serialize(run.state), liveHash);
    await store.setGameStatus(gameId, 'active');
  }
  return { mem, sql, gameId, liveHash };
}

describe('MemoryGameStore (bug: multiple tabs disrupt the save file)', () => {
  it('exports a verified save byte-identical in content to the SQLite store', async () => {
    const { mem, sql, gameId, liveHash } = await buildBoth();
    const memEnv = await mem.exportGame(gameId);
    const sqlEnv = await sql.exportGame(gameId);
    // created_at differs by a tick; everything that matters must match
    expect(memEnv.commands).toEqual(sqlEnv.commands);
    expect(memEnv.snapshot).toEqual(sqlEnv.snapshot);
    expect(memEnv.players).toEqual(sqlEnv.players);
    expect({ ...memEnv.game, created_at: '' }).toEqual({ ...sqlEnv.game, created_at: '' });

    const verified = verifySaveEnvelope(memEnv);
    expect(verified.finalHash).toBe(liveHash);
    const bytes = await encodeSaveFile(memEnv);
    const back = await decodeSaveFile(bytes);
    expect(back.commands).toEqual(memEnv.commands);
    await sql.destroy();
  });

  it('supports the session persistence surface: commands, snapshots, events, chat, replays', async () => {
    const mem = new MemoryGameStore();
    const meta = {
      gameId: 'g-1',
      engineVersion: 'e',
      dataVersion: 'd',
      protocolVersion: 1,
      settings: {},
      seed: 'a'.repeat(32),
      localPlayerId: 0,
      lobbyServer: 'x',
      roomCode: 'R',
    };
    await mem.createGame(meta, [{ id: 0, name: 'A' }]);
    await mem.appendCommands('g-1', [{ seq: 0, turn: 0, playerId: -1, kind: 'game_start', payload: { a: 1 } }]);
    // reissued seqs are last-writer-wins upserts, mirroring the sqlite store:
    // desync recovery refolds the healthy branch through here and a throw
    // stranded the memory-only tab's stored log on the dead branch
    await mem.appendCommands('g-1', [{ seq: 0, turn: 0, playerId: -1, kind: 'game_start', payload: { a: 2 } }]);
    const rewritten = await mem.readCommands('g-1');
    expect(rewritten).toHaveLength(1);
    expect(rewritten[0]!.payload).toEqual({ a: 2 });
    await mem.saveTurnHash('g-1', 1, 'h1');
    await mem.appendTurnEvents('g-1', 1, [{ idx: 0, visibleTo: -1, kind: 'x', payload: {} }]);
    await mem.appendChat('g-1', { id: 0, turn: 1, from: 0, to: -1, text: 'hi', sentAt: 'now' });
    await mem.saveBattleReplay('g-1', 'b1', 1, '{}', {});
    await mem.saveSnapshot('g-1', 10, 5, '{"turn":10}', 'h10');
    await mem.saveSnapshot('g-1', 20, 9, '{"turn":20}', 'h20');
    expect(await mem.latestSnapshot('g-1')).toEqual({ turn: 20, seq: 9, stateJson: '{"turn":20}', stateHash: 'h20' });
    expect(await mem.latestSnapshot('g-1', 15)).toEqual({ turn: 10, seq: 5, stateJson: '{"turn":10}', stateHash: 'h10' });
    expect((await mem.readCommands('g-1')).length).toBe(1);
    expect((await mem.listGames())[0]!.game_id).toBe('g-1');
    await mem.deleteGame('g-1');
    expect(await mem.getGame('g-1')).toBeUndefined();
  });
});
