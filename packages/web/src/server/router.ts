import { callRemote } from "@forge/server";
import * as devalue from "devalue";
import { hydratable } from "svelte";
import { hydrationKey } from "../shared/constants.ts";
import { pageScope } from "./page.ts";
import { createRemoteProxy } from "../shared/proxy.ts";

/**
 * Server implementation of `forge` from "forge:router": calls run in-process
 * (no HTTP) with the current request's dependencies and access rules. During
 * SSR the result is serialized by Svelte (`hydratable`) so the browser
 * reuses it instead of calling again while hydrating.
 */
export const forge = createRemoteProxy((name, input) => {
  const scope = pageScope.getStore();
  const run = () => callRemote(name, input, scope?.http);
  return scope ? hydratable(hydrationKey(name, devalue.stringify(input ?? null)), run) : run();
});
