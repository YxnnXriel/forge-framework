import { existsSync } from "node:fs";
import { ForgeConfigError, ForgeError, loadConfig, resolveConfig, type ResolvedConfig } from "@forge/core";
import { loadEnv, type LoadedEnv } from "@forge/env";
import { PRISMA_PATHS, createPrismaClient, prismaClientFrom, schemaStatus } from "@forge/models";
import { z } from "zod";
import {
  clearRemotes,
  createServer,
  defineUrls,
  discoverRemotes,
  isUrls,
  registerApps,
  serve,
  type DiscoveredApp,
  type ServerOptions,
  type Urls,
} from "@forge/server";
import type { Context, Hono } from "hono";
import { join } from "node:path";
import { databaseUrl } from "@forge/cli/db-url";
import { buildManifest } from "./manifest.ts";
import { writeTypes } from "./types.ts";

/** What `src/main.ts` exports by default: the app's own wiring. */
export type AppDefinition = Omit<ServerOptions, "urls" | "remote">;

/** Declares the app's dependencies and hooks (`export default defineApp({...})` in src/main.ts). */
export function defineApp<const D extends AppDefinition>(definition: D): D {
  return definition;
}

/** Entry file of the app, relative to the project root. Optional. */
export const MAIN_FILE = "src/main.ts";

export interface AppOptions extends AppDefinition {
  /** Project root containing `forge.config.ts`. Default: `process.cwd()`. */
  root?: string;
  /** Development mode (unminified bundle, no caching). Default: NODE_ENV !== "production". */
  dev?: boolean;
}

async function loadMain(root: string): Promise<AppDefinition> {
  const file = join(root, MAIN_FILE);
  if (!existsSync(file)) return {};
  const mod: { default?: unknown } = await import(file);
  if (mod.default === undefined) return {};
  if (typeof mod.default !== "object" || mod.default === null) {
    throw new ForgeConfigError([{ path: "", message: "must `export default defineApp({...})`" }], file);
  }
  return mod.default as AppDefinition;
}

export interface App {
  app: Hono;
  config: ResolvedConfig;
  env: LoadedEnv<ResolvedConfig["env"]>;
  /** Apps discovered in `src/apps` and their remote functions. */
  apps: DiscoveredApp[];
  /** Dependencies injected into handlers (including `db` when enabled). */
  deps: Partial<Forge.Deps>;
}

/** Minimum Bun version: older bundlers fail on the client build (EISDIR on isolated installs). */
export const BUN_RANGE = ">=1.4.0";

export function assertBunVersion(version: string = Bun.version): void {
  if (!Bun.semver.satisfies(version, BUN_RANGE)) {
    throw new ForgeError(
      "FORGE_BUN_VERSION",
      `Forge requires Bun ${BUN_RANGE}, but this is Bun ${version}. Run \`bun upgrade\`, then \`bun install\`.`,
    );
  }
}

async function loadUrls(config: ResolvedConfig): Promise<Urls> {
  if (!config.api) return defineUrls({});
  const mod: { default?: unknown } = await import(config.api.urls);
  if (!isUrls(mod.default)) {
    throw new ForgeConfigError([{ path: "api.urls", message: "must `export default defineUrls({...})`" }], config.api.urls);
  }
  return mod.default;
}

/**
 * Builds the application from the project conventions:
 * `forge.config.ts`, environment, backend routes (`api`), remote functions
 * (`src/apps/<app>/repository.ts`), pages (`web`). Fails at startup rather
 * than on the first request. Only the enabled modules are loaded.
 */
