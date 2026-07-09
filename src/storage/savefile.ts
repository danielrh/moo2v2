// Host save files: the complete game record (command log + snapshots) as a
// single robust binary file.
//
// Layout:  "MOO2SAVE" (8 ascii bytes) | version u8 | gzip(canonical JSON SaveEnvelope)
// Plain uncompressed JSON envelopes (starting with '{') are also accepted so
// saves remain hand-inspectable/craftable for debugging.
//
// FORWARD COMPATIBILITY CONTRACT (v2; see docs/save-compatibility.md):
// a save must remain loadable by every future build. Loading is snapshot-first:
//  - Same engine+data version: the full command log is deterministically
//    replayed and checked against the snapshot hashes ("replay" mode — the
//    strongest verification; tampered files cannot pass).
//  - Different version (any future build): the embedded final snapshot is the
//    load base ("snapshot" mode). Its integrity is checked by re-hashing the
//    canonical state JSON. The log is kept for provenance but never replayed
//    across versions. State fields added later MUST be optional-with-default
//    so an old snapshot parses cleanly; fields are never renamed or removed.
// v2 saves also embed every periodic snapshot ("history") so play can resume
// from an older turn ("what-if"), unless saved with the no-history option.

import { ENGINE_VERSION, gameEngine } from '@engine/index';
import { DATA_VERSION } from '@engine/data/index';
import { canonicalParse, canonicalStringify, hashCanonical } from '@engine/canonical';
import { gzip, gunzip } from './gzip';
import type { SaveEnvelope, SaveSnapshot } from './repo';

export type { SaveEnvelope };

export const SAVE_MAGIC = 'MOO2SAVE';
export const SAVE_VERSION = 2;

const TE = new TextEncoder();
const TD = new TextDecoder();

export class SaveFileError extends Error {
  constructor(
    readonly stage:
      | 'magic'
      | 'version'
      | 'compression'
      | 'json'
      | 'structure'
      | 'engine_version'
      | 'data_version'
      | 'replay'
      | 'snapshot',
    message: string,
  ) {
    super(message);
    this.name = 'SaveFileError';
  }
}

export async function encodeSaveFile(envelope: SaveEnvelope): Promise<Uint8Array> {
  const body = await gzip(TE.encode(canonicalStringify(envelope as unknown as Record<string, unknown>)));
  const out = new Uint8Array(SAVE_MAGIC.length + 1 + body.length);
  out.set(TE.encode(SAVE_MAGIC), 0);
  out[SAVE_MAGIC.length] = envelope.version;
  out.set(body, SAVE_MAGIC.length + 1);
  return out;
}

export async function decodeSaveFile(bytes: Uint8Array): Promise<SaveEnvelope> {
  let text: string;
  if (bytes.length > 0 && bytes[0] === 0x7b /* '{' */) {
    text = TD.decode(bytes); // plain JSON envelope
  } else {
    if (bytes.length < SAVE_MAGIC.length + 2) {
      throw new SaveFileError('magic', 'file is too small to be a save');
    }
    const magic = TD.decode(bytes.slice(0, SAVE_MAGIC.length));
    if (magic !== SAVE_MAGIC) {
      throw new SaveFileError('magic', 'not a moo2v2 save file (bad header)');
    }
    const version = bytes[SAVE_MAGIC.length]!;
    // accept every version we know how to read; newer builds keep this list growing
    if (version < 1 || version > SAVE_VERSION) {
      throw new SaveFileError('version', `unsupported save version ${version} (this build reads 1..${SAVE_VERSION})`);
    }
    let raw: Uint8Array;
    try {
      raw = await gunzip(bytes.slice(SAVE_MAGIC.length + 1));
    } catch {
      throw new SaveFileError('compression', 'save file is corrupted (decompression failed)');
    }
    text = TD.decode(raw);
  }

  let envelope: SaveEnvelope;
  try {
    envelope = JSON.parse(text) as SaveEnvelope;
  } catch {
    throw new SaveFileError('json', 'save file is corrupted (invalid JSON)');
  }
  validateStructure(envelope);
  return envelope;
}

function validateStructure(env: SaveEnvelope): void {
  const fail = (msg: string): never => {
    throw new SaveFileError('structure', `invalid save: ${msg}`);
  };
  if (env.format !== 'moo2v2-save') fail('wrong format tag');
  if (env.version !== 1 && env.version !== 2) fail(`unknown envelope version ${env.version}`);
  if (!env.game || typeof env.game.game_id !== 'string') fail('missing game record');
  if (!/^[0-9a-f]{32}$/.test(env.game.seed ?? '')) fail('bad seed');
  if (!Array.isArray(env.players) || env.players.length < 1) fail('missing players');
  if (!Array.isArray(env.commands)) fail('missing command log');
  env.commands.forEach((c, i) => {
    if (c.seq !== i) fail(`command log has a gap at seq ${i}`);
    if (typeof c.kind !== 'string') fail(`command ${i} has no kind`);
    if (typeof c.payload !== 'string') fail(`command ${i} payload must be canonical JSON text`);
  });
  if (env.commands.length > 0 && env.commands[0]!.kind !== 'game_start') fail('log must begin with game_start');
  // a save with no (usable) log must carry a snapshot to load from
  if (env.commands.length === 0 && !env.snapshot) fail('no command log and no snapshot');
  if (env.snapshots !== undefined && !Array.isArray(env.snapshots)) fail('bad snapshots list');
}

