import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  PRISMA_PATHS,
  deployMigrations,
  migrationName,
  readMigrations,
  runPrisma,
  schemaStatus,
  syncSchema,
} from "@forge/models";
import { listMigrations } from "@forge/models/testing";
import { databaseUrl } from "../db-url.ts";
import { dbConfig, extraModels, type DbConfig, type Out } from "../util.ts";

/** Environment for Prisma: .env is loaded by Bun; SQLite paths made absolute. */
function prismaEnv(root: string, config: DbConfig) {
  const url = Bun.env.DATABASE_URL;
  return url ? { DATABASE_URL: databaseUrl(root, config.db.provider, url) } : {};
}

async function prisma(root: string, args: string[], env: Record<string, string>, out: Out): Promise<number> {
  const { code } = await runPrisma(root, args, { env, inherit: true });
  if (code !== 0) out.error(`prisma ${args.join(" ")} failed (exit ${code})`);
  return code;
}

/** Models -> schema, then Prisma Client. `ifNeeded`: skip the client when nothing changed. */
export async function generate(root: string, out: Out, options: { ifNeeded?: boolean } = {}): Promise<number> {
  const config = await dbConfig(root);
  const result = await syncSchema(root, config.apps, config.db.provider, await extraModels(config));
  if (options.ifNeeded && !result.written.length && existsSync(join(root, PRISMA_PATHS.client))) return 0;
  out.log(`Models: ${result.models.join(", ") || "(none)"}`);
  for (const file of result.written) out.log(`  wrote ${file}`);
  if (!result.written.length) out.log("  schema already up to date");
  return prisma(root, ["generate"], prismaEnv(root, config), out);
}

export async function db(root: string, command: string | undefined, values: { name?: string }, out: Out): Promise<number> {
  switch (command) {
    case "generate":
      return generate(root, out);
    case "migrate": {
      const code = await generate(root, out);
      if (code !== 0) return code;
      const config = await dbConfig(root);
      const snapshotFile = join(root, PRISMA_PATHS.snapshot);
      const current = await Bun.file(join(root, PRISMA_PATHS.generatedSchema)).text();
      const previous = existsSync(snapshotFile) ? await Bun.file(snapshotFile).text() : null;
      const first = (await listMigrations(root)).length === 0;
      const name = values.name ?? migrationName(previous, current, first);
      out.log(`Migration: ${name}`);
      const result = await prisma(root, ["migrate", "dev", "--name", name], prismaEnv(root, config), out);
      if (result === 0) await Bun.write(snapshotFile, current);
      return result;
    }
    case "deploy": {
      // Bun's own drivers: no Prisma engine needed in CI or production.
      const config = await dbConfig(root);
      const url = Bun.env.DATABASE_URL;
      if (!url) {
        out.error("DATABASE_URL is not set");
        return 1;
      }
      const migrations = await readMigrations(root);
      const result = await deployMigrations(config.db.provider, databaseUrl(root, config.db.provider, url), migrations);
      for (const w of result.warnings) out.error(`warning: ${w}`);
      out.log(result.applied.length ? `Applied: ${result.applied.join(", ")}` : `No pending migration (${migrations.length} total)`);
      return 0;
    }
    case "status": {
      const config = await dbConfig(root);
      const status = await schemaStatus(root, config.apps, config.db.provider, await extraModels(config));
      out.log(`Schema: ${status}${status === "in-sync" ? "" : " (run `forge db generate`)"}`);
      return prisma(root, ["migrate", "status"], prismaEnv(root, config), out);
    }
    default:
      out.error(`Unknown command: forge db ${command ?? ""}`);
      return 1;
  }
}
