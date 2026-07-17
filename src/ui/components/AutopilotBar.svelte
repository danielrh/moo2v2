<script lang="ts">
  // The slider-autopilot control strip. Shared by the Colonies spreadsheet
  // and the map view (once autopilot is on, the player lives on the map — the
  // sliders must be adjustable without leaving it).
  import { app, saveAutopilot } from '../state.svelte';
</script>

<div class="bar autopilot" data-testid="autopilot-bar">
  <label title="Slider autopilot: five weights run every colony each turn (jobs, buildings, housing, colony ships, warships) so you only manage research, ships and the map. Your manual queue edits stick until the next turn opens; builds you hotkey-queue from the map are finished before autopilot takes the yard back.">
    <input
      type="checkbox"
      data-testid="autopilot-toggle"
      checked={app.autopilot.enabled}
      onchange={(e) => {
        app.autopilot.enabled = (e.target as HTMLInputElement).checked;
        saveAutopilot();
      }}
    />
    🎚 autopilot
  </label>
  {#if app.autopilot.enabled}
    {#each [
      { key: 'infra', icon: '🏗', label: 'infrastructure', help: 'buildings, in the winning build order' },
      { key: 'pop', icon: '👥', label: 'population', help: 'housing emphasis — higher fills planets fuller' },
      { key: 'research', icon: '🔬', label: 'research', help: 'labs over factories, plus extra scientists' },
      { key: 'colonyShips', icon: '🚀', label: 'colony ships', help: 'settlement pipeline depth (you sail them)' },
      { key: 'military', icon: '⚔', label: 'military', help: 'warship quota per colony; high values add a transport lift' },
    ] as const as s (s.key)}
      <label class="slider" title={s.help}>
        {s.icon} {s.label}
        <!-- onchange (drag release), not oninput: every weight change runs a
             full governor pass over all colonies -->
        <input
          type="range"
          min="0"
          max="10"
          data-testid="slider-{s.key}"
          value={app.autopilot.weights[s.key]}
          onchange={(e) => {
            app.autopilot.weights[s.key] = Number((e.target as HTMLInputElement).value);
            saveAutopilot();
          }}
        />
        <span class="val">{app.autopilot.weights[s.key]}</span>
      </label>
    {/each}
  {/if}
</div>

<style>
  .bar {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    margin-bottom: 0.4rem;
    flex-wrap: wrap;
  }
  .autopilot {
    font-size: 0.8rem;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 0.25rem 0.6rem;
  }
  .autopilot .slider {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    white-space: nowrap;
  }
  .autopilot input[type='range'] {
    width: 5.5rem;
  }
  .autopilot .val {
    min-width: 1.1rem;
    text-align: right;
    color: var(--accent-soft);
  }
</style>
