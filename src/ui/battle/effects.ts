// Battle VFX toolbox: pure draw helpers for the replay viewer. Everything is
// deterministic in (tick, seed) so scrubbing the timeline re-renders the exact
// same frame. Callers pass two layers: `fx` (normal blend: smoke, debris) and
// `glow` (additive blend: beams, flames, shields, fire) — the additive layer
// is what makes energy weapons actually *glow* over dark space.

import type { Graphics } from 'pixi.js';

// ---- deterministic hash noise ----
export function fxHash(a: number, b = 0, c = 0): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---- weapon beam styling ----
export interface BeamStyle {
  color: number;
  kind: 'line' | 'jag' | 'pulse' | 'lance';
  width: number;
}

const BEAM_FX: Record<string, BeamStyle> = {
  laser_cannon: { color: 0xff5a4d, kind: 'line', width: 1.7 },
  fusion_beam: { color: 0xffb14d, kind: 'line', width: 2.3 },
  particle_beam: { color: 0xcfe8ff, kind: 'line', width: 2.0 },
  ion_pulse_cannon: { color: 0x7db8ff, kind: 'pulse', width: 2.2 },
  graviton_beam: { color: 0xb98cff, kind: 'line', width: 2.5 },
  neutron_blaster: { color: 0x7dffc8, kind: 'line', width: 2.1 },
  phasor: { color: 0xff4da8, kind: 'line', width: 2.4 },
  disrupter: { color: 0x9dff5e, kind: 'jag', width: 2.0 },
  plasma_cannon: { color: 0xbaff5e, kind: 'line', width: 2.9 },
  mauler_device: { color: 0xff3d2e, kind: 'line', width: 3.8 },
  stellar_converter: { color: 0xffffff, kind: 'lance', width: 4.2 },
  starlight_projector: { color: 0xfff7d6, kind: 'lance', width: 3.0 },
  spatial_compressor: { color: 0xd0a2ff, kind: 'jag', width: 2.4 },
  tractor_beam: { color: 0x7de8ff, kind: 'pulse', width: 2.0 },
  stasis_field: { color: 0x7de8ff, kind: 'pulse', width: 2.4 },
  pulsar: { color: 0xcfe8ff, kind: 'jag', width: 2.6 },
  plasma_web: { color: 0x9dff5e, kind: 'jag', width: 2.2 },
  gyro_destabilizer: { color: 0xd0a2ff, kind: 'pulse', width: 2.2 },
  black_hole_generator: { color: 0x8a7dff, kind: 'jag', width: 3.0 },
  anti_missile_rocket: { color: 0xffe9b0, kind: 'line', width: 1.2 },
  // monster breath weapons
  dragon_breath: { color: 0xff8a3d, kind: 'jag', width: 3.2 },
  phasor_eye: { color: 0xff4da8, kind: 'line', width: 3.0 },
  crystal_ray: { color: 0xeaffff, kind: 'lance', width: 2.6 },
  plasma_breath: { color: 0x9dff5e, kind: 'jag', width: 3.0 },
  plasma_flux: { color: 0x9dff5e, kind: 'line', width: 2.4 },
  caustic_slime: { color: 0xd6ff5e, kind: 'line', width: 3.0 },
};

const FALLBACK_BEAMS = [0xffd75e, 0x7db8ff, 0xff8a5e, 0x9dff5e, 0xd07aff];

export function beamStyleOf(weaponId: string): BeamStyle {
  const hit = BEAM_FX[weaponId];
  if (hit) return hit;
  let h = 0;
  for (let i = 0; i < weaponId.length; i++) h = (h * 31 + weaponId.charCodeAt(i)) | 0;
  return { color: FALLBACK_BEAMS[Math.abs(h) % FALLBACK_BEAMS.length]!, kind: 'line', width: 2 };
}

/** guided munition tints (exhaust / plasma color) */
export const MISSILE_TINT: Record<string, number> = {
  nuclear_missile: 0xffb066,
  merculite_missile: 0xffe066,
  pulson_missile: 0x7db8ff,
  zeon_missile: 0xd07aff,
};

export const TORPEDO_TINT: Record<string, number> = {
  anti_matter_torpedo: 0xd07aff,
  proton_torpedo: 0x7db8ff,
  plasma_torpedo: 0x9dff5e,
};

