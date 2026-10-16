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
    expect(addToUrls(src, n, "./apps/todos/urls.ts")).toBe(
      `import { defineUrls } from "forge/server";\nimport { a } from "./a.ts";\nimport { router as todos } from "./apps/todos/urls.ts";\n\nexport default defineUrls({\n  "/api/a": a,\n  "/api/todos": todos,\n});\n`,
    );
    expect(addToUrls(`import { defineUrls } from "forge/server";\nexport default defineUrls({});\n`, n, "./x.ts")).toContain(
      'defineUrls({\n  "/api/todos": todos,\n})',
    );
    expect(addToUrls("export default {};", n, "./x.ts")).toBeNull();
  });

  test("layout: link inserted before the marker, same indentation, once", () => {
    const src = `<nav>\n    <a href="/">Home</a>\n    <!-- forge:nav -->\n  </nav>`;
    const next = addToNav(src, "/todos", "Todos")!;
    expect(addToNav(next, "/todos", "Todos")).toBe(next);
    expect(next).toBe(
      `<nav>\n    <a href="/">Home</a>\n    <a href="/todos" aria-current={page.route.startsWith("/todos") ? "page" : undefined}>Todos</a>\n    <!-- forge:nav -->\n  </nav>`,
    );
    expect(addToNav("<nav></nav>", "/todos", "Todos")).toBeNull();
  });
});

describe("forge new / startapp / example", () => {
  test("new: a commented skeleton, nothing implemented", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "forge-new-")), "todo");
    const c = capture();
    expect(await run(["new", "Todo", "--dir", dir, "--no-install"], { out: c.out })).toBe(0);
    expect(c.logs.join("\n")).toContain("Better Auth");

    const pkg = JSON.parse(await read(join(dir, "package.json")));
    expect(pkg.name).toBe("todo");
    expect(pkg.scripts).toMatchObject({ dev: "forge dev", build: "forge build", start: "forge start" });
    expect(pkg.dependencies).toMatchObject({ svelte: VERSIONS.svelte, "prisma-adapter-bun-sqlite": VERSIONS["prisma-adapter-bun-sqlite"] });
    expect(await read(join(dir, "forge.config.ts"))).toContain('db: { provider: "sqlite" }');
    // A real secret in .env, a placeholder in .env.example.
    const secret = /BETTER_AUTH_SECRET="([^"]+)"/.exec(await read(join(dir, ".env")))![1]!;
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(await read(join(dir, ".env.example"))).not.toContain(secret);
    // No app, no login page: those come from `forge example`.
    expect(existsSync(join(dir, "src/apps"))).toBe(false);
    expect(existsSync(join(dir, "src/web/login"))).toBe(false);
    expect(await read(join(dir, "src/urls.ts"))).toContain("defineUrls({\n});");
  });

  test("startapp: commented skeleton registered in urls.ts; example todo: the complete app", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "forge-new-")), "todo");
    await run(["new", "Todo", "--dir", dir, "--no-install"], { out: capture().out });
    await linkForge(dir);

    const s = capture();
    await run(["startapp", "notes"], { root: dir, out: s.out });
    for (const file of ["models.ts", "schemas.ts", "repository.ts", "views.ts", "urls.ts"]) {
      expect(existsSync(join(dir, "src/apps/notes", file))).toBe(true);
    }
    expect(await read(join(dir, "src/apps/notes/urls.ts"))).toContain("export const router = createRouter().mount(notes);");
    // Skeleton: the model is a commented example, the repository is empty.
    expect(await read(join(dir, "src/apps/notes/models.ts"))).toContain("// export class Note extends Model");
    expect(await read(join(dir, "src/apps/notes/repository.ts"))).toContain("export const notes = defineRepository(");
    expect(await read(join(dir, "src/apps/notes/repository.ts"))).toContain("//   handler: ({ db }) => db.note.findMany()");
    expect(existsSync(join(dir, "src/web/notes"))).toBe(false);
    // Listed in the page types right away (no remote function yet): the editor
    // completes `forge.notes.` as soon as one is marked `remote: true`.
    expect(await read(join(dir, ".forge/types.d.ts"))).toContain("notes: RemoteApi<typeof app_notes>;");
    const urls = await read(join(dir, "src/urls.ts"));
    expect(urls).toContain('import { router as notes } from "./apps/notes/urls.ts";');
    expect(urls).toContain('"/api/notes": notes,');
    const again = capture();
    expect(await run(["startapp", "notes"], { root: dir, out: again.out })).toBe(1);
    expect(again.errors.join()).toContain('App "notes" already exists');

    const e = capture();
    await run(["example", "todo"], { root: dir, out: e.out });
    expect(await read(join(dir, "src/apps/todos/models.ts"))).toContain("done: model.boolean({ default: false })");
    expect(await read(join(dir, "src/apps/todos/repository.ts"))).toContain("db.todo.findMany");
    expect(await read(join(dir, "src/web/todos/+page.svelte"))).toContain("await forge.todos.list()");
    expect(existsSync(join(dir, "src/web/login/+page.svelte"))).toBe(true);
    const wired = await read(join(dir, "src/urls.ts"));
    expect(wired).toContain('"/api/todos": todos,');
    expect(wired).toContain('"/api/account": account,');
    const layout = await read(join(dir, "src/web/+layout.svelte"));
    expect(layout).toContain('<a href="/todos"');
    expect(layout).toContain('<a href="/login"');
  });

  test("example list, api project without database: in-memory todos", async () => {
    const list = capture();
    expect(await run(["example"], { out: list.out })).toBe(0);
    expect(list.logs.join("\n")).toContain("todo");

    const dir = join(await mkdtemp(join(tmpdir(), "forge-new-")), "notes");
    expect(await run(["new", "notes", "--template", "api", "--db", "none", "--dir", dir, "--no-install"], { out: capture().out })).toBe(0);
    expect(existsSync(join(dir, "src/web"))).toBe(false);
    expect(await read(join(dir, "forge.config.ts"))).not.toContain("db:");
    await linkForge(dir);
    expect(await run(["example", "todo"], { root: dir, out: capture().out })).toBe(0);
    expect(existsSync(join(dir, "src/apps/todos/models.ts"))).toBe(false);
    expect(await read(join(dir, "src/apps/todos/repository.ts"))).toContain("kept in memory");
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
