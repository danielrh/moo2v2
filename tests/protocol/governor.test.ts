// Slider autopilot (bugs.md): the governor turns five slider weights into
// ordinary logged commands each turn — the player keeps research/ships/map.
// Smoke: a governed empire actually develops (jobs set, buildings rise,
// warships appear under a military-heavy mix) without any manual colony play.

import { describe, expect, it } from 'vitest';
import { MemoryHub } from '@protocol/memoryTransport';
import { createHostedGame, joinGame } from '@protocol/setup';
import { DEFAULT_SETTINGS } from '@protocol/messages';
import type { EngineAdapter } from '@protocol/engineAdapter';
import { gameEngine } from '@engine/adapter';
import type { GameState } from '@engine/types';
import { governColonies, DEFAULT_WEIGHTS } from '@ui/governor';
import { SoloBot } from '@ui/soloBot';

const SEED = 'deadbeefdeadbeefdeadbeefdeadbeef';
const TURN_CAP = 90;
const identity = (name: string) => ({ name, engineVersion: '0.1.0', dataVersion: 'dv-test', roomCode: 'GOVR', lobbyServer: 'memory' });

describe('slider autopilot governor', () => {
  it('develops an empire on sliders alone', async () => {
    const hub = new MemoryHub(2);
    const engine = gameEngine as unknown as EngineAdapter<GameState>;
    const hosted = createHostedGame<GameState>({
      transport: hub.join(),
      engine,
      store: null,
      settings: { ...DEFAULT_SETTINGS, playerCount: 2, galaxySize: 'small', startMode: 'average' },
      identity: identity('Sliders'),
    });
    const client = joinGame<GameState>({ transport: hub.join(), engine, store: null, identity: identity('Bot') });
    hosted.session.setRaceConfig(JSON.stringify({ presetId: 'solari' }), true);
    const bot = new SoloBot({ session: client, mode: 'fair', brain: 'v2' });
    await hub.settle();
    hosted.host.startGame(SEED);
    await hub.settle();

    const weights = { ...DEFAULT_WEIGHTS, military: 6 }; // military-leaning mix
    let last = -1;
    for (let i = 0; i < TURN_CAP * 4; i++) {
      await hub.settle();
      const st = hosted.session.getState();
      if (!st) continue;
      if (st.winner !== null || st.turn >= TURN_CAP) break;
      if (st.phase === 'planning' && st.turn !== last) {
        last = st.turn;
        // pick a research field like a (lazy) player so RP is not wasted
        const empire = st.empires.find((e) => e.id === 0)!;
        if (empire.research.fieldNum === null) {
          const open = (await import('@engine/index')).selectors
            .researchChoices(hosted.session.getPlanned() ?? st, 0)
            .filter((c) => c.apps.some((a) => !a.known));
          if (open.length) {
            const pick = open.sort((a, b) => a.cost - b.cost)[0]!;
            hosted.session.submit('set_research', {
              fieldNum: pick.field.num,
              targetApp: pick.grantsAll ? null : (pick.apps.find((a) => !a.known)?.id ?? null),
            });
          }
        }
        governColonies(hosted.session, weights);
        // the player's half of the deal: sail/settle the colony ships the
        // sliders produce (map play stays manual in this mode)
        const planned = hosted.session.getPlanned() ?? st;
        const { selectors } = await import('@engine/index');
        const freePlanets = planned.planets.filter(
          (p) =>
            p.body === 'planet' &&
            !planned.colonies.some((c) => c.planetId === p.id) &&
            !planned.monsters.some((m) => m.starId === p.starId),
        );
        for (const ship of planned.ships) {
          if (ship.owner !== 0 || ship.shipKind !== 'colony_ship' || ship.location.kind !== 'star') continue;
          const starId = ship.location.starId;
          const here = freePlanets.filter((p) => p.starId === starId).sort((a, b) => b.sizeClass - a.sizeClass);
          if (here.length) {
            hosted.session.submit('colonize', { shipId: ship.id, planetId: here[0]!.id });
            continue;
          }
          const dest = selectors
            .moveOptions(planned, 0, starId)
            .find((o) => o.reachable && freePlanets.some((p) => p.starId === o.starId));
          if (dest) hosted.session.submit('move_ships', { shipIds: [ship.id], destStarId: dest.starId });
        }
        hosted.session.commitTurn();
      }
    }
    bot.close();

    const final = hosted.session.getState()!;
    expect(final.turn).toBeGreaterThanOrEqual(TURN_CAP - 1);
    const colonies = final.colonies.filter((c) => c.owner === 0 && !c.outpost);
    // the governed empire develops: it settled or grew, built things, works jobs
    expect(colonies.length).toBeGreaterThanOrEqual(1);
    const buildings = colonies.reduce((n, c) => n + c.buildings.length, 0);
    expect(buildings).toBeGreaterThanOrEqual(3);
    const scientists = colonies.reduce((n, c) => n + c.groups.reduce((m, g) => m + g.scientists, 0), 0);
    expect(scientists).toBeGreaterThan(0);
    const apps = final.empires.find((e) => e.id === 0)!.knownApps.length;
    expect(apps).toBeGreaterThan(5);
    // military slider fields real hulls
    const warships = final.ships.filter((s) => s.owner === 0 && s.shipKind === 'design').length;
    expect(warships).toBeGreaterThan(0);
  }, 300_000);
});
