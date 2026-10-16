import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants as zlib } from "node:zlib";
import { ForgeError, loadConfig, type ResolvedConfig } from "@forge/core";
import { readMigrations, PRISMA_PATHS, ADAPTERS } from "@forge/models";
import { ENGINE_LIBRARY, engine } from "@forge/rust-engine";
import {
  buildClient,
  prepareCompileCache,
  runtimeFiles,
  scanRoutes,
  serverBundlePlugin,
  constants,
} from "@forge/web";
import { bytes, duration, symbols } from "@forge/core/term";
import { assertBun, type Out } from "../util.ts";
import { generate } from "./db.ts";

export type BuildTarget = "bun" | "vercel";

export interface BuildOptions {
  /** One self-contained executable (`bun build --compile`) instead of server.js. */
  compile?: boolean;
  /** `vercel` also writes `.vercel/output` (Build Output API v3). Default: vercel when VERCEL is set. */
  target?: BuildTarget;
}

export const BUILD_DIR = ".forge/build";
const CLIENT_DIR = ".forge/client";
const ENTRY = ".forge/server-entry.ts";

const brotli = promisify(brotliCompress);
const COMPRESSIBLE = /\.(js|mjs|css|json|svg|map|txt|html|xml|wasm)$/;

interface ClientFile {
  name: string;
  type: string;
  path: string;
  br?: string;
  gzip?: string;
}

/**
 * Writes the browser bundle with brotli/gzip variants: compressed once at
 * build time (maximum level), never per request. Brotli runs on libuv's
 * thread pool, so files compress in parallel.
 */
async function writeClient(root: string, config: ResolvedConfig) {
  const web = config.web!;
  await prepareCompileCache(root, web.dir);
  const manifest = await scanRoutes(web.dir);
  const client = await buildClient(manifest, { root, dev: false });
  const dir = join(root, CLIENT_DIR);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const files = await Promise.all(
    [...client.files].map(async ([name, file]): Promise<ClientFile> => {
      const bytes = new Uint8Array(await file.body.arrayBuffer());
      const path = join(dir, name);
      await Bun.write(path, bytes);
      const out: ClientFile = { name, type: file.type, path };
      if (COMPRESSIBLE.test(name) && bytes.length > 1024) {
        const [br, gz] = await Promise.all([
          brotli(bytes, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11, [zlib.BROTLI_PARAM_SIZE_HINT]: bytes.length } }),
          Promise.resolve(Bun.gzipSync(bytes, { level: 9 })),
        ]);
        if (br.length < bytes.length * 0.9) await Bun.write((out.br = `${path}.br`), br);
        if (gz.length < bytes.length * 0.9) await Bun.write((out.gzip = `${path}.gz`), gz);
      }
      return out;
    }),
  );
  const chunks: Record<string, string> = {};
  for (const [source, chunk] of client.chunks) chunks[source] = constants.ASSETS_PREFIX + chunk;
  return { manifest, entry: client.entry, files, chunks };
}

async function publicFiles(root: string): Promise<Record<string, string>> {
  const dir = join(root, "public");
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  for await (const rel of new Bun.Glob("**/*").scan({ cwd: dir, onlyFiles: true, dot: true })) {
    out[`/${rel.split("\\").join("/")}`] = join(dir, rel);
  }
  return out;
}

