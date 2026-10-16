import { defineConfig } from "forge";

export default defineConfig({
  api: {},
  web: { lang: "fr" },
  db: { provider: "sqlite" },
  server: { port: 3000 },
});
