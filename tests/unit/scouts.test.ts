// Scouts carry one laser cannon and fight (bug: "scouts should have 1 laser
// and be able to fight") — they trigger battles and shoot in the sim instead
// of watching from the sidelines.

import { describe, expect, it } from 'vitest';
import { gameEngine } from '@engine/index';
import { applyCommand } from '@engine/commands';
import { detectBattles, resolveBattle } from '@engine/battles';
import type { GameState, TurnEvent } from '@engine/types';

const SEED = 'aaaabbbbccccddddeeeeffff00001111';

function newGame(): GameState {
  return gameEngine.init({
    seed: SEED,
    settings: {
      galaxySize: 'small',
      startMode: 'average',
      playerCount: 2,
      modes: { creativeVariant: false, pickBidding: false, stickyBuild: false, antarans: false, randomEvents: false },
      battleOrdersTimeoutMs: 1000,
      debugCommands: true,
    },
    players: [
      { id: 0, name: 'A', raceJson: JSON.stringify({ presetId: 'solari' }) },
      { id: 1, name: 'B', raceJson: JSON.stringify({ presetId: 'solari' }) },
    ],
    dataVersion: 'test',
  });
}

describe('scouts fight', () => {
  it('an intruding scout triggers a battle and shoots its laser', () => {
    const state = newGame();
    applyCommand(state, { turn: state.turn, playerId: 0, kind: 'declare_war', payload: { target: 1 } });
    // player 0's scout barges into player 1's home system
    const scout = state.ships.find((s) => s.owner === 0 && s.shipKind === 'scout')!;
    const enemyHome = state.colonies.find((c) => c.owner === 1)!;
    const enemyStar = state.planets.find((p) => p.id === enemyHome.planetId)!.starId;
    scout.location = { kind: 'star', starId: enemyStar };

    const battles = detectBattles(state);
    const battle = battles.find((b) => b.starId === enemyStar);
    expect(battle).toBeDefined(); // a lone scout is a combatant, not a spectator
    expect(battle!.attacker).toBe(0);

    battle!.ordersA = { stance: 'charge', priority: 'nearest', retreatThresholdPct: 0, bombard: false };
    battle!.ordersD = { stance: 'charge', priority: 'nearest', retreatThresholdPct: 0, bombard: false };
    const events: TurnEvent[] = [];
    const { summary } = resolveBattle(state, battle!, events) as unknown as {
      summary: Record<string, unknown>;
    };
    expect(summary).toBeDefined();
    // the replay input contains the scout as a REAL combat ship with a laser
    const replay = events.find((e) => e.kind === 'battle_replay')!;
    const input = (replay.payload as { input: { ships: Array<{ shipId: number; weapons: Array<{ weaponId: string }> }>; bystanders: unknown[] } }).input;
    const scoutShip = input.ships.find((s) => s.shipId === scout.id);
    expect(scoutShip).toBeDefined();
    expect(scoutShip!.weapons.some((w) => w.weaponId === 'laser_cannon')).toBe(true);
  });
});
