import { ForgeError } from "@forge/core";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { currentDeps, globalDepsObject, type ForgeDeps } from "./deps.ts";
import { HttpError, ValidationError } from "./errors.ts";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Schema = z.ZodType;
type MaybePromise<T> = T | Promise<T>;

/* ------------------------------ Path params ------------------------------ */

type CleanParam<P extends string> = P extends `${infer N}{${string}`
  ? CleanParam<N>
  : P extends `${infer N}?`
    ? N
    : P;

/** Extracts `:param` names from a Hono path (`/:id{[0-9]+}/:slug?` -> "id" | "slug"). */
export type PathParams<P extends string> = P extends `${string}:${infer Param}/${infer Rest}`
  ? CleanParam<Param> | PathParams<`/${Rest}`>
  : P extends `${string}:${infer Param}`
    ? CleanParam<Param>
    : never;

/** Input without schema: path params (strings) plus untyped query/body values. */
export type RawInput<P extends string = string> = { [K in PathParams<P>]: string } & Record<string, unknown>;

/* --------------------------------- Types --------------------------------- */

export type DepName = keyof ForgeDeps & string;

/** Dependencies visible to a handler: all of them, or only the declared ones. */
export type DepsOf<D> = D extends readonly DepName[] ? Pick<ForgeDeps, D[number]> : ForgeDeps;

export type HandlerContext<I, D = undefined> = DepsOf<D> & {
  /** Validated input (params + query + body merged when called over HTTP). */
  input: I;
  /** Hono context. Only present when invoked through an HTTP route. */
  http?: Context;
};

/** The "simple function" form: `({ input, db }) => ...`. */
export type Handler<I, R, D = undefined> = (ctx: HandlerContext<I, D>) => R;

export interface ViewMeta {
  summary?: string;
  description?: string;
  tags?: string[];
  [key: string]: unknown;
}

/** Server-side rule evaluated before every remote call (from the browser or from SSR). */
export type AccessRule<I, D> = (ctx: DepsOf<D> & { input: I }) => boolean | Promise<boolean>;

/** Options of `defineView()`: the structured form of an endpoint handler. */
export interface ViewOptions<S, O, D, I, R, Rm extends boolean = false> {
  /** Validates params + query + body (merged). */
  input?: S;
  /**
   * Validates and shapes the result. With a Zod object, unknown keys are
   * stripped: only what the schema declares leaves the server.
   */
  output?: O;
  /** Restricts the dependencies passed to the handler. Default: all. */
  deps?: D;
  meta?: ViewMeta;
  /** Success status. Default 200 (204 when the handler returns undefined). */
  status?: ContentfulStatusCode;
  /**
   * Opt-in: makes the function callable from Svelte through `forge:router`.
   * Nothing is remote by default.
   */
  remote?: Rm;
  /** Checked server-side on every remote call; `false` -> 403. Not applied to in-process calls. */
  access?: AccessRule<I, D>;
  /**
   * Kept non-conditional on purpose: editors compute completions for `input.`
   * from this signature, and a conditional type here would hide them.
   * The output contract is enforced through the `R` constraint instead.
   */
  handler: (ctx: HandlerContext<I, D>) => R;
}

/** What a handler may return given its output schema. */
export type ReturnFor<O> = O extends Schema ? MaybePromise<z.input<O>> : unknown;

export type InOf<S, P extends string> = S extends Schema ? z.output<S> : RawInput<P>;
type CallInOf<S, P extends string> = S extends Schema ? z.input<S> : RawInput<P>;
type OutOf<O, R> = O extends Schema ? z.output<O> : Awaited<R>;

/** A view is callable in-process (no HTTP round-trip), with the same validation as over HTTP. */
type Call<CallIn, Out> = {} extends CallIn
  ? (input?: CallIn, deps?: Partial<ForgeDeps>) => Promise<Out>
  : (input: CallIn, deps?: Partial<ForgeDeps>) => Promise<Out>;

