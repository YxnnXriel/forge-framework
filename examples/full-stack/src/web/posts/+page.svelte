<script lang="ts">
  import { forge } from "forge:router";

  const posts = await forge.posts.list();
</script>

<svelte:head><title>Articles</title></svelte:head>

<h1>Articles</h1>
<ul>
  {#each posts as post (post.id)}
    <li>
      <a href="/posts/{post.slug}">{post.title}</a>
      <small>{post.createdAt.toLocaleDateString("fr-FR")}</small>
    </li>
  {/each}
</ul>