// ---- beams ----

/** layered glowing beam segment from (x0,y0) to (x1,y1) */
export function drawBeam(
  glow: Graphics,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  style: BeamStyle,
  alpha: number,
  kill: boolean,
  tick: number,
  seed: number,
): void {
  const w = style.width * (kill ? 1.5 : 1);
  if (style.kind === 'jag') {
    // crackling arc: jittered polyline, rebuilt every tick
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const segs = Math.max(3, Math.min(9, Math.round(len / 22)));
    const pts: Array<[number, number]> = [[x0, y0]];
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const off = (fxHash(seed, tick, i) - 0.5) * Math.min(14, len * 0.12);
      pts.push([x0 + dx * t + nx * off, y0 + dy * t + ny * off]);
    }
    pts.push([x1, y1]);
    for (const [lw, la] of [[w * 3, 0.14], [w * 1.4, 0.5], [w * 0.6, 1]] as const) {
      glow.moveTo(pts[0]![0], pts[0]![1]);
      for (let i = 1; i < pts.length; i++) glow.lineTo(pts[i]![0], pts[i]![1]);
      glow.stroke({ color: lw < w ? 0xffffff : style.color, width: lw, alpha: la * alpha, cap: 'round', join: 'round' });
    }
    return;
  }
  if (style.kind === 'pulse') {
    // bolt train marching along the path
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const gap = 16;
    const phase = ((tick * 6 + seed % 7) % gap);
    for (let d = phase; d < len; d += gap) {
      const bx = x0 + ux * d;
      const by = y0 + uy * d;
      glow.circle(bx, by, w * 1.9).fill({ color: style.color, alpha: 0.18 * alpha });
      glow.moveTo(bx - ux * 4, by - uy * 4).lineTo(bx + ux * 4, by + uy * 4).stroke({ color: style.color, width: w, alpha: 0.85 * alpha, cap: 'round' });
      glow.circle(bx + ux * 3, by + uy * 3, w * 0.5).fill({ color: 0xffffff, alpha: 0.9 * alpha });
    }
    return;
  }
  // line / lance: wide halo, colored core, white-hot center
  const layers: Array<[number, number, number]> =
    style.kind === 'lance'
      ? [[w * 3.4, 0.16, style.color], [w * 1.7, 0.4, style.color], [w * 0.8, 1, 0xffffff]]
      : [[w * 2.8, 0.13, style.color], [w * 1.2, 0.55, style.color], [w * 0.45, 0.95, 0xffffff]];
  for (const [lw, la, lc] of layers) {
    glow.moveTo(x0, y0).lineTo(x1, y1).stroke({ color: lc, width: lw, alpha: la * alpha, cap: 'round' });
  }
}

export function drawMuzzle(glow: Graphics, x: number, y: number, color: number, s: number): void {
  glow.circle(x, y, s * 2.4).fill({ color, alpha: 0.22 });
  glow.circle(x, y, s).fill({ color: 0xffffff, alpha: 0.75 });
}

export function drawImpact(glow: Graphics, x: number, y: number, color: number, mag: number, kill: boolean, tick: number, seed: number): void {
  glow.circle(x, y, mag * 1.9).fill({ color, alpha: 0.28 });
  glow.circle(x, y, mag * 0.9).fill({ color: 0xffffff, alpha: 0.6 });
  const sparks = kill ? 7 : 4;
  for (let i = 0; i < sparks; i++) {
    const a = fxHash(seed, i, 11) * Math.PI * 2;
    const d = mag * (1.2 + fxHash(seed, i, 12) * 1.6);
    glow.moveTo(x, y).lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d).stroke({ color, width: 1, alpha: 0.6 });
  }
}

// ---- slugs / tracers ----
export function drawSlug(glow: Graphics, x: number, y: number, ux: number, uy: number, hit: boolean): void {
  glow.moveTo(x - ux * 6, y - uy * 6).lineTo(x, y).stroke({ color: 0x9fb4ff, width: 1.6, alpha: hit ? 0.5 : 0.25, cap: 'round' });
  glow.circle(x, y, 1.7).fill({ color: hit ? 0xe8efff : 0x8b93b8, alpha: hit ? 1 : 0.55 });
}

// ---- guided munitions ----

