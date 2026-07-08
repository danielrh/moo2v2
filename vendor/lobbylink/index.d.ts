/**
 * lobbylink browser client: lobby membership over a WebSocket signaling
 * server plus peer-to-peer WebRTC DataChannels between all players.
 *
 * Zero runtime dependencies; everything here compiles with plain `tsc`
 * to a single ES module that is both the npm entry point and the
 * browser bundle (`web/p2p-client.js`). The whole implementation lives
 * in this one file on purpose: tsc cannot bundle multi-file ES modules,
 * and a single file is what game developers can copy straight into
 * their project.
 *
 * Wire compatibility notes (the Rust client must match):
 *  - Signaling protocol: see the repo implementation guide §4.
 *  - Per peer pair, two pre-negotiated SCTP DataChannels:
 *      "reliable"    negotiated id=1, ordered, fully reliable
 *      "best-effort" negotiated id=2, unordered, maxRetransmits=0
 *    Both sides create both channels; the lower player ID of the pair
 *    creates the SDP offer, the higher answers.
 *  - Reliable payloads are chunked into binary frames (big-endian):
 *      offset 0  u8  magic      0x4C ('L')
 *      offset 1  u8  version    0x01
 *      offset 2  u32 msgId      per-sender counter, wraps mod 2^32
 *      offset 6  u32 seq        0-based chunk index
 *      offset 10 u32 total      chunk count for this message (>= 1)
 *      offset 14 u32 payloadLen payload bytes in this frame
 *      offset 18 ... payload
 *    Chunk payload is 16 KiB (last chunk may be shorter); a frame
 *    payload larger than 64 KiB is invalid. Reassembly is keyed by
 *    (sender, msgId) and incomplete messages are dropped after 30 s.
 *  - Best-effort payloads are sent raw (no framing), at most 16000
 *    bytes each; keeping them under ~1200 bytes avoids SCTP
 *    fragmentation, where losing any fragment loses the message.
 */
/**
 * Error carrying a stable machine-readable `code`. Server-reported
 * codes (e.g. "room-full", "slot-not-claimable") pass through
 * unchanged; client-side failures use codes like "connect-timeout",
 * "connection-lost", "invalid-target", "message-too-large",
 * "channel-timeout", "send-failed", "closed".
 */
