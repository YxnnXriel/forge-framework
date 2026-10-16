<script lang="ts">
  import { forge } from "forge:router";
  import { RemoteError } from "forge/web";

  let title = $state("");
  let message = $state("");

  async function create(event: SubmitEvent) {
    event.preventDefault();
    try {
      const post = await forge.posts.create({ title });
      message = `Créé : #${post.id}`;
      title = "";
    } catch (e) {
      message = e instanceof RemoteError ? `Erreur ${e.status} : ${e.message}` : "Erreur inattendue";
    }
  }
</script>

<svelte:head><title>Dashboard</title></svelte:head>

<h1>Nouvel article</h1>
<form onsubmit={create}>
  <input name="title" bind:value={title} placeholder="Titre" />
  <button type="submit">Créer</button>
</form>
<p class="message">{message}</p>