/** a proper little missile: finned body + warhead + exhaust, rotated to course */
export function drawMissile(
  fx: Graphics,
  glow: Graphics,
  x: number,
  y: number,
  angle: number,
  tint: number,
  accent: number,
  tick: number,
  id: number,
): void {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const P = (px: number, py: number): [number, number] => [x + px * ca - py * sa, y + px * sa + py * ca];
  const body: Array<[number, number]> = [P(4.2, 0), P(2.2, -1.3), P(-3.4, -1.3), P(-3.4, 1.3), P(2.2, 1.3)];
  fx.poly(body.flat()).fill({ color: 0xb9c2d8 });
  fx.poly([...P(4.2, 0), ...P(2.2, -1.3), ...P(2.2, 1.3)]).fill({ color: accent });
  // tail fins
  fx.poly([...P(-3.4, -1.3), ...P(-4.6, -2.4), ...P(-2.6, -1.3)]).fill({ color: 0x8b93b8 });
  fx.poly([...P(-3.4, 1.3), ...P(-4.6, 2.4), ...P(-2.6, 1.3)]).fill({ color: 0x8b93b8 });
  // exhaust: flickering plume
  const f = 0.75 + fxHash(tick, id, 3) * 0.5;
  const [ex, ey] = P(-4.2, 0);
  const [tx, ty] = P(-4.2 - 6.5 * f, 0);
  glow.moveTo(ex, ey).lineTo(tx, ty).stroke({ color: tint, width: 2.4, alpha: 0.55, cap: 'round' });
  glow.circle(ex, ey, 1.6).fill({ color: 0xffffff, alpha: 0.9 });
}

/** plasma/AM torpedo: pulsing energy orb with crackle */
export function drawTorpedo(glow: Graphics, x: number, y: number, tint: number, tick: number, frac: number, id: number): void {
  const pulse = 0.85 + 0.3 * Math.sin((tick + frac) * 1.1 + id * 2.4);
  glow.circle(x, y, 6.5 * pulse).fill({ color: tint, alpha: 0.16 });
  glow.circle(x, y, 3.6 * pulse).fill({ color: tint, alpha: 0.5 });
  glow.circle(x, y, 1.8).fill({ color: 0xffffff, alpha: 0.95 });
  for (let i = 0; i < 3; i++) {
    const a = fxHash(tick, id, i) * Math.PI * 2;
    const r = 4.5 * pulse;
    glow.moveTo(x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.4)
      .lineTo(x + Math.cos(a + 0.6) * r, y + Math.sin(a + 0.6) * r)
      .stroke({ color: tint, width: 1, alpha: 0.65 });
  }
}

/** strike craft: a tiny wedge fighter with an engine spark */
export function drawFighter(fx: Graphics, glow: Graphics, x: number, y: number, angle: number, color: number, shuttle: boolean): void {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const P = (px: number, py: number): [number, number] => [x + px * ca - py * sa, y + px * sa + py * ca];
  if (shuttle) {
    fx.poly([...P(3, 0), ...P(1, -2), ...P(-3, -2), ...P(-3, 2), ...P(1, 2)]).fill({ color, alpha: 0.95 });
  } else {
    fx.poly([...P(3.6, 0), ...P(-2.6, -2.2), ...P(-1.2, 0), ...P(-2.6, 2.2)]).fill({ color, alpha: 0.95 });
  }
  const [ex, ey] = P(-2.6, 0);
  glow.circle(ex, ey, 1.1).fill({ color: 0xffffff, alpha: 0.8 });
}

/** fading trail behind a projectile */
export function drawTrail(glow: Graphics, pts: Array<[number, number]>, color: number, width: number): void {
  for (let i = 1; i < pts.length; i++) {
    const a = (i / pts.length) * 0.4;
    glow.moveTo(pts[i - 1]![0], pts[i - 1]![1]).lineTo(pts[i]![0], pts[i]![1]).stroke({ color, width: width * (i / pts.length), alpha: a, cap: 'round' });
  }
}

