import { existsSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "forge";
import { createTestDatabase, listMigrations } from "forge/testing";
import { demoUser } from "../src/deps.ts";
import { seed } from "../src/seed.ts";

export const root = join(import.meta.dir, "..");

/** Needs the generated client and at least one migration (`forge db migrate`). */
export const dbReady = existsSync(join(root, "generated/prisma/client.ts")) && (await listMigrations(root)).length > 0;
if (!dbReady) {
  console.warn("[full-stack] database tests skipped: run `bun run forge db migrate --name init` in examples/full-stack");
}

/** App on a fresh, migrated and seeded SQLite database. */
export async function freshApp() {
  const { url } = await createTestDatabase(root);
  Bun.env.DATABASE_URL = url;
  const built = await createApp({ root, deps: { user: null }, requestDeps: demoUser, onUnexpectedError: () => {} });
  await seed(built.deps.db!);
  return built;
}
