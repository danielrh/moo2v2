// Procedural 2D pixel-art warship sprites (original art, generated in code).
//
// Every empire picks one of the SHIP_STYLES silhouette families (engine
// shipstyles.ts); within a style each hull class has a handful of model
// variants a design can choose between. Models are tiny role-indexed pixel
// grids: the texture layer (shiptex.ts) maps roles to a palette so one model
// serves every player color. Grids also carry gameplay-relevant *visual*
// metadata: engine nozzle mounts (flames), gun muzzles (beam origins), and
// glow pixels (blinking lights). Everything is deterministic — same
// (style, class, variant) in, same sprite out — so replay scrubbing is stable.
//
// Ships face +x (nose right, engines left); the viewer rotates sprites to the
// sim heading. Monsters and Antarans get bespoke models keyed by their kind.

// ---- pixel roles ----
export const R_EMPTY = 0;
export const R_HULL = 1; // mid hull tone
export const R_SHADE = 2; // hull shadow
export const R_LIGHT = 3; // hull highlight
export const R_ACCENT = 4; // player color trim
export const R_GLOW = 5; // lit windows / canopy / energized parts
export const R_TRIM = 6; // near-black structural dark
export const R_NOZZLE = 7; // engine aperture

export interface Mount {
  x: number;
  y: number;
}

export interface ShipModel {
  w: number;
  h: number;
  px: Uint8Array;
  /** rear engine nozzles: flame plumes anchor here (empty for stations) */
  engines: Mount[];
  /** forward gun muzzles: beams originate here */
  guns: Mount[];
  /** half-diagonal in art px — the shield bubble radius */
  radius: number;
}

// ---- deterministic tiny RNG (UI-side; never touches the sim) ----
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rnd {
  private f: () => number;
  constructor(seed: string) {
    this.f = mulberry(hashStr(seed));
  }
  next(): number {
    return this.f();
  }
  int(n: number): number {
    return Math.floor(this.f() * n);
  }
  range(a: number, b: number): number {
    return a + this.f() * (b - a);
  }
  chance(p: number): boolean {
    return this.f() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]!;
  }
}

// ---- symmetric grid painter ----
class G {
  w: number;
  h: number;
  cy: number;
  px: Uint8Array;
  engines: Mount[] = [];
  guns: Mount[] = [];
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.cy = (h - 1) >> 1;
    this.px = new Uint8Array(w * h);
  }
  set(x: number, y: number, v: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = v;
  }
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return R_EMPTY;
    return this.px[y * this.w + x]!;
  }
  /** paint at cy±dy (both halves) */
  sym(x: number, dy: number, v: number): void {
    this.set(x, this.cy - dy, v);
    if (dy !== 0) this.set(x, this.cy + dy, v);
  }
  /** vertical band centered on the spine: dy in [d0..d1] */
  band(x: number, d0: number, d1: number, v: number): void {
    for (let d = Math.max(0, Math.round(d0)); d <= Math.round(d1); d++) this.sym(x, d, v);
  }
  /** symmetric box: x in [x0..x1], dy in [d0..d1] */
  box(x0: number, x1: number, d0: number, d1: number, v: number): void {
    for (let x = Math.round(x0); x <= Math.round(x1); x++) this.band(x, d0, d1, v);
  }
  /** spine-centered wedge: halfwidth tapers hw0 -> hw1 across [x0..x1] */
  wedge(x0: number, x1: number, hw0: number, hw1: number, v: number): void {
    const n = Math.max(1, Math.round(x1) - Math.round(x0));
    for (let x = Math.round(x0); x <= Math.round(x1); x++) {
      const t = (x - Math.round(x0)) / n;
      this.band(x, 0, hw0 + (hw1 - hw0) * t, v);
    }
  }
  /** solid symmetric ellipse centered (cx, spine) */
  ellipse(cx: number, rx: number, ry: number, v: number): void {
    for (let x = Math.round(cx - rx); x <= Math.round(cx + rx); x++) {
      const t = (x - cx) / rx;
      if (t * t > 1) continue;
      this.band(x, 0, ry * Math.sqrt(1 - t * t), v);
    }
  }
  /** erase an ellipse (carve crescents / notches) — symmetric */
  carve(cx: number, rx: number, ry: number): void {
    for (let x = Math.round(cx - rx); x <= Math.round(cx + rx); x++) {
      const t = (x - cx) / rx;
      if (t * t > 1) continue;
      const hw = ry * Math.sqrt(1 - t * t);
      for (let d = 0; d <= Math.round(hw); d++) this.sym(x, d, R_EMPTY);
    }
  }
  /** twin discs at spine offset ±dyC (pods, nacelle caps) */
  discPair(cx: number, dyC: number, r: number, v: number): void {
    for (let x = Math.round(cx - r); x <= Math.round(cx + r); x++) {
      for (let d = Math.round(dyC - r); d <= Math.round(dyC + r); d++) {
        if ((x - cx) * (x - cx) + (d - dyC) * (d - dyC) <= r * r + 0.3) {
          this.set(x, this.cy - d, v);
          this.set(x, this.cy + d, v);
        }
      }
    }
  }
  /** twin boxes at ±[d0..d1] (off-spine hulls: nacelles, pods, radiators) */
  boxPair(x0: number, x1: number, d0: number, d1: number, v: number): void {
    for (let x = Math.round(x0); x <= Math.round(x1); x++) {
      for (let d = Math.round(d0); d <= Math.round(d1); d++) {
        this.set(x, this.cy - d, v);
        this.set(x, this.cy + d, v);
      }
    }
  }
  /** twin straight lines (pylons, struts) from (x0,±d0) to (x1,±d1) */
  linePair(x0: number, d0: number, x1: number, d1: number, v: number): void {
    const steps = Math.max(Math.abs(Math.round(x1 - x0)), Math.abs(Math.round(d1 - d0)), 1);
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const d = d0 + ((d1 - d0) * i) / steps;
      this.set(Math.round(x), Math.round(this.cy - d), v);
      this.set(Math.round(x), Math.round(this.cy + d), v);
    }
  }
  /** ring / annulus centered on the spine */
  ring(cx: number, rOut: number, rIn: number, v: number): void {
    for (let x = Math.round(cx - rOut); x <= Math.round(cx + rOut); x++) {
      for (let d = 0; d <= Math.round(rOut); d++) {
        const q = (x - cx) * (x - cx) + d * d;
        if (q <= rOut * rOut + 0.5 && q >= rIn * rIn - 0.5) this.sym(x, d, v);
      }
    }
  }
  /** record an engine nozzle pair (or single when dy=0) + paint the aperture */
  eng(x: number, dy: number): void {
    this.sym(x, dy, R_NOZZLE);
    this.engines.push({ x, y: this.cy - dy });
    if (dy !== 0) this.engines.push({ x, y: this.cy + dy });
  }
  /** engine pair anchored to the rearmost hull cell of row cy±dy */
  engAuto(dy: number): void {
    dy = Math.round(dy);
    for (let x = 0; x < this.w; x++) {
      if (this.get(x, this.cy - dy) !== R_EMPTY) {
        this.eng(x, dy);
        return;
      }
    }
  }
  /** record a gun muzzle pair (or single when dy=0) */
  gun(x: number, dy: number): void {
    this.guns.push({ x, y: this.cy - dy });
    if (dy !== 0) this.guns.push({ x, y: this.cy + dy });
  }
  /** gun pair anchored to the foremost hull cell of row cy±dy */
  gunAuto(dy: number): void {
    dy = Math.round(dy);
    for (let x = this.w - 1; x >= 0; x--) {
      if (this.get(x, this.cy - dy) !== R_EMPTY) {
        this.gun(x, dy);
        return;
      }
    }
  }
  /** top-lit bevel: hull cells get a light top edge and a shaded bottom edge */
  bevel(): void {
    const out = new Uint8Array(this.px);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const v = this.get(x, y);
        if (v !== R_HULL) continue;
        if (this.get(x, y - 1) === R_EMPTY) out[y * this.w + x] = R_LIGHT;
        else if (this.get(x, y + 1) === R_EMPTY) out[y * this.w + x] = R_SHADE;
      }
    }
    this.px = out;
  }
  /** sprinkle detail dots onto existing hull pixels */
  greeble(r: Rnd, count: number, roles: number[]): void {
    for (let i = 0; i < count; i++) {
      const x = r.int(this.w);
      const y = r.int(this.h);
      if (this.get(x, y) === R_HULL) {
        const v = roles[r.int(roles.length)]!;
        this.set(x, y, v);
        this.set(x, this.h - 1 - y, v); // keep it symmetric
      }
    }
  }
  toModel(): ShipModel {
    return {
      w: this.w,
      h: this.h,
      px: this.px,
      engines: this.engines,
      guns: this.guns.length ? this.guns : [{ x: this.w - 1, y: this.cy }],
      radius: Math.max(this.w, this.h) / 2,
    };
  }
}

