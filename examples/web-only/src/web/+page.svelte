<script lang="ts">
  import { cart } from "../lib/cart.svelte.ts";
</script>

<svelte:head><title>Web only</title></svelte:head>

<h1>Forge web-only</h1>
<button class="add" onclick={() => cart.add("livre")}>Ajouter au panier</button>
