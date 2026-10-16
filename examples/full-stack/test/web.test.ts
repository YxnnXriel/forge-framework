import { beforeEach, describe, expect, test } from "bun:test";
import * as devalue from "devalue";
import type { App } from "forge";
import { dbReady, freshApp, signUp } from "./setup.ts";

describe.skipIf(!dbReady)("full-stack", () => {
  let app: App["app"];
  let deps: App["deps"];

  beforeEach(async () => {
    ({ app, deps } = await freshApp());
  });

  const rpc = (name: string, input: unknown, headers: Record<string, string> = {}) =>
    app.request(`/__forge/rpc/${name}`, {
      method: "POST",
      headers: { "content-type": "application/x-forge+devalue", ...headers },
      body: devalue.stringify(input),
    });

  describe("SSR", () => {
    test("renders the page with its layouts and the data needed for hydration", async () => {
      const res = await app.request("/posts/bienvenue-sur-forge");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<html lang="fr">');
      expect(html).toContain("<h1>Bienvenue sur Forge</h1>");
      expect(html).toContain("par Ariel");
      expect(html).toContain("#forge");
      expect(html).toContain("layout : 0");
      expect(html).toContain("forge:posts.detail:");
      expect(html).toContain("new Date(");
      expect(html).not.toContain("ariel@example.com"); // author email never leaves the server
      expect(html).toMatch(/<link rel="modulepreload" href="\/_forge\/\+page-[\w-]+\.js">/);
    });

    test("statuses: 404 from a remote error, 404 for unknown routes, 308 for trailing slashes", async () => {
      const missing = await app.request("/posts/nope");
      expect(missing.status).toBe(404);
      expect(await missing.text()).toContain("Article introuvable");
      expect((await app.request("/brouillon")).status).toBe(404);
      expect((await app.request("/posts/brouillon")).status).toBe(404); // unpublished
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
  });

  describe("remote calls on the database", () => {
    test("returns devalue-encoded rows (Dates preserved, relations included)", async () => {
      const reply = devalue.parse(await (await rpc("posts.detail", { slug: "bienvenue-sur-forge" })).text());
      expect(reply.ok).toBe(true);
      expect(reply.data.createdAt).toBeInstanceOf(Date);
      expect(reply.data.author).toEqual({ name: "Ariel" });
      expect(reply.data.tags.map((t: { label: string }) => t.label).sort()).toEqual(["forge", "svelte"]);
      expect(reply.data).not.toHaveProperty("authorId");
    });

    test("likes are incremented atomically in the database", async () => {
      await Promise.all(Array.from({ length: 5 }, () => rpc("posts.like", { slug: "layouts-imbriques" })));
      const post = await deps.db!.post.findUniqueOrThrow({ where: { slug: "layouts-imbriques" } });
      expect(post.likes).toBe(6);
    });

    test("create: Better Auth session required, author from the session, tags, unique slugs", async () => {
      expect((await rpc("posts.create", { title: "x" })).status).toBe(403);
      const cookie = { cookie: await signUp(app, "lea") };
      const first = devalue.parse(await (await rpc("posts.create", { title: "Été à Abidjan", tags: ["svelte", "voyage"] }, cookie)).text());
      expect(first.data.slug).toBe("ete-a-abidjan");
      expect(first.data.author.name).toBe("lea");
      const second = devalue.parse(await (await rpc("posts.create", { title: "Été à Abidjan" }, cookie)).text());
      expect(second.data.slug).toBe("ete-a-abidjan-2");
      expect(await deps.db!.tag.count()).toBe(3); // "svelte" reused, "voyage" created
      expect(await deps.db!.user.count({ where: { email: "lea@example.com" } })).toBe(1);
      expect(await deps.db!.account.count({ where: { providerId: "credential" } })).toBe(2); // ariel + lea
    });

    test("account.me reflects the session; pages render the user", async () => {
      expect(devalue.parse(await (await rpc("account.me", null)).text()).data).toBeNull();
      const cookie = await signUp(app, "sam");
      const me = devalue.parse(await (await rpc("account.me", null, { cookie })).text()).data;
      expect(me).toEqual({ name: "sam", email: "sam@example.com" });
      expect(await (await app.request("/dashboard", { headers: { cookie } })).text()).toContain("Bonjour sam");
      expect(await (await app.request("/dashboard")).text()).toContain("Connexion");
    });

    test("Better Auth's native API is mounted and usable", async () => {
      const cookie = await signUp(app, "max");
      const res = await app.request("/api/auth/get-session", { headers: { cookie } });
      expect((await res.json()).user.email).toBe("max@example.com");
      const user = await deps.auth!.api.getSession({ headers: new Headers({ cookie }) });
      expect(user?.user.name).toBe("max");
    });

    test("the session is never read when a handler does not ask for it", async () => {
      let lookups = 0;
      const original = deps.auth!.api.getSession;
      deps.auth!.api.getSession = ((...args: Parameters<typeof original>) => (lookups++, original(...args))) as typeof original;
      await app.request("/api/posts", { headers: { cookie: "better-auth.session_token=whatever" } });
      expect(lookups).toBe(0);
      await rpc("account.me", null);
      expect(lookups).toBe(1);
      deps.auth!.api.getSession = original;
    });

    test("only remote functions are reachable; validation; CSRF", async () => {
      expect((await rpc("posts.purge", null)).status).toBe(404);
      expect((await rpc("posts.detail", { slug: "" })).status).toBe(400);
      expect((await rpc("posts.list", null, { origin: "https://evil.example" })).status).toBe(403);
    });

    test("soft delete through the HTTP-only route hides posts", async () => {
      expect((await app.request("/api/posts/purge", { method: "POST" })).status).toBe(204);
      expect(await (await app.request("/api/posts")).json()).toEqual([]);
      expect(await deps.db!.post.count()).toBe(3); // rows kept, deletedAt set
    });
  });
});
