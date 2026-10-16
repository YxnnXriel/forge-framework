import { resolveConfig } from "@forge/core";
import { deployMigrations } from "@forge/models";
import { databaseUrl } from "@forge/cli/db-url";
import { startApp } from "./app.ts";
import { buildManifest } from "./manifest.ts";

/** Applies the migrations embedded in the build (`server migrate`). */
export async function migrate(root: string = process.cwd()): Promise<void> {
  const built = buildManifest();
  if (!built) throw new Error("[forge] not a production build");
  const config = resolveConfig(built.config, { root });
  if (!config.db) return;
  const url = Bun.env.DATABASE_URL;
  if (!url) throw new Error("[forge] DATABASE_URL is not set");
  const result = await deployMigrations(config.db.provider, databaseUrl(root, config.db.provider, url), built.migrations);
  for (const w of result.warnings) console.warn(`[forge] warning: ${w}`);
  console.log(
    result.applied.length
      ? `[forge] applied migrations: ${result.applied.join(", ")}`
      : `[forge] database up to date (${built.migrations.length} migrations)`,
  );
}

const USAGE = `usage: server [start] [--migrate]   start the app (--migrate: apply migrations first)
       server migrate             apply pending migrations and exit`;

/** Command line of the built server (`bun server.js ...` or the compiled executable). */
export async function runServer(argv: string[]): Promise<void> {
  const args = argv.filter((a) => !a.startsWith("-"));
  const command = args[0] ?? "start";
  if (argv.includes("--help") || argv.includes("-h") || (command !== "start" && command !== "migrate")) {
    console.log(USAGE);
    if (command !== "start" && command !== "migrate") process.exitCode = 1;
    return;
  }
  try {
    if (command === "migrate" || argv.includes("--migrate")) await migrate();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  if (command === "start") await startApp({ root: process.cwd() });
}
