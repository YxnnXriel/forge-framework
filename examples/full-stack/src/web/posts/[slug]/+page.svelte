<script lang="ts">
  import { forge } from "forge:router";
  import { page } from "forge:web";

  const post = await forge.posts.detail({ slug: page.params.slug ?? "" });
  let likes = $state(post.likes);

  async function like() {
    ({ likes } = await forge.posts.like({ slug: post.slug }));
  }
</script>

<svelte:head><title>{post.title}</title></svelte:head>

<article>
  <h1>{post.title}</h1>
  <p class="meta">
    par {post.author.name} ·
    <!-- createdAt is a real Date in the browser too (devalue) -->
    <time datetime={post.createdAt.toISOString()}>{post.createdAt.toLocaleDateString("fr-FR")}</time>
  </p>
  {#if post.tags.length}
    <p class="tags">{#each post.tags as tag (tag.label)}<span>#{tag.label}</span> {/each}</p>
  {/if}
  <p>{post.body}</p>
  <button class="like" onclick={like}>♥ {likes}</button>
</article>

<p><a href="/posts">← Retour</a></p>
