import { ForgeConfigError, loadConfig, type ResolvedConfig } from "@forge/core";
import { loadEnv, type LoadedEnv } from "@forge/env";
import type { Hono } from "hono";
import { createServer, isUrls, serve, type ServerOptions } from "./router.ts";

export interface AppOptions extends Omit<ServerOptions, "urls"> {
  /** Project root containing `forge.config.ts`. Default: `process.cwd()`. */
  root?: string;
}

export interface App {
  app: Hono;
  config: ResolvedConfig;
  env: LoadedEnv<ResolvedConfig["env"]>;
}

/**
 * Builds the backend from the project conventions: loads `forge.config.ts`,
 * validates the environment, imports the global registry (`src/urls.ts`).
 * Fails at startup rather than on the first request.
 */
export async function createApp(options: AppOptions = {}): Promise<App> {
  const config = await loadConfig(options.root);
  const env = loadEnv(config.env);

  if (!config.api) {
    throw new ForgeConfigError([{ path: "api", message: "the backend is disabled: add `api: {}` to forge.config.ts" }]);
  }

  const mod: { default?: unknown } = await import(config.api.urls);
  if (!isUrls(mod.default)) {
    throw new ForgeConfigError(
      [{ path: "api.urls", message: "must `export default defineUrls({...})`" }],
      config.api.urls,
    );
  }

  const { root: _root, ...serverOptions } = options;
  const app = createServer({ ...serverOptions, urls: mod.default });
  return { app, config, env };
}

/** `createApp()` + `Bun.serve()` with the `server` section of the config. */
export async function startApp(options: AppOptions = {}) {
  const built = await createApp(options);
  const server = serve(built.app, built.config.server);
  console.log(`Forge ready on ${server.url}`);
  return { ...built, server };
}
