import { dirname, join, sep } from "node:path";
import { ForgeError } from "@forge/core";
import { compareRoutes, matchRoute, type RoutePattern, type Segment } from "./shared/match.ts";

export interface WebRoute extends RoutePattern {
  /** Absolute path of `+page.svelte`. */
  page: string;
  /** Absolute paths of the `+layout.svelte` chain, root first. */
  layouts: string[];
}

export interface WebManifest {
  dir: string;
  routes: WebRoute[];
  /** Optional root `+error.svelte`. */
  errorPage: string | null;
  /** Optional root `+layout.svelte` (wraps error pages too). */
  rootLayout: string | null;
}

const PARAM = /^\[([A-Za-z_][\w]*)\]$/;

function parseSegment(name: string, file: string): Segment {
  const param = PARAM.exec(name);
  if (param) return { kind: "param", name: param[1]! };
  if (/[[\]()]/.test(name)) {
    throw new ForgeError(
      "FORGE_WEB_ROUTE",
      `Unsupported route segment "${name}" (${file}). Supported: static names and [param]. ` +
        `Catch-all [...rest] and (groups) are not available yet.`,
    );
  }
  return { kind: "static", value: name };
}

/**
 * Discovers pages and layouts under `dir`:
 *   +page.svelte    a page; its folder path is its URL
 *   +layout.svelte  wraps every page below its folder
 *   [name]/         a dynamic segment
 */
export async function scanRoutes(dir: string): Promise<WebManifest> {
  const files: string[] = [];
  for await (const rel of new Bun.Glob("**/+{page,layout,error}.svelte").scan({ cwd: dir, onlyFiles: true })) {
    files.push(rel.split(sep).join("/"));
  }
  files.sort();

  const layouts = new Map<string, string>();
  for (const rel of files) if (rel.endsWith("+layout.svelte")) layouts.set(dirname(rel), join(dir, rel));

  const errorFiles = files.filter((f) => f.endsWith("+error.svelte"));
  for (const f of errorFiles) {
    if (f !== "+error.svelte") {
      throw new ForgeError("FORGE_WEB_ROUTE", `Only a root +error.svelte is supported for now (found ${f})`);
    }
  }

  const routes: WebRoute[] = [];
  const byShape = new Map<string, string>();
  for (const rel of files) {
    if (!rel.endsWith("+page.svelte")) continue;
    const folder = dirname(rel);
    const names = folder === "." ? [] : folder.split("/");
    const segments = names.map((n) => parseSegment(n, rel));

    const shape = segments.map((s) => (s.kind === "static" ? s.value : "[]")).join("/");
    const other = byShape.get(shape);
    if (other) throw new ForgeError("FORGE_WEB_ROUTE", `Routes "${other}" and "/${names.join("/")}" match the same URLs`);
    byShape.set(shape, `/${names.join("/")}`);

    const chain: string[] = [];
    const root = layouts.get(".");
    if (root) chain.push(root);
    for (let i = 1; i <= names.length; i++) {
      const l = layouts.get(names.slice(0, i).join("/"));
      if (l) chain.push(l);
    }

    routes.push({ id: `/${names.join("/")}`, segments, page: join(dir, rel), layouts: chain });
  }

  routes.sort(compareRoutes);
  return {
    dir,
    routes,
    errorPage: errorFiles.length ? join(dir, "+error.svelte") : null,
    rootLayout: layouts.get(".") ?? null,
  };
}

export { matchRoute };