// ---- engine flames ----
export function drawFlame(
  glow: Graphics,
  x: number,
  y: number,
  angle: number, // ship heading; flame streams opposite
  len: number,
  width: number,
  color: number,
  tick: number,
  frac: number,
  seed: number,
  sputter: boolean,
): void {
  const back = angle + Math.PI;
  const ca = Math.cos(back);
  const sa = Math.sin(back);
  if (sputter) {
    // knocked-out drive: intermittent red backfires
    if (fxHash(tick, seed, 77) < 0.45) {
      const d = 2 + fxHash(tick, seed, 78) * 3;
      glow.circle(x + ca * d, y + sa * d, 1.6).fill({ color: 0xff6b5e, alpha: 0.7 });
    }
    return;
  }
  const flick = 0.8 + 0.4 * fxHash(tick, seed, Math.floor(frac * 3));
  const L = len * flick;
  const nx = -sa;
  const ny = ca;
  const tip: [number, number] = [x + ca * L, y + sa * L];
  const w = width;
  // outer plume, inner tongue, white-hot core
  glow.poly([x + nx * w, y + ny * w, tip[0] + ca * 1, tip[1] + sa * 1, x - nx * w, y - ny * w]).fill({ color, alpha: 0.26 });
  glow.poly([x + nx * w * 0.55, y + ny * w * 0.55, x + ca * L * 0.66, y + sa * L * 0.66, x - nx * w * 0.55, y - ny * w * 0.55]).fill({ color, alpha: 0.5 });
  glow.circle(x + ca * 1.2, y + sa * 1.2, w * 0.65).fill({ color: 0xffffff, alpha: 0.85 });
}

// ---- shields ----

/** faint standing bubble (alpha scales with remaining shield) */
export function drawShieldBubble(glow: Graphics, x: number, y: number, r: number, pct: number, tick: number, frac: number): void {
  const breathe = 1 + 0.02 * Math.sin((tick + frac) * 0.6);
  glow.circle(x, y, r * breathe).stroke({ color: 0x4da3ff, width: 1.2, alpha: 0.05 + (pct / 100) * 0.16 });
}

/** impact fizzle: bright arc facing the hit + crackling sparks, decays over ~4 ticks */
export function drawShieldHit(
  glow: Graphics,
  x: number,
  y: number,
  r: number,
  bearing: number,
  age: number, // 0..1 progress of the fizzle
  mag: number, // absorbed damage scale 0..1
  color: number,
  seed: number,
  tick: number,
): void {
  const fade = Math.max(0, 1 - age);
  const spread = 0.7 + mag * 0.7 + age * 0.5;
  // moveTo the arc start first: pixi otherwise pens a line in from the origin
  glow.moveTo(x + Math.cos(bearing - spread) * r, y + Math.sin(bearing - spread) * r)
    .arc(x, y, r, bearing - spread, bearing + spread)
    .stroke({ color, width: 2.6 * fade + 0.6, alpha: 0.75 * fade });
  glow.moveTo(x + Math.cos(bearing - spread * 0.7) * (r + 1.5), y + Math.sin(bearing - spread * 0.7) * (r + 1.5))
    .arc(x, y, r + 1.5, bearing - spread * 0.7, bearing + spread * 0.7)
    .stroke({ color: 0xffffff, width: 1.1 * fade, alpha: 0.5 * fade });
  // fizz: short radial static sparks dancing on the bubble
  const n = 3 + Math.round(mag * 5);
  for (let i = 0; i < n; i++) {
    const a = bearing + (fxHash(seed, i, tick) - 0.5) * spread * 2.4;
    const r0 = r + (fxHash(seed, i, 5) - 0.3) * 3;
    const r1 = r0 + 2 + fxHash(seed, i, 6) * 4 * fade;
    glow.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0)
      .lineTo(x + Math.cos(a + 0.15) * r1, y + Math.sin(a + 0.15) * r1)
      .stroke({ color, width: 0.9, alpha: 0.8 * fade });
  }
  const ix = x + Math.cos(bearing) * r;
  const iy = y + Math.sin(bearing) * r;
  glow.circle(ix, iy, 2.2 + mag * 2.5).fill({ color: 0xffffff, alpha: 0.5 * fade });
}

/** whole-bubble flash when the shield generator dies or the pool collapses */
export function drawShieldCollapse(glow: Graphics, x: number, y: number, r: number, age: number): void {
  const fade = Math.max(0, 1 - age);
  glow.circle(x, y, r * (1 + age * 0.5)).stroke({ color: 0x4da3ff, width: 2.5 * fade, alpha: 0.8 * fade });
  glow.circle(x, y, r * (1 + age * 0.5)).fill({ color: 0x4da3ff, alpha: 0.12 * fade });
}

