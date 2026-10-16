import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { ForgeConfigError, type ForgeIssue } from "./errors.ts";

/* -------------------------------------------------------------------------- */
/*                                Public types                                */
/* -------------------------------------------------------------------------- */

/** A map of variable name -> Zod schema. Values are read as strings from the environment. */
export type EnvShape = Record<string, z.ZodType>;

export interface EnvConfig<
  Private extends EnvShape = EnvShape,
  Public extends EnvShape = EnvShape,
> {
  /** Server-only variables. Never serialized to the browser. */
  private?: Private;
  /** Variables explicitly allowed to reach the browser. No naming prefix is implied. */
  public?: Public;
}

export interface ServerConfig {
  /** Defaults to Bun's own resolution (`PORT` / `BUN_PORT` / 3000). */
  port?: number;
  hostname?: string;
}

export interface ApiConfig {
  /** Global backend route registry. Default: `src/urls.ts`. */
  urls?: string;
}

export interface DbConfig {
  /** Database engine. The connection string is read from `DATABASE_URL`. */
  provider: "postgresql" | "sqlite";
}

export interface WebConfig {
  /** Directory scanned for `+page.svelte` / `+layout.svelte`. Default: `src/web`. */
  dir?: string;
  /** `<html lang>`. Default: `en`. */
  lang?: string;
}

/**
 * Forge configuration. A module is enabled by declaring its key;
 * `false` or absence disables it, so API-only and web-only projects
 * never have to configure what they don't use.
 */
export interface ForgeConfig {
  server?: ServerConfig;
  api?: ApiConfig | false;
  web?: WebConfig | false;
  /** Prisma integration (models declared in each app's models.ts). */
  db?: DbConfig | false;
  env?: EnvConfig;
}

export interface ResolvedConfig {
  /** Absolute project root. */
  root: string;
  server: ServerConfig;
  api: Required<ApiConfig> | null;
  web: Required<WebConfig> | null;
  db: DbConfig | null;
  /** Domain apps (`src/apps/<name>/`), source of remote functions. */
  apps: string;
  env: { private: EnvShape; public: EnvShape };
}

/**
 * Identity helper: gives autocompletion and keeps the literal type of the
 * config (needed later to infer env and module types).
 */
export function defineConfig<const C extends ForgeConfig>(config: C): C {
  return config;
}

/* -------------------------------------------------------------------------- */
/*                                 Validation                                 */
/* -------------------------------------------------------------------------- */

const zodSchema = z.custom<z.ZodType>((v) => v instanceof z.ZodType, {
  message: "expected a Zod schema",
});

const envShapeSchema = z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "invalid variable name"), zodSchema);

const configSchema = z.strictObject({
  server: z
    .strictObject({
      port: z.int().min(0).max(65535).optional(),
      hostname: z.string().min(1).optional(),
    })
    .optional(),
  api: z.union([z.literal(false), z.strictObject({ urls: z.string().min(1).optional() })]).optional(),
  web: z
    .union([z.literal(false), z.strictObject({ dir: z.string().min(1).optional(), lang: z.string().min(1).optional() })])
    .optional(),
  db: z.union([z.literal(false), z.strictObject({ provider: z.enum(["postgresql", "sqlite"]) })]).optional(),
  env: z
    .strictObject({
      private: envShapeSchema.optional(),
      public: envShapeSchema.optional(),
    })
    .optional(),
});

type RawIssue = { path: PropertyKey[]; message: string; code?: string; errors?: RawIssue[][] };

/**
 * Flattens issues. For `false | { ... }` options, Zod reports a vague union
 * error; the branch that got furthest (the object) explains the real problem.
 */
function flatten(issue: RawIssue, base: PropertyKey[] = []): ForgeIssue[] {
  const path = [...base, ...issue.path];
  if (issue.code === "invalid_union" && issue.errors?.length) {
    const depth = (branch: RawIssue[]) => Math.max(...branch.map((i) => i.path.length));
    const best = [...issue.errors].sort((a, b) => depth(b) - depth(a))[0]!;
    if (depth(best) > 0) return best.flatMap((i) => flatten(i, path));
  }
  return [{ path: path.map(String).join("."), message: issue.message }];
}

function toIssues(error: z.ZodError): ForgeIssue[] {
  return error.issues.flatMap((issue) => flatten(issue as unknown as RawIssue));
}

function abs(root: string, p: string): string {
  return isAbsolute(p) ? p : resolve(root, p);
}

/**
 * Validates a raw config object and applies defaults.
 * Throws `ForgeConfigError` listing every problem at once.
 */
export function resolveConfig(input: unknown, options: { root: string; file?: string }): ResolvedConfig {
  const parsed = configSchema.safeParse(input ?? {});
  if (!parsed.success) throw new ForgeConfigError(toIssues(parsed.error), options.file);

  const cfg = parsed.data;
  const issues: ForgeIssue[] = [];

  const api = cfg.api === false || cfg.api === undefined ? null : { urls: abs(options.root, cfg.api.urls ?? "src/urls.ts") };
  const web =
    cfg.web === false || cfg.web === undefined
      ? null
      : { dir: abs(options.root, cfg.web.dir ?? "src/web"), lang: cfg.web.lang ?? "en" };

  const db = cfg.db === false || cfg.db === undefined ? null : { provider: cfg.db.provider };

  if (!api && !web) {
    issues.push({ path: "", message: "no module enabled: declare at least `api` or `web`" });
  }

  const priv = cfg.env?.private ?? {};
  const pub = cfg.env?.public ?? {};
  for (const name of Object.keys(pub)) {
    if (name in priv) {
      issues.push({ path: `env.public.${name}`, message: "declared both as private and public" });
    }
  }

  if (issues.length > 0) throw new ForgeConfigError(issues, options.file);

  const server: ServerConfig = {};
  if (cfg.server?.port !== undefined) server.port = cfg.server.port;
  if (cfg.server?.hostname !== undefined) server.hostname = cfg.server.hostname;

  return { root: options.root, server, api, web, db, apps: abs(options.root, "src/apps"), env: { private: priv, public: pub } };
}

export const CONFIG_FILENAME = "forge.config.ts";

/**
 * Loads and resolves `forge.config.ts` from `root`.
 * The file is executed by Bun directly (no transpilation step).
 */
export async function loadConfig(root: string = process.cwd()): Promise<ResolvedConfig> {
  const file = join(root, CONFIG_FILENAME);
  if (!(await Bun.file(file).exists())) {
    throw new ForgeConfigError([{ path: "", message: `${CONFIG_FILENAME} not found in ${root}` }]);
  }
  const mod: { default?: unknown } = await import(file);
  if (mod.default === undefined) {
    throw new ForgeConfigError([{ path: "", message: "missing `export default defineConfig({...})`" }], file);
  }
  return resolveConfig(mod.default, { root, file });
}
