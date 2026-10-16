import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "forge";
import { join } from "node:path";
import { posts } from "../src/apps/posts/repository.ts";
import { PostStore } from "../src/store.ts";

const root = join(import.meta.dir, "..");
let app: Awaited<ReturnType<typeof createApp>>["app"];

beforeEach(async () => {
  const store = new PostStore([
    { title: "Published", body: "", published: true, authorEmail: "a@b.c" },
    { title: "Draft", body: "", published: false, authorEmail: "a@b.c" },
  ]);
  ({ app } = await createApp({ root, deps: { store } }));
});

const json = (body: unknown) => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("api-only example", () => {
  test("simple function", async () => {
    expect(await (await app.request("/api/posts/health")).json()).toEqual({ ok: true });
  });

  test("defineView", async () => {
    expect(await (await app.request("/api/posts/stats")).json()).toEqual({ total: 2, published: 1 });
  });

  test("repository CRUD, never leaking internal fields", async () => {
    const list = await (await app.request("/api/posts?published=true")).json();
    expect(list).toEqual([{ id: 1, title: "Published", body: "", published: true }]);

    const created = await app.request("/api/posts", { method: "POST", ...json({ title: "New" }) });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ id: 3, title: "New", body: "", published: false });

    const updated = await app.request("/api/posts/3", { method: "PUT", ...json({ published: true }) });
    expect(await updated.json()).toEqual({ id: 3, title: "New", body: "", published: true });

    expect((await app.request("/api/posts/3", { method: "DELETE" })).status).toBe(204);
    expect((await app.request("/api/posts/3")).status).toBe(404);
  });

  test("validation errors are explicit", async () => {
    const res = await app.request("/api/posts", { method: "POST", ...json({ title: "" }) });
    expect(res.status).toBe(400);
    expect((await res.json()).issues[0].path).toBe("title");
  });

  test("repository functions are reusable without HTTP", async () => {
    expect(await posts.detail({ id: 1 })).toEqual({ id: 1, title: "Published", body: "", published: true });
  });
});
