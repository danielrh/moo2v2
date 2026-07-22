<script lang="ts">
  import { selectors, itemLabel, itemDescription, explainOutput, COLONY_TAGS, planetTitle } from '@engine/index';
  import { app, getActive } from '../state.svelte';
  import ColonyPanel from '../components/ColonyPanel.svelte';
  import CitizenStack from '../components/CitizenStack.svelte';
  import PlanetGlobe from '../components/PlanetGlobe.svelte';
  import type { Job } from '@engine/types';

  type Props = {
    colonyId: number;
    onSelectPlanet?: (planetId: number) => void;
    onClose?: () => void;
  };

  let { colonyId, onSelectPlanet, onClose }: Props = $props();

  const session = () => getActive()!.session;
  const label = (item: string) => {
    const s = session().getPlanned();
    return s ? itemLabel(s, session().playerId, item) : item;
  };
  const describeItem = (item: string | null | undefined): string => (item ? itemDescription(item) : '');
  const pretty = (id: string) => id.replaceAll('_', ' ');
  const growthLabel = (k: number) => {
    const v = k / 1000;
    const s = v !== 0 && Math.abs(v) < 1 ? v.toFixed(2) : v.toFixed(1);
    return `${v >= 0 ? '+' : ''}${s}`;
  };

  /** hover breakdown per output column: every coefficient and where it's from */
  function explain(rowId: number): { farm: string; prod: string; sci: string; bc: string } {
    const s = session().getPlanned();
    const c = s?.colonies.find((x) => x.id === rowId);
    if (!s || !c || c.outpost) return { farm: '', prod: '', sci: '', bc: '' };
    const ex = explainOutput(s, c);
    return {
      farm: ex.farm.join('\n'),
      prod: ex.prod.join('\n'),
      sci: ex.sci.join('\n'),
      bc: ex.bc.join('\n'),
    };
  }

  const row = $derived.by(() => {
    void app.version;
    const s = session().getPlanned();
    if (!s) return null;
    const rows = selectors.colonyRows(s, session().playerId);
    return rows.find((r) => r.id === colonyId && !r.outpost) ?? null;
  });

  const stickyMode = $derived.by(() => {
    void app.version;
    return session().getPlanned()?.settings.modes.stickyBuild === true;
  });

  /** other planets at the same star, for the "jump to another colony here"
   * list — only own, non-outpost colonies are actually clickable */
  const siblingPlanets = $derived.by(() => {
    void app.version;
    const s = session().getPlanned();
    const r = row;
    if (!s || !r) return [];
    return s.planets
      .filter((p) => p.starId === r.planet.starId)
      .sort((a, b) => a.orbit - b.orbit)
      .map((p) => {
        const colony = s.colonies.find((c) => c.planetId === p.id) ?? null;
        return {
          planet: p,
          colony,
          isCurrent: p.id === r.planet.id,
          selectable: !!colony && !colony.outpost && colony.owner === session().playerId && p.id !== r.planet.id,
        };
      });
  });

  function parked(r: selectors.ColonyRow): string {
    const entries = Object.entries(r.stickyInvested).filter(([, v]) => v > 0);
    if (!entries.length) return '';
    return entries.map(([k, v]) => `${label(k)}: ${v}`).join(', ');
  }

  /** every queue edit surfaces the engine's rejection — a silently ignored
   * error leaves the dropdown face desynced from what is actually building */
  function submitNoted(kind: string, payload: unknown) {
    return session().submit(kind, payload);
  }

  function setBuild(r: selectors.ColonyRow, item: string) {
    if (!item) return;
    const idx = r.queue.indexOf(item);
    const items =
      idx >= 0
        ? [item, ...r.queue.slice(0, idx), ...r.queue.slice(idx + 1)]
        : r.queue.length
          ? [item, ...r.queue.slice(1)]
          : [item];
    submitNoted('set_build_queue', { colonyId: r.id, items });
  }

  function removeQueued(r: selectors.ColonyRow, index: number) {
    submitNoted('set_build_queue', {
      colonyId: r.id,
      items: r.queue.filter((_, i) => i !== index),
    });
  }

  function appendBuild(r: selectors.ColonyRow, item: string) {
    if (!item) return;
    submitNoted('set_build_queue', { colonyId: r.id, items: [...r.queue, item] });
  }

  function buy(r: selectors.ColonyRow) {
    submitNoted('buy_production', { colonyId: r.id });
  }

  function sell(r: selectors.ColonyRow, buildingId: string) {
    submitNoted('sell_building', { colonyId: r.id, buildingId });
  }

  function setTags(r: selectors.ColonyRow, tags: string[]) {
    session().submit('set_colony_tags', { colonyId: r.id, tags });
  }

  // ---- rename ----
  let renaming = $state(false);
  let renameText = $state('');
  const focusNow = (el: HTMLElement) => el.focus();
  function startRename(r: selectors.ColonyRow) {
    renaming = true;
    renameText = r.name;
  }
  function commitRename(r: selectors.ColonyRow) {
    if (!renaming) return;
    const name = renameText.trim();
    if (name && name !== r.name) session().submit('rename_colony', { colonyId: r.id, name });
    renaming = false;
  }

  /** reassign within ONE race group — captured colonists keep their own
   * group, so a multi-race colony never gets its groups overwritten */
  function moveJob(r: selectors.ColonyRow, race: number, fromJob: Job, toJob: Job, count = 1) {
    const grp = r.groups.find((g) => g.race === race);
    if (!grp) return;
    const n = Math.min(count, grp[fromJob]);
    if (fromJob === toJob || n <= 0) return;
    const jobs = { race: grp.race, farmers: grp.farmers, workers: grp.workers, scientists: grp.scientists };
    jobs[fromJob] -= n;
    jobs[toJob] += n;
    session().submit('set_jobs', { colonyId: r.id, groups: [jobs] });
  }

  // ---- drag colonists between job columns (single colony: no cross-colony drop) ----
  let picked = $state<{ job: Job; race: number; from: number } | null>(null);
  function pickFrom(r: selectors.ColonyRow, job: Job, race: number, i: number) {
    if (picked && picked.job === job && picked.race === race && picked.from === i) {
      picked = null;
    } else {
      picked = { job, race, from: i };
    }
  }
  const isPicked = (r: selectors.ColonyRow, job: Job, race: number, i: number): boolean =>
    !!picked && picked.job === job && picked.race === race && i >= picked.from;
  /** how many citizens a drag starting at icon i of a group carries */
  function grabCount(r: selectors.ColonyRow, job: Job, race: number, i: number): number {
    const grp = r.groups.find((g) => g.race === race);
    if (!grp) return 1;
    const from = picked && picked.job === job && picked.race === race && picked.from <= i ? picked.from : i;
    return grp[job] - from;
  }
  /** icons always overlap a bit (negative kerning), tighter as counts grow */
  const overlapPx = (count: number): number => (count <= 4 ? 3 : count <= 8 ? 6 : count <= 14 ? 8 : 10);
  let drag = $state<{ job: Job; race: number; count: number } | null>(null);
  let dragOver = $state<Job | null>(null);
  function onDragStart(r: selectors.ColonyRow, job: Job, race: number, i: number, ev: DragEvent) {
    drag = { job, race, count: Math.max(1, grabCount(r, job, race, i)) };
    ev.dataTransfer?.setData('text/plain', `${r.id}:${job}:${race}:${drag.count}`);
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
  }
  function onDrop(r: selectors.ColonyRow, job: Job) {
    if (drag) moveJob(r, drag.race, drag.job, job, drag.count);
    drag = null;
    picked = null;
    dragOver = null;
  }