/** The generated server entry: static imports of everything createApp would discover. */
async function serverEntry(root: string, config: ResolvedConfig, target: BuildTarget, embedEngine: boolean) {
  const lines: string[] = [];
  const imports: string[] = [];
  let n = 0;
  const id = (prefix: string) => `${prefix}${n++}`;
  const q = JSON.stringify;
  const fileImport = (path: string) => {
    const name = id("f");
    imports.push(`import ${name} from ${q(path)} with { type: "file" };`);
    return `file(${name})`;
  };

  imports.push(`import * as forge from "forge/internal/build";`);
  if (embedEngine) {
    imports.push(`import engineLibrary from ${q(ENGINE_LIBRARY)} with { type: "file" };`);
    lines.push(`forge.useEngineLibrary(resolveAsset(engineLibrary));`);
  }

  imports.push(`import config from ${q(join(root, "forge.config.ts"))};`);
  const mainFile = join(root, "src/main.ts");
  if (existsSync(mainFile)) imports.push(`import main from ${q(mainFile)};`);
  const urlsFile = config.api && existsSync(config.api.urls) ? config.api.urls : null;
  if (urlsFile) imports.push(`import urls from ${q(urlsFile)};`);

  const apps: string[] = [];
  if (existsSync(config.apps)) {
    const files: string[] = [];
    for await (const rel of new Bun.Glob("*/repository.{ts,js}").scan({ cwd: config.apps, onlyFiles: true })) files.push(rel);
    for (const rel of files.sort()) {
      const name = id("app");
      const file = join(config.apps, rel);
      imports.push(`import * as ${name} from ${q(file)};`);
      apps.push(`{ name: ${q(dirname(rel))}, file: ${q(file)}, module: ${name} }`);
    }
  }

  if (config.auth) imports.push(`import * as auth from "forge/internal/auth";`);

  let prisma = "null";
  if (config.db) {
    const client = join(root, PRISMA_PATHS.client);
    imports.push(`import * as prismaClient from ${q(client)};`);
    imports.push(`import * as prismaAdapter from ${q(ADAPTERS[config.db.provider].pkg)};`);
    prisma = "{ client: prismaClient, adapter: prismaAdapter }";
  }

  const migrations: string[] = [];
  if (config.db) {
    for (const m of await readMigrations(root)) {
      const name = id("sql");
      imports.push(`import ${name} from ${q(join(root, PRISMA_PATHS.migrations, m.name, "migration.sql"))} with { type: "text" };`);
      migrations.push(`{ name: ${q(m.name)}, sql: ${name} }`);
    }
  }

  let web = "null";
  let staticFiles: { client: ClientFile[]; public: Record<string, string> } | null = null;
  if (config.web) {
    const client = await writeClient(root, config);
    const pub = await publicFiles(root);
    staticFiles = { client: client.files, public: pub };
    const assetEntries = client.files.map((f) => {
      const parts = [`body: ${fileImport(f.path)}`, `type: ${q(f.type)}`];
      if (f.br) parts.push(`br: ${fileImport(f.br)}`);
      if (f.gzip) parts.push(`gzip: ${fileImport(f.gzip)}`);
      return `[${q(f.name)}, { ${parts.join(", ")} }]`;
    });
    const components = new Set<string>([
      ...client.manifest.routes.flatMap((r) => [...r.layouts, r.page]),
      ...(client.manifest.errorPage ? [client.manifest.errorPage] : []),
    ]);
    const modules = [
      `[forge.ROOT_COMPONENT]: () => import(${q(runtimeFiles.root)})`,
      `[forge.ERROR_COMPONENT]: () => import(${q(runtimeFiles.errorPage)})`,
      ...[...components].map((f) => `${q(f)}: () => import(${q(f)})`),
    ];
    const pubEntries = Object.entries(pub).map(([url, path]) => `${q(url)}: ${fileImport(path)}`);
    web = `{
    manifest: ${JSON.stringify({ ...client.manifest, dir: "" })},
    assets: {
      entry: ${q(client.entry)},
      files: new Map([${assetEntries.join(",\n      ")}]),
      preloads: forge.preloadsFrom((source) => chunks[source]),
    },
    modules: { ${modules.join(",\n      ")} },
    publicFiles: { ${pubEntries.join(",\n      ")} },
  }`;
    lines.unshift(`const chunks = ${JSON.stringify(client.chunks)};`);
  }

  const start =
    target === "vercel"
      ? `const { app } = await forge.createApp({ root: process.cwd() });\nexport default { fetch: app.fetch };`
      : `await forge.runServer(process.argv.slice(2));`;

  const code = `// Generated by \`forge build\`. Do not edit.
${imports.join("\n")}
import { isAbsolute, join } from "node:path";

/** Embedded files: absolute in an executable, relative to this bundle otherwise. */
const resolveAsset = (path: string) => (isAbsolute(path) ? path : join(import.meta.dir, path));
const file = (path: string) => Bun.file(resolveAsset(path));
${lines.join("\n")}

forge.setBuildManifest({
  config,
  main: ${existsSync(mainFile) ? "main" : "{}"},
  urls: ${urlsFile ? "urls" : "null"},
  apps: [${apps.join(", ")}],
  prisma: ${prisma},
  web: ${web},
  migrations: [${migrations.join(", ")}],
  auth: ${config.auth ? "auth" : "null"},
});

${start}
`;
  return { code, staticFiles };
}

