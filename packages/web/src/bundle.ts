import { join, resolve } from "node:path";
import { ForgeError } from "@forge/core";
import { clientPlugin, runtimeFiles } from "./compile.ts";
import type { WebManifest, WebRoute } from "./routes.ts";
import { ASSETS_PREFIX } from "./shared/constants.ts";

export interface ClientAssets {
  /** Public URL of the entry module. */
  entry: string;
  /** File name -> content, served under ASSETS_PREFIX. */
  files: Map<string, Blob>;
  /** Public URLs to `modulepreload` for a route (its layouts and page chunks). */
  preloads(route: WebRoute | null): string[];
}

const imp = (file: string) => `() => import(${JSON.stringify(file)})`;

/** Generated browser entry: route table with lazy loaders, then `start()`. */
export function clientEntry(manifest: WebManifest): string {
  const routes = manifest.routes.map((r) => {
    const loaders = [...r.layouts, r.page].map(imp).join(", ");
    return `  { id: ${JSON.stringify(r.id)}, segments: ${JSON.stringify(r.segments)}, load: () => Promise.all([${loaders}].map((l) => l())) }`;
  });
  const rootLayoutFile = manifest.rootLayout;
  const errorFile = manifest.errorPage ?? runtimeFiles.errorPage;
  return `import { start } from ${JSON.stringify(join(import.meta.dir, "client/index.ts"))};
const routes = [
${routes.join(",\n")}
];
const loadError = (withLayout) => Promise.all([
  ...(withLayout && ${rootLayoutFile ? "true" : "false"} ? [${rootLayoutFile ? imp(rootLayoutFile) : "null"}] : []),
  ${imp(errorFile)},
].map((l) => l()));
start(routes, loadError);
`;
}

/** Builds the browser bundle in memory with Bun.build (code splitting per page). */
export async function buildClient(manifest: WebManifest, options: { root: string; dev: boolean }): Promise<ClientAssets> {
  const entryPath = join(options.root, ".forge", "entry.client.ts");
  const result = await Bun.build({
    entrypoints: [entryPath],
    files: { [entryPath]: clientEntry(manifest) },
    plugins: [clientPlugin(options.dev)],
    target: "browser",
    format: "esm",
    splitting: true,
    minify: !options.dev,
    sourcemap: options.dev ? "inline" : "none",
    naming: { entry: "[name]-[hash].[ext]", chunk: "[name]-[hash].[ext]", asset: "[name]-[hash].[ext]" },
    publicPath: ASSETS_PREFIX,
    metafile: true,
    define: { "process.env.NODE_ENV": JSON.stringify(options.dev ? "development" : "production") },
  });
  if (!result.success) {
    throw new ForgeError("FORGE_WEB_BUILD", `Client build failed:\n${result.logs.map(String).join("\n")}`);
  }

  const files = new Map<string, Blob>();
  let entry = "";
  for (const output of result.outputs) {
    const name = output.path.replace(/^\.\//, "").split("/").pop()!;
    files.set(name, output);
    if (output.kind === "entry-point") entry = ASSETS_PREFIX + name;
  }

  // Source file -> output chunk, from the metafile, to preload a route's modules.
  const chunkOf = new Map<string, string>();
  const meta = result.metafile as { outputs?: Record<string, { inputs?: Record<string, unknown> }> } | undefined;
  for (const [out, info] of Object.entries(meta?.outputs ?? {})) {
    const name = out.split("/").pop()!;
    // Metafile paths are relative to the working directory (esbuild format).
    for (const input of Object.keys(info.inputs ?? {})) chunkOf.set(resolve(process.cwd(), input), name);
  }

  return {
    entry,
    files,
    preloads(route) {
      if (!route) return [];
      const urls = new Set<string>();
      for (const file of [...route.layouts, route.page]) {
        const chunk = chunkOf.get(file);
        if (chunk) urls.add(ASSETS_PREFIX + chunk);
      }
      return [...urls];
    },
  };
}
