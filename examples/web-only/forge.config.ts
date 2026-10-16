import { defineConfig } from "forge";

// Web only: no `api`, no database, no auth. Nothing else to configure.
export default defineConfig({
  web: { lang: "fr" },
  server: { port: 3001 },
});
