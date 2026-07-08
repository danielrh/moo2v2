import { test, expect } from '@playwright/test';
import { hashCanonical } from '../src/engine/canonical';
import { DATA_VERSION } from '../src/engine/data/index';
import { gameEngine } from '../src/engine/adapter';
import { rngFor } from '../src/engine/rng';

// Must match the fixture in src/ui/dev/StorageSmoke.svelte.
const PARITY_FIXTURE = {
  fixture: 'node-browser-parity',
  values: [1, 2, 3, 5, 8, 13, 21],
  nested: { b: true, a: 'text', n: null },
};

test('sqlocal/OPFS storage works in-browser and hashes match node', async ({ page }) => {
  await page.goto('/#storage-smoke');
  await expect(page.getByTestId('smoke-result')).not.toHaveText('running...', { timeout: 30_000 });
  const result = JSON.parse((await page.getByTestId('smoke-result').textContent())!) as Record<string, unknown>;

  expect(result['error']).toBeUndefined();
  expect(result['crossOriginIsolated']).toBe(true);
  expect(result['opfsAvailable']).toBe(true);
  expect(result['commandsRoundTrip']).toBe(true);
  expect(result['snapshotRoundTrip']).toBe(true);
  expect(result['ok']).toBe(true);

  // node <-> browser determinism parity
  expect(result['dataVersion']).toBe(DATA_VERSION);
  expect(result['parityHash']).toBe(hashCanonical(PARITY_FIXTURE));
  expect(result['rngSample']).toBe(rngFor('0123456789abcdef0123456789abcdef', 'parity', 1).nextU32());

  // real-engine parity: same scripted mini-game in node must hash identically
  expect(result['engineParity']).toEqual(nodeEngineParity());
});

function nodeEngineParity(): string[] {
  let s = gameEngine.init({
    seed: 'fedcba9876543210fedcba9876543210',
    settings: {
      galaxySize: 'small',
      startMode: 'average',
      playerCount: 2,
      modes: { creativeVariant: false, pickBidding: false, stickyBuild: false, antarans: false, randomEvents: false },
      battleOrdersTimeoutMs: 1000,
      debugCommands: false,
    } as never,
    players: [
      { id: 0, name: 'A', raceJson: JSON.stringify({ presetId: 'cerebri' }) },
      { id: 1, name: 'B', raceJson: JSON.stringify({ presetId: 'hivex' }) },
    ],
    dataVersion: 'parity',
  });
  const hashes: string[] = [gameEngine.hash(s)];
  for (let t = 0; t < 5; t++) {
    s = gameEngine.apply(s, { seq: -1, turn: s.turn, playerId: -1, kind: 'advance_turn', payload: {} } as never);
    gameEngine.takeEvents();
    hashes.push(gameEngine.hash(s));
  }
  return hashes;
}