</script>

<div
  class="overlay"
  role="dialog"
  tabindex="-1"
  aria-label="colony management"
  onclick={(e) => {
    if (e.currentTarget === e.target) onClose?.();
  }}
  onkeydown={(e) => {
    if (e.key === 'Escape') onClose?.();
  }}
>
  <div class="modalBody">
    {#if row}
      {@const ex = explain(row.id)}
      <div class="singleColony" data-testid="single-colony-view">
        <div class="colonyTitleRow">
          {#if renaming}
            <input
              class="rename"
              data-testid="rename-input-{row.id}"
              bind:value={renameText}
              use:focusNow
              onkeydown={(e) => {
                if (e.key === 'Enter') commitRename(row);
                else if (e.key === 'Escape') renaming = false;
              }}
              onblur={() => commitRename(row)}
              maxlength="24"
            />
          {:else}
            <h2 class="singleTitle">
              <span role="button" tabindex="-1" ondblclick={() => startRename(row)} data-testid="colony-name-{row.id}">{row.name}</span>
              <button class="mini ghost" data-testid="rename-{row.id}" title="rename colony" onclick={() => startRename(row)}>✏️</button>
              <span class="tagsline">
                {#each row.tags as t (t)}
                  <button class="tag" data-testid="tag-{row.id}-{t}" title="remove tag {t}" onclick={() => setTags(row, row.tags.filter((x) => x !== t))}>{t}✕</button>
                {/each}
                <select
                  class="tagadd"
                  data-testid="tag-add-{row.id}"
                  value=""
                  title="tag this colony"
                  onchange={(e) => {
                    const t = (e.target as HTMLSelectElement).value;
                    if (t) setTags(row, [...row.tags, t]);
                    (e.target as HTMLSelectElement).value = '';
                  }}
                >
                  <option value="">+ tag</option>
                  {#each COLONY_TAGS.filter((t) => !row.tags.includes(t)) as t (t)}
                    <option value={t}>{t}</option>
                  {/each}
                </select>
              </span>
            </h2>
          {/if}
          <span class="popLine" data-testid="pop-{row.id}">Pop {row.popUnits}/{row.maxPop} <small class:neg={row.growthK < 0}>({growthLabel(row.growthK)} next turn)</small></span>
          <button class="mini" data-testid="close-colony-modal" onclick={() => onClose?.()}>Close</button>
        </div>

        <section class="topRow">
      <ColonyPanel title="System">
        <ul class="sysPlanets">
          {#each siblingPlanets as sp (sp.planet.id)}
            <li class:current={sp.isCurrent}>
              {#if sp.selectable}
                <button class="sysPlanetBtn" onclick={() => onSelectPlanet?.(sp.planet.id)} title={planetTitle(sp.planet)}>
                  <PlanetGlobe planetId={sp.planet.id} climate={sp.planet.climate} sizeClass={sp.planet.sizeClass} minerals={sp.planet.minerals} size={22} />
                  <span class="sysPlanetText">
                    <span class="orbit">{sp.planet.orbit}</span>
                    {sp.planet.body === 'planet' ? `${sp.planet.climate} · size ${sp.planet.sizeClass}` : pretty(sp.planet.body)}
                    {#if sp.colony}<b class="sysColonyName"> — {sp.colony.name}</b>{/if}
                  </span>
                </button>
              {:else}
                <span class="sysPlanetLabel" title={planetTitle(sp.planet)}>
                  <PlanetGlobe planetId={sp.planet.id} climate={sp.planet.climate} sizeClass={sp.planet.sizeClass} minerals={sp.planet.minerals} size={22} />
                  <span class="sysPlanetText">
                    <span class="orbit">{sp.planet.orbit}</span>
                    {sp.planet.body === 'planet' ? `${sp.planet.climate} · size ${sp.planet.sizeClass}` : pretty(sp.planet.body)}
                    {#if sp.colony}<b class="sysColonyName"> — {sp.colony.name}</b>{/if}
                  </span>
                </span>
              {/if}
            </li>
          {/each}
        </ul>
      </ColonyPanel>

      <ColonyPanel title="Colony output">
        <div class="statStrip">
          <div class="statItem" title="Morale affects food, production and research.">
            <span class="statIcon">🙂</span>
            <strong>{row.output.moralePct}%</strong>
          </div>
          <div class="statItem" title={ex.farm}>
            <span class="statIcon">🌾</span>
            <strong class:neg={row.output.foodNet < 0}>{row.output.foodNet >= 0 ? '+' : ''}{row.output.foodNet}</strong>
          </div>
          <div class="statItem" title={ex.prod}>
            <span class="statIcon">⚒</span>
            <strong>{row.output.prodToQueue || row.output.prod}</strong>
          </div>
          <div class="statItem" title={ex.sci}>
            <span class="statIcon">⚗</span>
            <strong>{row.output.research}</strong>
          </div>
          <div class="statItem" title={ex.bc}>
            <span class="statIcon">💰</span>
            <strong>{row.output.bcIncome}</strong>
          </div>
          <div class="statItem" title="Production lost to pollution before it reaches the build queue.">
            <span class="statIcon">☁</span>
            <strong class:neg={row.output.pollution > 0}>{row.output.pollution}</strong>
          </div>
          <div class="statItem" title={row.farmable ? 'This world can grow food.' : 'Current tech cannot grow food here.'}>
            <span class="statIcon">{row.farmable ? '🌱' : '🚫'}</span>
          </div>
          <div class="statItem" title="Trained marine garrison (barracks cap shown when you have barracks).">
            <span class="statIcon">🛡</span>
            <strong>{row.marines}{row.marineCap > 0 ? `/${row.marineCap}` : ''}</strong>
          </div>
        </div>
      </ColonyPanel>

      <ColonyPanel title="Population assignment">
        {#each row.groups as grp (grp.race)}
          <div class="groupBlock">
            <div class="groupHead">
              <strong>{grp.raceName}</strong>
              <span class="dim">{grp.units} population unit{grp.units === 1 ? '' : 's'}{grp.unrest ? ' · unrest (-25% output)' : ''}</span>
            </div>
            <div class="singleJobs">
              {#each ['farmers', 'workers', 'scientists'] as const as job (job)}
                <div
                  class="singleJobCell jobs"
                  role="group"
                  class:dropping={dragOver === job}
                  ondragover={(e) => {
                    if (drag && (job !== 'farmers' || row.farmable)) {
                      e.preventDefault();
                      dragOver = job;
                    }
                  }}
                  ondragleave={() => {
                    if (dragOver === job) dragOver = null;
                  }}
                  ondrop={(e) => {
                    e.preventDefault();
                    onDrop(row, job);
                  }}
                >
                  <div class="jobExplainHead" title={job === 'farmers' ? 'Produce food.' : job === 'workers' ? 'Generate production.' : 'Contribute research.'}>
                    {job === 'farmers' ? '🌱 Farmers' : job === 'workers' ? '⚒ Workers' : '⚗ Scientists'}
                  </div>
                  <CitizenStack
                    rowId={row.id}
                    {job}
                    farmable={row.farmable}
                    count={grp[job]}
                    groups={[grp]}
                    playerId={session().playerId}
                    title={`${grp[job]} ${job} for ${grp.raceName}`}
                    {overlapPx}
                    isPicked={(j, race, i) => isPicked(row, j, race, i)}
                    onPick={(j, race, i) => pickFrom(row, j, race, i)}
                    onDragStart={(j, race, i, ev) => onDragStart(row, j, race, i, ev)}
                  />
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </ColonyPanel>
    </section>

    <section class="singleGrid">
      <ColonyPanel title="Build queue">
        <div class="fieldRow">
          <select
            data-testid="build-{row.id}"
            value={row.activeItem ?? ''}
            title={row.activeItem ? `${label(row.activeItem)} — ${describeItem(row.activeItem)}` : 'Choose what this colony should build next.'}
            onchange={(e) => setBuild(row, (e.target as HTMLSelectElement).value)}
          >
            <option value="" disabled>— build —</option>
            {#if row.activeItem && !row.buildable.includes(row.activeItem)}
              <option value={row.activeItem}>{label(row.activeItem)}</option>
            {/if}
            {#each row.queue.slice(1).filter((q) => !row.buildable.includes(q)) as q, qi (qi)}
              <option value={q}>{label(q)} (queued)</option>
            {/each}
            {#each row.buildable as item (item)}
              <option value={item} title={describeItem(item)}>{label(item)}</option>
            {/each}
          </select>
          {#if row.buyPrice !== null}
            <button data-testid="buy-{row.id}" disabled={!row.canBuy} title="Rush buy: spend BC to finish the remaining production immediately." onclick={() => buy(row)}>{row.buyPrice} BC</button>
          {/if}
        </div>

        <div class="progressLine" data-testid="progress-{row.id}">
          {#if row.activeItem === 'housing' || row.activeItem === 'trade_goods'}
            <strong title="This project converts production every turn.">∞</strong>
          {:else if row.activeItem}
            <span class="cellbar" title="{row.storedProd}/{row.activeCost}">
              <span class="cellfill" style="width:{row.activeCost > 0 ? Math.min(100, Math.floor((row.storedProd * 100) / row.activeCost)) : 0}%"></span>
            </span>
            <span>{row.storedProd}/{row.activeCost}{row.turnsLeft !== null ? ` (${row.turnsLeft}t)` : ''}</span>
          {:else}
            <span class="dim">idle</span>
          {/if}
          {#if stickyMode && parked(row)}
            <span class="parked" title="sticky build: production parked on switched-away items" data-testid="parked-{row.id}">⏸ {parked(row)}</span>
          {/if}
        </div>

        <div class="queueList">
          {#each row.queue.slice(1) as q, qi (qi)}
            <button
              class="queuechip"
              data-testid="queued-{row.id}-{qi + 1}"
              title="{label(q)} — click ✕ to remove, or pick it in the build select to build it now"
              onclick={() => removeQueued(row, qi + 1)}
            >{label(q)} ✕</button>
          {/each}
          <select
            data-testid="queue-add-{row.id}"
            value=""
            title="queue another item after the active build"
            onchange={(e) => { appendBuild(row, (e.target as HTMLSelectElement).value); (e.target as HTMLSelectElement).value = ''; }}
          >
            <option value="">+ queue</option>
            {#each row.buildable as item (item)}
              <option value={item} title={describeItem(item)}>{label(item)}</option>
            {/each}
          </select>
        </div>
      </ColonyPanel>

      <ColonyPanel title="Buildings">
        <p class="fieldHelp">Built structures on this colony. Selling refunds half the original cost, once per turn.</p>
        <div class="chips">
          {#each row.sellables as s (s.id)}
            <span class="chip singleChip">
              <strong>{pretty(s.id)}</strong>
              <small>{s.refund > 0 ? `${s.refund} BC refund` : 'cannot be sold for BC'}</small>
              <button class="mini sellbtn" disabled={!row.canSell || s.refund <= 0} data-testid="sell-{row.id}-{s.id}" onclick={() => sell(row, s.id)}>sell</button>
            </span>
          {/each}
          {#if !row.sellables.length}<span class="dim">No buildings completed yet.</span>{/if}
          {#if !row.canSell}<span class="dim">One sale per colony per turn — already used here this turn.</span>{/if}
        </div>
      </ColonyPanel>
    </section>
      </div>
    {:else}
      <div class="panelBox dim" data-testid="single-colony-missing">
        This colony is no longer available.
        <button class="mini" data-testid="close-colony-modal" onclick={() => onClose?.()}>Close</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(3, 6, 15, 0.7);
    display: grid;
    place-items: center;
    padding: 1rem;
    z-index: 25;
  }
  .modalBody {
    width: min(96vw, 1400px);
    max-height: 90vh;
    overflow: auto;
    background: #07111f;
    border: 1px solid #45516b;
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.45);
    padding: 0.8rem;
  }
  .panelBox {
    border: 1px solid var(--line);
    background: var(--panel-2);
    padding: 0.6rem;
  }
  .singleColony {
    display: grid;
    gap: 0.45rem;
  }
  .colonyTitleRow {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .singleTitle {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
  }
  .popLine {
    margin-left: auto;
    font-size: 0.82rem;
    font-weight: 400;
    color: var(--text-dim);
    white-space: nowrap;
  }
  .popLine small {
    font-size: 0.78rem;
  }
  .fieldHelp {
    color: var(--text-dim);
    font-size: 0.72rem;
    line-height: 1.22;
  }
  .singleGrid {
    display: grid;
    gap: 0.5rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .topRow {
    display: grid;
    gap: 0.5rem;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.3fr);
    align-items: start;
  }
  .sysPlanets {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.1rem;
    max-height: 12rem;
    overflow-y: auto;
  }
  .sysPlanets li {
    border-radius: 4px;
  }
  .sysPlanets li:hover {
    background: rgba(110, 168, 255, 0.12);
  }
  .sysPlanetBtn,
  .sysPlanetLabel {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    padding: 0.2rem 0.3rem;
    font-size: 0.78rem;
    text-align: left;
  }
  .sysPlanetBtn {
    appearance: none;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
  }
  .sysPlanetLabel {
    color: var(--text-dim);
  }
  li.current .sysPlanetLabel,
  li.current .sysPlanetBtn {
    background: var(--panel-3);
    border: 1px solid var(--line);
    color: var(--text);
  }
  .sysPlanetText {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sysColonyName {
    color: var(--accent);
  }
  .orbit {
    display: inline-block;
    width: 1.2rem;
    height: 1.2rem;
    line-height: 1.2rem;
    text-align: center;
    background: var(--panel-3);
    border-radius: 50%;
    font-size: 0.7rem;
    color: var(--accent-soft);
    flex: 0 0 auto;
  }
  .statStrip {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .statItem {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    background: var(--panel-3);
    border: 1px solid var(--line);
    padding: 0.25rem 0.5rem;
  }
  .statIcon {
    font-size: 0.9rem;
  }
  .statItem strong {
    font-size: 0.92rem;
  }
  .fieldRow {
    display: flex;
    gap: 0.35rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .progressLine {
    display: flex;
    gap: 0.3rem;
    align-items: center;
    flex-wrap: wrap;
    margin-top: 0.3rem;
    font-size: 0.82rem;
  }
  .queueList {
    display: flex;
    gap: 0.22rem;
    flex-wrap: wrap;
    align-items: center;
    margin-top: 0.3rem;
  }
  .singleJobs {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.4rem;
  }
  .jobExplainHead {
    font-weight: 600;
    margin-bottom: 0.08rem;
    font-size: 0.82rem;
  }
  .groupBlock {
    margin-top: 0.4rem;
    padding-top: 0.4rem;
    border-top: 1px solid var(--line);
  }
  .groupBlock:first-of-type {
    margin-top: 0;
    padding-top: 0;
    border-top: none;
  }
  .groupHead {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    flex-wrap: wrap;
    margin-bottom: 0.3rem;
  }
  .singleJobCell {
    display: grid;
    gap: 0.22rem;
    background: var(--panel-3);
    border: 1px solid var(--line);
    padding: 0.34rem;
    min-height: 3rem;
    align-content: start;
  }
  .singleChip {
    display: inline-grid;
    gap: 0.2rem;
    align-items: start;
  }
  .jobs {
    white-space: nowrap;
  }
  .jobs.dropping {
    background: rgba(94, 224, 138, 0.18);
    outline: 1px dashed var(--good);
  }
  .queuechip {
    font-size: 0.72rem;
    padding: 0 0.24rem;
    margin-right: 0.08rem;
    background: var(--panel-3);
    border: 1px solid var(--line);
    border-radius: 8px;
    opacity: 0.85;
  }
  .queuechip:hover {
    border-color: var(--bad);
  }
  .cellbar {
    display: inline-block;
    vertical-align: middle;
    width: 3.2rem;
    height: 0.4rem;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 3px;
    overflow: hidden;
    margin-right: 0.3rem;
  }
  .cellfill {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, #24418a, var(--accent));
  }
  .parked {
    display: block;
    color: var(--gold);
    font-size: 0.75rem;
  }
  .dim {
    opacity: 0.65;
  }
  .neg {
    color: var(--bad);
  }

  @media (max-width: 980px) {
    .singleGrid,
    .topRow,
    .singleJobs {
      grid-template-columns: 1fr;
    }
  }
</style>
