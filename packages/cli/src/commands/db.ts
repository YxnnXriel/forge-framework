import { existsSync } from "node:fs";
import { join } from "node:path";
import { ForgeError } from "@forge/core/errors";
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
import { dbConfig, extraModels, refreshTypes, type DbConfig, type Out } from "../util.ts";

/** Environment for Prisma: .env is loaded by Bun; SQLite paths made absolute. */
function prismaEnv(root: string, config: DbConfig) {
  const url = Bun.env.DATABASE_URL;
  return url ? { DATABASE_URL: databaseUrl(root, config.db.provider, url) } : {};
}

/** Prisma in the foreground (interactive commands: migrate dev may ask questions). */
async function prisma(root: string, args: string[], env: Record<string, string>, out: Out): Promise<number> {
  const { code } = await runPrisma(root, args, { env, inherit: true });
  if (code !== 0) out.ui.fail(`prisma ${args.join(" ")} failed (exit ${code})`);
  return code;
}

/** Models -> Prisma schema files. */
async function syncStep(root: string, config: DbConfig, out: Out) {
  const result = await out.ui.step(
    "Prisma schema",
    async () => syncSchema(root, config.apps, config.db.provider, await extraModels(config)),
    (r) => r.models.join(", ") || "no models",
  );
  for (const file of result.written) out.ui.file("change", file);
  return result;
}

/** `prisma generate`, output shown only on failure. */
async function clientStep(root: string, config: DbConfig, out: Out): Promise<number> {
  try {
    await out.ui.step("Prisma Client", async () => {
      const run = await runPrisma(root, ["generate"], { env: prismaEnv(root, config) });
      if (run.code !== 0) throw new ForgeError("FORGE_PRISMA", run.output.trim() || `prisma generate failed (exit ${run.code})`);
    }, () => PRISMA_PATHS.client.replace(/\/client\.ts$/, ""));
    return 0;
  } catch (err) {
    if (err instanceof ForgeError) {
      out.ui.fail(err.message);
      return 1;
    }
    throw err;
  }
}

/**
 * Models -> schema, then Prisma Client.
 * `ifNeeded`: skips the client when nothing changed and it exists.
 */
export async function generate(root: string, out: Out, options: { ifNeeded?: boolean } = {}): Promise<number> {
  const config = await dbConfig(root);
  const result = await syncStep(root, config, out);
  if (options.ifNeeded && !result.written.length && existsSync(join(root, PRISMA_PATHS.client))) return 0;
  return clientStep(root, config, out);
}

export async function db(root: string, command: string | undefined, values: { name?: string }, out: Out): Promise<number> {
  out.ui.header(`db ${command ?? ""}`.trim());
  switch (command) {
    case "generate": {
      const code = await generate(root, out);
      if (code === 0) await out.ui.step("Types", () => refreshTypes(root, out), () => ".forge/types.d.ts");
      out.ui.blank();
      return code;
    }
    case "migrate": {
      // Prisma 7's `migrate dev` no longer generates the client: Forge does it
      // after the migration, then refreshes the app types.
      const config = await dbConfig(root);
      await syncStep(root, config, out);
      const snapshotFile = join(root, PRISMA_PATHS.snapshot);
      const current = await Bun.file(join(root, PRISMA_PATHS.generatedSchema)).text();
      const previous = existsSync(snapshotFile) ? await Bun.file(snapshotFile).text() : null;
      const first = (await listMigrations(root)).length === 0;
      const name = values.name ?? migrationName(previous, current, first);
      out.ui.ok("Migration", name);
      out.ui.blank();
      const result = await prisma(root, ["migrate", "dev", "--name", name], prismaEnv(root, config), out);
      if (result !== 0) return result;
      await Bun.write(snapshotFile, current);
      out.ui.blank();
      if ((await clientStep(root, config, out)) !== 0) return 1;
      await out.ui.step("Types", () => refreshTypes(root, out), () => ".forge/types.d.ts");
      out.ui.blank();
      return 0;
    }
    case "deploy": {
      // Bun's own drivers: no Prisma engine needed in CI or production.
      const config = await dbConfig(root);
      const url = Bun.env.DATABASE_URL;
      if (!url) {
        out.ui.fail("DATABASE_URL is not set");
        return 1;
      }
      const migrations = await readMigrations(root);
      const result = await out.ui.step(
        `Migrations (${config.db.provider})`,
        () => deployMigrations(config.db.provider, databaseUrl(root, config.db.provider, url), migrations),
        (r) => (r.applied.length ? `${r.applied.length} applied` : `up to date, ${migrations.length} total`),
      );
      for (const name of result.applied) out.ui.file("add", name);
      for (const w of result.warnings) out.ui.warn(w);
      return 0;
    }
    case "status": {
      const config = await dbConfig(root);
      const status = await schemaStatus(root, config.apps, config.db.provider, await extraModels(config));
      if (status === "in-sync") out.ui.ok("Schema in sync with the models");
      else out.ui.warn(`Schema ${status === "missing" ? "not generated" : "out of date"}: run \`bun forge db generate\``);
      out.ui.blank();
      return prisma(root, ["migrate", "status"], prismaEnv(root, config), out);
    }
    default:
      out.ui.fail(`Unknown command: forge db ${command ?? ""} (generate, migrate, deploy, status)`);
      return 1;
  }
}
