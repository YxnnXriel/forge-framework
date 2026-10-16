/**
 * Forge benchmarks: `bun run bench` (add --json for machine-readable output).
 * In-process: every framework receives the same `Request` objects through its
 * fetch handler, so the numbers compare framework work, not the network stack.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engineStatus, hashFiles, nativeRouter } from "@forge/rust-engine";
import { createServer, defineRepository, defineUrls } from "@forge/server";
import { matchRoute, type WebRoute } from "@forge/web";
import { Elysia, t } from "elysia";
import { Hono } from "hono";
import { z } from "zod";

const json = process.argv.includes("--json");
const results: Array<{ group: string; name: string; ns: number }> = [];

async function bench(group: string, name: string, fn: () => unknown, iterations = 200_000) {
  const warm = Math.min(20_000, iterations / 10);
  for (let i = 0; i < warm; i++) await fn();
  const samples: number[] = [];
  for (let round = 0; round < 5; round++) {
    const start = Bun.nanoseconds();
    for (let i = 0; i < iterations / 5; i++) await fn();
    samples.push((Bun.nanoseconds() - start) / (iterations / 5));
  }
  samples.sort((a, b) => a - b);
  const ns = samples[2]!; // median of 5 rounds
  results.push({ group, name, ns });
  if (!json) console.log(`  ${name.padEnd(46)} ${fmt(ns).padStart(10)}   ${(1e9 / ns).toFixed(0).padStart(10)} ops/s`);
}

const fmt = (ns: number) => (ns < 1000 ? `${ns.toFixed(0)} ns` : ns < 1e6 ? `${(ns / 1e3).toFixed(2)} µs` : `${(ns / 1e6).toFixed(2)} ms`);
const section = (title: string) => !json && console.log(`\n${title}`);

if (!json) console.log(`Forge bench — Bun ${Bun.version}, engine: ${engineStatus()}`);

/* ------------------------------ 1. HTTP layer ----------------------------- */
section("HTTP handler: GET /users/:id -> JSON (in-process fetch)");
const req = () => new Request("http://localhost/users/42");

const hono = new Hono().get("/users/:id", (c) => c.json({ id: c.req.param("id"), ok: true }));
const elysia = new Elysia().get("/users/:id", ({ params }) => ({ id: params.id, ok: true }));
const elysiaTyped = new Elysia().get("/users/:id", ({ params }) => ({ id: params.id, ok: true }), {
  params: t.Object({ id: t.Numeric() }),
});
const forge = createServer({
  urls: defineUrls({
    "/users": defineRepository(({ get }) => ({ one: get("/:id", ({ input }) => ({ id: input.id, ok: true })) })),
    "/typed": defineRepository(({ get }) => ({
      one: get("/:id", {
        input: z.object({ id: z.coerce.number() }),
        output: z.object({ id: z.number(), ok: z.boolean() }),
        handler: ({ input }) => ({ id: input.id, ok: true }),
      }),
    })),
  }),
});
const typedReq = () => new Request("http://localhost/typed/42");

await bench("http", "Hono (raw)", () => hono.fetch(req()));
await bench("http", "Elysia", () => elysia.handle(req()));
await bench("http", "Forge simple function", () => forge.fetch(req()));
await bench("http", "Elysia + params schema", () => elysiaTyped.handle(req()));
await bench("http", "Forge defineView (zod input + output)", () => forge.fetch(typedReq()));

/* ------------------------------- 2. Routing ------------------------------- */
section("Page routing: 1000 routes, worst-case lookup (/s39/p999/:id)");
const routes: WebRoute[] = [];
for (let i = 0; i < 1000; i++) {
  routes.push({
    id: `/s${i % 40}/p${i}/[id]`,
    segments: [
      { kind: "static", value: `s${i % 40}` },
      { kind: "static", value: `p${i}` },
      { kind: "param", name: "id" },
    ],
    page: "",
    layouts: [],
  });
}
await bench("routing", "TypeScript segment tree", () => matchRoute(routes, "/s39/p999/abc"), 1_000_000);
const native = nativeRouter(routes.map((r) => r.id));
if (native) {
  await bench(
    "routing",
    "Rust engine (bun:ffi) incl. params",
    () => {
      const m = native.match("/s39/p999/abc");
      return m && { id: "/s39/p999/abc".slice(m.spans[0]!, m.spans[1]!) };
    },
    1_000_000,
  );
}

/* ------------------------------ 3. Hashing ------------------------------- */
section("Incremental cache: hash 5000 files (~10 MB)");
const dir = await mkdtemp(join(tmpdir(), "forge-bench-"));
const files: string[] = [];
for (let i = 0; i < 5000; i++) {
  const sub = join(dir, `d${i % 50}`);
  if (i < 50) await mkdir(sub);
  const f = join(sub, `f${i}.svelte`);
  await writeFile(f, `<script>let x = ${i};</script>\n` + "<p>contenu de test</p>\n".repeat(80));
  files.push(f);
}
const prev = Bun.env.FORGE_ENGINE;
Bun.env.FORGE_ENGINE = "off";
const { hashFiles: tsHash } = await import(`@forge/rust-engine?ts=${Date.now()}`);
Bun.env.FORGE_ENGINE = prev;
await bench("hash", "TypeScript (Bun.hash, concurrent reads)", () => tsHash(files), 20);
if (native) await bench("hash", `Rust engine (${navigator.hardwareConcurrency} threads)`, () => hashFiles(files), 20);

if (json) console.log(JSON.stringify({ bun: Bun.version, engine: engineStatus(), results }, null, 2));
