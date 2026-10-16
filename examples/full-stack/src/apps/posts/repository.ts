import { defineRepository, error, z } from "forge/server";
import { PostInput, PublicPost } from "./schemas.ts";

const Id = z.object({ id: z.coerce.number().int().positive() });

export const posts = defineRepository(({ get, post }) => ({
  list: get("/", {
    output: z.array(PublicPost),
    remote: true,
    handler: ({ store }) => store.findMany({ published: true }),
  }),

  detail: get("/:id", {
    input: Id,
    output: PublicPost,
    remote: true,
    handler: ({ input, store }) => store.findUnique(input.id) ?? error(404, "Article introuvable"),
  }),

  stats: get("/stats", {
    output: z.object({ total: z.number(), likes: z.number() }),
    remote: true,
    handler: ({ store }) => {
      const all = store.findMany();
      return { total: all.length, likes: all.reduce((n, p) => n + p.likes, 0) };
    },
  }),

  like: post("/:id/like", {
    input: Id,
    output: z.object({ likes: z.number() }),
    remote: true,
    handler: ({ input, store }) => {
      const post = store.findUnique(input.id) ?? error(404, "Article introuvable");
      return { likes: store.update(post.id, { likes: post.likes + 1 })!.likes };
    },
  }),

  create: post("/", {
    input: PostInput,
    output: PublicPost,
    status: 201,
    remote: true,
    access: ({ user }) => user !== null,
    handler: ({ input, store, user }) => store.create({ ...input, authorEmail: `${user!.name}@example.com` }),
  }),

  /** HTTP only: not callable from Svelte (no `remote`). */
  purge: post("/purge", ({ store }) => {
    for (const p of store.findMany()) store.delete(p.id);
  }),
}));