// ---- classes ----
export type ArtClass =
  | 'scout'
  | 'frigate'
  | 'destroyer'
  | 'cruiser'
  | 'battleship'
  | 'titan'
  | 'doomstar'
  | 'star_base'
  | 'battlestation'
  | 'star_fortress';

export const ART_CLASSES: readonly ArtClass[] = [
  'scout', 'frigate', 'destroyer', 'cruiser', 'battleship', 'titan', 'doomstar',
  'star_base', 'battlestation', 'star_fortress',
];

interface ClassSpec {
  w: number;
  h: number;
  tier: number; // 0 scout .. 6 doomstar; stations 3..5
  base: boolean;
}

const CLASS_SPECS: Record<ArtClass, ClassSpec> = {
  scout: { w: 11, h: 7, tier: 0, base: false },
  frigate: { w: 15, h: 9, tier: 1, base: false },
  destroyer: { w: 19, h: 11, tier: 2, base: false },
  cruiser: { w: 24, h: 13, tier: 3, base: false },
  battleship: { w: 29, h: 17, tier: 4, base: false },
  titan: { w: 35, h: 21, tier: 5, base: false },
  doomstar: { w: 37, h: 37, tier: 6, base: false },
  star_base: { w: 21, h: 21, tier: 3, base: true },
  battlestation: { w: 25, h: 25, tier: 4, base: true },
  star_fortress: { w: 31, h: 31, tier: 5, base: true },
};

/** how many model variants a class offers within a style */
export function variantsFor(cls: ArtClass): number {
  if (cls === 'doomstar') return 1; // the doom star is singular
  if (cls === 'titan') return 3;
  if (CLASS_SPECS[cls].base) return 1; // stations: one look per style
  return 4;
}

export function wrapVariant(cls: ArtClass, idx: number | undefined): number {
  const n = variantsFor(cls);
  const i = Math.abs(Math.trunc(idx ?? 0));
  return i % n;
}

/** resolve the art class the viewer should draw for a combat ship */
export function artClassOf(init: { hull: string; hullIdx: number; isBase: boolean; modelKind?: string }): ArtClass | string {
  if (init.modelKind === 'scout') return 'scout';
  if ((ART_CLASSES as readonly string[]).includes(init.hull)) return init.hull as ArtClass;
  if (MONSTER_KINDS.includes(init.hull)) return init.hull; // monsters key art by kind
  if (init.isBase) return init.hullIdx >= 9 ? 'star_fortress' : init.hullIdx === 8 ? 'battlestation' : 'star_base';
  const ships: ArtClass[] = ['frigate', 'frigate', 'destroyer', 'cruiser', 'battleship', 'titan', 'doomstar'];
  return ships[Math.max(1, Math.min(6, init.hullIdx))]!;
}

export const MONSTER_KINDS = [
  'amoeba', 'hydra', 'eel', 'crystal', 'dragon', 'guardian',
  'antaran_raider', 'antaran_marauder', 'antaran_intruder', 'antaran_fortress',
];

// ---- per-style flavor (flame + glow + station shape live with the plans) ----
export interface StyleArt {
  flame: string; // engine plume color
  glow: string; // window/canopy color
}

export const STYLE_ART: Record<string, StyleArt> = {
  raptor: { flame: '#ffc46b', glow: '#bfe6ff' },
  saucer: { flame: '#7db8ff', glow: '#ffe9b0' },
  lattice: { flame: '#9dff5e', glow: '#8dffb0' },
  orbital: { flame: '#ffa94d', glow: '#fff3c9' },
  crescent: { flame: '#c9a2ff', glow: '#e6d5ff' },
  gemini: { flame: '#7de8ff', glow: '#bfe6ff' },
  needle: { flame: '#cfe8ff', glow: '#bfe6ff' },
  manta: { flame: '#7dffc8', glow: '#d0ffe8' },
  bulwark: { flame: '#ff9a4d', glow: '#ffd9a1' },
  halo: { flame: '#a2c9ff', glow: '#cfe0ff' },
};

export const NPC_ART: StyleArt = { flame: '#b6ff9d', glow: '#eaffd0' };

// =====================================================================
// style plans — each draws a full class family + its station variant
// =====================================================================

type Plan = (g: G, cls: ArtClass, k: ClassSpec, r: Rnd, variant: number) => void;

/** raptor: swept-wing wedge darts */
const planRaptor: Plan = (g, cls, k, r, variant) => {
  const L = k.w;
  const HH = (k.h - 1) >> 1;
  if (k.base) {
    // pinwheel of swept vanes around a core
    const c = (L - 1) / 2;
    g.ellipse(c, HH * 0.42, HH * 0.42, R_HULL);
    g.boxPair(c - HH * 0.9, c - HH * 0.2, 1, 2, R_HULL);
    g.boxPair(c + HH * 0.2, c + HH * 0.9, 1, 2, R_HULL);
    g.linePair(c - HH * 0.8, 2, c - HH * 0.1, HH - 1, R_HULL);
    g.linePair(c - HH * 0.7, 2, c, HH - 1, R_HULL);
    g.linePair(c + HH * 0.1, HH - 1, c + HH * 0.8, 2, R_HULL);
    g.linePair(c + HH * 0.2, HH - 1, c + HH * 0.9, 2, R_HULL);
    g.bevel();
    g.ring(c, HH * 0.45, HH * 0.3, R_ACCENT);
    g.sym(c, 0, R_GLOW);
    g.sym(c - HH * 0.55, HH - 1, R_GLOW);
    g.sym(c + HH * 0.55, HH - 1, R_GLOW);
    g.gun(c, HH * 0.4);
    return;
  }
  const tail = variant === 2 ? 2 : 1; // rear fin depth
  const fus = Math.max(1, Math.round(HH * (variant === 1 ? 0.42 : 0.34)));
  const nose = L - 1;
  // fuselage: rear body tapering to a needle nose
  g.wedge(1, Math.round(L * 0.55), fus, Math.max(1, fus - 1), R_HULL);
  g.wedge(Math.round(L * 0.55), nose, Math.max(1, fus - 1), 0, R_HULL);
  // swept delta wings: tip trails at the rear
  const rootX = Math.round(L * (variant === 3 ? 0.7 : 0.6));
  const tipX = Math.round(L * (variant === 1 ? 0.1 : 0.16));
  for (let x = tipX; x <= rootX; x++) {
    const t = (x - tipX) / Math.max(1, rootX - tipX);
    const outer = HH - (HH - fus - 0.5) * t;
    if (outer > fus) g.band(x, fus, outer, R_HULL);
  }
  // rear stabilizer fins
  g.box(0, tail, 0, fus + (variant === 2 ? 2 : 1), R_HULL);
  if (k.tier >= 3) {
    // canards near the nose on capital raptors
    g.linePair(Math.round(L * 0.78), fus, Math.round(L * 0.68), fus + 2, R_HULL);
  }
  g.bevel();
  // wing leading-edge accent + cockpit glow
  g.linePair(rootX, fus, tipX + 1, HH - 1, R_ACCENT);
  g.band(Math.round(L * 0.72), 0, 0, R_GLOW);
  if (k.tier >= 1) g.sym(Math.round(L * 0.62), 0, R_GLOW);
  if (k.tier >= 4) {
    g.sym(Math.round(L * 0.3), Math.round(HH * 0.55), R_GLOW);
    g.greeble(r, k.tier * 2, [R_SHADE, R_TRIM]);
  }
  // engines between the wing roots
  if (k.tier <= 1) g.eng(0, 0);
  else if (k.tier <= 3) g.eng(0, 1);
  else {
    g.eng(0, 1);
    g.eng(1, Math.min(HH - 1, fus + 1));
  }
  g.gun(nose, 0);
  if (k.tier >= 2) g.gun(tipX + 1, HH - 1);
};

