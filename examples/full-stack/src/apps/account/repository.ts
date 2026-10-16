import { defineRepository, z } from "forge/server";

const Me = z.object({ name: z.string(), email: z.string() }).nullable();

export const account = defineRepository(({ get }) => ({
  /** Current user for the pages (only public fields leave the server). */
  me: get("/me", {
    output: Me,
    remote: true,
    handler: async ({ session }) => {
      const current = await session();
      return current ? { name: current.user.name, email: current.user.email } : null;
    },
  }),
}));
