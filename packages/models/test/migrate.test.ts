import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deployMigrations, type Migration } from "../src/migrate.ts";

const initial: Migration = { name: "20260101000000_initial", sql: `CREATE TABLE "Post" ("id" TEXT NOT NULL PRIMARY KEY, "title" TEXT NOT NULL);` };
const body: Migration = { name: "20260102000000_post_body", sql: `ALTER TABLE "Post" ADD COLUMN "body" TEXT;` };

async function database() {
  const file = join(await mkdtemp(join(tmpdir(), "forge-migrate-")), "app.db");
  return { file, url: `file:${file}` };
}

describe("deployMigrations (SQLite, Prisma's bookkeeping)", () => {
  test("applies pending migrations once, in order", async () => {
    const { file, url } = await database();
    expect((await deployMigrations("sqlite", url, [initial])).applied).toEqual([initial.name]);
    expect((await deployMigrations("sqlite", url, [initial, body])).applied).toEqual([body.name]);
    expect((await deployMigrations("sqlite", url, [initial, body])).applied).toEqual([]);

    const db = new Database(file);
    const rows = db.query(`SELECT migration_name, checksum, finished_at, applied_steps_count FROM _prisma_migrations ORDER BY started_at`).all() as any[];
    expect(rows.map((r) => r.migration_name)).toEqual([initial.name, body.name]);
    // sha256 of the file, timestamps in epoch ms: what Prisma's SQLite connector writes.
    expect(rows[0].checksum).toBe(new Bun.CryptoHasher("sha256").update(initial.sql).digest("hex"));
    expect(typeof rows[0].finished_at).toBe("number");
    expect(rows[0].applied_steps_count).toBe(1);
    expect(db.query(`SELECT name FROM pragma_table_info('Post')`).all().map((r: any) => r.name)).toEqual(["id", "title", "body"]);
    db.close();
  });

  test("warns about edited or unknown migrations", async () => {
    const { url } = await database();
    await deployMigrations("sqlite", url, [initial, body]);
    const result = await deployMigrations("sqlite", url, [{ ...initial, sql: initial.sql + "\n" }]);
    expect(result.applied).toEqual([]);
    expect(result.warnings.join("\n")).toContain(`"${initial.name}" was modified`);
    expect(result.warnings.join("\n")).toContain(`"${body.name}" is applied in the database but missing locally`);
  });

  test("a failed migration is recorded and blocks the next deploys", async () => {
    const { url } = await database();
    const bad: Migration = { name: "20260103000000_bad", sql: `ALTER TABLE "Nope" ADD COLUMN "x" INTEGER;` };
    expect(deployMigrations("sqlite", url, [initial, bad])).rejects.toThrow(`Migration "${bad.name}" failed`);
    await Bun.sleep(10);
    expect(deployMigrations("sqlite", url, [initial, body])).rejects.toThrow("failed earlier and blocks");
  });
});