export type View<CallIn = any, In = any, Out = any, Rm extends boolean = boolean> = Call<CallIn, Out> & {
  readonly kind: "view";
  readonly remote: Rm;
  readonly access: AccessRule<In, any> | undefined;
  readonly input: Schema | undefined;
  readonly output: Schema | undefined;
  readonly deps: readonly string[] | undefined;
  readonly meta: ViewMeta | undefined;
  readonly status: ContentfulStatusCode | undefined;
  readonly handler: (ctx: HandlerContext<In, any>) => unknown;
};

export type Endpoint<
  M extends Method = Method,
  P extends string = string,
  CallIn = any,
  In = any,
  Out = any,
  Rm extends boolean = boolean,
> = View<CallIn, In, Out, Rm> & {
  readonly method: M;
  readonly path: P;
};

/* ------------------------------- Execution ------------------------------- */

function issues(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
}

/**
 * Promise-like check, as `await` does: Prisma queries return a lazy
 * PrismaPromise (a thenable), not a `Promise` instance.
 */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null && (typeof value === "object" || typeof value === "function") && typeof (value as PromiseLike<unknown>).then === "function";
}

interface InvokeOptions {
  deps?: Partial<ForgeDeps> | undefined;
  http?: Context | undefined;
  /** Remote call: evaluates the view's `access` rule first. */
  checkAccess?: boolean;
}

function finish(view: View, result: unknown): unknown {
  if (!view.output || result instanceof Response) return result;
  const out = view.output.safeParse(result);
  if (!out.success) {
    // The server produced data that does not match its own contract: a bug, never the client's fault.
    throw new ForgeError(
      "FORGE_OUTPUT_INVALID",
      `View result does not match its output schema: ${JSON.stringify(issues(out.error))}`,
    );
  }
  return out.data;
}

function runHandler(view: View, input: unknown, available: Record<string, unknown>, options: InvokeOptions): unknown {
  let ctx: Record<string, unknown>;
  if (view.deps) {
    ctx = { input };
    for (const name of view.deps) {
      if (!(name in available)) {
        throw new ForgeError("FORGE_DEP_MISSING", `Dependency "${name}" is declared by the view but not provided`);
      }
      ctx[name] = available[name];
    }
  } else {
    // Global dependencies are inherited from one stable prototype (no copy, and
    // the same object shape on every request so engine inline caches stay
    // fast); only request-scoped/overridden entries are copied.
    const global = globalDepsObject();
    ctx = Object.create(global) as Record<string, unknown>;
    if (available !== global) for (const key of Object.keys(available)) ctx[key] = available[key];
    ctx.input = input;
  }
  if (options.http) ctx.http = options.http;
  const returned = view.handler(ctx as unknown as HandlerContext<unknown>);
  return isThenable(returned) ? Promise.resolve(returned).then((r) => finish(view, r)) : finish(view, returned);
}

/**
 * Validates `raw`, injects dependencies, runs the handler and validates its
 * result. Stays synchronous when nothing is asynchronous (no access rule,
 * sync handler): the hot path allocates no promise.
 */
export function run(view: View, raw: unknown, options: InvokeOptions = {}): unknown {
  let input: unknown = raw ?? {};
  if (view.input) {
    const parsed = view.input.safeParse(input);
    if (!parsed.success) throw new ValidationError(issues(parsed.error));
    input = parsed.data;
  }
  const base = currentDeps() as Record<string, unknown>;
  const available: Record<string, unknown> = options.deps ? { ...base, ...options.deps } : base;
  if (options.checkAccess && view.access) {
    const access = view.access;
    return (async () => {
      if (!(await access({ ...available, input } as never))) throw new HttpError(403, "Forbidden");
      return runHandler(view, input, available, options);
    })();
  }
  return runHandler(view, input, available, options);
}

/** Async form of `run` (always returns a promise). */
export async function invoke(view: View, raw: unknown, options: InvokeOptions = {}): Promise<unknown> {
  return run(view, raw, options);
}

