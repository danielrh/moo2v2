<script lang="ts">
  // Small DOM preview of a procedural pixel ship (no pixi): used by the
  // Designer's fleet-style picker / model selector and the Battle Lab.
  import { getShipModel, variantsFor, wrapVariant, type ArtClass } from './shipart';
  import { paletteFor, renderModelToCanvas } from './shiptex';

  const {
    style,
    cls,
    variant = 0,
    color = '#4da3ff',
    specials = [],
    heavyBeams = false,
    missileTubes = 0,
    px = 3,
    title = '',
  }: {
    style: string;
    cls: ArtClass;
    variant?: number;
    color?: string;
    specials?: string[];
    heavyBeams?: boolean;
    missileTubes?: number;
    px?: number;
    title?: string;
  } = $props();

  let host: HTMLSpanElement | undefined = $state();

  $effect(() => {
    if (!host) return;
    const model = getShipModel({
      style,
      cls,
      variant: wrapVariant(cls, variant),
      specials: [...specials],
      heavyBeams,
      missileTubes,
    });
    const canvas = renderModelToCanvas(model, paletteFor(style, color), px);
    canvas.style.imageRendering = 'pixelated';
    canvas.title = title || `${style} ${cls} — model ${wrapVariant(cls, variant) + 1}/${variantsFor(cls)}`;
    host.replaceChildren(canvas);
  });
</script>

<span class="preview" bind:this={host}></span>

<style>
  .preview {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
</style>
