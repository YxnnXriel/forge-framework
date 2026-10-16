<script lang="ts">
  let { status, message }: { status: number; message: string } = $props();
</script>

<svelte:head><title>{status}</title></svelte:head>
<main style="font-family: system-ui, sans-serif; padding: 3rem 1rem; text-align: center">
  <h1 style="font-size: 3rem; margin: 0">{status}</h1>
  <p>{message}</p>
</main>
