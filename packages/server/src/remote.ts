import { basename, dirname, join } from "node:path";
import { ForgeError } from "@forge/core";
import * as devalue from "devalue";
import type { Context, Hono } from "hono";
import { HttpError, Redirect, ValidationError } from "./errors.ts";
import { endpointsOf, isRepository, type Repository } from "./repository.ts";
import { invoke, type Endpoint } from "./view.ts";

/**
 * Registry of the functions explicitly marked `remote: true`, keyed
 * `<app>.<function>` (e.g. `posts.detail`). It is the only door from the
 * browser to repository code: anything not listed here cannot be called.
 */
const registry = new Map<string, Endpoint>();

export const RPC_PREFIX = "/__forge/rpc/";
export const RPC_CONTENT_TYPE = "application/x-forge+devalue";

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export function registerRemotes(namespace: string, repository: Repository): string[] {
  if (!IDENTIFIER.test(namespace)) {
    throw new ForgeError("FORGE_REMOTE_INVALID", `App folder "${namespace}" must be a valid identifier to expose remote functions`);
  }
  const added: string[] = [];
  for (const [name, endpoint] of endpointsOf(repository)) {
    if (!endpoint.remote) continue;
    const key = `${namespace}.${name}`;
    if (registry.has(key) && registry.get(key) !== endpoint) {
      throw new ForgeError("FORGE_REMOTE_CONFLICT", `Remote function "${key}" is registered twice`);
    }
    registry.set(key, endpoint);
    added.push(key);
  }
  return added;
}

export function clearRemotes(): void {
  registry.clear();
}

export function listRemotes(): string[] {
  return [...registry.keys()].sort();
}

export interface DiscoveredApp {
  /** Namespace used by `forge:router` (the app folder name). */
  name: string;
  /** Absolute path of `repository.ts`. */
  file: string;
  remotes: string[];
}

/**
 * Discovers `<appsDir>/<app>/repository.ts`, registers the remote functions of
 * the repository it exports under `forge.<app>`.
 */
export async function discoverRemotes(appsDir: string): Promise<DiscoveredApp[]> {
  const apps: DiscoveredApp[] = [];
  const glob = new Bun.Glob("*/repository.{ts,js}");
  for await (const rel of glob.scan({ cwd: appsDir, onlyFiles: true })) {
    const file = join(appsDir, rel);
    const name = basename(dirname(file));
    const mod: Record<string, unknown> = await import(file);
    const repositories = Object.values(mod).filter(isRepository);
    if (repositories.length > 1) {
      throw new ForgeError("FORGE_REMOTE_INVALID", `${file} exports ${repositories.length} repositories; expected one per app`);
    }
    if (repositories.length === 0) continue;
    apps.push({ name, file, remotes: registerRemotes(name, repositories[0]!) });
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Runs a remote function in-process: same validation and access control as
 * a call coming from the browser. Used by SSR (`forge:router` on the server).
 */
export async function callRemote(name: string, input: unknown, http?: Context): Promise<unknown> {
  const endpoint = registry.get(name);
  if (!endpoint) throw new HttpError(404, `Unknown remote function "${name}"`);
  const result = await invoke(endpoint, input, { checkAccess: true, http });
  if (result instanceof Response) {
    throw new ForgeError("FORGE_REMOTE_INVALID", `Remote function "${name}" returned a Response; return data instead`);
  }
  return result;
}

export type RpcReply =
  | { ok: true; data: unknown }
  | { ok: false; status: number; error: string; issues?: unknown }
  | { ok: false; redirect: string; status: number };

function reply(c: Context, body: RpcReply, status: number) {
  return c.body(devalue.stringify(body), status as never, { "content-type": RPC_CONTENT_TYPE });
}

/** Rejects cross-site calls (CSRF): the custom content-type forces a CORS preflight, Origin must match. */
function isSameOrigin(c: Context): boolean {
  const site = c.req.header("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = c.req.header("origin");
  return !origin || origin === new URL(c.req.url).origin;
}

/** `POST /__forge/rpc/<app>.<function>`: the browser side of `forge:router`. */
export function mountRemote(app: Hono<any, any, any>, onUnexpectedError: (e: unknown) => void = console.error): void {
  app.post(`${RPC_PREFIX}:name`, async (c) => {
    if (!(c.req.header("content-type") ?? "").startsWith(RPC_CONTENT_TYPE) || !isSameOrigin(c)) {
      return reply(c, { ok: false, status: 403, error: "Forbidden" }, 403);
    }
    let input: unknown;
    try {
      const text = await c.req.text();
      input = text ? devalue.parse(text) : undefined;
    } catch {
      return reply(c, { ok: false, status: 400, error: "Malformed payload" }, 400);
    }
    try {
      const data = await callRemote(c.req.param("name"), input, c);
      return reply(c, { ok: true, data }, 200);
    } catch (err) {
      if (err instanceof Redirect) return reply(c, { ok: false, redirect: err.location, status: err.status }, 200);
      if (err instanceof ValidationError) {
        return reply(c, { ok: false, status: 400, error: err.message, issues: err.issues }, 400);
      }
      if (err instanceof HttpError) return reply(c, { ok: false, status: err.status, error: err.message }, err.status);
      onUnexpectedError(err);
      return reply(c, { ok: false, status: 500, error: "Internal Server Error" }, 500);
    }
  });
}
