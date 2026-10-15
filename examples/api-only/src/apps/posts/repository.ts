import { defineRepository, error, z } from "forge/server";
import { PostInput, PostPatch, PublicPost } from "./schemas.ts";

const Id = z.object({ id: z.coerce.number().int().positive() });

/** 3. defineRepository: every endpoint of the domain, still callable in-process. */
export const posts = defineRepository(({ get, post, put, del }) => ({
  list: get("/", {
    input: z.object({ published: z.stringbool().optional() }),
    output: z.array(PublicPost),
    handler: ({ input, store }) => store.findMany(input.published === undefined ? {} : { published: input.published }),
  }),

  detail: get("/:id", {
    input: Id,
    output: PublicPost,
    handler: ({ input, store }) => store.findUnique(input.id) ?? error(404, "Post not found"),
  }),

  create: post("/", {
    input: PostInput,
    output: PublicPost,
    status: 201,
    handler: ({ input, store }) => store.create({ ...input, authorEmail: "author@example.com" }),
  }),

  update: put("/:id", {
    input: Id.extend(PostPatch.shape),
    output: PublicPost,
    handler: ({ input: { id, ...data }, store }) => store.update(id, data) ?? error(404, "Post not found"),
  }),

  remove: del("/:id", {
    input: Id,
    handler: ({ input, store }) => {
      if (!store.delete(input.id)) error(404, "Post not found");
    },
  }),
}));
