<script lang="ts">
  import { forge } from "forge:router";
  import { RemoteError } from "forge/web";
  import { authClient } from "../../lib/auth-client.ts";

  const me = await forge.account.me();

  let email = $state("");
  let password = $state("");
  let name = $state("");
  let title = $state("");
  let message = $state("");

  // Session changes (sign in/up/out) reload the page: layouts re-read the user.
  const reload = () => location.assign(location.href);

  async function signUp(event: SubmitEvent) {
    event.preventDefault();
    const { error } = await authClient().signUp.email({ email, password, name });
    if (error) message = error.message ?? "Inscription impossible";
    else reload();
  }

  async function signIn() {
    const { error } = await authClient().signIn.email({ email, password });
    if (error) message = error.message ?? "Connexion impossible";
    else reload();
  }

  async function signOut() {
    await authClient().signOut();
    reload();
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    try {
      const post = await forge.posts.create({ title });
      message = `Créé : ${post.slug}`;
      title = "";
    } catch (e) {
      message = e instanceof RemoteError ? `Erreur ${e.status} : ${e.message}` : "Erreur inattendue";
    }
  }
</script>

<svelte:head><title>Dashboard</title></svelte:head>

{#if me}
  <h1>Bonjour {me.name}</h1>
  <form class="create" onsubmit={create}>
    <input name="title" bind:value={title} placeholder="Titre" />
    <button type="submit">Créer</button>
  </form>
  <button class="sign-out" onclick={signOut}>Se déconnecter</button>
{:else}
  <h1>Connexion</h1>
  <form class="auth" onsubmit={signUp}>
    <input name="name" bind:value={name} placeholder="Nom (inscription)" />
    <input name="email" type="email" bind:value={email} placeholder="Email" required />
    <input name="password" type="password" bind:value={password} placeholder="Mot de passe" required />
    <button type="submit" class="sign-up">Créer un compte</button>
    <button type="button" class="sign-in" onclick={signIn}>Se connecter</button>
  </form>
{/if}
<p class="message">{message}</p>
