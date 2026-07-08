<script lang="ts">
  import { ENGINE_VERSION } from '@engine/index';
</script>

<main>
  <h1>MOO2v2</h1>
  <p data-testid="engine-version">engine v{ENGINE_VERSION}</p>
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
