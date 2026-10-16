// Shared by the server and the browser bundle: must not import server code.

/** Must match `RPC_PREFIX` / `RPC_CONTENT_TYPE` in @forge/server (checked by a test). */
export const RPC_PREFIX = "/__forge/rpc/";
export const RPC_CONTENT_TYPE = "application/x-forge+devalue";

/** Public URL prefix of the client bundle. */
export const ASSETS_PREFIX = "/_forge/";

/** DOM ids used between the SSR output and the client runtime. */
export const ROOT_ID = "__forge";
export const STATE_ID = "__forge_state";

/** Key of a remote call in Svelte's hydration cache. */
export function hydrationKey(name: string, serializedInput: string): string {
  return `forge:${name}:${serializedInput}`;
}
