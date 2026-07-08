<script lang="ts">
  // Dev-only route (#storage-smoke): proves the OPFS/sqlocal storage path works
  // in this browser and exposes engine hashes for node-parity e2e assertions.
  import { canonicalStringify, hashCanonical } from '@engine/canonical';
  import { DATA_VERSION } from '@engine/data/index';
  import { rngFor } from '@engine/rng';
  import { isOpfsLikelyAvailable, openBrowserStore } from '@storage/browser';
  import type { GameMeta } from '@storage/repo';

  let result = $state<string>('running...');

  const PARITY_FIXTURE = {
    fixture: 'node-browser-parity',
    values: [1, 2, 3, 5, 8, 13, 21],
    nested: { b: true, a: 'text', n: null },
  };

  async function run(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {
      crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
      opfsAvailable: isOpfsLikelyAvailable(),
      dataVersion: DATA_VERSION,
      parityHash: hashCanonical(PARITY_FIXTURE),
      rngSample: rngFor('0123456789abcdef0123456789abcdef', 'parity', 1).nextU32(),
    };
    const dbName = 'moo2v2-smoke.sqlite3';
    const { store, sqlocal } = await openBrowserStore(dbName);
    try {
      const meta: GameMeta = {
        gameId: 'smoke-game',
        engineVersion: '0.1.0',
        dataVersion: DATA_VERSION,
        protocolVersion: 1,
        settings: { smoke: true },
        seed: '0123456789abcdef0123456789abcdef',
        localPlayerId: 0,
        lobbyServer: 'local',
        roomCode: 'SMOKE',
      };
      const existing = await store.getGame(meta.gameId);
      if (existing) await store.deleteGame(meta.gameId);
      await store.createGame(meta, [{ id: 0, name: 'Smoke' }]);
      const cmds = Array.from({ length: 20 }, (_, i) => ({
        seq: i,
        turn: 0,
        playerId: 0,
        kind: 'noop',
        payload: { i },
      }));
      await store.appendCommands(meta.gameId, cmds);
      const back = await store.readCommands(meta.gameId);
      out['commandsRoundTrip'] = back.length === 20 && back[7]!.payload !== null && (back[7]!.payload as { i: number }).i === 7;

      const stateJson = canonicalStringify({ turn: 0, log: cmds.map((c) => c.seq) });
      const stateHash = hashCanonical(JSON.parse(stateJson));
      await store.saveSnapshot(meta.gameId, 0, 19, stateJson, stateHash);
      const snap = await store.latestSnapshot(meta.gameId);
      out['snapshotRoundTrip'] = snap?.stateJson === stateJson && snap?.stateHash === stateHash;
      out['ok'] = out['commandsRoundTrip'] === true && out['snapshotRoundTrip'] === true;
    } finally {
      await store.destroy();
      await sqlocal.deleteDatabaseFile().catch(() => undefined);
    }
    return out;
  }

  $effect(() => {
    run()
      .then((r) => (result = JSON.stringify(r)))
      .catch((e) => (result = JSON.stringify({ ok: false, error: String(e) })));
  });
</script>

<pre data-testid="smoke-result">{result}</pre>
