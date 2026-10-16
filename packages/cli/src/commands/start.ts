import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Out } from "../util.ts";
import { BUILD_DIR } from "./build.ts";

/** `forge start`: runs the production build (the executable if built with --compile). */
export async function start(root: string, args: string[], out: Out): Promise<number> {
  const dir = join(root, BUILD_DIR);
  const binary = join(dir, "server");
  const script = join(dir, "server.js");
  const cmd = existsSync(binary) ? [binary, ...args] : existsSync(script) ? ["bun", script, ...args] : null;
  if (!cmd) {
    out.ui.fail("No build found: run `bun forge build` first");
    return 1;
  }
  const child = Bun.spawn(cmd, {
    cwd: root,
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...Bun.env, NODE_ENV: "production" },
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
  return child.exited;
}
