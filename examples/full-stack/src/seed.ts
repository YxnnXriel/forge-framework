import type { App } from "forge";

/** Demo data. Idempotent: does nothing when posts already exist. */
export async function seed(deps: App["deps"]): Promise<void> {
  const db = deps.db!;
  if ((await db.post.count()) > 0) return;
  // Users are created through Better Auth (hashed password, account row).
  const { user } = await deps.auth!.api.signUpEmail({
    body: { email: "ariel@example.com", password: "forge-demo-password", name: "Ariel" },
  });
  const posts = [
    { slug: "bienvenue-sur-forge", title: "Bienvenue sur Forge", body: "SSR, hydratation et appels distants.", likes: 3, createdAt: new Date("2026-10-01T10:00:00Z"), tags: ["forge", "svelte"] },
    { slug: "layouts-imbriques", title: "Layouts imbriqués", body: "Le layout racine reste monté pendant la navigation.", likes: 1, createdAt: new Date("2026-10-10T10:00:00Z"), tags: ["svelte"] },
    { slug: "brouillon", title: "Brouillon", body: "Invisible dans la liste.", likes: 0, createdAt: new Date("2026-10-12T10:00:00Z"), published: false, tags: [] },
  ];
  for (const { tags, ...data } of posts) {
    await db.post.create({
      data: {
        ...data,
        author: { connect: { id: user.id } },
        tags: { connectOrCreate: tags.map((label) => ({ where: { label }, create: { label } })) },
      },
    });
  }
}

if (import.meta.main) {
  const { createApp } = await import("forge");
  const { deps } = await createApp({ root: `${import.meta.dir}/..` });
  await seed(deps);
  console.log("Seed done.");
}
