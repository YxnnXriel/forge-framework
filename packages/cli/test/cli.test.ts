import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/index.ts";

const modelsEntry = JSON.stringify(join(import.meta.dir, "../../models/src/index.ts"));

async function project(config: string, files: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "forge-cli-"));
  await writeFile(join(root, "forge.config.ts"), config);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

function capture() {
  const logs: string[] = [];
  const errors: string[] = [];
  return { out: { log: (m: string) => logs.push(m), error: (m: string) => errors.push(m) }, logs, errors };
}

describe("forge CLI", () => {
  test("help", async () => {
    const c = capture();
    expect(await run([], { out: c.out })).toBe(0);
    expect(c.logs.join()).toContain("db migrate");
    expect(c.logs.join()).toContain("startapp <name>");
  });

  test("unknown command", async () => {
    const c = capture();
    expect(await run(["nope"], { out: c.out })).toBe(1);
    expect(c.errors.join()).toContain("Unknown command");
  });

  test("db commands require `db` in the config", async () => {
    const root = await project(`export default { api: {} };`);
    const c = capture();
    expect(await run(["db", "generate"], { root, out: c.out })).toBe(1);
    expect(c.errors.join()).toContain("No `db` in forge.config.ts");
  });

  test("db generate writes the schema files before calling Prisma", async () => {
    const root = await project(`export default { api: {}, db: { provider: "postgresql" } };`, {
      "src/apps/blog/models.ts": `import { Model, model } from ${modelsEntry};
export class Article extends Model { static model = { title: model.string() }; }`,
    });
    const c = capture();
    // No Prisma installed in the temp project: schema is written, then a clear error.
    expect(await run(["db", "generate"], { root, out: c.out })).toBe(1);
    expect(c.logs.join("\n")).toContain("Prisma schema  Article");
    expect(existsSync(join(root, "prisma/schema/forge.generated.prisma"))).toBe(true);
    expect(await Bun.file(join(root, "prisma/schema/schema.prisma")).text()).toContain('provider = "postgresql"');
    expect(existsSync(join(root, "prisma.config.ts"))).toBe(true);
    expect(c.errors.join()).toContain("bun add -d prisma@7");
  });

  test("a hand-written model with the same name is a conflict", async () => {
    const root = await project(`export default { api: {}, db: { provider: "sqlite" } };`, {
      "src/apps/blog/models.ts": `import { Model } from ${modelsEntry};
export class Article extends Model {}`,
      "prisma/schema/legacy.prisma": "model Article {\n  id Int @id\n}\n",
    });
    const c = capture();
    expect(await run(["db", "generate"], { root, out: c.out })).toBe(1);
    expect(c.errors.join()).toContain('"Article" is both a Forge model and declared in prisma/schema/legacy.prisma');
  });
});

