<script lang="ts">
  import { ENGINE_VERSION } from '@engine/index';
  import StorageSmoke from './dev/StorageSmoke.svelte';

  let route = $state(location.hash);
  window.addEventListener('hashchange', () => (route = location.hash));
</script>

<main>
  {#if route === '#storage-smoke'}
    <StorageSmoke />
  {:else}
    <h1>MOO2v2</h1>
    <p data-testid="engine-version">engine v{ENGINE_VERSION}</p>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: #0b0e1a;
    color: #d8dcf0;
    font-family: system-ui, sans-serif;
  }
  main {
    padding: 2rem;
  }
</style>
