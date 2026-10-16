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
    expect(c.logs.join()).toContain("forge db migrate");
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
    expect(c.logs.join("\n")).toContain("Models: Article");
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