export interface VerifyResult {
  turn: number;
  finalHash: string;
  commandCount: number;
  /** how this save will load on THIS build: full log replay, or snapshot-first */
  mode: 'replay' | 'snapshot';
  /** human-readable compatibility notes (version differences etc.) */
  warnings: string[];
}

function checkSnapshotIntegrity(snap: SaveSnapshot, label: string): void {
  let parsed: unknown;
  try {
    parsed = canonicalParse(snap.stateJson);
  } catch {
    throw new SaveFileError('snapshot', `${label} is corrupted (invalid state JSON)`);
  }
  const h = hashCanonical(parsed as Record<string, unknown>);
  if (h !== snap.stateHash) {
    throw new SaveFileError('snapshot', `${label} hash mismatch (state tampered or truncated)`);
  }
}

/** Verify a save for loading on THIS build.
 *  - Same engine+data version with a log: deterministic full-log replay,
 *    hash-checked against embedded snapshots ("replay" mode).
 *  - Anything else: snapshot-first ("snapshot" mode) — every embedded snapshot
 *    must re-hash cleanly; the final snapshot becomes the load base. */
export function verifySaveEnvelope(envelope: SaveEnvelope): VerifyResult {
  const warnings: string[] = [];
  const sameEngine = envelope.game.engine_version === ENGINE_VERSION;
  const sameData = envelope.game.data_version === DATA_VERSION;
  if (!sameEngine) {
    warnings.push(`save is from engine ${envelope.game.engine_version}; this build is ${ENGINE_VERSION}`);
  }
  if (!sameData) {
    warnings.push(`save is from data version ${envelope.game.data_version}; this build is ${DATA_VERSION}`);
  }

  if (sameEngine && sameData && envelope.commands.length > 0) {
    // ---- replay mode: strongest check ----
    const bySeq = new Map<number, SaveSnapshot>();
    for (const s of [...(envelope.snapshots ?? []), ...(envelope.snapshot ? [envelope.snapshot] : [])]) {
      bySeq.set(s.seq, s);
    }
    let state: ReturnType<typeof gameEngine.init> | null = null;
    try {
      for (const c of envelope.commands) {
        const payload = JSON.parse(c.payload) as unknown;
        if (c.kind === 'game_start') {
          state = gameEngine.init(payload as never);
        } else if (state) {
          state = gameEngine.apply(state, { turn: c.turn, playerId: c.playerId, kind: c.kind, payload });
          gameEngine.takeEvents();
        }
        const snap = bySeq.get(c.seq);
        if (snap && state) {
          const h = gameEngine.hash(state);
          if (h !== snap.stateHash) {
            throw new SaveFileError('replay', `snapshot hash mismatch at seq ${c.seq} (log or snapshot tampered)`);
          }
        }
      }
    } catch (e) {
      if (e instanceof SaveFileError) throw e;
      throw new SaveFileError('replay', `log replay failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!state) throw new SaveFileError('replay', 'log produced no state');
    return {
      turn: gameEngine.turnOf(state),
      finalHash: gameEngine.hash(state),
      commandCount: envelope.commands.length,
      mode: 'replay',
      warnings,
    };
  }

  // ---- snapshot mode: version drift (or history-stripped save) ----
  if (!envelope.snapshot) {
    // a versioned-off save with no snapshot cannot be loaded at all
    if (!sameEngine) throw new SaveFileError('engine_version', warnings[0]!);
    if (!sameData) throw new SaveFileError('data_version', warnings[warnings.length - 1]!);
    throw new SaveFileError('snapshot', 'save has no snapshot to load from');
  }
  for (const s of envelope.snapshots ?? []) checkSnapshotIntegrity(s, `snapshot at turn ${s.turn}`);
  checkSnapshotIntegrity(envelope.snapshot, 'final snapshot');
  if (envelope.commands.length > 0 && sameEngine && !sameData) {
    warnings.push('game data changed: the command log is kept for provenance but will not be replayed');
  }
  const parsed = canonicalParse(envelope.snapshot.stateJson) as { turn?: number };
  return {
    turn: envelope.snapshot.turn ?? parsed.turn ?? 0,
    finalHash: envelope.snapshot.stateHash,
    commandCount: envelope.commands.length,
    mode: 'snapshot',
    warnings,
  };
}

/** Snapshot turns this save can branch from ("what-if" resume points).
 * Replay mode may branch at ANY turn up to the final one; snapshot mode only
 * at embedded snapshot turns. */
export function resumePoints(envelope: SaveEnvelope, mode: 'replay' | 'snapshot'): number[] {
  const turns = new Set<number>();
  for (const s of envelope.snapshots ?? []) turns.add(s.turn);
  if (envelope.snapshot) turns.add(envelope.snapshot.turn);
  if (mode === 'replay') {
    // every turn boundary in the log is reachable by replay
    for (const c of envelope.commands) turns.add(c.turn);
  }
  return [...turns].sort((a, b) => a - b);
}

export function saveFileName(roomCode: string, turn: number): string {
  return `moo2v2-${roomCode}-turn${turn}.moo2save`;
}
