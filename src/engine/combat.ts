// One-pass tactical combat (redesigned; deterministic; fixed-point integers).
//
// Field: 512x384 units (positions stored x256). 10 logical ticks/second, cap
// 400 ticks (~40s of playback). Range bands by pair distance:
//   short <= 96u (dmg 100%, hit +10), medium <= 224u (70%, +0),
//   long <= 448u (40%, -20); heavy mounts also fire out to 560u at long stats.
// The attacker enters at the left edge; a battle is one pass: it ends at the
// tick cap, when a side has no active ships, or when every surviving attacker
// has crossed the defender line or retreated. Survivors stay in the system,
// so sieges take multiple turns by design.

import { clamp, ceilDiv, roundDiv } from './imath';
import { idist } from './isqrt';
import type { Rng } from './rng';
import type { DesignStats } from './shipdesign';

export const FP = 256; // fixed-point scale
export const FIELD_W = 512 * FP;
export const FIELD_H = 384 * FP;
export const MAX_TICKS = 400;
/** master pace knob: percent of base rate-of-fire (tuned by the balance harness) */
export const COMBAT_PACE = 100;

export type Stance = 'charge' | 'hold_range' | 'standoff' | 'evade_retreat';
export type TargetPriority = 'nearest' | 'biggest' | 'smallest' | 'warships' | 'bases';

export interface BattleOrders {
  stance: Stance;
  priority: TargetPriority;
  /** fleet HP percent that flips survivors to evade_retreat */
  retreatThresholdPct: number;
  /** attacker only: bombard the colony after winning the pass */
  bombard: boolean;
}

export const DEFAULT_ORDERS: BattleOrders = {
  stance: 'charge',
  priority: 'nearest',
  retreatThresholdPct: 25,
  bombard: false,
};

export interface CombatWeapon {
  weaponId: string;
  classId: number; // 0 beam, 1 missile, 2 torpedo, 3 bomb
  dmgMin: number;
  dmgMax: number;
  mods: string[];
  ammo: number; // -1 unlimited
  cooldown: number; // ticks between shots
  count: number;
}

export interface CombatShipInit {
  shipId: number; // GameState ship id (or synthetic for bases)
  side: 0 | 1; // 0 attacker, 1 defender
  hull: string;
  hullIdx: number; // 1..6 ships, 7..9 bases
  isBase: boolean;
  beamAttack: number;
  beamDefense: number;
  speed: number; // units/tick (0 for bases)
  armorHp: number;
  structureHp: number;
  shieldPool: number;
  shieldFlat: number;
  weapons: CombatWeapon[];
  /** structure carried over from previous battles (<= structureHp) */
  startingStructure: number;
  startingArmor: number;
}

export interface BattleInput {
  battleId: string;
  seedLabel: Array<string | number>;
  attacker: number; // empireId
  defender: number;
  ships: CombatShipInit[];
  ordersA: BattleOrders;
  ordersD: BattleOrders;
}

export interface ShotEvent {
  tick: number;
  from: number;
  to: number;
  weaponId: string;
  classId: number;
  hit: boolean;
  dmg: number;
}

export interface BattleTickFrame {
  tick: number;
  ships: Array<{ id: number; x: number; y: number; alive: boolean; retreated: boolean; crossed: boolean; structPct: number; shieldPct: number }>;
  shots: ShotEvent[];
  deaths: number[];
}

export interface ShipOutcome {
  shipId: number;
  side: 0 | 1;
  destroyed: boolean;
  retreated: boolean;
  crossed: boolean;
  structureLeft: number;
  armorLeft: number;
  structureMax: number;
}

export interface BattleResult {
  ticks: number;
  outcomes: ShipOutcome[];
  /** side that still has active (non-retreated) ships when the other doesn't; null = stalemate */
  winner: 0 | 1 | null;
  attackerDamagePct: number; // fleet HP lost by attacker
  defenderDamagePct: number;
}

