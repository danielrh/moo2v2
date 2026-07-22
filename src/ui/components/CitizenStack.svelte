<script lang="ts">
  import { ANDROID_RACE } from '@engine/index';
  import type { Job } from '@engine/types';

  type CitizenGroup = {
    race: number;
    raceName: string;
    unrest: boolean;
    farmers: number;
    workers: number;
    scientists: number;
  };

  type Props = {
    rowId: number;
    job: Job;
    farmable: boolean;
    count: number;
    groups: CitizenGroup[];
    playerId: number;
    title: string;
    overlapPx: (count: number) => number;
    isPicked: (job: Job, race: number, i: number) => boolean;
    onPick: (job: Job, race: number, i: number) => void;
    onDragStart: (job: Job, race: number, i: number, ev: DragEvent) => void;
  };

  let {
    rowId,
    job,
    farmable,
    count,
    groups,
    playerId,
    title,
    overlapPx,
    isPicked,
    onPick,
    onDragStart,
  }: Props = $props();

  const JOB_ICONS: Record<Job, string> = { farmers: '🌾', workers: '🔨', scientists: '🧪' };
</script>

<span
  class="citizens"
  role="group"
  data-testid={`${job}-${rowId}`}
  data-count={count}
  {title}
>
  {#if job === 'farmers' && !farmable}
    <span class="zero" title="nothing grows here — farming is impossible on this world">🚫</span>
  {:else if count === 0}
    <span class="zero">0</span>
  {/if}
  {#each groups as grp (grp.race)}
    {#each Array(grp[job]) as _, i (i)}
      {#if grp.race === ANDROID_RACE}
        <span
          class="citizen android"
          style={i > 0 ? `margin-left:-${overlapPx(count)}px` : ''}
          title="android {job.slice(0, -1)} — hardwired to this job for life; consumes 1 production per turn instead of food, immune to morale, houses in compact subterranean compartments"
          data-testid={`android-${job}-${rowId}`}
        >🤖</span>
      {:else}
        <span
          class="citizen"
          class:foreign={grp.race !== playerId}
          class:unrest={grp.unrest}
          class:sel={isPicked(job, grp.race, i)}
          style={i > 0 ? `margin-left:-${overlapPx(count)}px` : ''}
          draggable="true"
          role="button"
          tabindex="-1"
          title={grp.race !== playerId
            ? `captured ${grp.raceName} colonist${grp.unrest ? ' — in unrest (−25% output until assimilated)' : ''}`
            : grp.unrest
              ? 'in unrest (−25% output until assimilated)'
              : ''}
          onclick={() => onPick(job, grp.race, i)}
          onkeydown={(e) => e.key === 'Enter' && onPick(job, grp.race, i)}
          ondragstart={(e) => onDragStart(job, grp.race, i, e)}
        >{JOB_ICONS[job]}</span>
      {/if}
    {/each}
  {/each}
</span>

<style>
  .citizens {
    display: inline-flex;
    align-items: center;
    gap: 0;
    min-width: 1.3rem;
    justify-content: center;
  }
  .citizen {
    cursor: grab;
    font-size: 0.85rem;
    line-height: 1;
    position: relative;
  }
  .citizen:hover {
    transform: scale(1.25);
    z-index: 2;
  }
  .citizen.sel {
    filter: drop-shadow(0 0 3px var(--accent)) brightness(1.3);
    z-index: 1;
  }
  .citizen.foreign {
    filter: drop-shadow(0 0 2px #c084fc) hue-rotate(45deg);
  }
  .citizen.foreign.sel {
    filter: drop-shadow(0 0 3px var(--accent)) hue-rotate(45deg) brightness(1.3);
  }
  .citizen.unrest {
    filter: drop-shadow(0 0 3px var(--bad)) grayscale(0.5);
  }
  .citizen.android {
    cursor: not-allowed;
    filter: drop-shadow(0 0 2px #22d3ee);
  }
  .zero {
    color: var(--text-dim);
    opacity: 0.5;
    padding: 0 0.2rem;
  }
</style>
