import { join } from "node:path";
import type { BunPlugin } from "bun";
import { compile, compileModule } from "svelte/compiler";

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
function svelteLoaders(build: Parameters<BunPlugin["setup"]>[0], options: CompileOptions) {
  build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
    const source = await Bun.file(path).text();
    const out = compile(source, {
      filename: path,
      generate: options.generate,
      dev: options.dev,
      css: "injected",
      experimental: { async: true },
    });
    return { contents: out.js.code, loader: "js" };
  });

  build.onLoad({ filter: /\.svelte\.(ts|js)$/ }, async ({ path }) => {
    let source = await Bun.file(path).text();
    if (path.endsWith(".ts")) source = ts.transformSync(source);
    const out = compileModule(source, { filename: path, generate: options.generate, dev: options.dev });
    return { contents: out.js.code, loader: "js" };
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