interface Sim {
  init: CombatShipInit;
  x: number;
  y: number;
  alive: boolean;
  retreated: boolean;
  crossed: boolean;
  shield: number;
  armor: number;
  structure: number;
  targetIdx: number;
  cds: number[]; // cooldown per weapon slot
  ammo: number[];
  stance: Stance;
  priority: TargetPriority;
}

interface Projectile {
  from: number; // sim index
  targetIdx: number;
  x: number;
  y: number;
  dmg: number;
  speed: number; // units/tick
  classId: number;
  weaponId: string;
  hp: number;
}

const BAND_SHORT = 96 * FP;
const BAND_MED = 224 * FP;
const BAND_LONG = 448 * FP;
const BAND_HV = 560 * FP;

function bandOf(dist: number): 0 | 1 | 2 | 3 {
  if (dist <= BAND_SHORT) return 0;
  if (dist <= BAND_MED) return 1;
  if (dist <= BAND_LONG) return 2;
  return 3;
}

const BAND_DMG = [100, 70, 40, 40];
const BAND_HIT = [10, 0, -20, -20];

export function runBattle(
  input: BattleInput,
  rng: Rng,
  onFrame?: (frame: BattleTickFrame) => void,
): BattleResult {
  const sims: Sim[] = input.ships.map((init) => ({
    init,
    x: 0,
    y: 0,
    alive: true,
    retreated: false,
    crossed: false,
    shield: init.shieldPool,
    armor: init.startingArmor,
    structure: init.startingStructure,
    targetIdx: -1,
    cds: init.weapons.map(() => 0),
    ammo: init.weapons.map((w) => (w.ammo < 0 ? -1 : w.ammo * w.count)),
    stance: init.side === 0 ? input.ordersA.stance : input.ordersD.stance,
    priority: init.side === 0 ? input.ordersA.priority : input.ordersD.priority,
  }));

  // deployment: attackers along left edge, defenders along right
  let ai = 0;
  let di = 0;
  const countA = sims.filter((s) => s.init.side === 0).length;
  const countD = sims.length - countA;
  for (const s of sims) {
    if (s.init.side === 0) {
      s.x = 24 * FP;
      s.y = Math.floor(((ai + 1) * FIELD_H) / (countA + 1));
      ai++;
    } else {
      s.x = s.init.isBase ? 488 * FP : 460 * FP;
      s.y = Math.floor(((di + 1) * FIELD_H) / (countD + 1));
      di++;
    }
  }

  const projectiles: Projectile[] = [];
  const initialHp = [0, 0];
  for (const s of sims) initialHp[s.init.side]! += s.structure + s.armor;

  const active = (s: Sim) => s.alive && !s.retreated && !s.crossed;

  let tick = 0;
  for (tick = 0; tick < MAX_TICKS; tick++) {
    const frameShots: ShotEvent[] = [];
    const frameDeaths: number[] = [];

    // --- retreat thresholds ---
    for (const side of [0, 1] as const) {
      const orders = side === 0 ? input.ordersA : input.ordersD;
      let hp = 0;
      for (const s of sims) if (s.init.side === side && s.alive) hp += s.structure + s.armor;
      if (initialHp[side]! > 0 && hp * 100 < initialHp[side]! * orders.retreatThresholdPct) {
        for (const s of sims) {
          if (s.init.side === side && active(s) && !s.init.isBase) s.stance = 'evade_retreat';
        }
      }
    }

    // --- targeting ---
    for (const s of sims) {
      if (!active(s)) continue;
      const t = sims[s.targetIdx];
      if (s.targetIdx >= 0 && t && active(t)) continue;
      s.targetIdx = pickTarget(sims, s);
    }

    // --- movement ---
    for (const s of sims) {
      if (!active(s) || s.init.speed === 0) continue;
      const crippled = s.structure * 3 < s.init.structureHp;
      const speed = Math.max(1, crippled ? Math.floor(s.init.speed / 2) : s.init.speed) * FP;
      const dir = s.init.side === 0 ? 1 : -1;
      const target = s.targetIdx >= 0 ? sims[s.targetIdx] : undefined;
      let dx = 0;
      let dy = 0;
      const stepToward = (tx: number, ty: number, sign: 1 | -1) => {
        const ddx = tx - s.x;
        const ddy = ty - s.y;
        const d = Math.max(1, idist(Math.abs(ddx), Math.abs(ddy)));
        dx = roundDiv(ddx * speed * sign, d);
        dy = roundDiv(ddy * speed * sign, d);
      };
      switch (s.stance) {
        case 'charge':
          if (target && active(target)) stepToward(target.x, target.y, 1);
          else dx = dir * speed;
          break;
        case 'hold_range': {
          if (target && active(target)) {
            const d = idist(Math.abs(target.x - s.x), Math.abs(target.y - s.y));
            if (d > 200 * FP) stepToward(target.x, target.y, 1);
            else if (d < 150 * FP) stepToward(target.x, target.y, -1);
          } else dx = dir * speed;
          break;
        }
        case 'standoff': {
          if (target && active(target)) {
            const d = idist(Math.abs(target.x - s.x), Math.abs(target.y - s.y));
            if (d > 430 * FP) stepToward(target.x, target.y, 1);
            else if (d < 360 * FP) stepToward(target.x, target.y, -1);
          }
          break;
        }
        case 'evade_retreat':
          dx = -dir * speed;
          break;
      }
      s.x += dx;
      s.y = clamp(s.y + dy, 8 * FP, FIELD_H - 8 * FP);
      // edges
      if (s.stance === 'evade_retreat') {
        if ((s.init.side === 0 && s.x <= 4 * FP) || (s.init.side === 1 && s.x >= FIELD_W - 4 * FP)) {
          s.retreated = true;
        }
      }
      if (s.init.side === 0 && s.x >= FIELD_W - 8 * FP) s.crossed = true;
      s.x = clamp(s.x, 2 * FP, FIELD_W - 2 * FP);
    }

    // --- projectiles fly ---
    for (const p of projectiles) {
      if (p.hp <= 0) continue;
      const t = sims[p.targetIdx];
      if (!t || !active(t)) {
        p.hp = 0;
        continue;
      }
      const ddx = t.x - p.x;
      const ddy = t.y - p.y;
      const d = idist(Math.abs(ddx), Math.abs(ddy));
      const step = p.speed * FP;
      if (d <= step) {
        // impact
        const dmg = applyDamage(t, p.dmg, ['guided'], frameShots, tick, p.from, p.targetIdx, p.weaponId, p.classId, frameDeaths, sims);
        void dmg;
        p.hp = 0;
      } else {
        p.x += roundDiv(ddx * step, d);
        p.y += roundDiv(ddy * step, d);
      }
    }

    // --- firing (deterministic ship order) ---
    for (let si = 0; si < sims.length; si++) {
      const s = sims[si]!;
      if (!active(s)) continue;
      const crippled = s.structure * 3 < s.init.structureHp;
      for (let wi = 0; wi < s.init.weapons.length; wi++) {
        const w = s.init.weapons[wi]!;
        if (w.classId === 3) continue; // bombs are for bombardment, not the pass
        if (s.cds[wi]! > 0) {
          s.cds[wi]!--;
          continue;
        }
        if (s.ammo[wi] === 0) continue;

        const isPd = w.mods.includes('pd');
        // point defense priority: shoot an incoming projectile aimed at our side
        if (isPd) {
          const incoming = projectiles.find(
            (p) => p.hp > 0 && sims[p.targetIdx] && sims[p.targetIdx]!.init.side === s.init.side &&
              idist(Math.abs(p.x - s.x), Math.abs(p.y - s.y)) <= BAND_SHORT * 2,
          );
          if (incoming) {
            const hit = rng.chancePct(70);
            frameShots.push({ tick, from: s.init.shipId, to: -1, weaponId: w.weaponId, classId: 0, hit, dmg: 0 });
            if (hit) incoming.hp = 0;
            s.cds[wi] = cooldownOf(w, crippled);
            continue;
          }
        }

        const t = s.targetIdx >= 0 ? sims[s.targetIdx] : undefined;
        if (!t || !active(t)) continue;
        const dist = idist(Math.abs(t.x - s.x), Math.abs(t.y - s.y));
        const band = bandOf(dist);

        if (w.classId === 0) {
          const maxBand = isPd ? BAND_SHORT : w.mods.includes('hv') ? BAND_HV : BAND_LONG;
          if (dist > maxBand) continue;
          const shots = w.mods.includes('af') ? 3 : 1;
          for (let burst = 0; burst < shots; burst++) {
            for (let n = 0; n < w.count; n++) {
              const hitPct = clamp(
                50 + s.init.beamAttack - t.init.beamDefense + BAND_HIT[band]! +
                  (w.mods.includes('co') ? 25 : 0) + (w.mods.includes('af') ? -20 : 0),
                5,
                95,
              );
              const hit = rng.chancePct(hitPct);
              if (!hit) {
                frameShots.push({ tick, from: s.init.shipId, to: t.init.shipId, weaponId: w.weaponId, classId: 0, hit: false, dmg: 0 });
                continue;
              }
              let dmg = w.dmgMin + rng.int(w.dmgMax - w.dmgMin + 1);
              const dmgPct = w.mods.includes('nr') ? 100 : BAND_DMG[band]!;
              dmg = Math.max(1, roundDiv(dmg * dmgPct, 100));
              if (w.mods.includes('hv')) dmg = roundDiv(dmg * 150, 100);
              if (isPd) dmg = Math.max(1, roundDiv(dmg * 50, 100));
              applyDamage(t, dmg, w.mods, frameShots, tick, s.init.shipId, s.targetIdx, w.weaponId, 0, frameDeaths, sims);
            }
          }
          s.cds[wi] = cooldownOf(w, crippled);
        } else if (w.classId === 1 || w.classId === 2) {
          const launchRange = w.classId === 1 ? 600 * FP : 500 * FP;
          if (dist > launchRange) continue;
          const volley = Math.min(w.count, s.ammo[wi]! < 0 ? w.count : s.ammo[wi]!);
          for (let n = 0; n < volley; n++) {
            projectiles.push({
              from: s.init.shipId,
              targetIdx: s.targetIdx,
              x: s.x,
              y: s.y,
              dmg: w.dmgMin + rng.int(w.dmgMax - w.dmgMin + 1),
              speed: w.classId === 1 ? 12 : 8,
              classId: w.classId,
              weaponId: w.weaponId,
              hp: 1,
            });
          }
          if (s.ammo[wi]! > 0) s.ammo[wi] = Math.max(0, s.ammo[wi]! - volley);
          s.cds[wi] = cooldownOf(w, crippled);
        }
      }
    }

    // --- shield regen (3%/tick) ---
    for (const s of sims) {
      if (s.alive && s.init.shieldPool > 0 && s.shield < s.init.shieldPool) {
        s.shield = Math.min(s.init.shieldPool, s.shield + Math.max(1, ceilDiv(s.init.shieldPool * 3, 100)));
      }
    }

    if (onFrame) {
      onFrame({
        tick,
        ships: sims.map((s) => ({
          id: s.init.shipId,
          x: s.x,
          y: s.y,
          alive: s.alive,
          retreated: s.retreated,
          crossed: s.crossed,
          structPct: s.init.structureHp > 0 ? Math.floor((s.structure * 100) / s.init.structureHp) : 0,
          shieldPct: s.init.shieldPool > 0 ? Math.floor((s.shield * 100) / s.init.shieldPool) : 0,
        })),
        shots: frameShots,
        deaths: frameDeaths,
      });
    }

    const aActive = sims.some((s) => s.init.side === 0 && active(s));
    const dActive = sims.some((s) => s.init.side === 1 && active(s));
    if (!aActive || !dActive) {
      tick++;
      break;
    }
  }

  // --- outcome ---
  const outcomes: ShipOutcome[] = sims.map((s) => ({
    shipId: s.init.shipId,
    side: s.init.side,
    destroyed: !s.alive,
    retreated: s.retreated,
    crossed: s.crossed,
    structureLeft: s.structure,
    armorLeft: s.armor,
    structureMax: s.init.structureHp,
  }));
  const endHp = [0, 0];
  for (const s of sims) if (s.alive) endHp[s.init.side]! += s.structure + s.armor;
  const dmgPct = (side: 0 | 1) =>
    initialHp[side]! > 0 ? Math.floor(((initialHp[side]! - endHp[side]!) * 100) / initialHp[side]!) : 0;
  const aAlive = sims.some((s) => s.init.side === 0 && s.alive && !s.retreated);
  const dAlive = sims.some((s) => s.init.side === 1 && s.alive && !s.retreated);
  const winner = aAlive && !dAlive ? 0 : dAlive && !aAlive ? 1 : null;

  return {
    ticks: tick,
    outcomes,
    winner,
    attackerDamagePct: dmgPct(0),
    defenderDamagePct: dmgPct(1),
  };
}

