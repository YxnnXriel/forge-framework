import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/index.ts";
import { addToNav, addToUrls } from "../src/scaffold/app.ts";
import { appName, kebab, namesOf } from "../src/scaffold/names.ts";
import { VERSIONS } from "../src/scaffold/versions.ts";

function capture() {
  const logs: string[] = [];
  const errors: string[] = [];
  return { out: { log: (m: string) => logs.push(m), error: (m: string) => errors.push(m) }, logs, errors };
}

const read = (path: string) => Bun.file(path).text();

/** Stands in for `bun install`: the project resolves `forge` to this repository's package. */
async function linkForge(dir: string) {
  await mkdir(join(dir, "node_modules"), { recursive: true });
  await symlink(join(import.meta.dir, "../../forge"), join(dir, "node_modules/forge"), "dir");
}

describe("names", () => {
  test("project and app names", () => {
    expect(kebab("Todo")).toBe("todo");
    expect(kebab("My Todo App")).toBe("my-todo-app");
    expect(namesOf("todos")).toEqual({ app: "todos", model: "Todo", delegate: "todo", path: "todos", label: "Todos" });
    expect(namesOf("categories").model).toBe("Category");
    expect(namesOf("blog_posts")).toMatchObject({ model: "BlogPost", delegate: "blogPost", path: "blog-posts", label: "Blog Posts" });
    expect(() => appName("My-Notes")).toThrow('e.g. "my_notes"');
  });

  test("template versions follow the repository catalog", async () => {
    const root = await Bun.file(join(import.meta.dir, "../../../package.json")).json();
    for (const [dep, version] of Object.entries(VERSIONS)) expect(`${dep}@${root.workspaces.catalog[dep]}`).toBe(`${dep}@${version}`);
  });
});

describe("wiring", () => {
  const n = namesOf("todos");
  test("urls: import after the last import, entry at the end of defineUrls", () => {
    const src = `import { defineUrls } from "forge/server";\nimport { a } from "./a.ts";\n\nexport default defineUrls({\n  "/api/a": a,\n});\n`;
    expect(addToUrls(src, n, "./apps/todos/repository.ts")).toBe(
      `import { defineUrls } from "forge/server";\nimport { a } from "./a.ts";\nimport { todos } from "./apps/todos/repository.ts";\n\nexport default defineUrls({\n  "/api/a": a,\n  "/api/todos": todos,\n});\n`,
    );
    expect(addToUrls(`import { defineUrls } from "forge/server";\nexport default defineUrls({});\n`, n, "./x.ts")).toContain(
      'defineUrls({\n  "/api/todos": todos,\n})',
    );
    expect(addToUrls("export default {};", n, "./x.ts")).toBeNull();
  });

  test("layout: link inserted before the marker, same indentation", () => {
    const src = `<nav>\n    <a href="/">Home</a>\n    <!-- forge:nav -->\n  </nav>`;
    expect(addToNav(src, n)).toBe(
      `<nav>\n    <a href="/">Home</a>\n    <a href="/todos" aria-current={page.route.startsWith("/todos") ? "page" : undefined}>Todos</a>\n    <!-- forge:nav -->\n  </nav>`,
    );
    expect(addToNav("<nav></nav>", n)).toBeNull();
  });
});

describe("forge new / startapp", () => {
  test("full-stack project, then an app wired into urls.ts and the layout", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "forge-new-")), "todo");
    const c = capture();
    expect(await run(["new", "Todo", "--dir", dir, "--no-install"], { out: c.out })).toBe(0);
    expect(c.logs.join("\n")).toContain("(full, sqlite, Better Auth)");

    const pkg = JSON.parse(await read(join(dir, "package.json")));
    expect(pkg.name).toBe("todo");
    expect(pkg.scripts).toMatchObject({ dev: "forge dev", build: "forge build", forge: "forge" });
    expect(pkg.dependencies).toMatchObject({ svelte: VERSIONS.svelte, "prisma-adapter-bun-sqlite": VERSIONS["prisma-adapter-bun-sqlite"] });
    expect(await read(join(dir, "forge.config.ts"))).toContain('db: { provider: "sqlite" }');
    // A real secret in .env, a placeholder in .env.example.
    const secret = /BETTER_AUTH_SECRET="([^"]+)"/.exec(await read(join(dir, ".env")))![1]!;
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(await read(join(dir, ".env.example"))).not.toContain(secret);
    expect(await read(join(dir, "src/urls.ts"))).toContain('"/api/account": account');

    await linkForge(dir);
    const s = capture();
    // No Prisma in the temp project: files are written, then generate fails clearly.
    await run(["startapp", "todos"], { root: dir, out: s.out });
    expect(s.logs.join("\n")).toContain('App "todos" (model Todo)');
    for (const file of ["models.ts", "schemas.ts", "repository.ts"]) expect(existsSync(join(dir, "src/apps/todos", file))).toBe(true);
    expect(await read(join(dir, "src/apps/todos/models.ts"))).toContain("export class Todo extends Model");
    expect(await read(join(dir, "src/apps/todos/repository.ts"))).toContain("db.todo.findMany");
    const urls = await read(join(dir, "src/urls.ts"));
    expect(urls).toContain('import { todos } from "./apps/todos/repository.ts";');
    expect(urls).toContain('"/api/todos": todos,');
    expect(await read(join(dir, "src/web/+layout.svelte"))).toContain('<a href="/todos"');
    expect(await read(join(dir, "src/web/todos/+page.svelte"))).toContain("await forge.todos.list()");

    const again = capture();
    expect(await run(["startapp", "todos"], { root: dir, out: again.out })).toBe(1);
    expect(again.errors.join()).toContain('App "todos" already exists');
  });

  test("api project without database: in-memory app, no page", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "forge-new-")), "notes");
    expect(await run(["new", "notes", "--template", "api", "--db", "none", "--dir", dir, "--no-install"], { out: capture().out })).toBe(0);
    expect(existsSync(join(dir, "src/web"))).toBe(false);
    expect(await read(join(dir, "forge.config.ts"))).not.toContain("db:");
    await linkForge(dir);
    const c = capture();
    expect(await run(["startapp", "notes"], { root: dir, out: c.out })).toBe(0);
    expect(existsSync(join(dir, "src/apps/notes/models.ts"))).toBe(false);
    expect(await read(join(dir, "src/apps/notes/repository.ts"))).toContain("In-memory store");
  });

  test("invalid combinations", async () => {
    const c = capture();
    expect(await run(["new", "x", "--template", "web", "--db", "sqlite", "--dir", "/tmp/nope", "--no-install"], { out: c.out })).toBe(1);
    expect(c.errors.join()).toContain("web-only project has no database");
    const d = capture();
    expect(await run(["new", "x", "--db", "none", "--auth", "--dir", "/tmp/nope", "--no-install"], { out: d.out })).toBe(1);
    expect(d.errors.join()).toContain("Better Auth needs a database");
  });
});
