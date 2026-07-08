import { describe, expect, it } from 'vitest';
import { MemoryHub } from '@protocol/memoryTransport';
import { stubEngine, type StubState } from '@protocol/engineAdapter';
import { createHostedGame, joinGame } from '@protocol/setup';
import { DEFAULT_SETTINGS } from '@protocol/messages';
import { bidHash, budgetSlack, findContested, resolveAuction } from '@protocol/auction';
import type { GameStartPayload } from '@protocol/engineAdapter';

const SEED = '0123456789abcdef0123456789abcdef';

function identity(name: string) {
  return {
    name,
    engineVersion: '0.1.0',
    dataVersion: 'dv-test',
    roomCode: 'ROOM',
    lobbyServer: 'memory',
  };
}

// two custom races sharing the contested 'warlord' pick
const RACE_A = JSON.stringify({ picks: ['dictatorship', 'warlord', 'industry1'].sort(), raceName: 'Alpha' });
const RACE_B = JSON.stringify({ picks: ['dictatorship', 'warlord', 'science1'].sort(), raceName: 'Beta' });

describe('auction primitives', () => {
  it('finds contested positive non-government picks', () => {
    const contested = findContested([
      { id: 0, raceJson: RACE_A },
      { id: 1, raceJson: RACE_B },
    ]);
    expect(Object.keys(contested)).toEqual(['warlord']);
    expect(contested['warlord']).toEqual([0, 1]);
  });

  it('resolves by highest valid bid; losers lose the pick', () => {
    const contested = { warlord: [0, 1] };
    const commits = new Map<number, string>();
    const reveals = new Map<number, { bids: Record<string, number>; nonce: string }>();
    const bid = (id: number, amount: number) => {
      const r = { bids: { warlord: amount }, nonce: `n${id}` };
      reveals.set(id, r);
      commits.set(id, bidHash(r.bids, r.nonce));
    };
    bid(0, 5);
    bid(1, 7);
    const result = resolveAuction({
      contested,
      players: [
        { id: 0, raceJson: RACE_A },
        { id: 1, raceJson: RACE_B },
      ],
      reveals,
      commits,
    });
    expect(result.outcomes).toEqual([{ pickId: 'warlord', winner: 1, price: 7 }]);
    const a = JSON.parse(result.players['0']!) as { picks: string[] };
    const b = JSON.parse(result.players['1']!) as { picks: string[] };
    expect(a.picks).not.toContain('warlord');
    expect(b.picks).toContain('warlord');
  });

  it('rejects tampered reveals and unaffordable premiums', () => {
    const contested = { warlord: [0, 1] };
    const commits = new Map<number, string>();
    const reveals = new Map<number, { bids: Record<string, number>; nonce: string }>();
    // player 0 commits to 3 then tries to reveal 9
    commits.set(0, bidHash({ warlord: 3 }, 'n0'));
    reveals.set(0, { bids: { warlord: 9 }, nonce: 'n0' });
    // player 1 bids beyond their budget slack
    const slack = budgetSlack(RACE_B);
    const base = 2; // warlord costs 2
    const tooRich = { bids: { warlord: base + slack + 5 }, nonce: 'n1' };
    commits.set(1, bidHash(tooRich.bids, tooRich.nonce));
    reveals.set(1, tooRich);
    const result = resolveAuction({
      contested,
      players: [
        { id: 0, raceJson: RACE_A },
        { id: 1, raceJson: RACE_B },
      ],
      reveals,
      commits,
    });
    // nobody bid validly: everyone keeps the pick
    expect(result.outcomes).toEqual([{ pickId: 'warlord', winner: null, price: 0 }]);
    expect((JSON.parse(result.players['0']!) as { picks: string[] }).picks).toContain('warlord');
    expect((JSON.parse(result.players['1']!) as { picks: string[] }).picks).toContain('warlord');
  });
});

describe('auction over the wire (commit -> reveal -> adjusted game_start)', () => {
  it('runs the full sealed-bid flow before game_start', async () => {
    const hub = new MemoryHub(2);
    const t0 = hub.join();
    const t1 = hub.join();
    const hosted = createHostedGame<StubState>({
      transport: t0,
      engine: stubEngine,
      store: null,
      settings: { ...DEFAULT_SETTINGS, playerCount: 2, modes: { ...DEFAULT_SETTINGS.modes, pickBidding: true } },
      identity: identity('Host'),
    });
    const client = joinGame<StubState>({
      transport: t1,
      engine: stubEngine,
      store: null,
      identity: identity('Client'),
    });
    await hub.settle();

    hosted.session.setRaceConfig(RACE_A, true);
    client.setRaceConfig(RACE_B, true);
    await hub.settle();

    hosted.host.startGame(SEED);
    await hub.settle();

    // the auction opened instead of the game starting
    expect(hosted.session.isStarted()).toBe(false);
    const auctionH = hosted.session.getAuction();
    const auctionC = client.getAuction();
    expect(auctionH?.phase).toBe('commit');
    expect(auctionC?.phase).toBe('commit');
    expect(Object.keys(auctionH!.contested)).toEqual(['warlord']);

    // both seal bids; client outbids the host
    hosted.session.submitBids({ warlord: 3 });
    client.submitBids({ warlord: 6 });
    await hub.settle();
    await hub.settle(); // commit -> auto-reveal -> result -> game_start

    expect(hosted.session.isStarted()).toBe(true);
    expect(client.isStarted()).toBe(true);
    const outcomes = hosted.session.getAuction()?.outcomes;
    expect(outcomes).toEqual([{ pickId: 'warlord', winner: 1, price: 6 }]);

    // game_start recorded the adjusted race configs + the audit trail
    const start = hosted.host.getLog()[0]!;
    const payload = start.payload as GameStartPayload;
    expect(payload.auction).toEqual([{ pickId: 'warlord', winner: 1, price: 6 }]);
    const hostRace = JSON.parse(payload.players.find((p) => p.id === 0)!.raceJson!) as { picks: string[] };
    const clientRace = JSON.parse(payload.players.find((p) => p.id === 1)!.raceJson!) as { picks: string[] };
    expect(hostRace.picks).not.toContain('warlord');
    expect(clientRace.picks).toContain('warlord');
  });
});