// ---- deaths ----

/** staged ship death: flash -> fireball + shock ring -> debris + embers */
export function drawExplosion(
  fx: Graphics,
  glow: Graphics,
  x: number,
  y: number,
  size: number, // hull visual radius in screen px
  age: number, // frames since death (0..)
  frac: number,
  seed: number,
): void {
  const t = age + frac;
  const life = 14 + size * 0.5;
  if (t > life) return;
  const p = t / life;
  // initial white flash
  if (t < 2.2) glow.circle(x, y, size * (1.4 + t * 1.2)).fill({ color: 0xffffff, alpha: 0.85 - t * 0.32 });
  // fireball: a hot core with noisy overlapping blobs, cooling white -> yellow -> red
  if (t < life * 0.62) {
    const heat = 1 - t / (life * 0.62);
    glow.circle(x, y, size * (0.75 + p * 0.9)).fill({ color: 0xff8a4d, alpha: 0.28 + heat * 0.25 });
    const blobs = 7;
    for (let i = 0; i < blobs; i++) {
      const a = fxHash(seed, i, 21) * Math.PI * 2;
      const d = (0.1 + fxHash(seed, i, 22) * 0.55) * size * (0.4 + p * 1.5);
      const br = size * (0.4 + fxHash(seed, i, 23) * 0.4) * (1 - p * 0.5);
      const color = heat > 0.66 ? 0xfff3c9 : heat > 0.33 ? 0xffb066 : 0xff7d4e;
      glow.circle(x + Math.cos(a) * d, y + Math.sin(a) * d, br).fill({ color, alpha: 0.5 + heat * 0.3 });
    }
    glow.circle(x, y, size * 0.55 * (1 - p * 0.8)).fill({ color: 0xffffff, alpha: 0.35 + heat * 0.55 });
  }
  // expanding shock ring
  glow.circle(x, y, size * 0.8 + t * (2.6 + size * 0.12)).stroke({
    color: 0xffc9a1,
    width: Math.max(0.8, 3.4 - t * 0.28),
    alpha: Math.max(0, 0.75 - p * 0.9),
  });
  // tumbling debris chunks decelerating outward
  const chunks = Math.min(14, 5 + Math.round(size * 0.5));
  for (let i = 0; i < chunks; i++) {
    const a = fxHash(seed, i, 31) * Math.PI * 2;
    const v = (1.4 + fxHash(seed, i, 32) * 2.4) * (0.4 + size * 0.05);
    const d = v * t * (1 - p * 0.45);
    const cx = x + Math.cos(a) * d;
    const cy = y + Math.sin(a) * d;
    const s = 1 + fxHash(seed, i, 33) * 2.2 * (1 - p * 0.6);
    fx.rect(cx - s / 2, cy - s / 2, s, s).fill({ color: i % 3 === 0 ? 0x59628c : 0x2e364f, alpha: Math.max(0, 1 - p * 1.1) });
    if (i % 2 === 0) glow.circle(cx, cy, 0.9).fill({ color: 0xffa15e, alpha: Math.max(0, 0.9 - p * 1.3) });
  }
  // lingering smoke
  if (t > 3) {
    for (let i = 0; i < 3; i++) {
      const a = fxHash(seed, i, 41) * Math.PI * 2;
      const d = 2 + fxHash(seed, i, 42) * size * 0.8;
      fx.circle(x + Math.cos(a) * d, y + Math.sin(a) * d - t * 0.3, size * 0.4 + t * 0.35).fill({ color: 0x11141f, alpha: Math.max(0, 0.5 - p * 0.6) });
    }
  }
}

// ---- misc ----

