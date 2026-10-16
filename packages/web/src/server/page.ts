import { AsyncLocalStorage } from "node:async_hooks";
import { ForgeError } from "@forge/core";
import type { Context } from "hono";

export interface PageError {
  message: string;
}

export interface PageState {
  url: URL;
  params: Record<string, string>;
  /** Route id, e.g. `/posts/[id]`. Empty when no route matched. */
  route: string;
  status: number;
  error: PageError | null;
  /** Request context, used to run remote calls with the request's session. */
  http?: Context;
}

/** One state per request being rendered: never shared between concurrent requests. */
export const pageScope = new AsyncLocalStorage<PageState>();

function current(): PageState {
  const state = pageScope.getStore();
  if (!state) throw new ForgeError("FORGE_WEB_CONTEXT", "`page` from forge:web is only available while rendering a page");
  return state;
}

/** Server implementation of `page` from "forge:web". */
export const page = {
  get url(): URL {
    return current().url;
  },
  get params(): Record<string, string> {
    return current().params;
  },
  get route(): string {
    return current().route;
  },
  get status(): number {
    return current().status;
  },
  get error(): PageError | null {
    return current().error;
  },
};

export function goto(): never {
  throw new ForgeError("FORGE_WEB_CONTEXT", "goto() only works in the browser; use redirect() on the server");
}
