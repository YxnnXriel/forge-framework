import { existsSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "forge";
import { createTestDatabase, listMigrations } from "forge/testing";
import { seed } from "../src/seed.ts";

export const root = join(import.meta.dir, "..");

/** Needs the generated client and at least one migration (`forge db migrate`). */
export const dbReady = existsSync(join(root, "generated/prisma/client.ts")) && (await listMigrations(root)).length > 0;
if (!dbReady) {
  console.warn("[full-stack] database tests skipped: run `bun run forge db migrate` in examples/full-stack");
}

Bun.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-42";
Bun.env.BETTER_AUTH_URL = "http://localhost";

/** App on a fresh, migrated and seeded SQLite database. */
export async function freshApp() {
  const { url } = await createTestDatabase(root);
  Bun.env.DATABASE_URL = url;
  const built = await createApp({ root, onUnexpectedError: () => {} });
  await seed(built.deps);
  return built;
}

/** Signs up through Better Auth's HTTP API and returns the session cookie. */
export async function signUp(app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> }, name = "lea") {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ email: `${name}@example.com`, password: "very-secret-password", name }),
  });
  if (!res.ok) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

/** `forge build` once, then `bun .forge/build/server.js` on a free port (current DATABASE_URL). */
let built: Promise<void> | null = null;
export async function startBuiltServer(projectRoot: string) {
  built ??= (async () => {
    const { run } = await import("forge/cli");
    const logs: string[] = [];
    const code = await run(["build"], { root: projectRoot, out: { log: (m) => logs.push(m), error: (m) => logs.push(m) } });
    if (code !== 0) throw new Error(`forge build failed:\n${logs.join("\n")}`);
  })();
  await built;
  // A free port, known in advance: Better Auth checks the origin against BETTER_AUTH_URL.
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = String(probe.port);
  probe.stop(true);
  const proc = Bun.spawn(["bun", join(projectRoot, ".forge/build/server.js"), "start"], {
    cwd: projectRoot,
    env: { ...Bun.env, PORT: port, BETTER_AUTH_URL: `http://localhost:${port}`, NODE_ENV: "production" },
    stdout: "pipe",
    stderr: "inherit",
  });
  const reader = proc.stdout.getReader();
  let output = "";
  while (!/Forge ready on (\S+)/.test(output)) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`built server exited:\n${output}`);
    output += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  const base = /Forge ready on (\S+)/.exec(output)![1]!.replace(/\/$/, "");
  return { base, stop: async () => void (proc.kill(), await proc.exited) };
}
