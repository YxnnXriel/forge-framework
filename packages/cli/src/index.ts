import { parseArgs } from "node:util";
import { ForgeError, loadConfig, type ResolvedConfig } from "@forge/core";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PRISMA_PATHS, migrationName, runPrisma, schemaStatus, syncSchema } from "@forge/models";
import { listMigrations } from "@forge/models/testing";
import { databaseUrl } from "./db-url.ts";

const HELP = `forge <command>

Database (needs \`db\` in forge.config.ts):
  forge db generate            Models -> ${PRISMA_PATHS.generatedSchema}, then Prisma Client
  forge db migrate             generate + create and apply a migration (development);
                               named automatically (initial, post_likes...), --name to override
  forge db deploy              Apply pending migrations (production, CI)
  forge db status              Models/schema sync + migration status
`;

type Out = { log: (msg: string) => void; error: (msg: string) => void };

async function dbConfig(root: string): Promise<ResolvedConfig & { db: NonNullable<ResolvedConfig["db"]> }> {
  const config = await loadConfig(root);
  if (!config.db) {
    throw new ForgeError("FORGE_DB_DISABLED", "No `db` in forge.config.ts: add `db: { provider: \"postgresql\" | \"sqlite\" }`");
  }
  return config as ResolvedConfig & { db: NonNullable<ResolvedConfig["db"]> };
}

/** Environment for Prisma: .env is loaded by Bun; SQLite paths made absolute. */
function prismaEnv(root: string, config: { db: { provider: "postgresql" | "sqlite" } }) {
  const url = Bun.env.DATABASE_URL;
  return url ? { DATABASE_URL: databaseUrl(root, config.db.provider, url) } : {};
}

async function prisma(root: string, args: string[], env: Record<string, string>, out: Out): Promise<number> {
  const { code } = await runPrisma(root, args, { env, inherit: true });
  if (code !== 0) out.error(`prisma ${args.join(" ")} failed (exit ${code})`);
  return code;
}

async function generate(root: string, out: Out): Promise<number> {
  const config = await dbConfig(root);
  const result = await syncSchema(root, config.apps, config.db.provider);
  out.log(`Models: ${result.models.join(", ") || "(none)"}`);
  for (const file of result.written) out.log(`  wrote ${file}`);
  if (!result.written.length) out.log("  schema already up to date");
  return prisma(root, ["generate"], prismaEnv(root, config), out);
}

export async function run(argv: string[], options: { root?: string; out?: Out } = {}): Promise<number> {
  const root = options.root ?? process.cwd();
  const out = options.out ?? { log: console.log, error: console.error };
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { name: { type: "string", short: "n" }, help: { type: "boolean", short: "h" } },
  });
  const [group, command] = positionals;

  try {
    if (values.help || !group) {
      out.log(HELP);
      return 0;
    }
    if (group === "db" && command === "generate") return await generate(root, out);
    if (group === "db" && command === "migrate") {
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
    if (group === "db" && command === "deploy") {
      const config = await dbConfig(root);
      return await prisma(root, ["migrate", "deploy"], prismaEnv(root, config), out);
    }
    if (group === "db" && command === "status") {
      const config = await dbConfig(root);
      const status = await schemaStatus(root, config.apps, config.db.provider);
      out.log(`Schema: ${status}${status === "in-sync" ? "" : " (run `forge db generate`)"}`);
      return await prisma(root, ["migrate", "status"], prismaEnv(root, config), out);
    }
    out.error(`Unknown command: ${positionals.join(" ")}\n\n${HELP}`);
    return 1;
  } catch (err) {
    if (err instanceof ForgeError) {
      out.error(err.message);
      return 1;
    }
    throw err;
  }
}
