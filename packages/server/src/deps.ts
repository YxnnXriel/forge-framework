import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "hono";

declare global {
  namespace Forge {
    /**
     * Server dependencies injected into every handler (`db`, `auth`, ...).
     * Augmented by Forge's generated types and by the application:
     *
     *   declare global { namespace Forge { interface Deps { mailer: Mailer } } }
     */
    interface Deps {}
  }
}

export type ForgeDeps = Forge.Deps;

let globalDeps: Partial<ForgeDeps> = {};
const requestScope = new AsyncLocalStorage<Partial<ForgeDeps>>();

/** Registers process-wide dependencies (called once at startup by the server). */
export function provideDeps(deps: Partial<ForgeDeps>): void {
  globalDeps = deps;
}

/** Runs `fn` with request-scoped dependencies; internal calls made inside inherit them. */
export function runWithDeps<T>(deps: Partial<ForgeDeps>, fn: () => T): T {
  return requestScope.run(deps, fn);
}

/** Current dependencies: request scope if any, otherwise the global ones. */
export function currentDeps(): Partial<ForgeDeps> {
  return requestScope.getStore() ?? globalDeps;
}

type RequestDepsProvider = (c: Context) => Partial<ForgeDeps> | Promise<Partial<ForgeDeps>>;
let requestProvider: RequestDepsProvider | null = null;

/** Registers the per-request dependencies factory (session, user...). */
export function provideRequestDeps(provider: RequestDepsProvider | null): void {
  requestProvider = provider;
}

/**
 * Runs `fn` with this request's dependencies. Zero cost when the app declares
 * no per-request dependencies: no AsyncLocalStorage scope is opened at all.
 * Used by Forge endpoints, remote calls and SSR; native Hono handlers can use
 * it too when they call Forge functions.
 */
export function inRequestScope<T>(c: Context, fn: () => T | Promise<T>): T | Promise<T> {
  if (!requestProvider) return fn(); // no extra promise on the hot path
  const provider = requestProvider;
  return (async () => {
    const extra = await provider(c);
    return requestScope.run({ ...globalDeps, ...extra }, fn);
  })();
}
