<script lang="ts">
  // The system-wide colonies spreadsheet: the primary way to run your empire.
  // Every edit is an optimistic command; dirty cells resolve on host accept.
  import { selectors, itemLabel } from '@engine/index';
  import { app, getActive } from '../state.svelte';

  const session = () => getActive()!.session;
  const allRows = $derived.by(() => {
    void app.version;
    const s = session().getPlanned();
    return s ? selectors.colonyRows(s, session().playerId) : [];
  });
  const stickyMode = $derived.by(() => {
    void app.version;
    return session().getPlanned()?.settings.modes.stickyBuild === true;
  });
  const label = (item: string) => {
    const s = session().getPlanned();
    return s ? itemLabel(s, session().playerId, item) : item;
  };

  // ---- filter + sort ----
  let filter = $state('');
  type SortKey = 'name' | 'pop' | 'food' | 'prod' | 'sci' | 'bc' | 'morale' | 'building';
  let sortKey = $state<SortKey>('name');
  let sortDir = $state(1);
  function sortBy(k: SortKey) {
    if (sortKey === k) sortDir = -sortDir;
    else {
      sortKey = k;
      sortDir = k === 'name' || k === 'building' ? 1 : -1;
    }
  }
  const keyFns: Record<SortKey, (r: selectors.ColonyRow) => string | number> = {
    name: (r) => r.name,
    pop: (r) => r.popUnits,
    food: (r) => r.output.foodNet,
    prod: (r) => r.output.prodToQueue || r.output.prod,
    sci: (r) => r.output.research,
    bc: (r) => r.output.bcIncome,
    morale: (r) => r.output.moralePct,
    building: (r) => r.activeItem ?? '',
  };
  const rows = $derived.by(() => {
    let out = allRows;
    const f = filter.trim().toLowerCase();
    if (f) {
      out = out.filter(
        (r) =>
          r.name.toLowerCase().includes(f) ||
          r.planet.climate.includes(f) ||
          (r.activeItem ?? '').includes(f),
      );
    }
    const fn = keyFns[sortKey];
    return [...out].sort((a, b) => {
      const x = fn(a);
      const y = fn(b);
      const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
      return c !== 0 ? c * sortDir : a.id - b.id;
    });
  });
  const totals = $derived.by(() => {
    const t = { pop: 0, food: 0, prod: 0, sci: 0, bc: 0, pollution: 0 };
    for (const r of allRows) {
      if (r.outpost) continue;
      t.pop += r.popUnits;
      t.food += r.output.foodNet;
      t.prod += r.output.prodToQueue || r.output.prod;
      t.sci += r.output.research;
      t.bc += r.output.bcIncome;
      t.pollution += r.output.pollution;
    }
    return t;
  });

  // ---- bulk ops ----
  let selected = $state<Set<number>>(new Set());
  function toggleSelect(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }
  function bulkBuild(item: string) {
    if (!item) return;
    for (const row of rows) {
      if (!selected.has(row.id) || !row.buildable.includes(item)) continue;
      const items = row.queue.length ? [item, ...row.queue.slice(1)] : [item];
      session().submit('set_build_queue', { colonyId: row.id, items });
    }
  }
  const bulkOptions = $derived.by(() => {
    const chosen = rows.filter((r) => selected.has(r.id));
    if (!chosen.length) return [];
    const common = new Set(chosen[0]!.buildable);
    for (const r of chosen.slice(1)) {
      for (const item of [...common]) if (!r.buildable.includes(item)) common.delete(item);
    }
    return [...common].sort();
  });

  function adjustJob(row: selectors.ColonyRow, job: 'farmers' | 'workers' | 'scientists', delta: number) {
    const jobs = { ...row.jobs };
    if (delta > 0) {
      // take a unit from the largest other pool
      const donors = (['workers', 'scientists', 'farmers'] as const).filter((j) => j !== job && jobs[j] > 0);
      if (!donors.length) return;
      const donor = donors.sort((a, b) => jobs[b] - jobs[a])[0]!;
      jobs[donor]--;
      jobs[job]++;
    } else {
      if (jobs[job] <= 0) return;
      jobs[job]--;
      // give to workers by default, else farmers
      const target = job === 'workers' ? 'farmers' : 'workers';
      jobs[target]++;
    }
    session().submit('set_jobs', {
      colonyId: row.id,
      groups: [{ race: session().playerId, ...jobs }],
    });
  }

  function setBuild(row: selectors.ColonyRow, item: string) {
    if (!item) return;
    const items = row.queue.length ? [item, ...row.queue.slice(1)] : [item];
    session().submit('set_build_queue', { colonyId: row.id, items });
  }

  function appendBuild(row: selectors.ColonyRow, item: string) {
    if (!item) return;
    session().submit('set_build_queue', { colonyId: row.id, items: [...row.queue, item] });
  }

  function buy(row: selectors.ColonyRow) {
    session().submit('buy_production', { colonyId: row.id });
  }

  function parked(row: selectors.ColonyRow): string {
    const entries = Object.entries(row.stickyInvested).filter(([, v]) => v > 0);
    if (!entries.length) return '';
    return entries.map(([k, v]) => `${label(k)}: ${v}`).join(', ');
  }
