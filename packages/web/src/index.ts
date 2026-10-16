import { stat } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import type { Hono } from "hono";
import { buildClient, type ClientAssets } from "./bundle.ts";
import { registerServerPlugin } from "./compile.ts";
import { scanRoutes, type WebManifest } from "./routes.ts";
import { ASSETS_PREFIX } from "./shared/constants.ts";
import { renderPage } from "./ssr.ts";

export { scanRoutes, matchRoute, type WebRoute, type WebManifest } from "./routes.ts";
export { buildClient, clientEntry, type ClientAssets } from "./bundle.ts";
export { registerServerPlugin, clientPlugin } from "./compile.ts";
export { renderPage } from "./ssr.ts";
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

/** Sets up the web layer: Svelte compilation, page discovery, browser bundle, SSR. */
export async function createWeb(options: WebOptions): Promise<Web> {
  registerServerPlugin(options.dev);
  const manifest = await scanRoutes(options.dir);
  const assets = await buildClient(manifest, { root: options.root, dev: options.dev });
  const publicDir = normalize(options.publicDir ?? join(options.root, "public"));
  const onUnexpectedError = options.onUnexpectedError ?? ((e: unknown) => console.error(e));

  return {
    manifest,
    assets,
    mount(app) {
      app.get(`${ASSETS_PREFIX}:file`, (c) => {
        const file = assets.files.get(c.req.param("file"));
        if (!file) return c.notFound();
        return new Response(file, {
          headers: {
            "content-type": file.type || "text/javascript;charset=utf-8",
            "cache-control": options.dev ? "no-cache" : "public, max-age=31536000, immutable",
          },
        });
      });

      app.get("*", async (c, next) => {
        let path: string;
        try {
          path = normalize(join(publicDir, decodeURIComponent(new URL(c.req.url).pathname)));
        } catch {
          return next();
        }
        // Never serve outside publicDir (path traversal) nor directories.
        if (path.startsWith(publicDir + sep) && (await stat(path).catch(() => null))?.isFile()) {
          return new Response(Bun.file(path));
        }
        await next();
      });

      app.get("*", (c) =>
        renderPage(c, { manifest, assets, lang: options.lang ?? "en", onUnexpectedError }),
      );
    },
  };
}
