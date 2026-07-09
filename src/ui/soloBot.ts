// Single-player bot: a deliberately simple opponent driven entirely through
// the normal command log, so the simulation never special-cases it.
//
// Two modes:
//   'parity' — keeps up via visible, replayable debug-command grants:
//     research parity (learns whatever the human knows), expansion parity
//     (founds the nearest free colony when the human expands), and a 100 BC
//     stipend when broke. Copies the human's ship designs.
//   'fair'   — no help at all: researches on its own, builds colony ships and
//     settles free planets with ordinary commands, spends its own money.
// Everything else is ordinary play in both modes: planets stay fed with one
// scientist and the rest on industry, it builds random things, occasionally
// buys production, and — in aggressive mode — throws half its warfleet at the
// human's nearest systems.

import { selectors, starDistance } from '@engine/index';
import type { GameState } from '@engine/types';
import type { GameSession } from '@protocol/session';

export type BotMode = 'parity' | 'fair';

export interface SoloBotOptions {
  session: GameSession<GameState>;
  raceJson?: string;
  /** 'parity' (default) uses logged debug grants; 'fair' never cheats */
  mode?: BotMode;
}

/** deterministic-enough tiny PRNG for bot whims (commands are logged anyway) */
function whim(seedA: number, seedB: number): () => number {
  let s = (seedA * 2654435761 + seedB * 40503 + 1) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export class SoloBot {
  private readonly session: GameSession<GameState>;
  readonly mode: BotMode;
  private aggressive = false;
  private lastPlayedTurn = 0;
  private orderedBattles = new Set<string>();
  private unsub: (() => void) | null = null;

  constructor(opts: SoloBotOptions) {
    this.session = opts.session;
    this.mode = opts.mode ?? 'parity';
    const raceJson = opts.raceJson ?? JSON.stringify({ presetId: 'hivex' });
    this.session.setRaceConfig(raceJson, true);
    this.unsub = this.session.subscribe((ev) => {
      if (ev.type === 'lobby') {
        // re-ready only while the roster does not yet show us ready — an
        // unconditional send here would echo lobby updates forever
        const self = this.session.getRoster().find((p) => p.id === this.session.playerId);
        if (self && (!self.ready || !self.raceJson)) this.session.setRaceConfig(raceJson, true);
      }
      if (ev.type === 'started' || ev.type === 'turn-advanced' || ev.type === 'state' || ev.type === 'commit-status') {
        this.maybePlay();
      }
    });
  }

  close(): void {
    this.unsub?.();
    this.unsub = null;
  }

  /** the empire seat this bot plays (assigned by the host's welcome) */
  get seatId(): number {
    return this.session.playerId;
  }

  setAggressive(on: boolean): void {
    this.aggressive = on;
    // new stance applies immediately on the current turn
    if (this.session.getState()) this.lastPlayedTurn = 0;
    this.maybePlay();
  }

  isAggressive(): boolean {
    return this.aggressive;
  }

  /** Play the current turn once: issue orders, then commit. */
  private maybePlay(): void {
    const state = this.session.getState();
    if (!state || state.winner !== null) return;
    if (state.phase !== 'planning') {
      this.orderBattles(state);
      return;
    }
    if (state.turn === this.lastPlayedTurn) return;
    this.lastPlayedTurn = state.turn;
    this.orderedBattles.clear();
    try {
      this.playTurn(state);
    } finally {
      this.session.commitTurn();
    }
  }

  private submit(kind: string, payload: unknown): void {
    this.session.submit(kind, payload); // rejections are fine — the bot shrugs
  }

  private playTurn(state: GameState): void {
    const me = this.session.playerId;
    const human = state.empires.find((e) => e.id !== me && !e.eliminated);
    const bot = state.empires.find((e) => e.id === me);
    if (!bot || !human) return;
    const rand = whim(state.turn, me);

    if (this.mode === 'parity') {
      // ---- stipend: broke bots get 100 BC (logged, no sim special case) ----
      if (bot.bc <= 0) this.submit('debug_add_bc', { amount: 100 });

      // ---- research parity: learn everything the human knows ----
      for (const app of human.knownApps) {
        if (!bot.knownApps.includes(app)) this.submit('debug_grant_app', { appId: app });
      }
    }
    // keep the labs pointed somewhere so banked RP is not wasted
    if (bot.research.fieldNum === null) {
      const planned = this.session.getPlanned() ?? state;
      const choices = selectors.researchChoices(planned, me);
      const open = choices.filter((c) => c.apps.some((a) => !a.known));
      if (open.length) {
        const pick = open[Math.floor(rand() * open.length)]!;
        const target = pick.grantsAll ? null : (pick.apps.find((a) => !a.known)?.id ?? null);
        this.submit('set_research', { fieldNum: pick.field.num, targetApp: target });
      }
    }

    if (this.mode === 'parity') {
      // ---- expansion parity: human has more colonies -> found the nearest free planet ----
      const humanColonies = state.colonies.filter((c) => c.owner === human.id && !c.outpost).length;
      const botColonies = state.colonies.filter((c) => c.owner === me && !c.outpost).length;
      if (humanColonies > botColonies) {
        const target = this.nearestFreePlanet(state, me);
        if (target !== null) this.submit('debug_found_colony', { planetId: target });
      }

      // ---- copy the human's ship designs (post-parity, components are known) ----
      const botDesignNames = new Set(bot.designs.filter((d) => !d.obsolete).map((d) => d.name));
      for (const d of human.designs) {
        if (d.obsolete || botDesignNames.has(d.name)) continue;
        this.submit('save_design', {
          name: d.name,
          hull: d.hull,
          computer: d.computer,
          shield: d.shield,
          specials: [...d.specials],
          weapons: d.weapons.map((w) => ({ weapon: w.weapon, count: w.count, mods: [...w.mods] })),
        });
      }
    }

    // ---- per-colony: jobs (fed + 1 scientist + industry), builds, buys ----
    const planned = this.session.getPlanned() ?? state;
    for (const colony of planned.colonies) {
      if (colony.owner !== me || colony.outpost) continue;
      const jobs = selectors.presetJobs(planned, colony.id, 'industry');
      if (jobs) {
        // one researcher per planet "so it has a chance to research more"
        const g = jobs.find((x) => x.workers > 0);
        if (g) {
          g.workers--;
          g.scientists++;
        }
        this.submit('set_jobs', { colonyId: colony.id, groups: jobs });
      }
      if (colony.queue.length === 0) {
        const row = selectors.colonyRow(planned, colony);
        const options = row.buildable.filter((b) => b !== 'housing' && b !== 'trade_goods' && b !== 'spy');
        if (options.length) {
          const item = options[Math.floor(rand() * options.length)]!;
          this.submit('set_build_queue', { colonyId: colony.id, items: [item] });
        }
      } else if (bot.bc > 150 && rand() < 0.3) {
        // surplus money gets spent on whatever is on the slipway
        const row = selectors.colonyRow(planned, colony);
        if (row.canBuy) this.submit('buy_production', { colonyId: colony.id });
      }
    }

    // ---- fair expansion: build/sail/settle colony ships, no shortcuts ----
    if (this.mode === 'fair') this.fairExpansion(me);

    // ---- aggression: half the warfleet at the human's two nearest systems ----
    if (this.aggressive) this.attack(state, me, human.id);
  }

  /** Non-cheating expansion: settle with real colony ships. Colony ships at a
   * star colonize the best free planet there or sail to the nearest reachable
   * free system; while free planets exist, one colony ship stays queued. */
  private fairExpansion(me: number): void {
    const planned = this.session.getPlanned();
    if (!planned) return;
    const freePlanets = planned.planets.filter(
      (p) =>
        p.body === 'planet' &&
        !planned.colonies.some((c) => c.planetId === p.id) &&
        !planned.monsters.some((m) => m.starId === p.starId),
    );
    const colonyShips = planned.ships.filter((s) => s.owner === me && s.shipKind === 'colony_ship');
    for (const ship of colonyShips) {
      if (ship.location.kind !== 'star') continue; // already sailing
      const starId = ship.location.starId;
      const here = freePlanets
        .filter((p) => p.starId === starId)
        .sort((a, b) => b.sizeClass - a.sizeClass);
      if (here.length) {
        this.submit('colonize', { shipId: ship.id, planetId: here[0]!.id });
        continue;
      }
      const dest = selectors
        .moveOptions(planned, me, starId)
        .find((o) => o.reachable && freePlanets.some((p) => p.starId === o.starId));
      if (dest) this.submit('move_ships', { shipIds: [ship.id], destStarId: dest.starId });
    }
    // keep exactly one colony ship in the pipeline while there is room to grow
    const building = planned.colonies.some(
      (c) => c.owner === me && c.queue.some((q) => q === 'colony_ship'),
    );
    if (freePlanets.length && !colonyShips.length && !building) {
      const rows = planned.colonies
        .filter((c) => c.owner === me && !c.outpost)
        .map((c) => selectors.colonyRow(planned, c))
        .filter((r) => r.buildable.includes('colony_ship'))
        .sort((a, b) => (b.output.prodToQueue || b.output.prod) - (a.output.prodToQueue || a.output.prod));
      const best = rows[0];
      if (best) this.submit('set_build_queue', { colonyId: best.id, items: ['colony_ship', ...best.queue] });
    }
  }

  private nearestFreePlanet(state: GameState, me: number): number | null {
    const myStars = new Set<number>();
    for (const c of state.colonies) {
      if (c.owner !== me) continue;
      const p = state.planets.find((x) => x.id === c.planetId);
      if (p) myStars.add(p.starId);
    }
    const anchors = state.stars.filter((s) => myStars.has(s.id));
    if (!anchors.length) return null;
    let best: { planetId: number; d: number } | null = null;
    for (const planet of state.planets) {
      if (planet.body !== 'planet') continue;
      if (state.colonies.some((c) => c.planetId === planet.id)) continue;
      const star = state.stars.find((s) => s.id === planet.starId)!;
      if (state.monsters.some((m) => m.starId === star.id)) continue; // keepers stay unpoked
      const d = Math.min(...anchors.map((a) => starDistance(a, star)));
      if (!best || d < best.d) best = { planetId: planet.id, d };
    }
    return best?.planetId ?? null;
  }

  private attack(state: GameState, me: number, humanId: number): void {
    // declare war first (no-op if already at war)
    const rel = state.relations.find(
      (r) => (r.a === Math.min(me, humanId) && r.b === Math.max(me, humanId)),
    );
    if (!rel || rel.status !== 'war') this.submit('declare_war', { target: humanId });

    const warships = state.ships.filter((s) => s.owner === me && s.shipKind === 'design' && s.location.kind === 'star');
    if (!warships.length) return;
    const humanStars = new Set<number>();
    for (const c of state.colonies) {
      if (c.owner !== humanId) continue;
      const p = state.planets.find((x) => x.id === c.planetId);
      if (p) humanStars.add(p.starId);
    }
    const myStars = state.stars.filter((s) =>
      state.colonies.some((c) => {
        if (c.owner !== me) return false;
        const p = state.planets.find((x) => x.id === c.planetId);
        return p?.starId === s.id;
      }),
    );
    const near = (starId: number) => {
      const star = state.stars.find((s) => s.id === starId)!;
      return myStars.length ? Math.min(...myStars.map((s) => starDistance(s, star))) : 0;
    };
    // "2 random planets as close to the player as possible, preferably owned"
    const targets = [...humanStars].sort((a, b) => near(a) - near(b)).slice(0, 2);
    if (!targets.length) return;
    const half = warships.slice(0, Math.max(1, Math.floor(warships.length / 2)));
    const groups: Record<number, number[]> = {};
    half.forEach((s, i) => {
      const t = targets[i % targets.length]!;
      (groups[t] ??= []).push(s.id);
    });
    for (const [starId, shipIds] of Object.entries(groups)) {
      this.submit('move_ships', { shipIds, destStarId: Number(starId) });
    }
  }

  /** battles: charge when aggressive, otherwise hold the line */
  private orderBattles(state: GameState): void {
    const me = this.session.playerId;
    for (const b of state.pendingBattles) {
      if (b.attacker !== me && b.defender !== me) continue;
      const mine = b.attacker === me ? b.ordersA : b.ordersD;
      if (mine !== null || this.orderedBattles.has(b.id)) continue;
      this.orderedBattles.add(b.id); // once — resubmitting on every event would echo forever
      this.submit('battle_orders', {
        battleId: b.id,
        orders: {
          stance: this.aggressive ? 'charge' : 'hold_range',
          priority: 'nearest',
          retreatThresholdPct: 25,
          bombard: this.aggressive && b.attacker === me,
        },
      });
    }
  }
}