/** saucer: circular primary hull + outrigger nacelles */
const planSaucer: Plan = (g, cls, k, r, variant) => {
  const L = k.w;
  const HH = (k.h - 1) >> 1;
  if (k.base) {
    const c = (L - 1) / 2;
    g.ellipse(c, HH * 0.75, HH * 0.75, R_HULL); // the big mushroom disc
    g.band(c - 1, 0, 2, R_SHADE);
    g.boxPair(c - 1, c + 1, HH * 0.75, HH - 1, R_HULL); // dock pylons
    g.box(c - HH * 0.2, c + HH * 0.2, 0, 1, R_LIGHT);
    g.bevel();
    g.ring(c, HH * 0.78, HH * 0.62, R_ACCENT);
    for (let i = -2; i <= 2; i++) g.sym(c + i * 2, Math.round(HH * 0.4), R_GLOW);
    g.sym(c, 0, R_GLOW);
    g.gun(c, HH * 0.7);
    return;
  }
  const discR = Math.max(2, Math.round(HH * (variant === 1 ? 0.82 : 0.72)));
  const discX = Math.round(L * (variant === 3 ? 0.6 : variant === 1 ? 0.62 : 0.66));
  const nacDy = HH - 1;
  const nacLen = Math.round(L * (variant === 2 ? 0.55 : 0.42));
  // secondary hull along the spine
  g.box(1, discX, 0, Math.max(1, Math.round(discR * 0.35)), R_HULL);
  // primary saucer
  g.ellipse(discX, discR + (variant === 1 ? 1 : 0), discR, R_HULL);
  // nacelle pair + pylons
  const nacX0 = variant === 3 ? 0 : 1;
  g.boxPair(nacX0, nacX0 + nacLen, nacDy - 1, nacDy, R_HULL);
  g.linePair(Math.round(L * 0.3), 1, nacX0 + Math.round(nacLen * 0.4), nacDy - 1, R_SHADE);
  g.bevel();
  // bussard glow on the nacelle front caps + player ring on the saucer
  g.sym(nacX0 + nacLen, nacDy - 1, R_ACCENT);
  g.sym(nacX0 + nacLen, nacDy, R_GLOW);
  g.ring(discX, discR - 0.5, discR - 1.6, R_ACCENT);
  g.sym(discX, 0, R_GLOW); // bridge
  if (k.tier >= 2) {
    g.sym(discX - 2, Math.round(discR * 0.5), R_GLOW);
    g.sym(discX + 2, Math.round(discR * 0.5), R_GLOW);
  }
  if (k.tier >= 4) {
    // capital saucers run four nacelles
    g.boxPair(2, 2 + Math.round(nacLen * 0.8), Math.round(HH * 0.55), Math.round(HH * 0.55) + 1, R_HULL);
    g.eng(2, Math.round(HH * 0.55));
    g.greeble(r, k.tier, [R_SHADE, R_GLOW]);
  }
  g.eng(nacX0, nacDy - 1);
  if (k.tier >= 1) g.eng(0, 0);
  g.gun(discX + discR, 0);
  if (k.tier >= 3) g.gun(discX, discR);
};

/** lattice: greebled machine cubes */
const planLattice: Plan = (g, cls, k, r, variant) => {
  const L = k.w;
  const HH = (k.h - 1) >> 1;
  if (k.base) {
    const c = (L - 1) / 2;
    const s = HH - 1;
    g.box(c - s, c + s, 0, s, R_HULL); // one perfect cube
    g.bevel();
    for (let x = -s; x <= s; x += 2) g.band(c + x, 0, s, x % 4 === 0 ? R_SHADE : R_HULL);
    for (let d = 1; d <= s; d += 2) for (let x = -s; x <= s; x++) if ((x + d) % 3 === 0) g.sym(c + x, d, R_TRIM);
    g.ring(c, 2.2, 1.2, R_GLOW);
    for (let i = 0; i < 6 + k.tier * 2; i++) g.sym(c - s + r.int(2 * s), r.int(s), r.chance(0.5) ? R_GLOW : R_ACCENT);
    g.linePair(c - s - 1, 0, c - s - 2, 0, R_TRIM);
    g.linePair(c + s + 1, 0, c + s + 2, 0, R_TRIM);
    g.gun(c, s);
    return;
  }
  const long = variant % 2 === 0;
  const bh = Math.max(2, HH - (long ? 2 : 1));
  const x0 = 1;
  const x1 = L - 2;
  g.box(x0, x1, 0, bh, R_HULL);
  if (variant >= 2) {
    // offset secondary block: broken silhouette
    g.box(Math.round(L * 0.35), Math.round(L * 0.75), bh, Math.min(HH, bh + 2), R_HULL);
  }
  // carve notches so it's not a brick
  g.box(x1 - 1, x1, Math.max(1, bh - 1), bh, R_EMPTY);
  if (k.tier >= 2) g.box(Math.round(L * 0.2), Math.round(L * 0.28), bh, bh, R_EMPTY);
  g.bevel();
  // circuit greebles: seams + node lights
  for (let x = x0 + 1; x < x1; x += 3) g.band(x, 0, bh - 1, R_SHADE);
  for (let x = x0 + 2; x < x1; x += 3) if ((x & 1) === 0) g.sym(x, Math.min(bh - 1, 1 + (x % Math.max(2, bh)))!, R_TRIM);
  const eyes = 2 + k.tier;
  for (let i = 0; i < eyes; i++) g.sym(x0 + 2 + r.int(Math.max(1, x1 - x0 - 3)), r.int(bh), r.chance(0.6) ? R_GLOW : R_ACCENT);
  g.box(x1 - 2, x1, 0, 0, R_ACCENT); // forward emitter strip
  g.sym(x1, 0, R_GLOW);
  // antenna spikes
  g.linePair(Math.round(L * 0.55), bh, Math.round(L * 0.55), Math.min(HH, bh + 2), R_TRIM);
  if (k.tier >= 4) g.linePair(Math.round(L * 0.3), bh + (variant >= 2 ? 2 : 0), Math.round(L * 0.26), HH, R_TRIM);
  // a wall of small nozzles across the stern
  g.eng(x0 - 1, 0);
  if (k.tier >= 1) g.eng(x0 - 1, Math.max(1, bh - 1));
  if (k.tier >= 4) g.eng(x0 - 1, 1);
  g.gunAuto(0);
  if (k.tier >= 2) g.gunAuto(bh - 1);
};

