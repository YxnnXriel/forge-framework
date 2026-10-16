<script lang="ts">
  let { children } = $props();
</script>

<section class="dashboard">
  <aside>Dashboard</aside>
  <div>{@render children()}</div>
</section>

<style>
  .dashboard {
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: 1.5rem;
  }
  aside {
    font-weight: 600;
    color: #6d4bd8;
  }
</style>
