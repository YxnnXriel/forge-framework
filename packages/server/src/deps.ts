import { AsyncLocalStorage } from "node:async_hooks";

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
