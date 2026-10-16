import { defineConfig } from "forge";

export default defineConfig({
  api: {},
  web: { lang: "fr" },
  db: { provider: "sqlite" },
  // Better Auth, native options (https://better-auth.com/docs).
  auth: {
    emailAndPassword: { enabled: true },
  },
  server: { port: 3000 },
});
