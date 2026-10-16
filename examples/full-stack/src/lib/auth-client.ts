import { createAuthClient } from "forge/auth/client";

/** Better Auth's native Svelte client, created on first use (browser only). */
let client: ReturnType<typeof createAuthClient> | undefined;
export function authClient() {
  return (client ??= createAuthClient());
}
