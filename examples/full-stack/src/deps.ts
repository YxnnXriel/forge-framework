import type { Context } from "forge/server";

declare global {
  namespace Forge {
    interface Deps {
      /** Demo session (cookie `demo_user`), replaced by Better Auth in a later phase. */
      user: { name: string } | null;
    }
  }
}

/** Demo session from a cookie, until Better Auth is integrated. */
export function demoUser(c: Context) {
  const name = /(?:^|;\s*)demo_user=([^;]+)/.exec(c.req.header("cookie") ?? "")?.[1];
  return { user: name ? { name: decodeURIComponent(name) } : null };
}
