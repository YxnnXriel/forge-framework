import { ForgeError, loadConfig, type ResolvedConfig } from "@forge/core";

export type Out = { log: (msg: string) => void; error: (msg: string) => void };

export type DbConfig = ResolvedConfig & { db: NonNullable<ResolvedConfig["db"]> };

/** Same range as the `forge` package (checked here too: the CLI cannot import it). */
export function assertBun(): void {
  if (!Bun.semver.satisfies(Bun.version, ">=1.4.0")) {
    throw new ForgeError("FORGE_BUN_VERSION", `Forge requires Bun >=1.4.0, but this is Bun ${Bun.version}. Run \`bun upgrade\`.`);
  }
}

export async function dbConfig(root: string): Promise<DbConfig> {
  const config = await loadConfig(root);
  if (!config.db) {
    throw new ForgeError("FORGE_DB_DISABLED", 'No `db` in forge.config.ts: add `db: { provider: "postgresql" | "sqlite" }`');
  }
  return config as DbConfig;
}

/** Better Auth's tables, generated alongside the models when `auth` is enabled. */
export async function extraModels(config: DbConfig) {
  if (!config.auth) return [];
  const { authModels } = await import("@forge/auth");
  return authModels(config.auth as never, config.db.provider);
}

/** Path of a package's bin script, resolved from the project (project-local tools only). */
export function resolveBin(root: string, pkg: string, bin: string): string | null {
  try {
    const manifest = Bun.resolveSync(`${pkg}/package.json`, root);
    const json = require(manifest) as { bin?: string | Record<string, string> };
    const rel = typeof json.bin === "string" ? json.bin : json.bin?.[bin];
    return rel ? Bun.resolveSync(`./${rel.replace(/^\.\//, "")}`, manifest.replace(/package\.json$/, "")) : null;
  } catch {
    return null;
  }
}

export const ms = (start: number) => `${((Bun.nanoseconds() - start) / 1e6).toFixed(0)} ms`;

/**
 * Regenerates `.forge/types.d.ts` with the project's own `forge` package (the
 * CLI cannot depend on it). Best effort: a project that does not load yet
 * (fresh install, broken file) keeps its previous types.
 */
export async function refreshTypes(root: string, out?: Out): Promise<boolean> {
  try {
    const mod = (await import(Bun.resolveSync("forge/internal/types", root))) as { refreshTypes: (root: string) => Promise<void> };
    await mod.refreshTypes(root);
    return true;
  } catch (err) {
    out?.error(`warning: types not refreshed (${err instanceof Error ? err.message.split("\n")[0] : String(err)})`);
    return false;
  }
}
