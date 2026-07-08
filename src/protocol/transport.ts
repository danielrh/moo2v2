// Transport abstraction over lobbylink (or an in-memory fake for tests).

import type { ProtocolMessage } from './messages';

export interface TransportPlayer {
  id: number;
  occupied: boolean;
  connected: boolean;
}

export type TransportEvent =
  | { type: 'player-joined'; playerId: number }
  | { type: 'player-left'; playerId: number; reason: 'explicit-leave' | 'disconnected' }
  | { type: 'player-rejoined'; playerId: number }
  | { type: 'signaling-lost' }
  | { type: 'fatal'; code: string; message: string };

export interface NetTransport {
  readonly selfId: number;
  readonly maxPlayers: number;
  players(): readonly TransportPlayer[];
  /** Reliable, ordered per peer pair. Resolves when handed to the transport. */
  send(to: number, msg: ProtocolMessage): Promise<void>;
  /** Reliable send to every other occupied slot. */
  broadcast(msg: ProtocolMessage): Promise<void>;
  onMessage(cb: (from: number, msg: ProtocolMessage) => void): () => void;
  onEvent(cb: (ev: TransportEvent) => void): () => void;
  close(): void;
}
