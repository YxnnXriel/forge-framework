<script lang="ts">
  import { page } from "forge:web";
</script>

<svelte:head><title>{page.status}</title></svelte:head>

<h1 class="error-status">{page.status}</h1>
<p>{page.error?.message}</p>
<p><a href="/">Retour à l'accueil</a></p>
