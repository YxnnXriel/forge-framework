import * as devalue from "devalue";
import { hydratable } from "svelte";
import { createRemoteProxy } from "../shared/proxy.ts";
import { RPC_CONTENT_TYPE, RPC_PREFIX, hydrationKey } from "../shared/constants.ts";
import { RemoteError } from "../shared/errors.ts";
import { goto } from "./navigation.ts";
import { nav } from "./state.svelte.ts";

type Reply =
  | { ok: true; data: unknown }
  | { ok: false; status: number; error: string; issues?: unknown }
  | { ok: false; redirect: string; status: number };

async function rpc(name: string, input: unknown): Promise<unknown> {
  const res = await fetch(RPC_PREFIX + name, {
    method: "POST",
    headers: { "content-type": RPC_CONTENT_TYPE },
    body: devalue.stringify(input ?? null),
  });
  let reply: Reply;
  try {
    reply = devalue.parse(await res.text()) as Reply;
  } catch {
    throw new RemoteError(res.status, res.statusText || "Remote call failed");
  }
  if (reply.ok) return reply.data;
  if ("redirect" in reply) {
    await goto(reply.redirect);
    return new Promise(() => {}); // the caller is being navigated away
  }
  throw new RemoteError(reply.status, reply.error, reply.issues);
}

/** Browser implementation of `forge` from "forge:router". */
export const forge = createRemoteProxy((name, input) => {
  const run = () => rpc(name, input);
  return nav.hydrating ? hydratable(hydrationKey(name, devalue.stringify(input ?? null)), run) : run();
});
