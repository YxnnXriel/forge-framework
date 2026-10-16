import { existsSync } from "node:fs";
import { ForgeConfigError, ForgeError, loadConfig, type ResolvedConfig } from "@forge/core";
import { loadEnv, type LoadedEnv } from "@forge/env";
import {
  clearRemotes,
  createServer,
  defineUrls,
  discoverRemotes,
  isUrls,
  serve,
  type DiscoveredApp,
  type ServerOptions,
  type Urls,
} from "@forge/server";
import type { Hono } from "hono";

export interface AppOptions extends Omit<ServerOptions, "urls" | "remote"> {
  /** Project root containing `forge.config.ts`. Default: `process.cwd()`. */
  root?: string;
  /** Development mode (unminified bundle, no caching). Default: NODE_ENV !== "production". */
  dev?: boolean;
}

export interface App {
  app: Hono;
  config: ResolvedConfig;
  env: LoadedEnv<ResolvedConfig["env"]>;
  /** Apps discovered in `src/apps` and their remote functions. */
  apps: DiscoveredApp[];
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
export async function createApp(options: AppOptions = {}): Promise<App> {
  assertBunVersion();
  const root = options.root ?? process.cwd();
  const dev = options.dev ?? Bun.env.NODE_ENV !== "production";
  const config = await loadConfig(root);
  const env = loadEnv(config.env);
  const urls = await loadUrls(config);

  clearRemotes();
  const apps = existsSync(config.apps) ? await discoverRemotes(config.apps) : [];
  const hasRemotes = apps.some((a) => a.remotes.length > 0);

  const { root: _root, dev: _dev, ...serverOptions } = options;
  const app = createServer({ ...serverOptions, urls, remote: hasRemotes || config.web !== null });

  if (config.web) {
    // Loaded only for projects with pages: API-only apps never load Svelte.
    const { createWeb, writeTypes } = await import("@forge/web");
    await writeTypes(root, apps);
    const web = await createWeb({
      root,
      dir: config.web.dir,
      lang: config.web.lang,
      dev,
      ...(options.onUnexpectedError ? { onUnexpectedError: (e: unknown) => options.onUnexpectedError!(e, undefined as never) } : {}),
    });
    web.mount(app);
  }

  return { app, config, env, apps };
}

/** `createApp()` + `Bun.serve()` with the `server` section of the config. */
export async function startApp(options: AppOptions = {}) {
  const built = await createApp(options);
  const server = serve(built.app, built.config.server);
  console.log(`Forge ready on ${server.url}`);
  return { ...built, server };
}