/** orbital: near-future trusses, tanks and radiators */
const planOrbital: Plan = (g, cls, k, r, variant) => {
  const L = k.w;
  const HH = (k.h - 1) >> 1;
  if (k.base) {
    const c = (L - 1) / 2;
    // ISS-style: long truss + module stack + panel wings
    g.box(c - HH + 1, c + HH - 1, 0, 0, R_SHADE);
    g.box(c - 2, c + 2, 0, 1, R_HULL);
    g.discPair(c, 0, 1.6, R_HULL);
    g.boxPair(c - HH + 1, c - 3, 2, 3, R_ACCENT); // port panels
    g.boxPair(c + 3, c + HH - 1, 2, 3, R_ACCENT);
    g.linePair(c - HH + 2, 2, c - HH + 2, 0, R_TRIM);
    g.linePair(c + HH - 2, 2, c + HH - 2, 0, R_TRIM);
    g.bevel();
    for (let x = -HH + 2; x <= HH - 2; x += 2) g.sym(c + x, 2, R_TRIM); // panel gridlines
    g.sym(c, 0, R_GLOW);
    g.sym(c - 1, 1, R_GLOW);
    g.discPair(c + HH - 1, 0, 1, R_LIGHT); // docked capsule
    g.gun(c, 1);
    return;
  }
  const spineD = 0;
  // truss spine
  g.box(2, L - 4, spineD, spineD, R_SHADE);
  // command module + dish at the bow
  g.wedge(L - 5, L - 1, 1, 0, R_HULL);
  g.sym(L - 3, 0, R_GLOW);
  // tanks amidships
  const tanks = 1 + (variant % 2);
  for (let i = 0; i < tanks; i++) {
    const cx = Math.round(L * (0.42 + i * 0.16));
    g.ellipse(cx, 2.2, Math.min(HH - 2, 1.6), R_LIGHT);
  }
  // radiators / solar wings
  const panX = Math.round(L * (variant >= 2 ? 0.3 : 0.5));
  const panW = variant >= 2 ? 2 : 0;
  g.boxPair(panX - panW, panX + panW, 2, HH - 1, R_ACCENT);
  for (let d = 2; d <= HH - 1; d += 2) {
    g.set(panX, g.cy - d, R_TRIM);
    g.set(panX, g.cy + d, R_TRIM);
  }
  if (variant === 1 || k.tier >= 4) {
    const pan2 = Math.round(L * 0.66);
    g.boxPair(pan2 - 1, pan2 + 1, 2, Math.max(3, HH - 2), R_ACCENT);
  }
  // dish antenna
  g.discPair(Math.round(L * 0.72), Math.min(HH - 1, 2.5), 1.1, R_SHADE);
  // engine block: bell nozzles on a thrust plate
  g.box(1, 2, 0, 1, R_HULL);
  g.bevel();
  g.eng(0, 0);
  if (k.tier >= 2) g.eng(0, 1);
  if (k.tier >= 5) g.eng(1, 2);
  g.greeble(r, k.tier, [R_TRIM, R_GLOW]);
  g.gun(L - 1, 0);
};

/** crescent: flowing curved blades */
const planCrescent: Plan = (g, cls, k, r, variant) => {
  const L = k.w;
  const HH = (k.h - 1) >> 1;
  if (k.base) {
    const c = (L - 1) / 2;
    // two opposed crescents cupping a core
    g.ellipse(c - 2, HH - 1, HH - 1, R_HULL);
    g.carve(c - 2 - Math.round(HH * 0.7), HH - 1, HH - 2);
    g.ellipse(c + 2 + Math.round(HH * 0.2), HH * 0.55, HH * 0.55, R_HULL);
    g.carve(c + 2 + Math.round(HH * 0.2) + Math.round(HH * 0.5), HH * 0.55, HH * 0.45);
    g.bevel();
    g.ellipse(c, 2, 2, R_HULL);
    g.sym(c, 0, R_GLOW);
    g.ring(c, 2.4, 1.4, R_ACCENT);
    g.sym(c - 2, HH - 2, R_GLOW);
    g.sym(c + 1, Math.round(HH * 0.5), R_GLOW);
    g.gun(c, 2);
    return;
  }
  // main blade: ellipse with a rear carve -> forward-swept crescent
  const bx = Math.round(L * 0.45);
  const brx = Math.round(L * 0.4);
  g.ellipse(bx, brx, HH, R_HULL);
  const depth = variant === 1 ? 0.55 : variant === 2 ? 0.75 : 0.65;
  g.carve(bx - Math.round(brx * depth), brx, HH - 1);
  // center dagger to the nose
  g.wedge(bx - 2, L - 1, Math.max(1, Math.round(HH * 0.28)), 0, R_HULL);
  if (variant === 3 && k.tier >= 2) {
    // double blade: smaller inner crescent
    g.ellipse(bx - 3, Math.round(brx * 0.5), Math.round(HH * 0.55), R_HULL);
    g.carve(bx - 3 - Math.round(brx * 0.35), Math.round(brx * 0.5), Math.round(HH * 0.45));
  }
  g.bevel();
  // luminous blade edge
  for (let d = 1; d <= HH - 1; d++) {
    // find the leading (rightmost) hull cell in this row pair and edge it
    for (let x = L - 1; x >= 0; x--) {
      if (g.get(x, g.cy - d) !== R_EMPTY) {
        g.sym(x, d, R_ACCENT);
        break;
      }
    }
  }
  g.sym(0 + 1, 0, R_SHADE);
  g.band(Math.round(L * 0.52), 0, 0, R_GLOW);
  g.sym(bx, HH - 1, R_GLOW); // blade tip lights
  if (k.tier >= 3) g.greeble(r, k.tier, [R_SHADE, R_GLOW]);
  g.engAuto(Math.round(HH * 0.45));
  if (k.tier >= 4) g.engAuto(HH - 2);
  g.gun(L - 1, 0);
  g.gunAuto(HH - 1);
};

/** gemini: twin-pod catamarans */
const planGemini: Plan = (g, cls, k, r, variant) => {
  const L = k.w;
  const HH = (k.h - 1) >> 1;
  if (k.base) {
    const c = (L - 1) / 2;
    // H-station: two habitat bars + crossdock
    g.boxPair(c - HH + 2, c + HH - 2, HH - 2, HH - 1, R_HULL);
    g.box(c - 1, c + 1, 0, HH - 2, R_HULL);
    g.bevel();
    g.boxPair(c - 1, c + 1, HH - 2, HH - 1, R_ACCENT);
    for (let x = -HH + 3; x <= HH - 3; x += 2) g.sym(c + x, HH - 2, R_GLOW);
    g.sym(c, 0, R_GLOW);
    g.gun(c, HH - 1);
    return;
  }
  const podD = Math.max(2, HH - 2); // pod centerline offset
  const podHw = Math.max(1, Math.round(HH * 0.28));
  const podLen = L - 3;
  // two hull pods with tapered noses
  for (let x = 1; x <= podLen; x++) {
    const t = x / podLen;
    const hw = t > 0.75 ? Math.max(0, Math.round(podHw * (1 - (t - 0.75) * 4))) : podHw;
    for (let d = podD - hw; d <= podD + hw; d++) {
      g.set(x, g.cy - d, R_HULL);
      g.set(x, g.cy + d, R_HULL);
    }
  }
  // cross spars
  const spar1 = Math.round(L * (variant === 1 ? 0.3 : 0.42));
  g.box(spar1 - 1, spar1 + 1, 0, podD, R_HULL);
  if (variant >= 2) {
    const spar2 = Math.round(L * 0.68);
    g.box(spar2, spar2 + 1, 0, podD, R_SHADE);
  }
  // centerline bridge
  g.ellipse(spar1 + (variant === 3 ? 3 : 0), 2, 1.4, R_HULL);
  if (k.tier >= 4) {
    // capital gemini: a third spine hull between the pods
    g.wedge(2, L - 2, 1, 0, R_HULL);
    g.eng(1, 0);
  }
  g.bevel();
  g.sym(spar1 + (variant === 3 ? 3 : 0), 0, R_GLOW);
  // pod nose rings + engine glow
  g.linePair(podLen - 1, podD - podHw, podLen - 1, podD + podHw, R_ACCENT);
  g.linePair(Math.round(L * 0.55), podD - podHw, Math.round(L * 0.55), podD + podHw, R_ACCENT);
  const eyes = 1 + (k.tier >> 1);
  for (let i = 0; i < eyes; i++) g.sym(3 + r.int(Math.max(1, podLen - 5)), podD, R_GLOW);
  g.eng(0, podD);
  g.gun(podLen + 1, podD);
  if (k.tier >= 3) g.gun(spar1, 0);
};