</script>

<div class="bar">
  <input data-testid="colony-filter" placeholder="filter colonies…" bind:value={filter} style="width:12rem" />
  {#if selected.size > 0}
    <span>{selected.size} selected:</span>
    <select
      data-testid="bulk-build"
      value=""
      onchange={(e) => {
        bulkBuild((e.target as HTMLSelectElement).value);
        (e.target as HTMLSelectElement).value = '';
      }}
    >
      <option value="">set build for all…</option>
      {#each bulkOptions as item (item)}<option value={item}>{label(item)}</option>{/each}
    </select>
    <button onclick={() => (selected = new Set())}>clear selection</button>
  {:else}
    <span class="dim">tick colonies to bulk-set builds; click headers to sort</span>
  {/if}
</div>

<table data-testid="colony-table">
  <thead>
    <tr>
      <th></th>
      <th class="sortable" onclick={() => sortBy('name')}>Colony {sortKey === 'name' ? (sortDir > 0 ? '▲' : '▼') : ''}</th>
      <th>Planet</th>
      <th class="sortable" onclick={() => sortBy('pop')}>Pop {sortKey === 'pop' ? (sortDir > 0 ? '▲' : '▼') : ''}</th>
      <th class="sortable" onclick={() => sortBy('morale')}>Morale {sortKey === 'morale' ? (sortDir > 0 ? '▲' : '▼') : ''}</th>
      <th>Farm</th>
      <th>Work</th>
      <th>Sci</th>
      <th class="sortable" onclick={() => sortBy('food')}>🌾 {sortKey === 'food' ? (sortDir > 0 ? '▲' : '▼') : ''}</th>
      <th class="sortable" onclick={() => sortBy('prod')}>🔧 {sortKey === 'prod' ? (sortDir > 0 ? '▲' : '▼') : ''}</th>
      <th class="sortable" onclick={() => sortBy('sci')}>🔬 {sortKey === 'sci' ? (sortDir > 0 ? '▲' : '▼') : ''}</th>
      <th class="sortable" onclick={() => sortBy('bc')}>💰 {sortKey === 'bc' ? (sortDir > 0 ? '▲' : '▼') : ''}</th>
      <th>☁️</th>
      <th class="sortable" onclick={() => sortBy('building')}>Building {sortKey === 'building' ? (sortDir > 0 ? '▲' : '▼') : ''}</th>
      <th>Progress</th>
      <th>Buy</th>
      <th>Queue</th>
    </tr>
  </thead>
  <tbody>
    {#each rows as row (row.id)}
      <tr data-testid="colony-row-{row.id}" class:outpost={row.outpost}>
        <td><input type="checkbox" checked={selected.has(row.id)} onchange={() => toggleSelect(row.id)} /></td>
        <td class="name">{row.name}{row.outpost ? ' (outpost)' : ''}</td>
        <td class="dim">{row.planet.climate} {row.planet.minerals} {row.planet.gravity}-g s{row.planet.sizeClass}</td>
        <td data-testid="pop-{row.id}">{row.popUnits}/{row.maxPop}</td>
        <td>{row.output.moralePct}%</td>
        {#each ['farmers', 'workers', 'scientists'] as const as job (job)}
          <td class="jobs">
            <button class="mini" onclick={() => adjustJob(row, job, -1)}>-</button>
            <span data-testid="{job}-{row.id}">{row.jobs[job]}</span>
            <button class="mini" onclick={() => adjustJob(row, job, +1)}>+</button>
          </td>
        {/each}
        <td class:neg={row.output.foodNet < 0} data-testid="foodnet-{row.id}">{row.output.foodNet >= 0 ? '+' : ''}{row.output.foodNet}</td>
        <td data-testid="prod-{row.id}">{row.output.prodToQueue || row.output.prod}</td>
        <td>{row.output.research}</td>
        <td>{row.output.bcIncome}</td>
        <td class:neg={row.output.pollution > 0}>{row.output.pollution}</td>
        <td>
          <select
            data-testid="build-{row.id}"
            value={row.activeItem ?? ''}
            onchange={(e) => setBuild(row, (e.target as HTMLSelectElement).value)}
          >
            <option value="" disabled>— build —</option>
            {#if row.activeItem && !row.buildable.includes(row.activeItem)}
              <option value={row.activeItem}>{label(row.activeItem)}</option>
            {/if}
            {#each row.buildable as item (item)}
              <option value={item}>{label(item)}</option>
            {/each}
          </select>
        </td>
        <td data-testid="progress-{row.id}">
          {#if row.activeItem === 'housing' || row.activeItem === 'trade_goods'}
            ∞
          {:else if row.activeItem}
            {row.storedProd}/{row.activeCost}{row.turnsLeft !== null ? ` (${row.turnsLeft}t)` : ''}
          {:else}
            idle
          {/if}
          {#if stickyMode && parked(row)}
            <span class="parked" title="sticky build: production parked on switched-away items" data-testid="parked-{row.id}">⏸ {parked(row)}</span>
          {/if}
        </td>
        <td>
          {#if row.buyPrice !== null}
            <button data-testid="buy-{row.id}" disabled={!row.canBuy} onclick={() => buy(row)}>
              {row.buyPrice} BC
            </button>
          {/if}
        </td>
        <td>
          <span class="dim">{row.queue.slice(1).map(label).join(', ')}</span>
          <select data-testid="queue-add-{row.id}" value="" onchange={(e) => { appendBuild(row, (e.target as HTMLSelectElement).value); (e.target as HTMLSelectElement).value = ''; }}>
            <option value="">+ queue</option>
            {#each row.buildable as item (item)}
              <option value={item}>{label(item)}</option>
            {/each}
          </select>
        </td>
      </tr>
    {/each}
  </tbody>
  <tfoot>
    <tr data-testid="totals">
      <td></td>
      <td class="name">Σ {allRows.filter((r) => !r.outpost).length} colonies</td>
      <td></td>
      <td>{totals.pop}</td>
      <td></td>
      <td colspan="3"></td>
      <td class:neg={totals.food < 0}>{totals.food >= 0 ? '+' : ''}{totals.food}</td>
      <td>{totals.prod}</td>
      <td>{totals.sci}</td>
      <td>{totals.bc}</td>
      <td class:neg={totals.pollution > 0}>{totals.pollution}</td>
      <td colspan="4"></td>
    </tr>
  </tfoot>
</table>

<style>
  .bar {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    margin-bottom: 0.4rem;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.85rem;
  }
  td,
  th {
    border: 1px solid #26304f;
    padding: 0.25rem 0.45rem;
    text-align: left;
    white-space: nowrap;
  }
  th.sortable {
    cursor: pointer;
    user-select: none;
  }
  tfoot td {
    background: #141830;
    font-weight: 600;
  }
  .jobs {
    white-space: nowrap;
  }
  .mini {
    padding: 0 0.35rem;
    margin: 0 0.15rem;
  }
  .neg {
    color: #ff8a7a;
  }
  .dim {
    opacity: 0.65;
  }
  .parked {
    display: block;
    color: #ffd479;
    font-size: 0.75rem;
  }
  .name {
    font-weight: 600;
  }
  .outpost {
    opacity: 0.6;
  }
  select {
    max-width: 11rem;
  }
</style>
