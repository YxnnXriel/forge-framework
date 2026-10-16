import { beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import * as devalue from "devalue";
import { createApp, type App } from "forge";
import { createStore, demoUser } from "../src/deps.ts";

let app: App["app"];

beforeEach(async () => {
  ({ app } = await createApp({
    root: join(import.meta.dir, ".."),
    deps: { store: createStore(), user: null },
    requestDeps: demoUser,
    onUnexpectedError: () => {},
  }));
});

const rpc = (name: string, input: unknown, headers: Record<string, string> = {}) =>
  app.request(`/__forge/rpc/${name}`, {
    method: "POST",
    headers: { "content-type": "application/x-forge+devalue", ...headers },
    body: devalue.stringify(input),
  });

describe("SSR", () => {
  test("renders the page with its layouts and the data needed for hydration", async () => {
    const res = await app.request("/posts/1");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain("<h1>Bienvenue sur Forge</h1>"); // page
    expect(html).toContain("layout : 0"); // root layout
    expect(html).toContain("forge:posts.detail:"); // hydration cache entry
    expect(html).toContain("new Date("); // Date survives serialization
    expect(html).not.toContain("authorEmail"); // stripped by the output schema
    expect(html).toMatch(/<link rel="modulepreload" href="\/_forge\/\+page-[\w-]+\.js">/);
  });

  test("statuses: 404 from a remote error, 404 for unknown routes, 308 for trailing slashes", async () => {
    const missing = await app.request("/posts/999");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("Article introuvable");
    expect((await app.request("/nope")).status).toBe(404);
    const slash = await app.request("/posts/");
    expect(slash.status).toBe(308);
    expect(slash.headers.get("location")).toBe("/posts");
  });

  test("API routes and pages coexist; public files are served", async () => {
    expect((await app.request("/api/posts")).headers.get("content-type")).toContain("application/json");
    expect((await app.request("/posts")).headers.get("content-type")).toContain("text/html");
    expect((await app.request("/favicon.svg")).status).toBe(200);
    expect((await app.request("/../forge.config.ts")).status).toBe(404);
  });

  test("client bundle is served with its hashed name", async () => {
    const html = await (await app.request("/")).text();
    const entry = /<script type="module" src="([^"]+)"/.exec(html)![1]!;
    const js = await app.request(entry);
    expect(js.status).toBe(200);
    expect(await js.text()).not.toContain("authorEmail@");
  });
});

describe("remote calls", () => {
  test("returns devalue-encoded data (Dates preserved)", async () => {
    const res = await rpc("posts.detail", { id: 1 });
    expect(res.status).toBe(200);
    const reply = devalue.parse(await res.text());
    expect(reply.ok).toBe(true);
    expect(reply.data.createdAt).toBeInstanceOf(Date);
  });

  test("only functions marked remote are reachable", async () => {
    expect((await rpc("posts.purge", null)).status).toBe(404);
    expect((await rpc("posts.nope", null)).status).toBe(404);
    expect((await app.request("/api/posts/purge", { method: "POST" })).status).toBe(204); // still an HTTP route
  });

  test("input is validated", async () => {
    const res = await rpc("posts.detail", { id: "abc" });
    expect(res.status).toBe(400);
    expect(devalue.parse(await res.text()).issues[0].path).toBe("id");
  });

  test("access rules are enforced", async () => {
    expect((await rpc("posts.create", { title: "x" })).status).toBe(403);
    const ok = await rpc("posts.create", { title: "x" }, { cookie: "demo_user=ariel" });
    expect(ok.status).toBe(200);
  });

  test("cross-site calls are rejected (CSRF)", async () => {
    expect((await rpc("posts.list", null, { origin: "https://evil.example" })).status).toBe(403);
    expect((await rpc("posts.list", null, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    const form = await app.request("/__forge/rpc/posts.list", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "a=1",
    });
    expect(form.status).toBe(403);
  });
});
