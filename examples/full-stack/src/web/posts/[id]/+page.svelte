<script lang="ts">
  import { forge } from "forge:router";
  import { page } from "forge:web";

  const post = await forge.posts.detail({ id: page.params.id });
  let likes = $state(post.likes);

  async function like() {
    ({ likes } = await forge.posts.like({ id: post.id }));
  }
</script>

<svelte:head><title>{post.title}</title></svelte:head>

<article>
  <h1>{post.title}</h1>
  <!-- createdAt is a real Date in the browser too (devalue) -->
  <time datetime={post.createdAt.toISOString()}>{post.createdAt.toLocaleDateString("fr-FR")}</time>
  <p>{post.body}</p>
  <button class="like" onclick={like}>♥ {likes}</button>
</article>

<p><a href="/posts">← Retour</a></p>
