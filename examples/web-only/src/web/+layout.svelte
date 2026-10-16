<script lang="ts">
  import { cart } from "../lib/cart.svelte.ts";
  let { children } = $props();
</script>

<header>
  <a href="/">Accueil</a>
  <a href="/about">À propos</a>
  <a href="/blog/bonjour-forge">Blog</a>
  <span class="cart">Panier : {cart.count}</span>
</header>
<main>{@render children()}</main>

<style>
  header {
    display: flex;
    gap: 1rem;
    padding: 1rem;
    border-bottom: 2px solid #6d4bd8;
  }
  .cart {
    margin-left: auto;
  }
  main {
    padding: 1rem;
  }
</style>