type AnyDef = Handler<any, any, any> | ViewOptions<any, any, any, any, any, boolean> | View;

function normalize(def: AnyDef) {
  if (typeof def === "function" && (def as View).kind === "view") {
    const v = def as View;
    const { input, output, deps, meta, status, remote, access, handler } = v;
    return { input, output, deps, meta, status, remote, access, handler };
  }
  if (typeof def === "function") {
    return {
      input: undefined,
      output: undefined,
      deps: undefined,
      meta: undefined,
      status: undefined,
      remote: false,
      access: undefined,
      handler: def,
    };
  }
  const o = def as ViewOptions<Schema | undefined, Schema | undefined, readonly string[] | undefined, any, any, boolean>;
  return {
    input: o.input,
    output: o.output,
    deps: o.deps,
    meta: o.meta,
    status: o.status,
    remote: o.remote === true,
    access: o.access,
    handler: o.handler,
  };
}

function makeView(def: AnyDef, route?: { method: Method; path: string }) {
  const parts = normalize(def);
  const view = ((input?: unknown, deps?: Partial<ForgeDeps>) => invoke(view as View, input, { deps })) as any;
  for (const [key, value] of Object.entries({ kind: "view", ...parts, ...route })) {
    Object.defineProperty(view, key, { value, enumerable: true });
  }
  return view;
}

/* ------------------------------ Public API ------------------------------- */

/**
 * Structured endpoint handler: input/output validation, allowed dependencies,
 * metadata. Mounted on a route by a router or a repository, and still
 * callable directly server-side: `await detail({ id: 1 })`.
 */
export function defineView<
  const S extends Schema | undefined = undefined,
  const O extends Schema | undefined = undefined,
  const D extends readonly DepName[] | undefined = undefined,
  R extends ReturnFor<O> = ReturnFor<O>,
  const Rm extends boolean = false,
>(
  options: ViewOptions<S, O, D, InOf<S, string>, R, Rm>,
): View<CallInOf<S, string>, InOf<S, string>, OutOf<O, R>, Rm> {
  return makeView(options as AnyDef);
}

/** Anything accepted where a route handler is expected: simple function, view options, or a view. */
/**
 * The options form is declared FIRST on purpose: while a handler is being
 * typed it does not type-check yet, and TypeScript then falls back to the
 * first overload for completions, so `input.` keeps suggesting the schema keys.
 */
export interface RouteDefinition<M extends Method> {
  <
    const P extends string,
    const S extends Schema | undefined = undefined,
    const O extends Schema | undefined = undefined,
    const D extends readonly DepName[] | undefined = undefined,
    R extends ReturnFor<O> = ReturnFor<O>,
    const Rm extends boolean = false,
  >(
    path: P,
    options: ViewOptions<S, O, D, InOf<S, P>, R, Rm>,
  ): Endpoint<M, P, CallInOf<S, P>, InOf<S, P>, OutOf<O, R>, Rm>;
  <const P extends string, R>(
    path: P,
    handler: Handler<RawInput<P>, R>,
  ): Endpoint<M, P, RawInput<P>, RawInput<P>, Awaited<R>, false>;
  <const P extends string, CallIn, In, Out, Rm extends boolean>(
    path: P,
    view: View<CallIn, In, Out, Rm>,
  ): Endpoint<M, P, CallIn, In, Out, Rm>;
}

function verb<M extends Method>(method: M): RouteDefinition<M> {
  return ((path: string, def: AnyDef) => makeView(def, { method, path })) as RouteDefinition<M>;
}

export const get = verb("GET");
export const post = verb("POST");
export const put = verb("PUT");
export const patch = verb("PATCH");
export const del = verb("DELETE");

export function isView(value: unknown): value is View {
  return typeof value === "function" && (value as View).kind === "view";
}

export function isEndpoint(value: unknown): value is Endpoint {
  return isView(value) && typeof (value as Endpoint).method === "string";
}
