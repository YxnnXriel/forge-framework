import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { ForgeConfigError, defineConfig, loadConfig, resolveConfig } from "../src/index.ts";

const root = "/project";
const resolve = (input: unknown) => resolveConfig(input, { root });

function issuesOf(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ForgeConfigError);
    return (e as ForgeConfigError).issues;
  }
  throw new Error("expected ForgeConfigError");
}

describe("resolveConfig", () => {
  test("api-only project needs nothing about web", () => {
    const c = resolve({ api: {} });
    expect(c.api).toEqual({ urls: "/project/src/urls.ts" });
    expect(c.web).toBeNull();
  });

  test("web-only project needs nothing about api", () => {
    const c = resolve({ web: { dir: "app" } });
    expect(c.web).toEqual({ dir: "/project/app", lang: "en" });
    expect(c.api).toBeNull();
  });

  test("full-stack project enables both", () => {
    const c = resolve({ api: {}, web: {}, server: { port: 4000 } });
    expect(c.api).not.toBeNull();
    expect(c.web).not.toBeNull();
    expect(c.server).toEqual({ port: 4000 });
  });

  test("db is opt-in and validated", () => {
    expect(resolve({ api: {} }).db).toBeNull();
    expect(resolve({ api: {}, db: { provider: "sqlite" } }).db).toEqual({ provider: "sqlite" });
    expect(issuesOf(() => resolve({ api: {}, db: { provider: "mongo" } }))[0]?.path).toBe("db.provider");
  });

  test("server defaults are left to Bun", () => {
    expect(resolve({ api: {} }).server).toEqual({});
  });

  test("rejects a config with no module", () => {
    expect(issuesOf(() => resolve({}))[0]?.message).toContain("no module enabled");
    expect(issuesOf(() => resolve({ api: false, web: false }))).toHaveLength(1);
  });

  test("rejects unknown keys (typos) with their path", () => {
    const issues = issuesOf(() => resolve({ api: {}, serveur: {} }));
    expect(issues[0]?.message).toContain("serveur");
  });

  test("reports every invalid field at once", () => {
    const issues = issuesOf(() => resolve({ api: { urls: "" }, server: { port: 70000 } }));
    expect(issues.map((i) => i.path).sort()).toEqual(["api.urls", "server.port"]);
  });

  test("env entries must be Zod schemas", () => {
    const issues = issuesOf(() => resolve({ api: {}, env: { private: { DB: "string" } } }));
    expect(issues[0]?.path).toBe("env.private.DB");
  });

  test("a variable cannot be both private and public", () => {
    const issues = issuesOf(() =>
      resolve({ api: {}, env: { private: { API_URL: z.string() }, public: { API_URL: z.string() } } }),
    );
    expect(issues[0]?.path).toBe("env.public.API_URL");
  });

  test("defineConfig keeps literal types", () => {
    const c = defineConfig({ api: { urls: "src/routes.ts" } });
    const urls: "src/routes.ts" = c.api.urls;
    expect(urls).toBe("src/routes.ts");
  });
});

describe("loadConfig", () => {
  test("loads forge.config.ts from a directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forge-"));
    await writeFile(join(dir, "forge.config.ts"), `export default { web: {} };`);
    const c = await loadConfig(dir);
    expect(c.web?.dir).toBe(join(dir, "src/web"));
  });

  test("fails clearly when the file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forge-"));
    await expect(loadConfig(dir)).rejects.toThrow("forge.config.ts not found");
  });

  test("fails clearly without a default export", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forge-"));
    await writeFile(join(dir, "forge.config.ts"), `export const config = {};`);
    await expect(loadConfig(dir)).rejects.toThrow("missing `export default");
  });
});
