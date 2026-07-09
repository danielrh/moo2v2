<script lang="ts">
  import { selectors } from '@engine/index';
  import { app, getActive } from '../state.svelte';

  const session = () => getActive()!.session;
  const gs = $derived.by(() => {
    void app.version;
    return session().getPlanned();
  });
  const fleets = $derived.by(() => (gs ? selectors.fleetRows(gs, session().playerId) : []));

  let note = $state('');
  function submit(kind: string, payload: unknown) {
    note = '';
    const res = session().submit(kind, payload);
    if (res.error) note = res.error;
  }
  function move(shipId: number, destStarId: number) {
    if (destStarId >= -1) submit('move_ships', { shipIds: [shipId], destStarId });
  }
  function colonize(shipId: number, planetId: number) {
    submit('colonize', { shipId, planetId });
  }
  function outpost(shipId: number, planetId: number) {
    submit('build_outpost', { shipId, planetId });
  }
  function scrap(shipId: number) {
    submit('scrap_ship', { shipId });
  }
  function colonyName(id: number | null): string {
    return gs?.colonies.find((c) => c.id === id)?.name ?? '';
  }
  const starName = (id: number) => gs?.stars.find((s) => s.id === id)?.name ?? `star ${id}`;
</script>

{#if note}<p class="error">{note}</p>{/if}
{#if fleets.length === 0}
  <p class="dim">No ships yet — build scouts, colony ships, or warship designs from the Colonies tab.</p>
{:else}
  <table>
    <thead>
      <tr><th>Ship</th><th>Type</th><th>Location</th><th>Cargo / status</th><th>Actions</th></tr>
    </thead>
    <tbody>
      {#each fleets as f (f.ship.id)}
        <tr data-testid="fleet-{f.ship.id}">
          <td class="shipname">{f.name} <span class="dim">#{f.ship.id}</span></td>
          <td class="dim">{f.kind === 'design' ? 'warship' : f.kind.replaceAll('_', ' ')}</td>
          <td>
            {#if f.transit}
              <span class="transit">
                {starName(f.transit.fromStarId)} ➤ <b>{starName(f.transit.toStarId)}</b>
                <span class="etabar" title="arrives in {f.etaTurns}t">
                  <span
                    class="etafill"
                    style="width:{Math.min(100, Math.max(6, Math.floor(((gs!.turn - f.transit.departedTurn) * 100) / Math.max(1, f.transit.arrivalTurn - f.transit.departedTurn))))}%"
                  ></span>
                </span>
                {f.etaTurns}t
              </span>
            {:else}
              {f.location}
            {/if}
          </td>
          <td>
            {#if f.ship.cargoPopUnits > 0}
              👥 {f.ship.cargoPopUnits} colonists aboard
            {/if}
            {#if f.ship.dmgStructure > 0 || f.ship.dmgArmor > 0}
              <span class="neg" title="repairs automatically at your colonies">🔧 damaged</span>
            {/if}
            {#if f.reroutable}
              <span class="gold" title="this order was placed this turn — you can still change it">↩ re-routable</span>
            {/if}
          </td>
          <td class="actions">
            {#if gs && (f.atStarId !== null || f.reroutable)}
              {@const origin = f.atStarId ?? f.transit!.fromStarId}
              <select value={-2} onchange={(e) => move(f.ship.id, Number((e.target as HTMLSelectElement).value))}>
                <option value={-2}>{f.reroutable ? 're-route to…' : 'move to…'}</option>
                {#if f.reroutable}
                  <option value={f.transit!.fromStarId}>✕ cancel — stay at {starName(f.transit!.fromStarId)}</option>
                {/if}
                {#each selectors.moveOptions(gs, session().playerId, origin) as o (o.starId)}
                  <option value={o.starId} disabled={!o.reachable}>
                    {o.name} ({o.turns}t){o.reachable ? '' : ' — out of range'}
                  </option>
                {/each}
              </select>
            {/if}
            {#each f.canColonizeHere.slice(0, 1) as pid (pid)}
              <button class="primary" data-testid="colonize-btn-{f.ship.id}" onclick={() => colonize(f.ship.id, pid)}>colonize</button>
            {/each}
            {#each f.canOutpostHere.slice(0, 1) as pid (pid)}
              <button onclick={() => outpost(f.ship.id, pid)}>outpost</button>
            {/each}
            {#if f.canLoadFromColonyId !== null}
              <button
                title="load 2 colonists from {colonyName(f.canLoadFromColonyId)}"
                onclick={() => submit('load_transports', { colonyId: f.canLoadFromColonyId, shipId: f.ship.id })}
              >⬆ load colonists</button>
            {/if}
            {#if f.canUnloadToColonyId !== null}
              <button
                title="land the colonists at {colonyName(f.canUnloadToColonyId)}"
                onclick={() => submit('unload_transports', { colonyId: f.canUnloadToColonyId, shipId: f.ship.id })}
              >⬇ unload</button>
            {/if}
            <button class="dimbtn" onclick={() => scrap(f.ship.id)}>scrap</button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  <p class="dim hint">
    👥 To move colonists: build a <b>transport</b>, load it at a colony (needs &gt;2 of your people), fly it, unload.
    Colony ships found new colonies; outpost ships extend fuel range. Move orders placed this turn can be re-routed or cancelled until the turn resolves.
  </p>
{/if}

<style>
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.9rem;
  }
  td,
  th {
    border: 1px solid var(--line);
    padding: 0.3rem 0.6rem;
    text-align: left;
  }
  .shipname {
    font-weight: 600;
  }
  .actions {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .transit {
    display: inline-flex;
    gap: 0.4rem;
    align-items: center;
  }
  .etabar {
    display: inline-block;
    width: 4rem;
    height: 0.45rem;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 3px;
    overflow: hidden;
  }
  .etafill {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, #24418a, var(--accent));
  }
  .dim {
    opacity: 0.65;
  }
  .dimbtn {
    opacity: 0.65;
  }
  .neg {
    color: var(--bad);
  }
  .gold {
    color: var(--gold);
  }
  .error {
    color: var(--bad);
  }
  .hint {
    margin-top: 0.6rem;
    max-width: 60rem;
  }
  button.primary {
    background: linear-gradient(180deg, #1f6a38, #175028);
    border-color: var(--good);
  }
</style>
