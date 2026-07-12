// Fleet visual styles (cosmetic only — never touches combat math).
//
// Every empire owns one style; it decides the pixel-art silhouette family its
// warships use in battle replays. Ship DESIGNS additionally pick one of the
// style's model variants per hull class (EmpireDesign.modelIdx). The style ids
// live in the engine so the set_ship_style command can validate them and so
// battle inputs can snapshot them; the actual pixel plans live in the UI
// (src/ui/battle/shipart.ts) — the sim itself never reads these.

export interface ShipStyleInfo {
  id: string;
  name: string;
  blurb: string;
}

export const SHIP_STYLES: readonly ShipStyleInfo[] = [
  { id: 'raptor', name: 'Raptor', blurb: 'swept-wing wedge darts — knife-edged interceptor lines' },
  { id: 'saucer', name: 'Meridian', blurb: 'circular primary hulls with outrigger drive nacelles' },
  { id: 'lattice', name: 'Lattice', blurb: 'machine raiders — chrome crescents' },
  { id: 'orbital', name: 'Orbital', blurb: 'near-future spaceframes — trusses, tanks and radiators' },
  { id: 'crescent', name: 'Crescent', blurb: 'flowing blade hulls — curved scimitars and fins' },
  { id: 'gemini', name: 'Gemini', blurb: 'twin-pod catamarans — paired hulls on a cross spar' },
  { id: 'needle', name: 'Needle', blurb: 'spinal lances — long thin spikes with cross fins' },
  { id: 'manta', name: 'Manta', blurb: 'smooth biomorphic rays — rounded lifting bodies' },
  { id: 'bulwark', name: 'Bulwark', blurb: 'predatory war-hulls — fanged, glowing armored raptors' },
  { id: 'halo', name: 'Halo', blurb: 'annular ring ships — hulls built around a halo' },
];

export function isShipStyle(id: unknown): boolean {
  return typeof id === 'string' && SHIP_STYLES.some((s) => s.id === id);
}

/** The style an empire renders with: chosen, else a stable per-empire default. */
export function shipStyleOf(empire: { id: number; shipStyle?: string }): string {
  if (empire.shipStyle && SHIP_STYLES.some((s) => s.id === empire.shipStyle)) return empire.shipStyle;
  return SHIP_STYLES[((empire.id % SHIP_STYLES.length) + SHIP_STYLES.length) % SHIP_STYLES.length]!.id;
}
