<script lang="ts">
  import type { Component } from "svelte";
  import Node from "./Node.svelte";

  /** `components`: layouts (root first) then the page. `key` changes on every navigation. */
  let { state }: {
    state: { components: Component<any>[]; key: string; onerror?: (error: unknown) => void };
  } = $props();
</script>

<svelte:boundary onerror={(error) => state.onerror?.(error)}>
  <Node components={state.components} index={0} pageKey={state.key} />
</svelte:boundary>