/** damaged hull: sparks + drifting smoke puffs */
export function drawDamageSmoke(fx: Graphics, glow: Graphics, x: number, y: number, size: number, structPct: number, tick: number, seed: number): void {
  if (structPct > 55) return;
  const bad = 1 - structPct / 55;
  for (let i = 0; i < 2; i++) {
    const h = fxHash(tick - i * 2, seed, i);
    if (h > 0.3 + bad * 0.4) continue;
    const a = fxHash(seed, i, 51) * Math.PI * 2;
    const d = size * 0.5 * fxHash(seed, i, 52);
    fx.circle(x + Math.cos(a) * d + i, y + Math.sin(a) * d - i * 1.5, 1.6 + i * 1.4).fill({ color: 0x0d1017, alpha: 0.4 * bad });
  }
  if (structPct < 30 && fxHash(tick, seed, 53) < 0.25) {
    const a = fxHash(tick, seed, 54) * Math.PI * 2;
    glow.circle(x + Math.cos(a) * size * 0.4, y + Math.sin(a) * size * 0.4, 1.1).fill({ color: 0xffe9b0, alpha: 0.9 });
  }
}

/** retreat warp-out: light streaks stretching along the escape heading */
export function drawWarpStreak(glow: Graphics, x: number, y: number, angle: number, age: number, color: number): void {
  const fade = Math.max(0, 1 - age);
  if (fade <= 0) return;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const L = 14 + age * 30;
  for (const off of [-3, 0, 3]) {
    const nx = -sa * off;
    const ny = ca * off;
    glow.moveTo(x + nx, y + ny).lineTo(x + nx + ca * L, y + ny + sa * L).stroke({ color, width: off === 0 ? 2 : 1, alpha: (off === 0 ? 0.8 : 0.4) * fade, cap: 'round' });
  }
  glow.circle(x, y, 3 * fade).fill({ color: 0xffffff, alpha: 0.6 * fade });
}

/** lightning_field special: stray arcs crawling over the hull */
export function drawLightningAura(glow: Graphics, x: number, y: number, r: number, tick: number, seed: number): void {
  if (fxHash(tick, seed, 61) > 0.3) return;
  const a0 = fxHash(tick, seed, 62) * Math.PI * 2;
  let px = x + Math.cos(a0) * r;
  let py = y + Math.sin(a0) * r;
  glow.moveTo(px, py);
  for (let i = 1; i <= 4; i++) {
    const a = a0 + i * 0.5;
    const rr = r * (0.85 + fxHash(tick, seed, 63 + i) * 0.4);
    px = x + Math.cos(a) * rr;
    py = y + Math.sin(a) * rr;
    glow.lineTo(px, py);
  }
  glow.stroke({ color: 0x9dff5e, width: 1, alpha: 0.7 });
}

/** automated_repair_unit special: little drones orbiting the hull */
export function drawRepairDrones(glow: Graphics, x: number, y: number, r: number, tick: number, frac: number, seed: number): void {
  for (let i = 0; i < 2; i++) {
    const a = (tick + frac) * 0.22 + i * Math.PI + fxHash(seed, i, 71) * 6.28;
    const dx = x + Math.cos(a) * r;
    const dy = y + Math.sin(a) * r * 0.7;
    glow.circle(dx, dy, 1.2).fill({ color: 0xffe9b0, alpha: 0.9 });
    glow.moveTo(dx, dy).lineTo(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.4).stroke({ color: 0xffe9b0, width: 0.5, alpha: 0.25 });
  }
}

/** warp_dissipater special: a violet interdiction wake behind the ship */
export function drawDissipaterWake(glow: Graphics, x: number, y: number, angle: number, size: number, tick: number, frac: number): void {
  const back = angle + Math.PI;
  const ca = Math.cos(back);
  const sa = Math.sin(back);
  for (let i = 1; i <= 3; i++) {
    const d = size * 0.8 + i * 5 + ((tick + frac) * 1.4) % 5;
    const acx = x + ca * d;
    const acy = y + sa * d;
    const ar = size * 0.5 + i;
    glow.moveTo(acx + Math.cos(back - 0.9) * ar, acy + Math.sin(back - 0.9) * ar)
      .arc(acx, acy, ar, back - 0.9, back + 0.9)
      .stroke({ color: 0xb98cff, width: 1.1, alpha: 0.4 - i * 0.1 });
  }
}

/** point-defense intercept pop */
export function drawPdPop(glow: Graphics, x: number, y: number, age: number): void {
  const fade = Math.max(0, 1 - age);
  glow.circle(x, y, 2 + age * 5).stroke({ color: 0xffe9b0, width: 1.4 * fade, alpha: 0.8 * fade });
  glow.circle(x, y, 1.5).fill({ color: 0xffffff, alpha: 0.85 * fade });
}
