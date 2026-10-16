import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ForgeError } from "@forge/core";
import { PRISMA_PATHS } from "./project.ts";
import type { Provider } from "./schema.ts";

/**
 * `forge db deploy`, without the Prisma CLI: applies the committed migrations
 * with Bun's own drivers (Bun.SQL, bun:sqlite). Production images then need
 * no Prisma engine and no node_modules. Bookkeeping uses Prisma's
 * `_prisma_migrations` table, so `prisma migrate dev/status` keep working on
 * the same database.
 */

export interface Migration {
  /** Folder name (`<timestamp>_<name>`). */
  name: string;
  sql: string;
}

export interface DeployResult {
  applied: string[];
  warnings: string[];
}

/** Prisma's advisory lock id for migrations (same value: never run concurrently with it). */
const LOCK_ID = 72707369;

export async function readMigrations(root: string): Promise<Migration[]> {
  const dir = join(root, PRISMA_PATHS.migrations);
  if (!existsSync(dir)) return [];
  const names = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const out: Migration[] = [];
  for (const name of names) {
    const file = Bun.file(join(dir, name, "migration.sql"));
    if (await file.exists()) out.push({ name, sql: await file.text() });
  }
  return out;
}

const checksum = (sql: string) => new Bun.CryptoHasher("sha256").update(sql).digest("hex");

interface Row {
  migration_name: string;
  checksum: string;
  finished_at: unknown;
  rolled_back_at: unknown;
}

/** Decides what to apply, Prisma's way. Throws on a failed migration. */
function plan(migrations: readonly Migration[], rows: readonly Row[]) {
  const warnings: string[] = [];
  const failed = rows.find((r) => r.finished_at == null && r.rolled_back_at == null);
  if (failed) {
    throw new ForgeError(
      "FORGE_MIGRATION_FAILED",
      `Migration "${failed.migration_name}" failed earlier and blocks the next ones. Fix the database, then mark it with ` +
        "`prisma migrate resolve --applied|--rolled-back`.",
    );
  }
  const applied = new Map(rows.filter((r) => r.rolled_back_at == null).map((r) => [r.migration_name, r]));
  const local = new Set(migrations.map((m) => m.name));
  for (const name of applied.keys()) {
    if (!local.has(name)) warnings.push(`migration "${name}" is applied in the database but missing locally`);
  }
  const pending: Migration[] = [];
  for (const m of migrations) {
    const row = applied.get(m.name);
    if (!row) pending.push(m);
    else if (row.checksum !== checksum(m.sql)) warnings.push(`migration "${m.name}" was modified after being applied`);
  }
  return { pending, warnings };
}

async function deploySqlite(path: string, migrations: readonly Migration[]): Promise<DeployResult> {
  const db = new Database(path, { create: true });
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
)`);
    const rows = db.query(`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"`).all() as Row[];
    const { pending, warnings } = plan(migrations, rows);
    const applied: string[] = [];
    for (const m of pending) {
      const id = crypto.randomUUID();
      // Timestamps as epoch milliseconds, like Prisma's SQLite connector.
      db.query(`INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, applied_steps_count) VALUES (?, ?, ?, ?, 0)`).run(
        id,
        checksum(m.sql),
        m.name,
        Date.now(),
      );
      try {
        // Not wrapped in a transaction, like Prisma (scripts manage PRAGMAs themselves).
        db.exec(m.sql);
      } catch (err) {
        db.query(`UPDATE "_prisma_migrations" SET logs = ? WHERE id = ?`).run(String(err), id);
        throw new ForgeError("FORGE_MIGRATION_FAILED", `Migration "${m.name}" failed: ${(err as Error).message}`);
      }
      db.query(`UPDATE "_prisma_migrations" SET finished_at = ?, applied_steps_count = 1 WHERE id = ?`).run(Date.now(), id);
      applied.push(m.name);
    }
    return { applied, warnings };
  } finally {
    db.close();
  }
}

async function deployPostgres(url: string, migrations: readonly Migration[]): Promise<DeployResult> {
  const pool = new Bun.SQL(url);
  // One dedicated connection: the advisory lock belongs to a session.
  const sql = await pool.reserve();
  try {
    await sql`SELECT pg_advisory_lock(${LOCK_ID})`;
    try {
      await sql.unsafe(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum"              VARCHAR(64) NOT NULL,
    "finished_at"           TIMESTAMPTZ,
    "migration_name"        VARCHAR(255) NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        TIMESTAMPTZ,
    "started_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count"   INTEGER NOT NULL DEFAULT 0
)`);
      const rows = (await sql`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"`) as Row[];
      const { pending, warnings } = plan(migrations, rows);
      const applied: string[] = [];
      for (const m of pending) {
        const id = crypto.randomUUID();
        await sql`INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, applied_steps_count) VALUES (${id}, ${checksum(m.sql)}, ${m.name}, now(), 0)`;
        try {
          await sql.unsafe(m.sql);
        } catch (err) {
          await sql`UPDATE "_prisma_migrations" SET logs = ${String(err)} WHERE id = ${id}`;
          throw new ForgeError("FORGE_MIGRATION_FAILED", `Migration "${m.name}" failed: ${(err as Error).message}`);
        }
        await sql`UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE id = ${id}`;
        applied.push(m.name);
      }
      return { applied, warnings };
    } finally {
      await sql`SELECT pg_advisory_unlock(${LOCK_ID})`.catch(() => {});
    }
  } finally {
    sql.release();
    await pool.close();
  }
}

/** Applies pending migrations. `url`: absolute `file:` URL (SQLite) or a postgres URL. */
export function deployMigrations(provider: Provider, url: string, migrations: readonly Migration[]): Promise<DeployResult> {
  if (provider === "sqlite") {
    if (!url.startsWith("file:")) throw new ForgeError("FORGE_DB_URL", "SQLite DATABASE_URL must start with file:");
    return deploySqlite(url.slice("file:".length), migrations);
  }
  return deployPostgres(url, migrations);
}
