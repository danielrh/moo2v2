// Global UI state: which screen is visible plus the active game handle.
// Screens re-render off `app.version`, bumped on every session event; all game
// data is read through session getters (engine state is never proxied).

import type { ActiveGame } from './net';

export interface ReplayEntry {
  battleId: string;
  seed: string;
  input: unknown;
  summary: Record<string, unknown>;
  turn: number;
  watched: boolean;
}

export interface GroundBattleEntry {
  turn: number;
  payload: {
    colonyId: number;
    colonyName: string;
    starId: number;
    attacker: number;
    defender: number;
    captured: boolean;
    civilianLosses: number;
    startTroops: number;
    startMilitia: number;
    rounds: Array<{ t: number; m: number }>;
  };
}

export interface ReportEntry {
  turn: number;
  kind: string;
  payload: Record<string, unknown>;
}

export const app = $state({
  screen: 'home' as 'home' | 'lobby' | 'game',
  error: '',
  connecting: false,
  version: 0,
  chat: [] as Array<{ id: number; from: number; to: number; text: string }>,
  replays: [] as ReplayEntry[],
  groundBattles: [] as GroundBattleEntry[],
  /** replay currently open in the battle viewer */
  viewing: null as ReplayEntry | null,
  /** turn-event feed visible to this player (newest last) */
  reports: [] as ReportEntry[],
  /** host peer connectivity (clients only; host is always true) */
  hostConnected: true,
  /** transient note when the host rejects a command that passed optimistic
   * local validation (lost races: leader hires, colonize contention...) */
  rejectedNote: '',
  /** the ?room=&name= URL auto-join already ran (don't rejoin after leaving) */
  autoJoined: false,
  /** fast start: the CONTACT flash overlay (null = dismissed / never) */
  contactFlash: null as null | { turn: number; pairs: Array<[number, number]> },
  /** map view: star to center/select on next open (colony-ship arrival alert) */
  focusStarId: null as number | null,
});

let rejectedNoteTimer: ReturnType<typeof setTimeout> | null = null;

// Not reactive on purpose: session/transport are external objects.
let activeGame: ActiveGame | null = null;

export function getActive(): ActiveGame | null {
  return activeGame;
}

export function bindActive(active: ActiveGame): void {
  activeGame = active;
  app.error = '';
  app.screen = active.session.isStarted() ? 'game' : 'lobby';
  app.hostConnected = true;
  app.version++;
  if (!active.host) {
    // signaling blips fire spurious player-left for a host whose data channel
    // is fine — only show "host offline" if they stay gone for a while
    let hostLostTimer: ReturnType<typeof setTimeout> | null = null;
    active.transport.onEvent((ev) => {
      if (ev.type === 'player-left' && ev.playerId === 0) {
        if (!hostLostTimer) {
          hostLostTimer = setTimeout(() => {
            hostLostTimer = null;
            app.hostConnected = false;
            app.version++;
          }, 8000);
        }
      } else if ((ev.type === 'player-rejoined' || ev.type === 'player-joined') && ev.playerId === 0) {
        if (hostLostTimer) {
          clearTimeout(hostLostTimer);
          hostLostTimer = null;
        }
        app.hostConnected = true;
      }
      app.version++;
    });
  }
  active.session.subscribe((ev) => {
    app.version++;
    // any session event means host traffic is flowing: the "host offline"
    // banner must clear even when only the signaling websocket dropped
    // (lobbylink fires player-left(0) while the data channel stays healthy)
    if (!active.host && !app.hostConnected) app.hostConnected = true;
    if (ev.type === 'started') app.screen = 'game';
    else if (ev.type === 'version-reject') {
      app.error = ev.reason;
      app.screen = 'home';
    } else if (ev.type === 'rejected') {
      // the optimistic UI already reverted; without a note the action just
      // silently un-happens (lost host-side races)
      app.rejectedNote = `⛔ ${ev.reason}`;
      if (rejectedNoteTimer) clearTimeout(rejectedNoteTimer);
      rejectedNoteTimer = setTimeout(() => {
        app.rejectedNote = '';
        app.version++;
      }, 6000);
    } else if (ev.type === 'chat') {
      app.chat.push({ id: ev.id, from: ev.from, to: ev.to, text: ev.text });
      if (app.chat.length > 100) app.chat.shift();
    } else if (ev.type === 'turn-advanced') {
      // authoritative boundary. In a fast game the preview already showed
      // (identical) events for this turn — the dedupe below drops repeats.
      ingestTurnEvents(active, active.session.lastTurnEvents, ev.turn - 1);
    } else if (ev.type === 'fast-advanced') {
      // fast preview boundary: show the player what their turn produced
      ingestTurnEvents(active, [...active.session.getFastEvents()], ev.turn - 1);
    } else if (ev.type === 'contact') {
      app.contactFlash = { turn: ev.turn, pairs: ev.pairs };
    }
  });
  if (import.meta.env.DEV) {
    // dev/e2e hook: drive the session from the console or page.evaluate
    (window as unknown as Record<string, unknown>)['__moo2'] = { session: active.session };
  }
}

export function leaveGame(): void {
  const g = activeGame;
  activeGame = null;
  app.screen = 'home';
  app.chat = [];
  // scrub per-game UI state: reports/replays/an open viewer leaking into the
  // next game shows the previous game's battles under the new game's turns
  app.replays = [];
  app.groundBattles = [];
  app.reports = [];
  app.viewing = null;
  app.rejectedNote = '';
  app.hostConnected = true;
  app.version++;
  if (!g) return;
  g.solo?.close();
  for (const b of g.bots) b.close();
  void (async () => {
    // play-by-mail: final upload + lock release must finish BEFORE the store
    // (its data source) is torn down
    await g.pbm?.stop().catch(() => undefined);
    g.transport.close();
    // release the room database (OPFS access handle) so another tab can take it
    await g.store?.destroy().catch(() => undefined);
  })();
}
