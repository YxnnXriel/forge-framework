import type { Context } from "hono";
import type { WebRoute } from "./routes.ts";

/** One file of the browser bundle, with its precompressed variants (production). */
export interface AssetFile {
  body: Blob;
  type: string;
  br?: Blob;
  gzip?: Blob;
}

export interface ClientAssets {
  /** Public URL of the entry module. */
  entry: string;
  /** File name -> content, served under ASSETS_PREFIX. */
  files: Map<string, AssetFile>;
  /** Public URLs to `modulepreload` for a route (its layouts and page chunks). */
  preloads(route: WebRoute | null): string[];
}

/** Preload lookup from "source file -> chunk URL". */
export function preloadsFrom(chunkOf: (file: string) => string | undefined): ClientAssets["preloads"] {
  return (route) => {
    if (!route) return [];
    const urls = new Set<string>();
    for (const file of [...route.layouts, route.page]) {
      const chunk = chunkOf(file);
      if (chunk) urls.add(chunk);
    }
    return [...urls];
  };
}

/**
 * Serves an asset, picking the precompressed variant the client accepts
 * (brotli, then gzip). Hashed names: cached forever in production, by the
 * browser and by CDNs.
 */
export function sendAsset(c: Context, file: AssetFile, immutable: boolean): Response {
  const headers: Record<string, string> = {
    "content-type": file.type || "text/javascript;charset=utf-8",
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  };
  let body = file.body;
  if (file.br || file.gzip) {
    headers.vary = "accept-encoding";
    const accept = c.req.header("accept-encoding") ?? "";
    if (file.br && accept.includes("br")) {
      body = file.br;
      headers["content-encoding"] = "br";
    } else if (file.gzip && accept.includes("gzip")) {
      body = file.gzip;
      headers["content-encoding"] = "gzip";
    }
  }
  return new Response(body, { headers });
}
