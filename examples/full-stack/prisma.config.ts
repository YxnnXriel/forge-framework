// Prisma CLI configuration, created by Forge. You own this file.
// Prefer `bun run forge db <command>`: it loads .env and keeps the schema in sync.
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema",
  migrations: { path: "prisma/schema/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
