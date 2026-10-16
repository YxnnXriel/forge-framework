<script lang="ts">
  import { forge } from "forge:router";
  import { page } from "forge:web";
  let { children } = $props();

  // Current user (Better Auth session, read lazily on the server).
  const me = await forge.account.me();

  // Local state: survives client-side navigations (the layout is not re-created).
  let clicks = $state(0);
</script>

<svelte:head>
  <link rel="icon" href="/favicon.svg" />
</svelte:head>

<header>
  <a href="/" class="brand">Forge</a>
  <nav>
    <a href="/" aria-current={page.route === "/" ? "page" : undefined}>Accueil</a>
    <a href="/posts" aria-current={page.route.startsWith("/posts") ? "page" : undefined}>Articles</a>
    <a href="/dashboard" aria-current={page.route.startsWith("/dashboard") ? "page" : undefined}>Dashboard</a>
  </nav>
  <span class="me">{me ? me.name : "invité"}</span>
  <button class="layout-counter" onclick={() => clicks++}>layout : {clicks}</button>
</header>

<main>
  {@render children()}
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: system-ui, sans-serif;
    color: #1d1b26;
    background: #faf9fd;
  }
  header {
    display: flex;
    gap: 1.5rem;
    align-items: center;
    padding: 0.75rem 1.5rem;
    background: #2a1d4a;
    color: white;
  }
  header a {
    color: #d9ccff;
    text-decoration: none;
  }
  .brand {
    font-weight: 700;
    color: white;
  }
  nav {
    display: flex;
    gap: 1rem;
    flex: 1;
  }
  nav a[aria-current="page"] {
    color: white;
    text-decoration: underline;
  }
  .layout-counter {
    background: #6d4bd8;
    color: white;
    border: 0;
    border-radius: 6px;
    padding: 0.35rem 0.75rem;
    cursor: pointer;
  }
  main {
    max-width: 720px;
    margin: 2rem auto;
    padding: 0 1rem;
  }
</style>
