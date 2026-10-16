import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { hashFiles, hashFlavor } from "@forge/rust-engine";
import type { BunPlugin } from "bun";
import { VERSION as SVELTE_VERSION, compile, compileModule } from "svelte/compiler";

const here = import.meta.dir;
export const runtimeFiles = {
  root: join(here, "runtime/Root.svelte"),
  errorPage: join(here, "runtime/ErrorPage.svelte"),
  serverRouter: join(here, "server/router.ts"),
  serverPage: join(here, "server/page.ts"),
  clientRouter: join(here, "client/router.ts"),
  clientPage: join(here, "client/page.ts"),
};

const ts = new Bun.Transpiler({ loader: "ts" });

export interface CompileOptions {
  generate: "server" | "client";
  dev: boolean;
}

/**
 * Svelte compilation for Bun (runtime plugin and bundler plugin):
 *  - `.svelte` components, with `await` support (experimental.async)
 *  - `.svelte.ts` / `.svelte.js` rune modules (TS stripped by Bun first)
 */
/* ------------------------- Incremental compile cache ------------------------ */

/** Bump when the compile options below change: invalidates every cached output. */
const COMPILER_REV = 1;

let cacheDir: string | null = null;
const knownHashes = new Map<string, bigint>();

/**
 * Enables the on-disk compile cache (`.forge/cache/svelte`) and hashes every
 * Svelte source in one batch: on all cores with the Rust engine, concurrently
 * otherwise. Unchanged files are then loaded from the cache instead of being
 * recompiled (dev restarts, production builds).
 */
export async function prepareCompileCache(root: string, dir: string): Promise<{ files: number }> {
  cacheDir = join(root, ".forge", "cache", "svelte");
  mkdirSync(cacheDir, { recursive: true });
  const files: string[] = [];
  for await (const rel of new Bun.Glob("**/*.{svelte,svelte.ts,svelte.js}").scan({ cwd: dir, onlyFiles: true })) {
    files.push(join(dir, rel));
  }
  files.push(...Object.values(runtimeFiles).filter((f) => f.endsWith(".svelte")));
  const hashes = await hashFiles(files);
  files.forEach((f, i) => hashes[i] && knownHashes.set(f, hashes[i]!));
  return { files: files.length };
}

async function cached(path: string, variant: string, compileFn: (source: string) => string): Promise<string> {
  const known = cacheDir ? knownHashes.get(path) : undefined;
  if (!cacheDir || known === undefined) return compileFn(await Bun.file(path).text());
  const key = Bun.hash(`${hashFlavor()}:${known}:${variant}:${SVELTE_VERSION}:${COMPILER_REV}:${path}`).toString(36);
  const file = Bun.file(join(cacheDir, `${key}.js`));
  if (await file.exists()) return file.text();
  const code = compileFn(await Bun.file(path).text());
  await Bun.write(file, code);
  return code;
}

/* ------------------------------- Bun loaders ------------------------------ */

function svelteLoaders(build: Parameters<BunPlugin["setup"]>[0], options: CompileOptions) {
  const variant = `${options.generate}:${options.dev ? "dev" : "prod"}`;

  build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
    const contents = await cached(path, variant, (source) =>
      compile(source, {
        filename: path,
        generate: options.generate,
        dev: options.dev,
        css: "injected",
        experimental: { async: true },
      }).js.code,
    );
    return { contents, loader: "js" };
  });

  build.onLoad({ filter: /\.svelte\.(ts|js)$/ }, async ({ path }) => {
    const contents = await cached(path, variant, (source) => {
      const js = path.endsWith(".ts") ? ts.transformSync(source) : source;
      return compileModule(js, { filename: path, generate: options.generate, dev: options.dev }).js.code;
    });
    return { contents, loader: "js" };
  });
}

/** Registered once in the server process (Bun.plugin): SSR imports `.svelte` directly. */
let serverRegistered = false;
export function registerServerPlugin(_dev: boolean): void {
  if (serverRegistered) return;
  serverRegistered = true;
  Bun.plugin({
    name: "forge-svelte-server",
    setup(build) {
      // Server code is always compiled with dev: false. Svelte 5.57.2 crashes when
      // rendering <svelte:head> in dev SSR ("context.function[FILENAME]"); dev SSR
      // only adds warnings, the browser bundle keeps dev mode.
      svelteLoaders(build, { generate: "server", dev: false });
      // Runtime virtual modules: same names as in the browser, server implementations.
      build.module("forge:router", () => ({
        contents: `export { forge } from ${JSON.stringify(runtimeFiles.serverRouter)};`,
        loader: "js",
      }));
      build.module("forge:web", () => ({
        contents: `export { page, goto } from ${JSON.stringify(runtimeFiles.serverPage)};`,
        loader: "js",
      }));
    },
  });
}

/** Bundler plugin for the browser build (Bun.build). */
export function clientPlugin(dev: boolean): BunPlugin {
  return {
    name: "forge-svelte-client",
    setup(build) {
      svelteLoaders(build, { generate: "client", dev });
      build.onResolve({ filter: /^forge:router$/ }, () => ({ path: runtimeFiles.clientRouter }));
      build.onResolve({ filter: /^forge:web$/ }, () => ({ path: runtimeFiles.clientPage }));
    },
  };
}
