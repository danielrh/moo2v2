import { test, expect } from '@playwright/test';
import { hashCanonical } from '../src/engine/canonical';
import { DATA_VERSION } from '../src/engine/data/index';
import { rngFor } from '../src/engine/rng';

// Must match the fixture in src/ui/dev/StorageSmoke.svelte.
const PARITY_FIXTURE = {
  fixture: 'node-browser-parity',
  values: [1, 2, 3, 5, 8, 13, 21],
  nested: { b: true, a: 'text', n: null },
};

test('sqlocal/OPFS storage works in-browser and hashes match node', async ({ page }) => {
  await page.goto('/#storage-smoke');
  const resultText = await page.getByTestId('smoke-result').textContent({ timeout: 30_000 });
  expect(resultText).not.toBe('running...');
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
});
