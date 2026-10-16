import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRISMA_PATHS } from "./project.ts";

export interface TestDatabase {
  /** `file:` URL of a fresh SQLite database with every migration applied. */
  url: string;
  file: string;
}

/** Migration folders (`<timestamp>_<name>/migration.sql`), oldest first. */
export async function listMigrations(root: string): Promise<string[]> {
  const dir = join(root, PRISMA_PATHS.migrations);
  if (!existsSync(dir)) return [];
  const entries = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  return entries.map((name) => join(dir, name, "migration.sql")).filter((f) => existsSync(f));
}

/**
 * Fresh SQLite database for tests, built from the project's committed
 * migrations (the same SQL production runs). Uses bun:sqlite directly:
 * no Prisma engine, nothing written in the project.
 */
export async function createTestDatabase(root: string): Promise<TestDatabase> {
  const migrations = await listMigrations(root);
  if (!migrations.length) {
    throw new Error("No migrations found: run `bun run forge db migrate --name init` first");
  }
  const file = join(await mkdtemp(join(tmpdir(), "forge-db-")), "test.db");
  const db = new Database(file, { create: true });
  db.exec("PRAGMA foreign_keys = ON;");
  for (const migration of migrations) db.exec(await Bun.file(migration).text());
  db.close();
  return { url: `file:${file}`, file };
}
