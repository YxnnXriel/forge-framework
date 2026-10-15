import { ForgeError } from "@forge/core";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { currentDeps, provideDeps, runWithDeps, type ForgeDeps } from "./deps.ts";
import { HttpError, ValidationError } from "./errors.ts";
import { readInput } from "./input.ts";
import { endpointsOf, isRepository, type Repository } from "./repository.ts";
import {
  del,
  get,
  invoke,
  patch,
  post,
  put,
  type DepName,
  type Endpoint,
  type Handler,
  type InOf,
  type Method,
  type RawInput,
  type ReturnFor,
  type RouteDefinition,
  type Schema,
  type View,
  type ViewOptions,
} from "./view.ts";

function toHonoHandler(endpoint: Endpoint) {
  return async (c: Context) => {
    const raw = await readInput(c);
    const result = await invoke(endpoint, raw, { http: c });
    if (result instanceof Response) return result;
    if (result === undefined) return c.body(null, 204);
    return c.json(result as never, endpoint.status ?? 200);
  };
}

function joinPath(prefix: string, path: string): string {
  const joined = `${prefix.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  return joined.length > 1 ? joined.replace(/\/+$/, "") : "/";
}

/**
 * Local router of a domain (`apps/<domain>/urls.ts`). Accepts the three ways
 * of writing an endpoint:
 *
 *   createRouter()
 *     .get("/health", () => "ok")       // 1. simple function
 *     .get("/:id", detail)               // 2. defineView()
 *     .mount(posts)                      // 3. defineRepository()
 *
 * Native Hono stays reachable through `.hono` and `.use()` takes any Hono
 * middleware. Routes are matched in registration order.
 */
export class Router {
  readonly hono = new Hono();

  use(...middlewares: MiddlewareHandler[]): this {
    for (const mw of middlewares) this.hono.use(mw);
    return this;
  }

  private add(method: Method, path: string, def: unknown): this {
    const factory = { GET: get, POST: post, PUT: put, PATCH: patch, DELETE: del }[method] as RouteDefinition<Method>;
    const endpoint = (factory as (p: string, d: unknown) => Endpoint)(path, def);
    this.hono.on(method, path, toHonoHandler(endpoint));
    return this;
  }

  readonly get: RouteMethod = (path: string, def: unknown) => this.add("GET", path, def);
  readonly post: RouteMethod = (path: string, def: unknown) => this.add("POST", path, def);
  readonly put: RouteMethod = (path: string, def: unknown) => this.add("PUT", path, def);
  readonly patch: RouteMethod = (path: string, def: unknown) => this.add("PATCH", path, def);
  readonly delete: RouteMethod = (path: string, def: unknown) => this.add("DELETE", path, def);

  /** Registers the endpoints of a repository, optionally under a sub-prefix. */
  mount(repository: Repository): this;
  mount(prefix: string, repository: Repository): this;
  mount(a: string | Repository, b?: Repository): this {
    const [prefix, repository] = typeof a === "string" ? [a, b!] : ["/", a];
    for (const [, endpoint] of endpointsOf(repository)) {
      this.hono.on(endpoint.method, joinPath(prefix, endpoint.path), toHonoHandler(endpoint));
    }
    return this;
  }
}

/** Same accepted forms as the verb helpers, but returns the router for chaining. */
interface RouteMethod {
  // Options form first: see RouteDefinition in view.ts (editor completions).
  <
    const P extends string,
    const S extends Schema | undefined = undefined,
    const O extends Schema | undefined = undefined,
    const D extends readonly DepName[] | undefined = undefined,
    R extends ReturnFor<O> = ReturnFor<O>,
  >(
    path: P,
    options: ViewOptions<S, O, D, InOf<S, P>, R>,
  ): Router;
  <const P extends string, R>(path: P, handler: Handler<RawInput<P>, R>): Router;
  (path: string, view: View): Router;
}

export function createRouter(): Router {
  return new Router();
}

export type UrlTarget = Repository | Router | Hono<any, any, any>;
const URLS = Symbol.for("forge.urls");

export interface Urls {
  readonly [URLS]: true;
  readonly entries: ReadonlyArray<readonly [prefix: string, target: UrlTarget]>;
}

export function isUrls(value: unknown): value is Urls {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[URLS] === true;
}

/** Global backend route registry (`src/urls.ts`): prefix -> router, repository or Hono app. */
export function defineUrls(map: Record<string, UrlTarget>): Urls {
  const entries = Object.entries(map).map(([prefix, target]) => {
    if (!prefix.startsWith("/")) {
      throw new ForgeError("FORGE_URLS_INVALID", `URL prefix "${prefix}" must start with "/"`);
    }
    if (!isRepository(target) && !(target instanceof Router) && !(target instanceof Hono)) {
      throw new ForgeError("FORGE_URLS_INVALID", `"${prefix}" must map to a router, a repository or a Hono app`);
    }
    return [prefix, target] as const;
  });
  return { [URLS]: true, entries };
}

function toHono(target: UrlTarget): Hono<any, any, any> {
  if (target instanceof Router) return target.hono;
  if (isRepository(target)) return createRouter().mount(target).hono;
  return target;
}

export interface ServerOptions {
  urls: Urls;
  /** Process-wide dependencies (db client, mailer...). */
  deps?: Partial<ForgeDeps>;
  /** Per-request dependencies, merged over the global ones (session, user...). */
  requestDeps?: (c: Context) => Partial<ForgeDeps> | Promise<Partial<ForgeDeps>>;
  /** Called for unexpected errors (default: console.error). Never sent to the client. */
  onUnexpectedError?: (error: unknown, c: Context) => void;
}

/** Assembles the application: dependency scope, routes from `urls`, error handling. */
export function createServer(options: ServerOptions): Hono {
  provideDeps(options.deps ?? {});
  const app = new Hono();

  app.use(async (c, next) => {
    const extra = options.requestDeps ? await options.requestDeps(c) : {};
    await runWithDeps({ ...currentDeps(), ...extra }, next);
  });

  for (const [prefix, target] of options.urls.entries) app.route(prefix, toHono(target));

  app.notFound((c) => c.json({ error: "Not Found" }, 404));
  app.onError((err, c) => {
    if (err instanceof ValidationError) return c.json({ error: err.message, issues: err.issues }, 400);
    if (err instanceof HttpError) {
      const body = err.details === undefined ? { error: err.message } : { error: err.message, details: err.details };
      return c.json(body, err.status);
    }
    (options.onUnexpectedError ?? ((e) => console.error(e)))(err, c);
    return c.json({ error: "Internal Server Error" }, 500);
  });

  return app;
}

/** Starts the app with `Bun.serve`. Port/hostname default to Bun's own resolution. */
export function serve(app: Hono, server: { port?: number; hostname?: string } = {}) {
  return Bun.serve({ fetch: app.fetch, ...server });
}