/** needle: spinal lances */
const planNeedle: Plan = (g, cls, k, r, variant) => {
  const L = k.w;
  const HH = (k.h - 1) >> 1;
  if (k.base) {
    const c = (L - 1) / 2;
    // urchin: radial spikes from an armored core
    g.ellipse(c, 3, 3, R_HULL);
    g.band(c - HH + 1, 0, 0, R_SHADE);
    g.box(c - HH + 1, c + HH - 1, 0, 0, R_SHADE);
    g.linePair(c - 2, 2, c - HH + 1, HH - 1, R_SHADE);
    g.linePair(c + 2, 2, c + HH - 1, HH - 1, R_SHADE);
    g.band(c, 3, HH - 1, R_SHADE);
    g.bevel();
    g.sym(c, 0, R_GLOW);
    g.ring(c, 3.2, 2.2, R_ACCENT);
    g.sym(c - HH + 1, 0, R_GLOW);
    g.sym(c + HH - 1, 0, R_GLOW);
    g.sym(c, HH - 1, R_GLOW);
    g.gun(c, 3);
    return;
  }
  const hw = 1;
  const taperX = Math.round(L * (variant === 2 ? 0.55 : 0.7));
  // the lance
  g.wedge(2, taperX, hw, hw, R_HULL);
  g.wedge(taperX, L - 1, hw, 0, R_HULL);
  g.sym(L - 1, 0, R_ACCENT);
  g.sym(L - 2, 0, R_LIGHT);
  // rear fins: v0 swept back, v1 swept forward, v2 straight cross, v3 twin-boom
  const finX = Math.round(L * (variant === 1 ? 0.08 : 0.16));
  if (variant === 1) {
    g.linePair(finX, hw, finX + 4, HH - 1, R_HULL);
    g.linePair(finX + 1, hw, finX + 5, HH - 1, R_HULL);
  } else if (variant === 2) {
    g.linePair(finX + 2, hw, finX + 2, HH - 1, R_HULL);
    g.linePair(finX + 3, hw, finX + 3, HH - 1, R_HULL);
  } else {
    g.linePair(finX, hw, Math.max(0, finX - 3), HH - 1, R_HULL);
    g.linePair(finX + 1, hw, Math.max(1, finX - 2), HH - 1, R_HULL);
  }
  if (variant === 3 || k.tier >= 4) {
    // twin outrigger booms riding beside the spine
    const railD = Math.min(HH - 2, 3);
    g.boxPair(Math.round(L * 0.25), Math.round(L * 0.72), railD, railD, R_HULL);
    g.linePair(Math.round(L * 0.35), hw, Math.round(L * 0.35), railD, R_TRIM);
    g.linePair(Math.round(L * 0.62), hw, Math.round(L * 0.62), railD, R_TRIM);
    g.sym(Math.round(L * 0.72), railD, R_ACCENT);
    g.eng(Math.round(L * 0.25) - 1, railD);
  }
  if (variant === 0 && k.tier >= 3) {
    const midX = Math.round(L * 0.5);
    g.linePair(midX, hw, midX - 2, Math.round(HH * 0.6), R_HULL);
  }
  g.bevel();
  // bulkhead rings + running lights down the spine (cadence varies by model)
  const step = variant === 2 ? 4 : 3;
  for (let x = 4; x < taperX; x += step) g.band(x, 0, hw, x % (step * 2) === step + 1 ? R_SHADE : R_HULL);
  for (let x = 5; x < taperX; x += step + 1) g.sym(x, 0, R_GLOW);
  g.linePair(Math.max(0, finX - 2), HH - 1, Math.max(0, finX - 3), HH - 1, R_ACCENT);
  g.eng(1, 0);
  g.gun(L - 1, 0);
};

/** manta: smooth biomorphic rays */
const planManta: Plan = (g, cls, k, r, variant) => {
  const L = k.w;
  const HH = (k.h - 1) >> 1;
  if (k.base) {
    const c = (L - 1) / 2;
    g.ellipse(c, HH - 1, HH - 2, R_HULL); // rounded reef
    g.carve(c - HH, HH * 0.6, HH * 0.5);
    g.bevel();
    g.ring(c, HH * 0.5, HH * 0.5 - 1, R_ACCENT);
    g.sym(c + 2, 0, R_GLOW);
    g.sym(c - 1, Math.round(HH * 0.55), R_GLOW);
    g.gun(c + HH - 1, 0);
    return;
  }
  const bodyX = Math.round(L * 0.42);
  const bodyR = Math.round(L * 0.38);
  // lifting body + rounded nose
  g.ellipse(bodyX, bodyR, HH, R_HULL);
  const noseX = Math.round(L * 0.68);
  g.ellipse(noseX, Math.round(L * 0.22), Math.max(1, Math.round(HH * 0.42)), R_HULL);
  // sweep the wingtips back: carve the outboard corners fore and aft
  for (let d = Math.max(2, Math.round(HH * 0.45)); d <= HH; d++) {
    const cut = Math.round((d - HH * 0.45) * (variant === 2 ? 1.8 : 1.2));
    for (let x = 0; x <= cut; x++) g.sym(bodyX + bodyR - x, d, R_EMPTY);
    for (let x = 0; x < Math.max(0, cut - 2); x++) g.sym(Math.max(0, bodyX - bodyR + x), d, R_EMPTY);
  }
  // tail spine
  const tailLen = Math.round(L * (variant === 3 ? 0.3 : 0.2));
  g.box(Math.max(0, bodyX - bodyR - tailLen), bodyX - bodyR + 2, 0, 0, R_HULL);
  g.bevel();
  // eyes, gill vents and a short dorsal stripe
  g.sym(noseX + Math.round(L * 0.1), Math.max(1, Math.round(HH * 0.2)), R_GLOW);
  for (let i = 0; i < 3; i++) g.linePair(bodyX - 1 - i * 2, 1, bodyX - 2 - i * 2, Math.round(HH * 0.5), R_SHADE);
  g.box(Math.round(L * 0.34), Math.round(L * 0.58), 0, 0, R_ACCENT);
  g.sym(bodyX, HH - 1, R_ACCENT); // wingtips
  if (variant === 1) g.sym(bodyX + 2, HH - 2, R_ACCENT);
  if (k.tier >= 3) g.greeble(r, k.tier, [R_SHADE, R_GLOW]);
  g.engAuto(0);
  g.engAuto(Math.round(HH * 0.45));
  g.gunAuto(0);
  if (k.tier >= 2) g.gunAuto(Math.round(HH * 0.5));
};