function cooldownOf(w: CombatWeapon, crippled: boolean): number {
  let base = w.classId === 0 ? 12 : w.classId === 1 ? 25 : 30;
  if (w.mods.includes('af')) base = roundDiv(base * 60, 100);
  base = roundDiv(base * 100, COMBAT_PACE);
  return crippled ? base * 2 : base;
}

function pickTarget(sims: Sim[], s: Sim): number {
  const enemies: number[] = [];
  for (let i = 0; i < sims.length; i++) {
    const e = sims[i]!;
    if (e.init.side !== s.init.side && e.alive && !e.retreated && !e.crossed) enemies.push(i);
  }
  if (!enemies.length) return -1;
  const priority = s.priority;
  const dist = (i: number) => idist(Math.abs(sims[i]!.x - s.x), Math.abs(sims[i]!.y - s.y));
  switch (priority) {
    case 'biggest':
      return enemies.sort((a, b) => sims[b]!.init.hullIdx - sims[a]!.init.hullIdx || dist(a) - dist(b) || a - b)[0]!;
    case 'smallest':
      return enemies.sort((a, b) => sims[a]!.init.hullIdx - sims[b]!.init.hullIdx || dist(a) - dist(b) || a - b)[0]!;
    case 'warships':
      return enemies.sort((a, b) => Number(sims[a]!.init.isBase) - Number(sims[b]!.init.isBase) || dist(a) - dist(b) || a - b)[0]!;
    case 'bases':
      return enemies.sort((a, b) => Number(sims[b]!.init.isBase) - Number(sims[a]!.init.isBase) || dist(a) - dist(b) || a - b)[0]!;
    default:
      return enemies.sort((a, b) => dist(a) - dist(b) || a - b)[0]!;
  }
}

function applyDamage(
  t: Sim,
  raw: number,
  mods: string[],
  shots: ShotEvent[],
  tick: number,
  fromId: number,
  targetIdx: number,
  weaponId: string,
  classId: number,
  deaths: number[],
  sims: Sim[],
): number {
  let dmg = raw;
  if (!mods.includes('sp')) {
    // flat per-hit reduction then pool absorption
    if (!mods.includes('ap')) dmg = Math.max(0, dmg - t.init.shieldFlat);
    const absorbed = Math.min(t.shield, dmg);
    t.shield -= absorbed;
    dmg -= absorbed;
  }
  if (dmg > 0) {
    if (mods.includes('ap')) {
      t.structure -= dmg;
    } else {
      const toArmor = Math.min(t.armor, dmg);
      t.armor -= toArmor;
      t.structure -= dmg - toArmor;
    }
  }
  shots.push({ tick, from: fromId, to: t.init.shipId, weaponId, classId, hit: true, dmg: raw });
  if (t.structure <= 0 && t.alive) {
    t.alive = false;
    t.structure = 0;
    deaths.push(t.init.shipId);
  }
  void targetIdx;
  void sims;
  return dmg;
}