async function bundleServer(root: string, entry: string, outDir: string, compile: boolean) {
  const result = await Bun.build({
    entrypoints: [entry],
    target: "bun",
    format: "esm",
    minify: true,
    sourcemap: "linked",
    plugins: [serverBundlePlugin()],
    define: {
      "process.env.FORGE_BUILD": JSON.stringify("1"),
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    ...(compile
      ? // Precompiled bytecode: measured cold start 200 ms -> 75 ms (full-stack example).
        { compile: { outfile: join(outDir, "server") }, bytecode: true }
      : { outdir: outDir, naming: { entry: "server.[ext]", chunk: "[name]-[hash].[ext]", asset: "assets/[name]-[hash].[ext]" } }),
  } as Bun.BuildConfig);
  if (!result.success) {
    throw new ForgeError("FORGE_BUILD", `Server build failed:\n${result.logs.map(String).join("\n")}`);
  }
  return result.outputs;
}

/** `.vercel/output` (Build Output API v3): static files on the CDN, the server as one Bun function. */
async function writeVercel(root: string, buildDir: string, staticFiles: { client: ClientFile[]; public: Record<string, string> } | null) {
  const out = join(root, ".vercel/output");
  await rm(out, { recursive: true, force: true });
  const fn = join(out, "functions/index.func");
  await mkdir(fn, { recursive: true });
  await cp(buildDir, fn, { recursive: true });
  const [major, minor] = Bun.version.split(".");
  await Bun.write(
    join(fn, ".vc-config.json"),
    JSON.stringify(
      { runtime: `bun${major}.${minor}.x`, handler: "server.js", launcherType: "Nodejs", experimentalResponseStreaming: true },
      null,
      2,
    ),
  );
  await Bun.write(join(fn, "package.json"), JSON.stringify({ type: "module" }));

  const assets = constants.ASSETS_PREFIX;
  if (staticFiles) {
    for (const f of staticFiles.client) await cp(f.path, join(out, "static", assets, f.name));
    for (const [url, path] of Object.entries(staticFiles.public)) await cp(path, join(out, "static", url));
  }
  await Bun.write(
    join(out, "config.json"),
    JSON.stringify(
      {
        version: 3,
        routes: [
          {
            src: `^${assets.replace(/\//g, "\\/")}(.*)$`,
            headers: { "cache-control": "public, max-age=31536000, immutable" },
            continue: true,
          },
          { handle: "filesystem" },
          { src: "/(.*)", dest: "/index" },
        ],
      },
      null,
      2,
    ),
  );
  return out;
}

export async function build(root: string, options: BuildOptions, out: Out): Promise<number> {
  assertBun();
  const started = performance.now();
  const target: BuildTarget = options.target ?? (Bun.env.VERCEL ? "vercel" : "bun");
  if (target === "vercel" && options.compile) {
    throw new ForgeError("FORGE_BUILD", "--compile is not available for Vercel (it runs server.js on its Bun runtime)");
  }
  const { ui } = out;
  ui.header("build", [target === "vercel" ? "vercel" : null, options.compile ? "single executable" : null].filter(Boolean).join(" · ") || "bun");
  const config = await loadConfig(root);
  if (target === "vercel" && config.db?.provider === "sqlite") {
    ui.warn("SQLite files do not persist on Vercel (read-only, ephemeral functions): use postgresql there");
  }
  if (config.db && (await generate(root, out, { ifNeeded: true })) !== 0) return 1;

  // The native engine is embedded when it is built for this machine (Docker/VPS);
  // Vercel uses the TypeScript fallback.
  const embedEngine = target === "bun" && engine() !== null;
  const { code, staticFiles } = await ui.step(
    config.web ? "Pages & client bundle" : "Server entry",
    () => serverEntry(root, config, target, embedEngine),
    (r) => (r.staticFiles ? `${r.staticFiles.client.length} files` : undefined),
  );
  const entry = join(root, ENTRY);
  await Bun.write(entry, code);

  const buildDir = join(root, BUILD_DIR);
  await rm(buildDir, { recursive: true, force: true });
  await mkdir(buildDir, { recursive: true });
  const output = join(buildDir, options.compile ? "server" : "server.js");
  await ui.step(
    options.compile ? "Executable (bytecode)" : "Server bundle",
    () => bundleServer(root, entry, buildDir, options.compile === true),
    () => bytes(Bun.file(output).size),
  );
  const vercel = target === "vercel" ? await ui.step("Vercel output", () => writeVercel(root, buildDir, staticFiles)) : null;

  out.log(`\n  ${ui.p.green(symbols.ok)} ${ui.p.bold("Built")} ${ui.p.dim("in")} ${duration(performance.now() - started)}\n`);
  const rows: [string, string][] = [["output", `${relative(root, output)}  ${ui.p.dim(bytes(Bun.file(output).size))}`]];
  if (staticFiles) {
    const raw = staticFiles.client.reduce((n, f) => n + Bun.file(f.path).size, 0);
    const br = staticFiles.client.reduce((n, f) => n + Bun.file(f.br ?? f.path).size, 0);
    rows.push(["client", `${staticFiles.client.length} files ${ui.p.dim(symbols.dot)} ${bytes(raw)} ${ui.p.dim("→")} ${ui.p.green(bytes(br))} ${ui.p.dim("brotli")}`]);
    const pub = Object.keys(staticFiles.public).length;
    if (pub) rows.push(["public", `${pub} file${pub > 1 ? "s" : ""}`]);
  }
  rows.push(["engine", embedEngine ? ui.p.green("Rust, embedded") : ui.p.yellow("TypeScript fallback")]);
  if (vercel) rows.push(["vercel", relative(root, vercel)]);
  rows.push(["run", ui.p.cyan(target === "vercel" ? "deployed by Vercel" : "bun forge start")]);
  ui.table(rows);
  out.log("");
  return 0;
}