/** bulwark: brutalist armored slabs */
const planBulwark: Plan = (g, cls, k, r, variant) => {
  const L = k.w;
  const HH = (k.h - 1) >> 1;
  if (k.base) {
    const c = (L - 1) / 2;
    const s = HH - 1;
    g.box(c - s, c + s, 0, s - 1, R_HULL); // the keep
    g.box(c - s + 2, c + s - 2, 0, s, R_HULL); // parapet overhang
    g.bevel();
    g.box(c - s + 1, c + s - 1, s - 3, s - 3, R_TRIM);
    g.box(c - 2, c + 2, 0, 1, R_LIGHT);
    g.sym(c, 0, R_GLOW);
    g.box(c - s, c - s, 0, s - 1, R_ACCENT);
    g.box(c + s, c + s, 0, s - 1, R_ACCENT);
    // corner gun bastions
    g.discPair(c - s + 1, s - 1, 1, R_SHADE);
    g.discPair(c + s - 1, s - 1, 1, R_SHADE);
    g.gun(c + s - 1, s - 1);
    g.gun(c - s + 1, s - 1);
    return;
  }
  const bh = HH - 1;
  // slab with a blunt chamfered prow
  g.box(1, Math.round(L * 0.82), 0, bh, R_HULL);
  g.wedge(Math.round(L * 0.82), L - 1, bh, Math.max(1, Math.round(bh * 0.4)), R_HULL);
  // deck steps
  if (variant % 2 === 0) g.box(Math.round(L * 0.25), Math.round(L * 0.6), bh, Math.min(HH, bh + 1), R_HULL);
  g.bevel();
  // armor plate seams + rivets
  for (let x = 3; x < L - 3; x += 4) g.band(x, 0, bh - 1, R_SHADE);
  for (let x = 5; x < L - 4; x += 4) g.sym(x, Math.max(1, bh - 1), R_TRIM);
  // citadel tower
  const cit = Math.round(L * (variant === 3 ? 0.55 : 0.4));
  g.box(cit - 1, cit + 1, 0, 1, R_LIGHT);
  g.sym(cit, 0, R_GLOW);
  g.sym(cit + 1, 1, R_GLOW);
  // hazard stripe at the prow + bastion turrets
  g.band(Math.round(L * 0.8), 0, Math.max(1, Math.round(bh * 0.6)), R_ACCENT);
  if (k.tier >= 2) {
    g.discPair(Math.round(L * 0.68), bh, 1, R_SHADE);
    g.gun(Math.round(L * 0.7), bh);
  }
  if (k.tier >= 4) {
    g.discPair(Math.round(L * 0.3), bh, 1, R_SHADE);
    g.gun(Math.round(L * 0.32), bh);
  }
  g.eng(0, Math.max(1, Math.round(bh * 0.5)));
  if (k.tier >= 3) g.eng(0, 0);
  g.gun(L - 1, 0);
};

/** halo: annular ring ships */
const planHalo: Plan = (g, cls, k, r, variant) => {
  const L = k.w;
  const HH = (k.h - 1) >> 1;
  if (k.base) {
    const c = (L - 1) / 2;
    g.ring(c, HH - 1, HH - 3, R_HULL);
    g.ellipse(c, 2.4, 2.4, R_HULL);
    g.linePair(c - HH + 2, 0, c - 2, 0, R_SHADE);
    g.linePair(c + 2, 0, c + HH - 2, 0, R_SHADE);
    g.band(c, 3, HH - 2, R_SHADE);
    g.bevel();
    g.ring(c, HH - 1, HH - 1.8, R_ACCENT);
    g.sym(c, 0, R_GLOW);
    for (let i = 0; i < 4; i++) g.sym(c - HH + 2 + i * Math.max(2, Math.round((2 * HH - 4) / 3)), HH - 2, R_GLOW);
    g.gun(c, HH - 1);
    return;
  }
  const ringX = Math.round(L * (variant === 1 ? 0.52 : 0.62));
  const rOut = HH;
  const rIn = Math.max(2, HH - (variant === 2 ? 2 : 3));
  // stern block + spine through the ring
  g.wedge(1, ringX, Math.max(1, Math.round(HH * 0.3)), 1, R_HULL);
  g.box(ringX, Math.min(L - 1, ringX + rOut + 1), 0, 0, R_HULL);
  g.ring(ringX, rOut, rIn, R_HULL);
  // hub
  g.ellipse(ringX, Math.max(1.6, rIn * 0.5), Math.max(1.6, rIn * 0.5), R_HULL);
  // spokes
  g.band(ringX, 0, rOut - 1, R_SHADE);
  if (variant >= 2) g.linePair(ringX - rIn + 1, 1, ringX - 1, 1, R_SHADE);
  if (k.tier >= 4) {
    // second ring astern on capitals
    const r2 = Math.max(2, Math.round(rOut * 0.55));
    g.ring(Math.round(L * 0.18), r2, r2 - 1.6, R_HULL);
  }
  g.bevel();
  g.ring(ringX, rOut, rOut - 1, R_ACCENT); // rim light
  g.sym(ringX, 0, R_GLOW);
  g.sym(Math.min(L - 1, ringX + rOut + 1), 0, R_GLOW); // bow beacon
  for (let i = 1; i <= 2 + (k.tier >> 1); i++) g.sym(ringX + (i % 2 === 0 ? i : -i), rOut - 1, R_GLOW);
  g.eng(0, Math.max(1, Math.round(HH * 0.22)));
  if (k.tier >= 3) g.eng(0, 0);
  g.gun(Math.min(L - 1, ringX + rOut + 1), 0);
  if (k.tier >= 2) g.gun(ringX, rOut);
};

const PLANS: Record<string, Plan> = {
  raptor: planRaptor,
  saucer: planSaucer,
  lattice: planLattice,
  orbital: planOrbital,
  crescent: planCrescent,
  gemini: planGemini,
  needle: planNeedle,
  manta: planManta,
  bulwark: planBulwark,
  halo: planHalo,
};

/** doomstars are singular per style: a planet-cracker sphere with a
 * superlaser dish, plus a small style-flavored flourish */
function planDoomstar(g: G, style: string, r: Rnd): void {
  const c = (g.w - 1) / 2;
  const R = c - 1;
  g.ellipse(c, R, R, R_HULL);
  g.bevel();
  // curvature shading: lower-right limb in shadow, upper-left lit
  for (let x = 0; x < g.w; x++) {
    for (let y = 0; y < g.h; y++) {
      if (g.get(x, y) !== R_HULL) continue;
      const dx = (x - c) / R;
      const dy = (y - c) / R;
      const d2 = dx * dx + dy * dy;
      if (d2 > 0.62 && dx + dy > 0.45) g.set(x, y, R_SHADE);
      else if (d2 > 0.7 && dx + dy < -0.5) g.set(x, y, R_LIGHT);
    }
  }
  // equatorial trench
  for (let x = 2; x < g.w - 2; x++) if (g.get(x, g.cy + 4) !== R_EMPTY) g.set(x, g.cy + 4, R_TRIM);
  // superlaser dish, offset toward the bow
  const dx = c + Math.round(R * 0.52);
  const dyOff = -Math.round(R * 0.3);
  for (let x = dx - 4; x <= dx + 4; x++) {
    for (let y = g.cy + dyOff - 4; y <= g.cy + dyOff + 4; y++) {
      const q = (x - dx) * (x - dx) + (y - (g.cy + dyOff)) * (y - (g.cy + dyOff));
      if (q <= 17) g.set(x, y, q <= 3 ? R_GLOW : q <= 9 ? R_TRIM : R_SHADE);
    }
  }
  g.guns.push({ x: dx, y: g.cy + dyOff });
  // city lights
  for (let i = 0; i < 26; i++) {
    const x = 2 + r.int(g.w - 4);
    const y = 2 + r.int(g.h - 4);
    if (g.get(x, y) === R_HULL || g.get(x, y) === R_SHADE) g.set(x, y, r.chance(0.75) ? R_GLOW : R_ACCENT);
  }
  // style flourish
  if (style === 'raptor' || style === 'crescent') {
    g.linePair(1, 2, 3, Math.round(R * 0.55), R_HULL); // rear fins
  } else if (style === 'lattice' || style === 'bulwark') {
    g.box(c - 2, c + 2, R - 2, R - 1, R_HULL); // pole blocks
  } else if (style === 'halo' || style === 'saucer') {
    g.ring(c, R + 0.7, R - 0.3, R_ACCENT); // equator halo
  } else if (style === 'needle') {
    g.box(g.w - 3, g.w - 1, 0, 0, R_ACCENT); // bow spike
  }
  g.eng(1, 2);
  g.eng(1, 0);
}