export declare class LobbyError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export type ReconnectPolicy = "token-only" | "token-or-claim-after-timeout" | "claim-after-timeout" | "host-approval";
export type CreateRoomOptions = {
    maxPlayers: number;
    waitUntilFull?: boolean;
    allowLateJoin?: boolean;
    allowReconnect?: boolean;
    allowReplacement?: boolean;
    reconnectPolicy?: ReconnectPolicy;
    claimAfterMs?: number;
};
export type ConnectOptions = {
    /** "https://host[:port][/path]" or "wss://host[:port][/path]/ws". */
    server: string;
    /** Optional app policy id for hosted static sites. */
    appId?: string;
    /** Room code, 4-64 chars of [A-Za-z0-9_-]. */
    code: string;
    /** Create the room if it does not exist. */
    create?: CreateRoomOptions;
    /** Explicit resume token; overrides the one stored under storageKey. */
    resumeToken?: string;
    /** Claim a specific slot after losing the resume token (claim-slot). */
    claimPlayerId?: number;
    /** Storage key for automatic resume-token persistence. */
    storageKey?: string;
    /**
     * Which storage backs storageKey: "local" (default, survives browser
     * restart, but SHARED BY ALL TABS — two tabs with the same key will
     * steal each other's slot via token resume) or "session" (per-tab,
     * survives reload; the right choice when several tabs on one browser
     * may join the same room).
     */
    storage?: "local" | "session";
    /** Extra ICE servers, appended to the ones issued by the server. */
    iceServers?: RTCIceServer[];
    /** Force TURN relay (iceTransportPolicy "relay"); for TURN testing. */
    forceRelay?: boolean;
};
export type MessageKind = "reliable" | "best-effort";
/** Public snapshot of one room slot. */
export type PlayerInfo = {
    id: number;
    occupied: boolean;
    connected: boolean;
};
export type P2PEvent = {
    type: "message";
    from: number;
    kind: MessageKind;
    data: Uint8Array;
} | {
    type: "player-joined";
    playerId: number;
} | {
    type: "player-left";
    playerId: number;
    reason: "explicit-leave" | "disconnected";
} | {
    type: "player-rejoined";
    playerId: number;
    wasReplacement: boolean;
} | {
    type: "player-replaced";
    playerId: number;
} | {
    type: "started";
} | {
    type: "peer-state";
    playerId: number;
    state: RTCPeerConnectionState;
}
/** Selected ICE candidate types (host/srflx/relay) once connected. */
 | {
    type: "candidate-pair";
    playerId: number;
    local: string;
    remote: string;
}
/** Non-fatal error reported by the lobby server. */
 | {
    type: "lobby-error";
    code: string;
    message: string;
}
/**
 * The signaling WebSocket is gone. Established DataChannels keep
 * working unless code is "replaced", "session-superseded" or
 * "room-expired", in which case the game is over and peers are torn
 * down. A plain transport drop uses code "connection-lost".
 */
 | {
    type: "signaling-closed";
    code: string;
    message: string;
};
export declare class P2PGame {
    readonly code: string;
    readonly selfId: number;
    readonly maxPlayers: number;
    /** Rotates on every (re)join; persisted under storageKey if set. */
    readonly resumeToken: string;
    /** ICE servers in use: the server-issued set plus any from options. */
    readonly iceServers: readonly RTCIceServer[];
    private readonly ws;
    private readonly rtcConfig;
    private readonly storageKey;
    private readonly storageKind;
    private roster;
    private startedFlag;
    private closedFlag;
    private fatalSeen;
    private readonly peers;
    private readonly linkWaiters;
    private readonly sendChains;
    private readonly rebuildCounts;
    private readonly listeners;
    private pendingEvents;
    /** Join (optionally creating) or claim a slot in a room. */
    static connect(opts: ConnectOptions): Promise<P2PGame>;
    private constructor();
    /** True once the room has reached its start condition. */
    get started(): boolean;
    /** Snapshot of all room slots. */
    get players(): readonly PlayerInfo[];
    /**
     * Subscribe to events. Events fired before the first listener
     * registers are buffered and replayed. Returns an unsubscribe
     * function.
     */
    onEvent(cb: (ev: P2PEvent) => void): () => void;
    /**
     * Send one datagram on the unordered, no-retransmit channel. Silently
     * dropped if the channel is not open or its buffer is full (that is
     * the best-effort contract). Throws only on caller errors: bad
     * target or payload over 16000 bytes.
     */
    sendBestEffort(to: number, data: Uint8Array | ArrayBuffer): void;
    /** sendBestEffort to every other occupied slot. */
    broadcastBestEffort(data: Uint8Array | ArrayBuffer): void;
    /**
     * Send a reliable, ordered message (chunked over the reliable
     * channel, up to 16 MiB). Resolves once every chunk has been handed
     * to the transport; rejects if the peer link cannot be established
     * or dies mid-send. Sends to the same peer are serialized.
     */
    sendReliable(to: number, data: Uint8Array | ArrayBuffer): Promise<void>;
    /**
     * Leave the room and release all resources. Sends an explicit leave
     * (freeing our slot) and clears any stored resume token.
     */
    close(): void;
    private emit;
    private handleServerMessage;
    /** A peer got a new session: drop the old link, re-offer if initiator. */
    private resetPeer;
    private sendSignal;
    private createLink;
    private initiatePeer;
    private handleSignal;
    private flushCandidates;
    private addCandidate;
    private handlePeerFailure;
    private reportCandidatePair;
    private channelBytes;
    private onReliableData;
    private bestEffortTo;
    private sendReliableNow;
    /** Resolve the current link to a peer, waiting for one if necessary. */
    private awaitLink;
    private checkTarget;
    private closePeer;
    private teardownPeers;
}
