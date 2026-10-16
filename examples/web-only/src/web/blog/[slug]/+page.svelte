<script lang="ts">
  import { page } from "forge:web";

  const title = $derived((page.params.slug ?? "").replaceAll("-", " "));
</script>

<svelte:head><title>{title}</title></svelte:head>

<h1>{title}</h1>
<p>Route : <code>{page.route}</code></p>