// ---- monsters & Antarans ----
function monsterPlan(kind: string, g: G, r: Rnd): void {
  const L = g.w;
  const HH = (g.h - 1) >> 1;
  const c = (L - 1) / 2;
  switch (kind) {
    case 'amoeba': {
      g.ellipse(c, c - 1, HH - 1, R_HULL);
      for (let i = 0; i < 7; i++) g.discPair(2 + r.int(L - 4), r.int(HH), 1 + r.next() * 1.6, R_HULL); // lumpy membrane
      g.bevel();
      g.ellipse(c + 1, 2.4, 2.2, R_SHADE);
      g.sym(c + 1, 0, R_GLOW); // nucleus
      g.sym(c, 1, R_GLOW);
      for (let i = 0; i < 6; i++) g.sym(2 + r.int(L - 4), r.int(HH - 1), R_ACCENT); // vacuoles
      g.gun(L - 2, 0);
      break;
    }
    case 'hydra': {
      g.ellipse(c - 2, Math.round(L * 0.3), HH - 2, R_HULL); // body
      for (const d of [0, HH - 2]) {
        // three necks forward, heads with glowing eyes
        g.linePair(c, d === 0 ? 0 : d - 1, L - 4, d, R_HULL);
        g.linePair(c, d === 0 ? 1 : d - 2, L - 4, d === 0 ? 1 : d - 1, R_HULL); // thicken
        g.discPair(L - 3, d, 1.4, R_HULL);
        g.sym(L - 3, d, R_GLOW);
      }
      g.bevel();
      g.linePair(2, 1, 0, Math.round(HH * 0.6), R_HULL); // tails
      for (let i = 0; i < 4; i++) g.sym(c - 3 + r.int(6), r.int(HH - 2), R_ACCENT);
      g.gun(L - 2, HH - 2);
      g.gun(L - 2, 0);
      break;
    }
    case 'eel': {
      // sinuous body: offset from the spine by a sine wave (asymmetric on purpose)
      for (let x = 0; x < L - 2; x++) {
        const off = Math.round(Math.sin(x * 0.55) * (HH - 3));
        for (let d = -1; d <= 1; d++) g.set(x, g.cy + off + d, R_HULL);
        if (x % 3 === 0) g.set(x, g.cy + off - 2, R_SHADE); // dorsal spines
      }
      const headOff = Math.round(Math.sin((L - 2) * 0.55) * (HH - 3));
      g.discPair(L - 3, 0, 0, R_HULL);
      for (let d = -2; d <= 2; d++) for (let x = L - 4; x <= L - 1; x++) g.set(x, g.cy + headOff + Math.round(d * 0.6), R_HULL);
      g.set(L - 2, g.cy + headOff - 1, R_GLOW);
      g.set(L - 2, g.cy + headOff + 1, R_GLOW);
      g.bevel();
      for (let x = 2; x < L - 4; x += 4) g.set(x, g.cy + Math.round(Math.sin(x * 0.55) * (HH - 3)), R_ACCENT);
      g.guns.push({ x: L - 1, y: g.cy + headOff });
      break;
    }
    case 'crystal': {
      // radial shard star
      const arms: Array<[number, number]> = [[c + HH - 1, 0], [c - HH + 1, 0], [c, HH - 1], [c + Math.round(HH * 0.6), Math.round(HH * 0.6)], [c - Math.round(HH * 0.6), Math.round(HH * 0.6)]];
      for (const [ax, ad] of arms) {
        g.linePair(c, 0, ax, ad, R_LIGHT);
        g.linePair(c, 1, ax, Math.max(0, ad - 1), R_HULL); // shard body
        g.linePair(c + Math.sign(ax - c), 0, ax, Math.max(0, ad - 1), R_HULL);
      }
      g.ellipse(c, 2.6, 2.6, R_LIGHT);
      g.ring(c, 2.6, 1.6, R_HULL);
      g.sym(c, 0, R_GLOW);
      for (const [ax, ad] of arms) g.sym(ax, ad, R_GLOW);
      break;
    }
    case 'dragon': {
      g.ellipse(c - 1, Math.round(L * 0.26), Math.max(2, HH - 4), R_HULL); // torso
      // bat wings swept back
      for (let i = 0; i < HH - 1; i++) {
        const x0 = c + 1 - Math.round(i * 1.2);
        g.linePair(x0, i, x0 - Math.max(2, Math.round(HH * 0.5)), i + 1, R_HULL);
      }
      g.linePair(c + 1, 1, L - 3, 1, R_HULL); // neck
      g.discPair(L - 3, 1, 1.4, R_HULL); // head
      g.set(L - 2, g.cy - 2, R_GLOW);
      g.set(L - 2, g.cy, R_GLOW);
      g.wedge(0, c - Math.round(L * 0.26) + 1, 1, 0, R_HULL); // tail
      g.bevel();
      for (let i = 1; i < HH - 1; i += 2) g.sym(c - Math.round(i * 1.2), i, R_ACCENT); // wing veins
      g.guns.push({ x: L - 2, y: g.cy - 1 });
      break;
    }
    case 'guardian': {
      // mythic warden: armored core, radial blades, orbiting lights
      g.ring(c, HH - 1, HH - 3, R_HULL);
      g.ellipse(c, HH * 0.45, HH * 0.45, R_HULL);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI;
        const ex = Math.cos(a) * (HH - 1);
        const ed = Math.sin(a) * (HH - 1);
        g.linePair(c - ex, Math.abs(ed), c + ex, Math.abs(ed), i === 0 ? R_SHADE : R_SHADE);
      }
      g.bevel();
      g.ring(c, HH - 1, HH - 1.8, R_ACCENT);
      g.ring(c, HH * 0.45, HH * 0.45 - 1, R_TRIM);
      g.sym(c, 0, R_GLOW); // the eye
      g.sym(c - 1, 0, R_GLOW);
      g.sym(c + 1, 0, R_GLOW);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.set(Math.round(c + Math.cos(a) * (HH - 2)), Math.round(g.cy + Math.sin(a) * (HH - 2)), R_GLOW);
      }
      g.gun(c, HH - 1);
      g.gun(c + HH - 1, 0);
      break;
    }
    default: {
      // antaran_*: crystalline angular warships, ghost-pale
      const fortress = kind === 'antaran_fortress';
      if (fortress) {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI;
          g.linePair(c - Math.cos(a) * (HH - 1), Math.abs(Math.sin(a) * (HH - 1)), c + Math.cos(a) * (HH - 1), Math.abs(Math.sin(a) * (HH - 1)), R_LIGHT);
        }
        g.ellipse(c, HH * 0.55, HH * 0.55, R_HULL);
        g.ring(c, HH * 0.55, HH * 0.55 - 1.2, R_LIGHT);
        g.sym(c, 0, R_GLOW);
        g.ring(c, HH - 1, HH - 1.9, R_ACCENT);
        g.gun(c, HH - 1);
      } else {
        // shard dart: a hull prism flanked by luminous crystal blades
        g.wedge(2, L - 1, Math.max(1, HH - 2), 0, R_HULL);
        g.carve(0, 2, HH);
        g.bevel();
        const bd = Math.max(1, HH - 2);
        g.linePair(3, bd, Math.round(L * 0.55), HH - 1, R_LIGHT); // side shards
        g.linePair(4, bd, Math.round(L * 0.55) + 1, HH - 1, R_LIGHT);
        g.linePair(Math.round(L * 0.55), HH - 1, Math.round(L * 0.7), Math.round(HH * 0.4), R_LIGHT);
        g.box(Math.round(L * 0.4), Math.round(L * 0.85), 0, 0, R_GLOW); // energy vein
        g.sym(Math.round(L * 0.55), HH - 1, R_GLOW);
        g.sym(Math.round(L * 0.25), bd, R_ACCENT);
        g.engAuto(0);
        g.engAuto(bd);
        g.gun(L - 1, 0);
      }
      break;
    }
  }
}

