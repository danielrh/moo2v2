<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    title: string;
    children: Snippet;
  };

  let { title, children }: Props = $props();
</script>

<section class="panelBox">
  <h3>{title}</h3>
  {@render children()}
</section>

<style>
  .panelBox {
    border: 1px solid var(--line);
    background: var(--panel-2);
    padding: 0.45rem 0.55rem;
  }
  .panelBox h3 {
    margin: 0 0 0.25rem;
    font-size: 0.88rem;
  }
</style>
