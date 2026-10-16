import { describe, expect, test } from "bun:test";
import { ForgeError } from "@forge/core";
import { logger } from "hono/logger";
import { z } from "zod";
import {
  createRouter,
  createServer,
  defineRepository,
  defineUrls,
  defineView,
  error,
  ValidationError,
} from "../src/index.ts";

type Post = { id: number; title: string; secret?: string };

function fakeDb(rows: Post[] = [{ id: 1, title: "Hello", secret: "s3cr3t" }]) {
  return {
    post: {
      findMany: async () => rows,
      findUnique: async ({ where }: { where: { id: number } }) => rows.find((r) => r.id === where.id) ?? null,
      create: async ({ data }: { data: Omit<Post, "id"> }) => {
        const row = { id: rows.length + 1, ...data };
        rows.push(row);
        return row;
      },
      delete: async ({ where }: { where: { id: number } }) => {
        rows.splice(rows.findIndex((r) => r.id === where.id), 1);
      },
    },
  };
}

declare global {
  namespace Forge {
    interface Deps {
      db: ReturnType<typeof fakeDb>;
      user: { id: string } | null;
    }
  }
}

const PublicPost = z.object({ id: z.number(), title: z.string() });

/* 2. defineView: structured endpoint */
const detail = defineView({
  input: z.object({ id: z.coerce.number().int() }),
  output: PublicPost,
  deps: ["db"],
  meta: { summary: "Get one post" },
  handler: async ({ input, db }) => (await db.post.findUnique({ where: { id: input.id } })) ?? error(404, "Post not found"),
});

/* 3. defineRepository: endpoints of a domain */
const posts = defineRepository(({ get, post, del }) => ({
  list: get("/", ({ db }) => db.post.findMany()),
  detail: get("/:id", detail),
  create: post("/", {
    input: z.object({ title: z.string().min(1) }),
    output: PublicPost,
    status: 201,
    handler: ({ input, db }) => db.post.create({ data: input }),
  }),
  remove: del("/:id", async ({ input, db }) => {
    await db.post.delete({ where: { id: Number(input.id) } });
  }),
  raw: get("/raw/:slug", ({ input, http }) => http!.text(`slug=${input.slug}`)),
  whoami: get("/me", ({ user }) => ({ user })),
  /** Plain helper: kept as-is, never exposed. */
  slugify: (title: string) => title.toLowerCase().replaceAll(" ", "-"),
}));

function app(db = fakeDb()) {
  return createServer({
    urls: defineUrls({ "/api/posts": posts }),
    deps: { db, user: null },
    requestDeps: (c) => ({ user: c.req.header("x-user") ? { id: c.req.header("x-user")! } : null }),
    onUnexpectedError: () => {},
  });
}

describe("defineView", () => {
  test("is callable in-process with validated input", async () => {
    app();
    expect(await detail({ id: "1" })).toEqual({ id: 1, title: "Hello" });
    expect(detail({ id: "x" })).rejects.toBeInstanceOf(ValidationError);
  });

  test("output schema strips undeclared fields, internally and over HTTP", async () => {
    const a = app();
    expect(await detail({ id: 1 })).not.toHaveProperty("secret");
    expect(await (await a.request("/api/posts/1")).json()).toEqual({ id: 1, title: "Hello" });
  });

  test("an output not matching its schema is a server error", async () => {
    const broken = defineView({ output: z.object({ n: z.number() }), handler: () => ({ n: "x" }) as never });
    await expect(broken()).rejects.toMatchObject({ code: "FORGE_OUTPUT_INVALID" });
  });

  test("declared deps restrict what the handler receives", async () => {
    app();
    const seen = defineView({ deps: ["db"], handler: (ctx) => Object.keys(ctx).sort() });
    expect(await seen()).toEqual(["db", "input"]);
  });

  test("a declared dep that is not provided fails clearly", async () => {
    createServer({ urls: defineUrls({}), deps: {} });
    const needsDb = defineView({ deps: ["db"], handler: () => 1 });
    await expect(needsDb()).rejects.toBeInstanceOf(ForgeError);
  });

  test("keeps its metadata", () => {
    expect(detail.meta).toEqual({ summary: "Get one post" });
  });

  test("dependencies can be overridden per call", async () => {
    app();
    expect(await posts.list(undefined, { db: fakeDb([]) })).toEqual([]);
  });

  test("thenables (PrismaPromise) are awaited like promises, over HTTP too", async () => {
    const lazy = <T,>(value: T) => ({ then: (ok: (v: T) => unknown) => ok(value) });
    const r = defineRepository(({ get }) => ({
      list: get("/", { output: z.array(z.number()), handler: () => lazy([1, 2]) as never }),
    }));
    const a = createServer({ urls: defineUrls({ "/t": r }) });
    expect(await (await a.request("/t")).json()).toEqual([1, 2]);
    expect(await r.list()).toEqual([1, 2]);
  });

  test("http context is absent on internal calls", async () => {
    app();
    const probe = defineView({ handler: ({ http }) => http === undefined });
    expect(await probe()).toBe(true);
  });
});

