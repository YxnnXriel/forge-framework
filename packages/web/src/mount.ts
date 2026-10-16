import { stat } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import type { Hono } from "hono";
import { sendAsset, type ClientAssets } from "./assets.ts";
import type { WebManifest } from "./routes.ts";
import { createMatcher } from "./server/matcher.ts";
import { ASSETS_PREFIX } from "./shared/constants.ts";
import { renderPage, type ModuleLoader } from "./ssr.ts";

/** Returns the public file for a URL pathname, or null. */
export type PublicFiles = (pathname: string) => Blob | null | Promise<Blob | null>;

export interface MountOptions {
  manifest: WebManifest;
  assets: ClientAssets;
  load: ModuleLoader;
  publicFiles: PublicFiles;
  dev: boolean;
  lang?: string;
  onUnexpectedError?: (error: unknown) => void;
}

export const DEV_EVENTS = "/__forge/dev";

/**
 * Live reload: the page listens to the dev server's boot id and reloads when
 * a restarted server answers with a new one.
 */
const DEV_SCRIPT = `\n<script>(()=>{let id;const s=new EventSource(${JSON.stringify(DEV_EVENTS)});s.addEventListener("boot",(e)=>{if(id&&id!==e.data)location.reload();id=e.data})})()</script>`;

/** Public files of a directory (development). Never outside it, never directories. */
export function publicDir(dir: string): PublicFiles {
  const base = normalize(dir);
  return async (pathname) => {
    let path: string;
    try {
      path = normalize(join(base, decodeURIComponent(pathname)));
    } catch {
      return null;
    }
    if (!path.startsWith(base + sep)) return null;
    return (await stat(path).catch(() => null))?.isFile() ? Bun.file(path) : null;
  };
}

/** Public files from a prebuilt table (production build). */
export function publicTable(files: Record<string, Blob>): PublicFiles {
  const table = new Map(Object.entries(files));
  return (pathname) => table.get(pathname) ?? null;
}

/** Registers assets, public files and the SSR catch-all on the app (after API routes). */
export function mountWeb(app: Hono<any, any, any>, options: MountOptions): void {
  const { assets, dev } = options;
  const match = createMatcher(options.manifest.routes);
  const onUnexpectedError = options.onUnexpectedError ?? ((e: unknown) => console.error(e));

  app.get(`${ASSETS_PREFIX}:file`, (c) => {
    const file = assets.files.get(c.req.param("file"));
    return file ? sendAsset(c, file, !dev) : c.notFound();
  });

  if (dev) {
    const boot = crypto.randomUUID();
    app.get(DEV_EVENTS, () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(`retry: 250\nevent: boot\ndata: ${boot}\n\n`);
          },
        }),
        { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } },
      ),
    );
  }

  app.get("*", async (c, next) => {
    const file = await options.publicFiles(new URL(c.req.url).pathname);
    if (file) return new Response(file);
    await next();
  });

  app.get("*", (c) =>
    renderPage(c, {
      manifest: options.manifest,
      match,
      assets,
      lang: options.lang ?? "en",
      onUnexpectedError,
      load: options.load,
      ...(dev ? { bodyEnd: DEV_SCRIPT } : {}),
    }),
  );
}
