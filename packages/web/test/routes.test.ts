import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { RPC_CONTENT_TYPE as SERVER_CT, RPC_PREFIX as SERVER_PREFIX } from "@forge/server";
import { matchRoute, scanRoutes } from "../src/routes.ts";
import { RPC_CONTENT_TYPE, RPC_PREFIX } from "../src/shared/constants.ts";

async function project(files: string[]) {
  const dir = await mkdtemp(join(tmpdir(), "forge-web-"));
  for (const f of files) {
    await mkdir(dirname(join(dir, f)), { recursive: true });
    await writeFile(join(dir, f), "<p></p>");
  }
  return dir;
}

describe("scanRoutes", () => {
  test("discovers pages, nested layouts and params", async () => {
    const dir = await project([
      "+layout.svelte",
      "+page.svelte",
      "posts/+page.svelte",
      "posts/[id]/+page.svelte",
      "posts/latest/+page.svelte",
      "dashboard/+layout.svelte",
      "dashboard/+page.svelte",
      "dashboard/settings/+page.svelte",
      "+error.svelte",
    ]);
    const m = await scanRoutes(dir);
    expect(m.routes.map((r) => r.id)).toEqual([
      "/",
      "/dashboard",
      "/posts",
      "/dashboard/settings",
      "/posts/latest",
      "/posts/[id]",
    ]);
    const settings = m.routes.find((r) => r.id === "/dashboard/settings")!;
    expect(settings.layouts).toEqual([join(dir, "+layout.svelte"), join(dir, "dashboard/+layout.svelte")]);
    expect(m.errorPage).toBe(join(dir, "+error.svelte"));
    expect(m.rootLayout).toBe(join(dir, "+layout.svelte"));
  });

  test("static segments win over params", async () => {
    const m = await scanRoutes(await project(["posts/[id]/+page.svelte", "posts/latest/+page.svelte"]));
    expect(matchRoute(m.routes, "/posts/latest")?.route.id).toBe("/posts/latest");
    expect(matchRoute(m.routes, "/posts/42")).toMatchObject({ route: { id: "/posts/[id]" }, params: { id: "42" } });
    expect(matchRoute(m.routes, "/posts/a%20b")?.params).toEqual({ id: "a b" });
    expect(matchRoute(m.routes, "/posts/42/x")).toBeNull();
    expect(matchRoute(m.routes, "/posts/%E0%A4%A")).toBeNull(); // malformed encoding
  });

  test("two routes matching the same URLs are rejected", async () => {
    await expect(scanRoutes(await project(["[a]/+page.svelte", "[b]/+page.svelte"]))).rejects.toThrow("match the same URLs");
  });

  test("unsupported segments fail with a clear message", async () => {
    await expect(scanRoutes(await project(["[...rest]/+page.svelte"]))).rejects.toThrow("Catch-all");
    await expect(scanRoutes(await project(["(group)/+page.svelte"]))).rejects.toThrow("not available yet");
  });

  test("no pages is valid", async () => {
    expect((await scanRoutes(await project([]))).routes).toEqual([]);
  });
});

test("browser and server agree on the RPC protocol constants", () => {
  expect(RPC_PREFIX).toBe(SERVER_PREFIX);
  expect(RPC_CONTENT_TYPE).toBe(SERVER_CT);
});

describe("matchRoute (segment tree)", () => {
  const r = (id: string) => ({
    id,
    segments: id.split("/").filter(Boolean).map((s) =>
      s.startsWith("[") ? ({ kind: "param", name: s.slice(1, -1) } as const) : ({ kind: "static", value: s } as const),
    ),
  });

  test("backtracks from a static branch to a param branch", () => {
    const routes = [r("/posts/latest/edit"), r("/posts/[id]"), r("/posts/[slug]/comments")];
    expect(matchRoute(routes, "/posts/latest")).toMatchObject({ route: { id: "/posts/[id]" }, params: { id: "latest" } });
    expect(matchRoute(routes, "/posts/latest/edit")?.route.id).toBe("/posts/latest/edit");
    expect(matchRoute(routes, "/posts/hello/comments")).toMatchObject({ params: { slug: "hello" } });
    expect(matchRoute(routes, "/")).toBeNull();
  });

  test("root route and nested params", () => {
    const routes = [r("/"), r("/[org]/[repo]")];
    expect(matchRoute(routes, "/")?.route.id).toBe("/");
    expect(matchRoute(routes, "/a/b")?.params).toEqual({ org: "a", repo: "b" });
  });
});