describe("defineRepository over HTTP", () => {
  test("list and detail", async () => {
    const a = app();
    expect((await (await a.request("/api/posts")).json())[0].title).toBe("Hello");
    expect((await a.request("/api/posts/99")).status).toBe(404);
  });

  test("POST validates JSON and form bodies and uses the declared status", async () => {
    const a = app();
    const json = await a.request("/api/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "New" }),
    });
    expect(json.status).toBe(201);
    expect(await json.json()).toEqual({ id: 2, title: "New" });

    const form = await a.request("/api/posts", { method: "POST", body: new URLSearchParams({ title: "Form" }) });
    expect(form.status).toBe(201);

    const bad = await a.request("/api/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "" }),
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).issues[0].path).toBe("title");
  });

  test("undefined gives 204, Response passes through", async () => {
    const a = app();
    expect((await a.request("/api/posts/1", { method: "DELETE" })).status).toBe(204);
    expect(await (await a.request("/api/posts/raw/abc")).text()).toBe("slug=abc");
  });

  test("a key present in two sources is rejected", async () => {
    const res = await app().request("/api/posts/1?id=2");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('"id"');
  });

  test("malformed JSON gives 400", async () => {
    const res = await app().request("/api/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{oops",
    });
    expect(res.status).toBe(400);
  });

  test("plain entries are callable but not routed", async () => {
    expect(posts.slugify("Hello World")).toBe("hello-world");
    expect((await app().request("/api/posts/slugify")).status).toBe(400); // matched /:id, not a slugify route
  });

  test("unexpected errors never leak their message", async () => {
    const boom = defineRepository(({ get }) => ({
      x: get("/", () => {
        throw new Error("DATABASE_URL=postgres://secret");
      }),
    }));
    const res = await createServer({ urls: defineUrls({ "/boom": boom }), onUnexpectedError: () => {} }).request("/boom");
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret");
  });

  test("request-scoped deps reach handlers and nested internal calls", async () => {
    const nested = defineRepository(({ get }) => ({ me: get("/", () => posts.whoami()) }));
    const a = createServer({
      urls: defineUrls({ "/nested": nested }),
      deps: { db: fakeDb(), user: null },
      requestDeps: () => ({ user: { id: "u1" } }),
    });
    expect(await (await a.request("/nested")).json()).toEqual({ user: { id: "u1" } });
    expect(await (await app().request("/api/posts/me", { headers: { "x-user": "u2" } })).json()).toEqual({
      user: { id: "u2" },
    });
  });

  test("static paths win over params regardless of declaration order", async () => {
    const r = defineRepository(({ get }) => ({
      byId: get("/:id", ({ input }) => `id:${input.id}`),
      latest: get("/latest", () => "latest"),
      any: get("/*", () => "any"),
    }));
    const a = createServer({ urls: defineUrls({ "/r": r }) });
    expect(await (await a.request("/r/latest")).json()).toBe("latest");
    expect(await (await a.request("/r/7")).json()).toBe("id:7");
    expect(await (await a.request("/r/7/x")).json()).toBe("any");
  });

  test("duplicate routes in a repository are rejected", () => {
    expect(() => defineRepository(({ get }) => ({ a: get("/", () => 1), b: get("/", () => 2) }))).toThrow(
      'declared twice: "a" and "b"',
    );
  });
});

describe("createRouter: the three forms together", () => {
  test("simple function, defineView and repository on one router", async () => {
    const seen: string[] = [];
    const router = createRouter()
      .use(async (c, next) => {
        seen.push(c.req.path);
        await next();
      })
      .use(logger(() => {}))
      .get("/health", () => "ok") // 1. simple function
      .get("/one/:id", detail) // 2. defineView
      .mount("/posts", posts); // 3. repository under a sub-prefix

    router.hono.get("/native", (c) => c.text("native hono"));

    const a = createServer({ urls: defineUrls({ "/api": router }), deps: { db: fakeDb(), user: null } });
    expect(await (await a.request("/api/health")).json()).toBe("ok");
    expect(await (await a.request("/api/one/1")).json()).toEqual({ id: 1, title: "Hello" });
    expect((await (await a.request("/api/posts")).json())).toHaveLength(1);
    expect(await (await a.request("/api/native")).text()).toBe("native hono");
    expect(seen).toEqual(["/api/health", "/api/one/1", "/api/posts", "/api/native"]);
  });

  test("url prefixes must be absolute", () => {
    expect(() => defineUrls({ api: posts })).toThrow('must start with "/"');
  });
});
