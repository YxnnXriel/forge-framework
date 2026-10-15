import { defineConfig, z } from "forge";

export default defineConfig({
  api: {},
  server: { port: 3000 },
  env: {
    private: {
      APP_NAME: z.string().default("Forge api-only"),
    },
  },
});