export async function createApp(appOptions: AppOptions = {}): Promise<App> {
  assertBunVersion();
  const built = process.env.FORGE_BUILD === "1" ? buildManifest() : null;
  const root = appOptions.root ?? process.cwd();
  const dev = built ? false : (appOptions.dev ?? Bun.env.NODE_ENV !== "production");
  const config = built ? resolveConfig(built.config, { root }) : await loadConfig(root);
  // src/main.ts wiring, overridden by explicit options (tests).
  const main = built ? built.main : await loadMain(root);
  const options: AppOptions = { ...main, ...appOptions, deps: { ...main.deps, ...appOptions.deps } };
  // Variables are required only by the modules that are enabled.
  const required: Record<string, z.ZodType> = {};
  if (config.db) required.DATABASE_URL = z.string().min(1);
  if (config.auth) {
    required.BETTER_AUTH_SECRET = z.string().min(32, "at least 32 characters (openssl rand -base64 32)");
    required.BETTER_AUTH_URL = z.url().optional();
  }
  const envShape = { ...config.env, private: { ...required, ...config.env.private } };
  const env = loadEnv(envShape) as LoadedEnv<ResolvedConfig["env"]>;
  const urls = built ? (built.urls ?? defineUrls({})) : await loadUrls(config);

  const deps = { ...options.deps };
  // In a build, the entry provides Better Auth only when enabled (static
  // imports): projects without auth never bundle it.
  const authModule =
    process.env.FORGE_BUILD === "1" ? (built?.auth ?? null) : config.auth ? await import("@forge/auth") : null;
  if (config.db) {
    const extra = authModule ? authModule.authModels(config.auth as never, config.db.provider) : [];
    const status = built ? "in-sync" : await schemaStatus(root, config.apps, config.db.provider, extra);
    if (status !== "in-sync") {
      console.warn(
        `[forge] Prisma schema is ${status === "missing" ? "not generated" : "out of date with your models"}: run \`bun run forge db generate\` (then \`forge db migrate\`).`,
      );
    }
    // A db passed explicitly (tests) wins over the configured one.
    if (!("db" in deps)) {
      const url = databaseUrl(root, config.db.provider, (env.private as Record<string, string>).DATABASE_URL!);
      (deps as Record<string, unknown>).db = built?.prisma
        ? prismaClientFrom(built.prisma.client, built.prisma.adapter, config.db.provider, url)
        : await createPrismaClient(root, config.db.provider, url);
    }
  }

  clearRemotes();
  const apps = built ? registerApps(built.apps) : existsSync(config.apps) ? await discoverRemotes(config.apps) : [];
  const hasRemotes = apps.some((a) => a.remotes.length > 0);

  // Better Auth: native instance in deps, routes mounted first, lazy session per request.
  let requestDeps = options.requestDeps;
  let beforeRoutes: ((app: Hono) => void) | undefined;
  if (authModule && config.auth && config.db) {
    const priv = env.private as Record<string, string | undefined>;
    const auth = authModule.createAuth(config.auth as never, {
      db: (deps as Record<string, unknown>).db,
      provider: config.db.provider,
      secret: priv.BETTER_AUTH_SECRET!,
      // In development, the local server's own URL (whatever PORT says) unless set.
      baseURL: priv.BETTER_AUTH_URL ?? (dev ? `http://localhost:${Bun.env.PORT ?? config.server.port ?? 3000}` : undefined),
    });
    (deps as Record<string, unknown>).auth = auth;
    const session = authModule.sessionDeps(auth as never);
    const user = options.requestDeps;
    requestDeps = (user ? async (c: Context) => ({ ...session(c), ...(await user(c)) }) : (c: Context) => session(c)) as never;
    const basePath = (config.auth.basePath as string | undefined) ?? "/api/auth";
    beforeRoutes = (app) => authModule.mountAuth(app, auth as never, basePath);
  }

  const { root: _root, dev: _dev, ...serverOptions } = options;
  const app = createServer({
    ...serverOptions,
    deps,
    urls,
    ...(requestDeps ? { requestDeps } : {}),
    ...(beforeRoutes ? { beforeRoutes } : {}),
    remote: hasRemotes || config.web !== null,
  });

  if (!built && (config.web || config.db)) {
    await writeTypes(root, {
      apps,
      db: config.db !== null,
      auth: config.auth !== null,
      clientFile: join(root, PRISMA_PATHS.client),
    });
  }

  const onWebError = options.onUnexpectedError
    ? { onUnexpectedError: (e: unknown) => options.onUnexpectedError!(e, undefined as never) }
    : {};
  if (process.env.FORGE_BUILD === "1") {
    // Production build: prebuilt pages and assets, no compiler in the bundle.
    if (config.web) {
      if (!built?.web) throw new ForgeError("FORGE_BUILD", "The build has no web output");
      const { createPrebuiltWeb } = await import("@forge/web/runtime");
      createPrebuiltWeb(built.web, { lang: config.web.lang, ...onWebError }).mount(app);
    }
  } else if (config.web) {
    // Loaded only for projects with pages: API-only apps never load Svelte.
    const { createWeb } = await import("@forge/web");
    const web = await createWeb({
      root,
      dir: config.web.dir,
      lang: config.web.lang,
      dev,
      ...onWebError,
    });
    web.mount(app);
  }

  return { app, config, env, apps, deps };
}

/** `createApp()` + `Bun.serve()` with the `server` section of the config. */
export async function startApp(options: AppOptions = {}) {
  const built = await createApp(options);
  const server = serve(built.app, built.config.server);
  console.log(`Forge ready on ${server.url}`);
  return { ...built, server };
}
