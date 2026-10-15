// Compile-time checks only (run by `bun run typecheck`).
import { z } from "zod";
import { createRouter, defineRepository, defineView, type PathParams } from "../src/index.ts";

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export type _params = Expect<Equal<PathParams<"/:id{[0-9]+}/comments/:slug?">, "id" | "slug">>;

const view = defineView({
  input: z.object({ n: z.coerce.number() }),
  output: z.object({ doubled: z.number() }),
  handler: ({ input }) => ({ doubled: input.n * 2 }),
});

const repo = defineRepository(({ get, post }) => ({
  detail: get("/:id", ({ input }) => {
    const id: string = input.id;
    return { id };
  }),
  create: post("/", view),
  helper: (x: number) => x + 1,
}));

createRouter()
  .get("/:slug", ({ input }) => input.slug.toUpperCase())
  .post("/x", { input: z.object({ a: z.string() }), handler: ({ input }) => input.a.length })
  .get("/v", view)
  .mount(repo);

defineView({
  output: z.object({ ok: z.boolean() }),
  // @ts-expect-error handler result must match the output schema
  handler: () => ({ ok: "yes" }),
});

export async function checks() {
  const d: { id: string } = await repo.detail({ id: "1" });
  const c: { doubled: number } = await repo.create({ n: "2" });
  const h: number = repo.helper(1);
  // @ts-expect-error missing required path param
  await repo.detail();
  // @ts-expect-error wrong input shape
  await view({ m: 1 });
  return [d, c, h];
}
