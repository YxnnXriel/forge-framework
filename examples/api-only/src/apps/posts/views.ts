import { defineView, z } from "forge/server";

/** 2. defineView: a structured endpoint, mounted in urls.ts. */
export const stats = defineView({
  deps: ["store"],
  output: z.object({ total: z.number(), published: z.number() }),
  meta: { summary: "Post counters" },
  handler: ({ store }) => ({
    total: store.findMany().length,
    published: store.findMany({ published: true }).length,
  }),
});
