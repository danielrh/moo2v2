import { test, expect } from '@playwright/test';

// Pick-bidding mode: both players take the same preset, so its positive picks
// are contested. Sealed bids commit -> reveal -> adjusted game_start; ties go
// to the lower seat, so the client (higher bid here) must win the contested
// pick and the game must still start hash-identical for both.

const SERVER = 'http://127.0.0.1:8787';

function roomUrl(room: string, name: string): string {
  return `/?server=${encodeURIComponent(SERVER)}&room=${room}&name=${name}&players=2`;
}

test('sealed-bid pick auction runs between start and game_start', async ({ browser }) => {
  const stamp = `${process.pid % 10000}${Math.floor(Math.random() * 1000)}`;
  const room = `AU${stamp}`;
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await a.goto(roomUrl(room, 'Alice'));
  await expect(a.getByTestId('roster-count')).toHaveText('1 joined', { timeout: 30_000 });
  await b.goto(roomUrl(room, 'Bob'));
  await expect(a.getByTestId('roster-count')).toHaveText('2 joined', { timeout: 30_000 });

  // host flips pick bidding on; both keep the default (same) preset
  await a.getByTestId('mode-pickBidding').check();
  await expect(b.getByTestId('settings-view')).toContainText('Pick bidding', { timeout: 10_000 });
  await b.getByTestId('ready').click();
  await expect(a.getByTestId('start')).toBeEnabled({ timeout: 10_000 });
  await a.getByTestId('start').click();

  // the auction opens on both sides instead of the game starting
  await expect(a.getByTestId('auction')).toBeVisible({ timeout: 15_000 });
  await expect(b.getByTestId('auction')).toBeVisible({ timeout: 15_000 });

  // host seals default (minimum) bids; client raises one bid then seals
  await a.getByTestId('submit-bids').click();
  await expect(a.getByTestId('auction-waiting')).toBeVisible();
  const firstBid = b.locator('[data-testid^="bid-"]').first();
  const min = Number(await firstBid.getAttribute('min'));
  await firstBid.fill(String(min + 1));
  await b.getByTestId('submit-bids').click();

  // commit -> auto reveal -> result -> game_start
  await expect(a.getByTestId('turn')).toHaveText('Turn 1', { timeout: 30_000 });
  await expect(b.getByTestId('turn')).toHaveText('Turn 1', { timeout: 30_000 });

  // both folded the same adjusted game_start: hashes agree after a turn
  await a.getByTestId('commit').click();
  await b.getByTestId('commit').click();
  await expect(a.getByTestId('turn')).toHaveText('Turn 2', { timeout: 20_000 });
  const hashA = await a.getByTestId('state-hash').textContent();
  await expect(b.getByTestId('turn')).toHaveText('Turn 2');
  await expect(b.getByTestId('state-hash')).toHaveText(hashA ?? '');

  // the auction stripped the contested pick from exactly one side
  const picksOf = (page: typeof a) =>
    page.evaluate(() => {
      const s = (window as never as { __moo2: { session: { getPlanned(): { empires: Array<{ id: number; picks: string[] }> } ; playerId: number } } }).__moo2.session;
      const gs = s.getPlanned();
      return gs.empires.map((e) => e.picks);
    });
  const picks = await picksOf(a);
  expect(picks[0]!.length).not.toBe(picks[1]!.length);

  await ctxA.close();
  await ctxB.close();
});
