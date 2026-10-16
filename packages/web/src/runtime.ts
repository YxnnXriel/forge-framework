// Production entry of the web layer: no Svelte compiler, no bundler, no
// filesystem scan. Everything comes from the build (`forge build`).
import type { Hono } from "hono";
import type { ClientAssets } from "./assets.ts";
import { mountWeb, publicTable } from "./mount.ts";
import type { WebManifest } from "./routes.ts";

export interface PrebuiltWeb {
  manifest: WebManifest;
  assets: ClientAssets;
  /** Compiled components by key (source path, ROOT_COMPONENT, ERROR_COMPONENT). */
  modules: Record<string, () => Promise<{ default: any }>>;
  /** URL pathname -> file. */
  publicFiles: Record<string, Blob>;
}

export function createPrebuiltWeb(
  built: PrebuiltWeb,
  options: { lang?: string; onUnexpectedError?: (error: unknown) => void } = {},
) {
  return {
    manifest: built.manifest,
    assets: built.assets,
    mount(app: Hono<any, any, any>) {
      mountWeb(app, {
        manifest: built.manifest,
        assets: built.assets,
        load: (key) => {
          const load = built.modules[key];
          if (!load) throw new Error(`[forge] component not in the build: ${key}`);
          return load();
        },
        publicFiles: publicTable(built.publicFiles),
        dev: false,
        ...options,
      });
    },
  };
}

export { preloadsFrom, type AssetFile, type ClientAssets } from "./assets.ts";
export { ROOT_COMPONENT, ERROR_COMPONENT } from "./paths.ts";
export type { WebManifest } from "./routes.ts";
