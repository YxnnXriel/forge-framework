<script lang="ts">
  import type { Component } from "svelte";
  import Self from "./Node.svelte";

  let { components, index, pageKey }: { components: Component<any>[]; index: number; pageKey: string } = $props();
  const Current = $derived(components[index]!);
  const isPage = $derived(index === components.length - 1);
</script>

{#if isPage}
  <!-- Layouts persist across navigations; the page is re-created for each URL. -->
  {#key pageKey}
    <Current />
  {/key}
{:else}
  <Current>
    <Self {components} index={index + 1} {pageKey} />
  </Current>
{/if}
