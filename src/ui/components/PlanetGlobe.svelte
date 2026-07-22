<script lang="ts">
  // Stylized procedural planet portrait: climate-tinted globe with a
  // deterministic per-planet variant (seas/bands/craters/ice), reusing the
  // same visual language as the small system-map dots in MapView.svelte, but
  // rendered standalone so it can be shown large as a colony "portrait".
  type Props = {
    planetId: number;
    climate: string;
    sizeClass: number;
    minerals?: string;
    size?: number;
  };
  let { planetId, climate, sizeClass, minerals, size = 96 }: Props = $props();
  const uid = $props.id();

  const CLIMATE_COLORS: Record<string, string> = {
    gaia: '#5ee08a', terran: '#6cc862', arid: '#d8bb6a', swamp: '#7aa85a', ocean: '#4da3ff',
    tundra: '#bcd7e8', desert: '#e0a35e', barren: '#8f8a80', energized: '#c78bff', hostile: '#ff6b5e',
  };
  function mixHex(a: string, b: string, t: number): string {
    const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
    const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    return `#${pa.map((v, i) => Math.round(v + (pb[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
  }
  type Pattern = 'seas' | 'bands' | 'craters' | 'ice';
  interface WorldLook {
    base: string;
    light: string;
    dark: string;
    detail: string;
    pattern: Pattern;
    cap: boolean;
    v: number;
  }
  const CLIMATE_PATTERNS: Record<string, Pattern[]> = {
    gaia: ['seas'], terran: ['seas'], ocean: ['seas'], swamp: ['seas', 'bands'],
    arid: ['bands', 'craters'], desert: ['bands', 'craters'], tundra: ['ice', 'craters'],
    barren: ['craters'], energized: ['bands', 'seas'], hostile: ['craters', 'bands'],
  };
  const DETAIL_TINT: Record<string, string> = {
    gaia: '#2f8f5a', terran: '#3f7fbf', ocean: '#2c6cc0', swamp: '#4d7a3a',
    arid: '#a8843c', desert: '#b07a3a', tundra: '#8fb8d8', barren: '#5d5a52',
    energized: '#8f5fd0', hostile: '#b03a30',
  };
  function worldLook(): WorldLook {
    const base = CLIMATE_COLORS[climate] ?? '#999';
    const h = ((planetId * 2654435761) >>> 0) % 1024;
    const patterns = CLIMATE_PATTERNS[climate] ?? ['craters'];
    return {
      base,
      light: mixHex(base, '#ffffff', 0.35),
      dark: mixHex(base, '#000000', 0.45),
      detail: DETAIL_TINT[climate] ?? mixHex(base, '#000000', 0.3),
      pattern: patterns[h % patterns.length]!,
      cap: climate === 'tundra' || climate === 'terran' || climate === 'gaia' ? h % 3 !== 0 : h % 5 === 0,
      v: h % 4,
    };
  }
  function mineralRing(m: string): { stroke: string; width: number; dash: string } | null {
    if (m === 'ultra_rich') return { stroke: '#ffd75e', width: 2.5, dash: '' };
    if (m === 'rich') return { stroke: '#ffd75e', width: 1.5, dash: '' };
    if (m === 'poor') return { stroke: '#777f9d', width: 1.2, dash: '3 3' };
    if (m === 'ultra_poor') return { stroke: '#565d78', width: 1.2, dash: '2 4' };
    return null;
  }

  const look = $derived(worldLook());
  const pr = $derived(4 + sizeClass * 1.8);
  const ring = $derived(minerals ? mineralRing(minerals) : null);
</script>

<svg viewBox="0 0 100 100" width={size} height={size} class="planetGlobe" aria-hidden="true" focusable="false">
  <defs>
    <radialGradient id="pg-{uid}" cx="0.35" cy="0.3" r="1.05">
      <stop offset="0%" stop-color={look.light} />
      <stop offset="55%" stop-color={look.base} />
      <stop offset="100%" stop-color={look.dark} />
    </radialGradient>
    <clipPath id="clip-{uid}"><circle cx="50" cy="50" r={pr} /></clipPath>
  </defs>
  <circle cx="50" cy="50" r={pr} fill="url(#pg-{uid})" />
  <g clip-path="url(#clip-{uid})">
    {#if look.pattern === 'seas'}
      <ellipse cx={50 - pr * 0.35 + look.v} cy={50 - pr * 0.2} rx={pr * 0.55} ry={pr * 0.35} fill={look.detail} opacity="0.75" transform="rotate({look.v * 17} 50 50)" />
      <ellipse cx={50 + pr * 0.4 - look.v * 0.5} cy={50 + pr * 0.35} rx={pr * 0.4} ry={pr * 0.22} fill={look.detail} opacity="0.65" transform="rotate({-look.v * 11} 50 50)" />
    {:else if look.pattern === 'bands'}
      <ellipse cx="50" cy={50 - pr * 0.35} rx={pr * 1.1} ry={pr * 0.16} fill={look.detail} opacity="0.6" transform="rotate({look.v * 4 - 6} 50 50)" />
      <ellipse cx="50" cy={50 + pr * 0.25} rx={pr * 1.1} ry={pr * 0.2} fill={look.detail} opacity="0.5" transform="rotate({look.v * 4 - 6} 50 50)" />
    {:else if look.pattern === 'craters'}
      <circle cx={50 - pr * 0.3} cy={50 - pr * 0.25 + look.v * 0.6} r={pr * 0.2} fill={look.dark} opacity="0.8" />
      <circle cx={50 + pr * 0.35} cy={50 + pr * 0.15} r={pr * 0.14} fill={look.dark} opacity="0.7" />
      <circle cx={50 + pr * 0.05 + look.v * 0.4} cy={50 + pr * 0.45} r={pr * 0.1} fill={look.detail} opacity="0.8" />
    {:else if look.pattern === 'ice'}
      <ellipse cx="50" cy={50 - pr * 0.55} rx={pr * 0.8} ry={pr * 0.35} fill="#eef6ff" opacity="0.85" />
      <ellipse cx={50 - pr * 0.2} cy={50 + pr * 0.3} rx={pr * 0.4} ry={pr * 0.18} fill={look.detail} opacity="0.5" />
    {/if}
    {#if look.cap}
      <ellipse cx="50" cy={50 - pr * 0.78} rx={pr * 0.5} ry={pr * 0.2} fill="#f2f8ff" opacity="0.9" />
    {/if}
    <circle cx={50 + pr * 0.45} cy={50 + pr * 0.4} r={pr * 1.15} fill="#04060e" opacity="0.28" />
  </g>
  {#if ring}
    <circle cx="50" cy="50" r={pr + 3} fill="none" stroke={ring.stroke} stroke-width={ring.width} stroke-dasharray={ring.dash} />
  {/if}
</svg>

<style>
  .planetGlobe {
    display: block;
    flex-shrink: 0;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.45));
  }
</style>
