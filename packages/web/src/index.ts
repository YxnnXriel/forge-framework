import { join } from "node:path";
import type { Hono } from "hono";
import { buildClient, type ClientAssets } from "./bundle.ts";
import { prepareCompileCache, registerServerPlugin } from "./compile.ts";
import { mountWeb, publicDir } from "./mount.ts";
import { ERROR_COMPONENT, ROOT_COMPONENT, runtimeFiles } from "./paths.ts";
import { scanRoutes, type WebManifest } from "./routes.ts";
import type { ModuleLoader } from "./ssr.ts";

export { scanRoutes, matchRoute, type WebRoute, type WebManifest } from "./routes.ts";
export { buildClient, clientEntry, type ClientAssets, type BuiltClient } from "./bundle.ts";
export { registerServerPlugin, clientPlugin, serverBundlePlugin, prepareCompileCache } from "./compile.ts";
export { renderPage, type ModuleLoader } from "./ssr.ts";
export { createMatcher, type Matcher } from "./server/matcher.ts";
export { mountWeb, publicDir, publicTable, DEV_EVENTS, type PublicFiles } from "./mount.ts";
export { sendAsset, type AssetFile } from "./assets.ts";
export { runtimeFiles, ROOT_COMPONENT, ERROR_COMPONENT } from "./paths.ts";
export { createPrebuiltWeb, type PrebuiltWeb } from "./runtime.ts";
export type { RemoteApi } from "./types.ts";
export { pageScope, type PageState } from "./server/page.ts";
export * as constants from "./shared/constants.ts";

export interface WebOptions {
  root: string;
  /** Pages directory (`config.web.dir`). */
  dir: string;
  dev: boolean;
  lang?: string;
  /** Files served as-is at the site root. Default: `<root>/public`. */
  publicDir?: string;
  onUnexpectedError?: (error: unknown) => void;
}

export interface Web {
  manifest: WebManifest;
  assets: ClientAssets;
  /** Registers assets, public files and the SSR catch-all on the app (after API routes). */
  mount(app: Hono<any, any, any>): void;
}

/** Imports compiled components from source (the runtime Svelte plugin compiles them). */
export const sourceLoader: ModuleLoader = (key) =>
  import(key === ROOT_COMPONENT ? runtimeFiles.root : key === ERROR_COMPONENT ? runtimeFiles.errorPage : key);

/** Sets up the web layer from source: Svelte compilation, page discovery, browser bundle, SSR. */
export async function createWeb(options: WebOptions): Promise<Web> {
  await prepareCompileCache(options.root, options.dir);
  registerServerPlugin(options.dev);
  const manifest = await scanRoutes(options.dir);
  const assets = await buildClient(manifest, { root: options.root, dev: options.dev });
  return {
    manifest,
    assets,
    mount(app) {
      mountWeb(app, {
        manifest,
        assets,
        load: sourceLoader,
        publicFiles: publicDir(options.publicDir ?? join(options.root, "public")),
        dev: options.dev,
        ...(options.lang ? { lang: options.lang } : {}),
        ...(options.onUnexpectedError ? { onUnexpectedError: options.onUnexpectedError } : {}),
      });
    },
  };
}