describe("forge build / start / setup", () => {
  const examples = join(import.meta.dir, "../../../examples");

  /** Runs a built server on a free port and returns its URL. */
  async function serveBuild(root: string) {
    const proc = Bun.spawn(["bun", join(root, ".forge/build/server.js")], {
      cwd: root,
      env: { ...Bun.env, PORT: "0" },
      stdout: "pipe",
      stderr: "inherit",
    });
    let output = "";
    const reader = proc.stdout.getReader();
    while (!output.includes("Forge ready on")) {
      const { value, done } = await reader.read();
      if (done) throw new Error(output);
      output += new TextDecoder().decode(value);
    }
    reader.releaseLock();
    return { base: /Forge ready on (\S+)/.exec(output)![1]!.replace(/\/$/, ""), stop: () => proc.kill() };
  }

  test("web-only: pages prebuilt, assets precompressed and immutable, public files served", async () => {
    const root = join(examples, "web-only");
    const c = capture();
    expect(await run(["build"], { root, out: c.out })).toBe(0);
    expect(c.logs.join("\n")).toContain(".forge/build/server.js");
    expect(c.logs.join("\n")).toContain("brotli");
    // No compiler and no bundler in the production server.
    const server = await Bun.file(join(root, ".forge/build/server.js")).text();
    expect(server).not.toContain("svelte/compiler");
    expect(server).not.toContain("experimental.async");

    const { base, stop } = await serveBuild(root);
    try {
      const html = await (await fetch(base + "/")).text();
      expect(html).toContain('<html lang="fr">');
      expect(html).not.toContain("/__forge/dev"); // no live reload in production
      const entry = /src="(\/_forge\/[^"]+)"/.exec(html)![1]!;
      const br = await fetch(base + entry, { headers: { "accept-encoding": "br" }, decompress: false } as RequestInit);
      expect(br.headers.get("content-encoding")).toBe("br");
      expect(br.headers.get("cache-control")).toContain("immutable");
      const plain = await fetch(base + entry, { headers: { "accept-encoding": "identity" } });
      expect(plain.headers.get("content-encoding")).toBeNull();
      expect((await plain.text()).length).toBeGreaterThan(1000);
    } finally {
      stop();
    }
  }, 60_000);

  test("api-only: src/main.ts wiring is bundled", async () => {
    const root = join(examples, "api-only");
    expect(await run(["build"], { root, out: capture().out })).toBe(0);
    const { base, stop } = await serveBuild(root);
    try {
      const res = await fetch(base + "/api/posts");
      expect(res.status).toBe(200);
      expect(JSON.stringify(await res.json())).toContain("Bienvenue sur Forge");
    } finally {
      stop();
    }
  }, 60_000);

  test("build --target vercel writes the Build Output API layout", async () => {
    const root = join(examples, "web-only");
    expect(await run(["build", "--target", "vercel"], { root, out: capture().out })).toBe(0);
    const out = join(root, ".vercel/output");
    const config = await Bun.file(join(out, "config.json")).json();
    expect(config.version).toBe(3);
    expect(config.routes.at(-1)).toEqual({ src: "/(.*)", dest: "/index" });
    const fn = await Bun.file(join(out, "functions/index.func/.vc-config.json")).json();
    expect(fn).toMatchObject({ runtime: "bun1.4.x", handler: "server.js" });
    const assets = [...new Bun.Glob("static/_forge/*.js").scanSync({ cwd: out })];
    expect(assets.length).toBeGreaterThan(0);
    // The function exports a fetch handler (no Bun.serve on Vercel).
    const mod = await import(join(out, "functions/index.func/server.js"));
    expect((await mod.default.fetch(new Request("https://x.vercel.app/"))).status).toBe(200);
  }, 60_000);

  test("start without a build", async () => {
    const root = await project(`export default { api: {} };`);
    const c = capture();
    expect(await run(["start"], { root, out: c.out })).toBe(1);
    expect(c.errors.join()).toContain("run `bun forge build` first");
  });

  test("setup docker: multi-stage build, compiled executable, migrations on start", async () => {
    const root = await project(`export default { api: {}, db: { provider: "postgresql" }, server: { port: 8080 } };`);
    const c = capture();
    expect(await run(["setup", "docker"], { root, out: c.out })).toBe(0);
    const dockerfile = await Bun.file(join(root, "Dockerfile")).text();
    expect(dockerfile).toContain("FROM oven/bun:1.4 AS build");
    expect(dockerfile).toContain("RUN bun run forge build --compile");
    expect(dockerfile).toContain("EXPOSE 8080");
    expect(dockerfile).toContain('CMD ["start", "--migrate"]');
    expect(existsSync(join(root, ".dockerignore"))).toBe(true);
    // Never overwrites without --force.
    expect(await run(["setup", "docker"], { root, out: capture().out })).toBe(1);
    expect(await run(["setup", "docker", "--force"], { root, out: capture().out })).toBe(0);
  });

  test("setup vercel: migrations run during the Vercel build", async () => {
    const root = await project(`export default { api: {}, db: { provider: "postgresql" } };`);
    expect(await run(["setup", "vercel"], { root, out: capture().out })).toBe(0);
    const json = await Bun.file(join(root, "vercel.json")).json();
    expect(json.bunVersion).toBe("1.4.x");
    expect(json.buildCommand).toBe("bun run forge build && bun run forge db deploy");
  });
});
