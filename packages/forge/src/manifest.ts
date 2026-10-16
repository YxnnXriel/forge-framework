import type { Migration, PrismaModule } from "@forge/models";
import type { AppModule, Urls } from "@forge/server";
import type { PrebuiltWeb } from "@forge/web/runtime";
import type { AppDefinition } from "./app.ts";

/**
 * Everything `createApp()` would discover on disk, produced by `forge build`
 * and set by the generated server entry before the app starts. Its presence
 * switches createApp to the prebuilt path: no config file read, no folder
 * scan, no compiler.
 */
export interface BuildManifest {
  /** Default export of forge.config.ts. */
  config: unknown;
  /** Default export of src/main.ts (or {}). */
  main: AppDefinition;
  urls: Urls | null;
  apps: AppModule[];
  prisma: { client: PrismaModule; adapter: Record<string, unknown> } | null;
  web: PrebuiltWeb | null;
  migrations: Migration[];
  /** `forge/auth` when `auth` is enabled. */
  auth: typeof import("@forge/auth") | null;
}

let current: BuildManifest | null = null;

export function setBuildManifest(manifest: BuildManifest): void {
  current = manifest;
}

export function buildManifest(): BuildManifest | null {
  return current;
}

// Used by the generated server entry (.forge/server-entry.ts): it can only
// import the `forge` package, not its internal workspace packages.
export { createApp, startApp } from "./app.ts";
export { runServer, migrate } from "./production.ts";
export { useEngineLibrary } from "@forge/rust-engine";
export { preloadsFrom, ROOT_COMPONENT, ERROR_COMPONENT } from "@forge/web/runtime";
