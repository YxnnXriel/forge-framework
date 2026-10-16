import { defineRepository, error, z } from "forge/server";
import { PostInput, PublicPost, slugify } from "./schemas.ts";

const Slug = z.object({ slug: z.string().min(1) });
/** Prisma `include` shared by every query returning a public post. */
const withRelations = { author: { select: { name: true } }, tags: { select: { label: true } } } as const;
const visible = { published: true, deletedAt: null } as const;

export const posts = defineRepository(({ get, post }) => ({
  list: get("/", {
    output: z.array(PublicPost),
    remote: true,
    handler: ({ db }) =>
      db.post.findMany({ where: visible, include: withRelations, orderBy: { createdAt: "desc" } }),
  }),

  detail: get("/:slug", {
    input: Slug,
    output: PublicPost,
    remote: true,
    handler: async ({ input, db }) =>
      (await db.post.findFirst({ where: { ...visible, slug: input.slug }, include: withRelations })) ??
      error(404, "Article introuvable"),
  }),

  stats: get("/stats", {
    output: z.object({ total: z.number(), likes: z.number() }),
    remote: true,
    handler: async ({ db }) => {
      const agg = await db.post.aggregate({ where: visible, _count: true, _sum: { likes: true } });
      return { total: agg._count, likes: agg._sum.likes ?? 0 };
    },
  }),

  like: post("/:slug/like", {
    input: Slug,
    output: z.object({ likes: z.number() }),
    remote: true,
    handler: async ({ input, db }) => {
      const found = await db.post.findFirst({ where: { ...visible, slug: input.slug }, select: { id: true } });
      if (!found) error(404, "Article introuvable");
      // Atomic increment: no read-modify-write race.
      return db.post.update({ where: { id: found.id }, data: { likes: { increment: 1 } }, select: { likes: true } });
    },
  }),

  create: post("/", {
    input: PostInput,
    output: PublicPost,
    status: 201,
    remote: true,
    access: ({ user }) => user !== null,
    handler: async ({ input, db, user }) => {
      const base = slugify(input.title) || "article";
      const taken = await db.post.count({ where: { slug: { startsWith: base } } });
      return db.$transaction(async (tx) => {
        const author = await tx.user.upsert({
          where: { email: `${user!.name}@example.com` },
          create: { email: `${user!.name}@example.com`, name: user!.name },
          update: {},
        });
        return tx.post.create({
          data: {
            title: input.title,
            body: input.body,
            slug: taken ? `${base}-${taken + 1}` : base,
            author: { connect: { id: author.id } },
            tags: { connectOrCreate: input.tags.map((label) => ({ where: { label }, create: { label } })) },
          },
          include: withRelations,
        });
      });
    },
  }),

  /** HTTP only (no `remote`): soft-deletes every post. */
  purge: post("/purge", async ({ db }) => {
    await db.post.updateMany({ data: { deletedAt: new Date() } });
  }),
}));
