<script lang="ts">
  import { forge } from "forge:router";

  const stats = await forge.posts.stats();
</script>

<svelte:head><title>Forge — accueil</title></svelte:head>

<h1>Forge full-stack</h1>
<p class="stats">{stats.total} articles · {stats.likes} likes</p>
<p><a href="/posts">Voir les articles →</a></p>