const MONSTER_DIMS: Record<string, [number, number]> = {
  amoeba: [23, 19],
  hydra: [25, 19],
  eel: [27, 15],
  crystal: [21, 21],
  dragon: [27, 21],
  guardian: [33, 33],
  antaran_raider: [17, 11],
  antaran_marauder: [21, 13],
  antaran_intruder: [25, 15],
  antaran_fortress: [31, 31],
};

// ---- specials -> baked visual attachments (the add-ons change the look) ----
export const VISUAL_SPECIALS = [
  'battle_pods', 'heavy_armor', 'shield_capacitor', 'ecm_jammer', 'multi_wave_ecm_jammer',
  'wide_area_jammer', 'high_energy_focus', 'warp_dissipater', 'hyper_x_capacitors', 'fast_missile_racks',
] as const;

function bakeAttachments(g: G, specials: string[], heavyBeams: boolean, missileTubes: number): void {
  const cy = g.cy;
  const midX = Math.round(g.w * 0.45);
  const topEdgeAt = (x: number): number => {
    for (let y = 0; y < g.h; y++) if (g.get(x, y) !== R_EMPTY) return y;
    return cy;
  };
  if (specials.includes('battle_pods')) {
    const y = topEdgeAt(midX);
    g.set(midX, y - 1, R_ACCENT);
    g.set(midX + 1, y - 1, R_ACCENT);
    g.set(midX, g.h - y, R_ACCENT);
    g.set(midX + 1, g.h - y, R_ACCENT);
  }
  const jammers = ['ecm_jammer', 'multi_wave_ecm_jammer', 'wide_area_jammer'].filter((s) => specials.includes(s)).length;
  if (jammers > 0) {
    // sensor mast(s) with a lit tip
    for (let i = 0; i < Math.min(2, jammers + (specials.includes('wide_area_jammer') ? 1 : 0)); i++) {
      const x = Math.round(g.w * (0.55 + i * 0.12));
      const y = topEdgeAt(x);
      g.set(x, y - 1, R_TRIM);
      g.set(x, y - 2, R_TRIM);
      g.set(x, y - 3, R_GLOW);
    }
  }
  if (specials.includes('shield_capacitor')) {
    // energized studs around the midsection
    const y = topEdgeAt(midX + 2);
    g.set(midX + 2, y, R_GLOW);
    g.set(midX + 2, g.h - 1 - y, R_GLOW);
    g.set(midX - 2, topEdgeAt(midX - 2), R_GLOW);
    g.set(midX - 2, g.h - 1 - topEdgeAt(midX - 2), R_GLOW);
  }
  if (specials.includes('high_energy_focus')) {
    // prominent focusing lens at the first muzzle
    const m = g.guns[0];
    if (m) {
      g.set(m.x, m.y, R_GLOW);
      g.set(m.x - 1, m.y, R_GLOW);
    }
  }
  if (specials.includes('warp_dissipater')) {
    // trailing interdiction tines
    g.sym(0, 2, R_ACCENT);
    g.set(0, cy - 3, R_ACCENT);
    g.set(0, cy + 3, R_ACCENT);
  }
  if (specials.includes('hyper_x_capacitors')) {
    // charged spine conduit
    for (let x = Math.round(g.w * 0.3); x < Math.round(g.w * 0.7); x += 2) {
      if (g.get(x, cy) !== R_EMPTY) g.set(x, cy, R_GLOW);
    }
  }
  if (specials.includes('fast_missile_racks') || missileTubes >= 6) {
    // visible silo row
    const y = topEdgeAt(Math.round(g.w * 0.35));
    for (let i = 0; i < 3; i++) {
      const x = Math.round(g.w * 0.3) + i * 2;
      if (g.get(x, y + 1) !== R_EMPTY) g.set(x, y + 1, R_TRIM);
    }
  }
  if (heavyBeams) {
    // heavy-mount barrels protruding past the bow
    const m = g.guns[0];
    if (m) {
      g.set(Math.min(g.w - 1, m.x + 1), Math.max(0, m.y - 1), R_TRIM);
      g.set(Math.min(g.w - 1, m.x + 1), Math.min(g.h - 1, m.y + 1), R_TRIM);
    }
  }
  if (specials.includes('heavy_armor')) {
    // plating outline: hull edge cells go dark and dense
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const v = g.get(x, y);
        if ((v === R_LIGHT || v === R_SHADE) && (x + y) % 2 === 0) g.set(x, y, R_TRIM);
      }
    }
  }
}

// ---- public builders (memoized) ----
const modelCache = new Map<string, ShipModel>();

export interface ModelRequest {
  style: string;
  cls: ArtClass;
  variant: number;
  /** visual add-ons (subset of VISUAL_SPECIALS is what matters) */
  specials?: string[];
  /** any heavy-mount beams on the design (barrel bake) */
  heavyBeams?: boolean;
  /** total missile tube count (silo bake) */
  missileTubes?: number;
}

export function getShipModel(req: ModelRequest): ShipModel {
  const specials = (req.specials ?? []).filter((s) => (VISUAL_SPECIALS as readonly string[]).includes(s)).sort();
  const variant = wrapVariant(req.cls, req.variant);
  const key = `${req.style}|${req.cls}|${variant}|${specials.join(',')}|${req.heavyBeams ? 1 : 0}|${Math.min(9, req.missileTubes ?? 0)}`;
  const hit = modelCache.get(key);
  if (hit) return hit;
  const spec = CLASS_SPECS[req.cls];
  const g = new G(spec.w, spec.h);
  const r = new Rnd(`${req.style}/${req.cls}/${variant}`);
  const plan = PLANS[req.style] ?? planRaptor;
  if (req.cls === 'doomstar') planDoomstar(g, req.style, r);
  else plan(g, req.cls, spec, r, variant);
  if (!spec.base && req.cls !== 'doomstar') bakeAttachments(g, specials, req.heavyBeams ?? false, req.missileTubes ?? 0);
  const model = g.toModel();
  modelCache.set(key, model);
  return model;
}

export function getMonsterModel(kind: string): ShipModel {
  const key = `npc|${kind}`;
  const hit = modelCache.get(key);
  if (hit) return hit;
  const [w, h] = MONSTER_DIMS[kind] ?? [21, 15];
  const g = new G(w, h);
  monsterPlan(kind, g, new Rnd(`npc/${kind}`));
  const model = g.toModel();
  modelCache.set(key, model);
  return model;
}

/** glow-role pixels of a model (blinking nav lights, window shimmer) */
export function glowPixels(model: ShipModel): Mount[] {
  const out: Mount[] = [];
  for (let y = 0; y < model.h; y++) {
    for (let x = 0; x < model.w; x++) {
      if (model.px[y * model.w + x] === R_GLOW) out.push({ x, y });
    }
  }
  return out;
}
