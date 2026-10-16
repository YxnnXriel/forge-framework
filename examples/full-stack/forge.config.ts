import { defineConfig, z } from "forge";

export default defineConfig({
  api: {},
  web: { lang: "fr" },
  server: { port: 3000 },
  env: {
    private: {
      DEMO_ADMIN: z.string().default("ariel"),
    },
  },
});
