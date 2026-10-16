import { expect, test } from "bun:test";
import { withRequestLog } from "../src/logger.ts";

test("one line per request: method, path, status, time; RPC by name; skipped paths", async () => {
  const lines: string[] = [];
  const fetch = withRequestLog(
    (req) => (req.url.endsWith("/slow") ? Promise.resolve(new Response("", { status: 404 })) : new Response("ok")),
    { color: false, write: (l) => lines.push(l), skip: (p) => p.startsWith("/_forge/") },
  );
  const server = {} as never;
  await fetch(new Request("http://x/todos?page=2"), server);
  await fetch(new Request("http://x/slow", { method: "DELETE" }), server);
  await fetch(new Request("http://x/__forge/rpc/todos.create", { method: "POST" }), server);
  await fetch(new Request("http://x/_forge/entry.js"), server);
  expect(lines).toHaveLength(3);
  expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT.* GET \/todos 200 \d/);
  expect(lines[1]).toContain(" DELETE /slow 404 ");
  expect(lines[2]).toContain(" RPC todos.create 200 ");
});

test("a throwing handler is logged as 500 and rethrown", () => {
  const lines: string[] = [];
  const fetch = withRequestLog(() => {
    throw new Error("boom");
  }, { write: (l) => lines.push(l) });
  expect(() => fetch(new Request("http://x/"), {} as never)).toThrow("boom");
  expect(lines[0]).toContain(" GET / 500 ");
});
