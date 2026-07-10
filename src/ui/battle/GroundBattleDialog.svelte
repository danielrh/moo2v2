<script lang="ts">
  // Short animated playback of a planetary invasion: two shrinking troop rows
  // stepping through the recorded rounds. Participants-only data.
  import { playerColor } from '../colors';
  import type { GroundBattleEntry } from '../state.svelte';

  let { battle, onclose }: { battle: GroundBattleEntry; onclose: () => void } = $props();

  const p = $derived(battle.payload);
  let step = $state(0);
  let playing = $state(true);
  const rounds = $derived(p.rounds.length ? p.rounds : [{ t: p.startTroops, m: p.startMilitia }]);
  const cur = $derived(rounds[Math.min(step, rounds.length - 1)]!);
  const done = $derived(step >= rounds.length - 1);

  $effect(() => {
    if (!playing) return;
    const iv = setInterval(() => {
      if (step < rounds.length - 1) step++;
      else playing = false;
    }, 140);
    return () => clearInterval(iv);
  });

  const icons = (n: number, max: number, icon: string): string => {
    const shown = Math.min(n, 30);
    void max;
    return icon.repeat(shown) + (n > 30 ? ` ×${n}` : '');
  };
</script>

<div class="overlay" role="dialog" aria-label="ground battle replay">
  <div class="panel">
    <h3>
      ⚔ Ground assault — {p.colonyName} (turn {battle.turn})
      <button class="x" onclick={onclose}>✕</button>
    </h3>
    <div class="field">
      <div class="side">
        <span class="who" style="color:{playerColor(p.attacker)}">invaders</span>
        <div class="troops" data-testid="ground-attackers">{icons(cur.t, p.startTroops, '💂')}</div>
        <span class="count">{cur.t}/{p.startTroops} troops</span>
      </div>
      <div class="vs">⚡</div>
      <div class="side">
        <span class="who" style="color:{playerColor(p.defender)}">defenders</span>
        <div class="troops" data-testid="ground-defenders">{icons(cur.m, p.startMilitia, '🛡')}</div>
        <span class="count">{cur.m}/{p.startMilitia} militia</span>
      </div>
    </div>
    <input type="range" min="0" max={rounds.length - 1} bind:value={step} oninput={() => (playing = false)} />
    <p class="verdict" class:won={p.captured}>
      {#if done}
        {p.captured ? '🏳 The colony falls — surviving population is captured.' : '🛡 The invasion is repelled.'}
        {p.civilianLosses > 0 ? ` ${p.civilianLosses} civilian unit${p.civilianLosses > 1 ? 's' : ''} died in the fighting.` : ''}
      {:else}
        fighting…
        <button onclick={() => (playing = !playing)}>{playing ? '⏸' : '▶'}</button>
      {/if}
    </p>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(3, 5, 12, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 60;
  }
  .panel {
    background: var(--panel, #10162e);
    border: 1px solid var(--line-bright, #3a4468);
    border-radius: 10px;
    padding: 1rem 1.4rem;
    min-width: 30rem;
    max-width: 44rem;
  }
  h3 {
    margin: 0 0 0.6rem;
    display: flex;
    justify-content: space-between;
  }
  .x {
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .field {
    display: flex;
    gap: 1rem;
    align-items: center;
  }
  .side {
    flex: 1;
  }
  .who {
    font-weight: 700;
    font-size: 0.85rem;
  }
  .troops {
    font-size: 1.05rem;
    line-height: 1.3;
    min-height: 2.6rem;
    word-break: break-all;
  }
  .count {
    font-size: 0.78rem;
    opacity: 0.75;
  }
  .vs {
    font-size: 1.4rem;
  }
  input[type='range'] {
    width: 100%;
    margin-top: 0.5rem;
  }
  .verdict {
    margin: 0.5rem 0 0;
  }
  .verdict.won {
    color: var(--gold, #ffd75e);
  }
</style>
