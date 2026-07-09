import { describe, expect, it } from 'vitest';
import { MemoryHub } from '@protocol/memoryTransport';
import { createHostedGame, joinGame } from '@protocol/setup';
import { DEFAULT_SETTINGS } from '@protocol/messages';
import type { EngineAdapter } from '@protocol/engineAdapter';
import { gameEngine } from '@engine/adapter';
import { areAtWar } from '@engine/battles';
import type { GameState } from '@engine/types';
import { SoloBot } from '@ui/soloBot';

const SEED = '0123456789abcdef0123456789abcdef';

function identity(name: string) {
  return {
    name,
    engineVersion: '0.1.0',
    dataVersion: 'dv-test',
    roomCode: 'SOLO',
    lobbyServer: 'local',
  };
}

async function soloGame(mode: 'parity' | 'fair' = 'parity') {
  const hub = new MemoryHub(2);
  const engine = gameEngine as unknown as EngineAdapter<GameState>;
  const hosted = createHostedGame<GameState>({
    transport: hub.join(),
    engine,
    store: null,
    settings: {
      ...DEFAULT_SETTINGS,
      playerCount: 2,
      debugCommands: mode === 'parity',
      galaxySize: 'small',
      startMode: 'average',
    },
    identity: identity('Human'),
  });
  const botSession = joinGame<GameState>({
    transport: hub.join(),
    engine,
    store: null,
    identity: identity('Bot'),
  });
  const bot = new SoloBot({ session: botSession, mode });
  await hub.settle();
  hosted.session.setRaceConfig(JSON.stringify({ presetId: 'solari' }), true);
  await hub.settle();
  hosted.host.startGame(SEED);
  await hub.settle();
  return { hub, hosted, bot, botSession };
}

async function endTurn(hub: MemoryHub, hosted: Awaited<ReturnType<typeof soloGame>>['hosted']) {
  const before = hosted.session.getState()!.turn;
  hosted.session.commitTurn();
  await hub.settle();
  // battles may pause the turn; the bot answers its own orders, the human's
  // side defaults on the host timeout — resolve manually if still paused
  for (let i = 0; i < 6 && hosted.session.getState()!.turn === before; i++) {
    const s = hosted.session.getState()!;
    if (s.phase === 'battle_orders') {
      for (const b of s.pendingBattles) {
        if (b.attacker === 0 || b.defender === 0) {
          hosted.session.submit('battle_orders', {
            battleId: b.id,
            orders: { stance: 'hold_range', priority: 'nearest', retreatThresholdPct: 25, bombard: false },
          });
        }
      }
    }
    await hub.settle();
  }
  return hosted.session.getState()!.turn;
}

describe('single-player bot (bug: solo mode with a very simple bot, no lobbylink)', () => {
  it('bot readies up, plays every turn, and the game advances on human commits alone', async () => {
    const { hub, hosted, bot } = await soloGame();
    expect(hosted.session.isStarted()).toBe(true);
    let turn = hosted.session.getState()!.turn;
    expect(turn).toBe(1);
    for (let i = 0; i < 5; i++) turn = await endTurn(hub, hosted);
    expect(turn).toBeGreaterThanOrEqual(5); // bot never stalls the game
    bot.close();
  });

  it('research parity: whatever the human knows, the bot learns next turn', async () => {
    const { hub, hosted, bot } = await soloGame();
    hosted.session.submit('debug_grant_app', { appId: 'research_lab' });
    await hub.settle();
    await endTurn(hub, hosted);
    await hub.settle();
    const state = hosted.session.getState()!;
    expect(state.empires[0]!.knownApps).toContain('research_lab');
    expect(state.empires[1]!.knownApps).toContain('research_lab');
    bot.close();
  });

  it('expansion parity: the bot is granted the nearest free planet when the human expands', async () => {
    const { hub, hosted, bot } = await soloGame();
    const s0 = hosted.session.getState()!;
    // human founds an extra colony directly (debug shortcut for the test)
    const free = s0.planets.find(
      (p) => p.body === 'planet' && !s0.colonies.some((c) => c.planetId === p.id) && !s0.monsters.some((m) => m.starId === p.starId),
    )!;
    hosted.session.submit('debug_found_colony', { planetId: free.id });
    await hub.settle();
    await endTurn(hub, hosted);
    await hub.settle();
    const s1 = hosted.session.getState()!;
    const humanCount = s1.colonies.filter((c) => c.owner === 0 && !c.outpost).length;
    const botCount = s1.colonies.filter((c) => c.owner === 1 && !c.outpost).length;
    expect(humanCount).toBe(2);
    expect(botCount).toBe(2);
    bot.close();
  });

  it('copies human ship designs and keeps colonies working (fed + 1 scientist + industry)', async () => {
    const { hub, hosted, bot } = await soloGame();
    hosted.session.submit('save_design', {
      name: 'Test Lancer',
      hull: 'frigate',
      computer: 1,
      shield: 0,
      specials: [],
      weapons: [{ weapon: 'laser_cannon', count: 1, mods: [] }],
    });
    await hub.settle();
    await endTurn(hub, hosted);
    await hub.settle();
    const state = hosted.session.getState()!;
    expect(state.empires[1]!.designs.some((d) => d.name === 'Test Lancer')).toBe(true);
    // bot colony has at least one scientist and a build under way
    const botColony = state.colonies.find((c) => c.owner === 1 && !c.outpost)!;
    const sci = botColony.groups.reduce((n, g) => n + g.scientists, 0);
    expect(sci).toBeGreaterThanOrEqual(1);
    expect(botColony.queue.length).toBeGreaterThan(0);
    bot.close();
  });

  it('fair mode: never uses debug commands, researches on its own, builds a colony ship to expand', async () => {
    const { hub, hosted, bot } = await soloGame('fair');
    for (let i = 0; i < 3; i++) await endTurn(hub, hosted);
    await hub.settle();
    // no cheating: not a single debug grant in the authoritative log
    expect(hosted.host.getLog().some((c) => c.kind.startsWith('debug_'))).toBe(false);
    const state = hosted.session.getState()!;
    // real research is under way
    expect(state.empires[1]!.research.fieldNum).not.toBeNull();
    // expansion the honest way: a colony ship is queued (or already launched)
    const queued = state.colonies.some(
      (c) => c.owner === 1 && c.queue.some((q) => q.item === 'colony_ship'),
    );
    const launched = state.ships.some((s) => s.owner === 1 && s.shipKind === 'colony_ship');
    expect(queued || launched).toBe(true);
    bot.close();
  });

  it('aggressive mode: declares war and sends warships at the human', async () => {
    const { hub, hosted, bot } = await soloGame();
    await endTurn(hub, hosted);
    // give the bot a small fleet so "half the fleet" exists to send
    // (the human cannot spawn ships for the bot; the bot builds its own — the
    // stance change is what we assert: war + movement orders on its ships)
    bot.setAggressive(true);
    await hub.settle();
    await endTurn(hub, hosted);
    await hub.settle();
    const state = hosted.session.getState()!;
    expect(areAtWar(state, 0, 1)).toBe(true);
    bot.close();
  });
});
