import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { ForgeError } from "@forge/core/errors";
import type { Out } from "../util.ts";
import { kebab, pascal } from "./names.ts";
import { VERSIONS, type Dependency } from "./versions.ts";

export type Template = "full" | "api" | "web";
export type DbChoice = "sqlite" | "postgresql" | "none";

export interface NewProjectOptions {
  name: string;
  template: Template;
  db: DbChoice;
  auth: boolean;
  /** Where the project goes (default: `<forge repo>/projects/<name>`, else `./<name>`). */
  dir?: string;
}

export interface ProjectPlan {
  root: string;
  /** Forge repository the project is a workspace member of, if any. */
  repo: string | null;
  files: Record<string, string>;
}

/** The Forge repository containing `from` (it has packages/forge), if any. */
export function forgeRepo(from: string): string | null {
  let dir = from;
  while (true) {
    const pkg = join(dir, "package.json");
    if (existsSync(join(dir, "packages/forge/package.json")) && existsSync(pkg)) return dir;
    if (dir === dirname(dir)) return null;
    dir = dirname(dir);
  }
}

const secret = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");

function packageJson(o: NewProjectOptions, slug: string, inRepo: boolean): string {
  const v = (dep: Dependency) => (inRepo ? "catalog:" : VERSIONS[dep]);
  const web = o.template !== "api";
  const db = o.db !== "none";
  const dependencies: Record<string, string> = { forge: inRepo ? "workspace:*" : "latest" };
  if (web) dependencies.svelte = v("svelte");
  if (db) {
    dependencies["@prisma/client"] = v("@prisma/client");
    const adapter = o.db === "sqlite" ? "prisma-adapter-bun-sqlite" : "@prisma/adapter-pg";
    dependencies[adapter] = v(adapter);
  }
  const devDependencies: Record<string, string> = { "@types/bun": v("@types/bun"), typescript: v("typescript") };
  if (db) devDependencies.prisma = v("prisma");
  if (web) devDependencies["svelte-check"] = v("svelte-check");
  return `${JSON.stringify(
    {
      name: slug,
      private: true,
      type: "module",
      scripts: {
        dev: "forge dev",
        build: "forge build",
        start: "forge start",
        check: "forge check",
        test: "bun test",
      },
      dependencies,
      devDependencies,
    },
    null,
    2,
  )}\n`;
}

function config(o: NewProjectOptions): string {
  const lines = [
    "// Forge configuration: the modules this project uses. Read when the app",
    "// starts and by the CLI (`bun forge ...`). Only enabled modules are loaded.",
    'import { defineConfig } from "forge";',
    "",
    "export default defineConfig({",
  ];
  if (o.template !== "web") lines.push("  // Backend routes, declared in src/urls.ts.", "  api: {},");
  if (o.template !== "api") lines.push("  // Svelte pages: every src/web/**/+page.svelte is a route.", '  web: { lang: "en" },');
  if (o.db !== "none") {
    lines.push(
      "  // Database: models in src/apps/*/models.ts; `bun forge db migrate` creates the migrations.",
      `  db: { provider: "${o.db}" },`,
    );
  }
  if (o.auth) {
    lines.push(
      "  // Better Auth, with its native options: https://better-auth.com/docs",
      "  // Routes on /api/auth. In handlers: `await session()` (null when signed out),",
      "  // `access: authenticated` to require a user. In pages: createAuthClient()",
      "  // from \"forge/auth/client\" (sign up, sign in, sign out).",
      "  auth: {",
      "    emailAndPassword: { enabled: true },",
      "  },",
    );
  }
  lines.push("  // Local port; PORT in the environment wins (hosting platforms set it).", "  server: { port: 3000 },", "});", "");
  return lines.join("\n");
}

function env(o: NewProjectOptions, slug: string, example: boolean): string {
  const lines: string[] = [];
  if (o.db === "sqlite") lines.push("# SQLite file, relative to the project root.", 'DATABASE_URL="file:./prisma/dev.db"');
  if (o.db === "postgresql") lines.push(`DATABASE_URL="postgresql://postgres:postgres@localhost:5432/${slug.replace(/-/g, "_")}"`);
  if (o.auth) {
    if (lines.length) lines.push("");
    lines.push(
      "# Better Auth: at least 32 random characters (openssl rand -base64 32).",
      `BETTER_AUTH_SECRET="${example ? "change-me-to-32-random-characters-at-least" : secret()}"`,
      "# Production only: the public URL (https://todo.example.com). Locally, Forge uses its own.",
      '# BETTER_AUTH_URL="https://example.com"',
    );
  }
  return lines.length ? lines.join("\n") + "\n" : "";
}

const TSCONFIG = (web: boolean) => `${JSON.stringify(
  {
    compilerOptions: {
      target: "ESNext",
      module: "Preserve",
      moduleResolution: "bundler",
      lib: ["ESNext", "DOM", "DOM.Iterable"],
      types: ["bun"],
      strict: true,
      noUncheckedIndexedAccess: true,
      noImplicitOverride: true,
      exactOptionalPropertyTypes: true,
      verbatimModuleSyntax: true,
      isolatedModules: true,
      allowImportingTsExtensions: true,
      noEmit: true,
      skipLibCheck: true,
    },
    include: ["src/**/*.ts", ...(web ? ["src/**/*.svelte"] : []), "test/**/*.ts", "forge.config.ts", ".forge/types.d.ts"],
  },
  null,
  2,
)}\n`;

const GITIGNORE = `node_modules/
.forge/
.vercel/
generated/
.env
.env.*
!.env.example
*.db
*.db-journal
`;

const SVELTE_CONFIG = `// Read by editor tooling (Svelte for VS Code, svelte-check). Forge compiles
// with the same options: \`await\` in components needs experimental.async.
export default {
  compilerOptions: {
    experimental: { async: true },
  },
};
`;

const MAIN = `// The app's own wiring: extra dependencies for handlers (\`deps\`), per-request
// dependencies (\`requestDeps\`), error hook. Database, auth and session come
// from forge.config.ts: nothing to add for them.
import { defineApp } from "forge";

export default defineApp({});
`;

const URLS = `// Backend routes: URL prefix -> repository or router.
// \`bun forge startapp <name>\` adds its app here.
import { defineUrls } from "forge/server";

export default defineUrls({
});
`;

function layout(title: string): string {
  return `<!-- Root layout: wraps every page and stays mounted across client-side
     navigations (its state survives). Nested folders can have their own
     +layout.svelte. -->
<script lang="ts">
  import { page } from "forge:web";
  // The page being shown is rendered where {@render children()} is.
  let { children } = $props();
</script>

<header>
  <a href="/" class="brand">${title}</a>
  <nav>
    <a href="/" aria-current={page.route === "/" ? "page" : undefined}>Home</a>
    <!-- forge:nav (\`bun forge example\` adds its links above this line) -->
  </nav>
</header>

<main>
  {@render children()}
</main>

<style>
  :global(body) { margin: 0; font-family: system-ui, sans-serif; color: #1f1d2b; }
  header { display: flex; gap: 1.5rem; align-items: center; padding: 1rem 2rem; border-bottom: 1px solid #e4e2ee; }
  .brand { font-weight: 700; color: #7c3aed; text-decoration: none; }
  nav { display: flex; gap: 1rem; }
  nav a { color: inherit; }
  main { padding: 2rem; max-width: 48rem; }
</style>
`;
}

const HOME = (title: string) => `<!-- Page "/": src/web/+page.svelte. Every +page.svelte under src/web is a
     route: src/web/about/+page.svelte -> /about, src/web/posts/[id]/+page.svelte
     -> /posts/:id (page.params.id from "forge:web").

     Data comes from your apps' remote functions, awaited right here: rendered
     on the server, reused by the browser without a second call.
       import { forge } from "forge:router";
       const items = await forge.todos.list();
-->
<svelte:head><title>${title}</title></svelte:head>

<h1>${title}</h1>
<p>Edit <code>src/web/+page.svelte</code>, or create an app: <code>bun forge startapp &lt;name&gt;</code></p>
`;

function smokeTest(o: NewProjectOptions): string {
  const probe = o.template === "api" ? '"/api/nope"' : '"/"';
  const status = o.template === "api" ? 404 : 200;
  const head = `// Smoke test: the app starts and answers. \`bun test\`
import { expect, test } from "bun:test";
import { join } from "node:path";
import { createApp } from "forge";
`;
  const body = `  const { app } = await createApp({ root });
  expect((await app.request(${probe})).status).toBe(${status});
});
`;
  const secret = o.auth ? 'Bun.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-42";\n' : "";
  if (o.db === "sqlite") {
    return `${head}import { createTestDatabase, listMigrations } from "forge/testing";

const root = join(import.meta.dir, "..");
// Runs once a migration exists (\`bun forge db migrate\`): fresh SQLite database, every migration applied.
const migrated = (await listMigrations(root)).length > 0;
${secret}
test.skipIf(!migrated)("the app starts", async () => {
  Bun.env.DATABASE_URL = (await createTestDatabase(root)).url;
${body}`;
  }
  if (o.db === "postgresql") {
    return `${head}
const root = join(import.meta.dir, "..");
${secret}
// Uses DATABASE_URL (.env): a migrated database (\`bun forge db migrate\`).
test.skipIf(!Bun.env.DATABASE_URL)("the app starts", async () => {
${body}`;
  }
  return `${head}
const root = join(import.meta.dir, "..");

test("the app starts", async () => {
${body}`;
}

/** Every file of a new project (nothing written yet). */
export function planProject(o: NewProjectOptions, cwd: string): ProjectPlan {
  const slug = kebab(o.name);
  if (!slug) throw new ForgeError("FORGE_NEW", `Invalid project name "${o.name}"`);
  if (o.template === "web" && o.db !== "none") throw new ForgeError("FORGE_NEW", "A web-only project has no database: use --template full");
  if (o.auth && o.db === "none") throw new ForgeError("FORGE_NEW", "Better Auth needs a database: add --db sqlite|postgresql");
  const repo = o.dir ? forgeRepo(o.dir) : forgeRepo(cwd);
  const root = o.dir ?? (repo ? join(repo, "projects", slug) : join(cwd, slug));
  const title = pascal(o.name.trim()) === o.name.trim() ? o.name.trim() : pascal(slug);
  const web = o.template !== "api";
  const api = o.template !== "web";

  const files: Record<string, string> = {
    "package.json": packageJson(o, slug, repo !== null),
    "forge.config.ts": config(o),
    "tsconfig.json": TSCONFIG(web),
    ".gitignore": GITIGNORE,
    "src/main.ts": MAIN,
    "test/app.test.ts": smokeTest(o),
  };
  const dotenv = env(o, slug, false);
  if (dotenv) {
    files[".env"] = dotenv;
    files[".env.example"] = env(o, slug, true);
  }
  if (api) files["src/urls.ts"] = URLS;
  if (web) {
    files["svelte.config.js"] = SVELTE_CONFIG;
    files["src/web/+layout.svelte"] = layout(title);
    files["src/web/+page.svelte"] = HOME(title);
  }
  return { root, repo, files };
}

/** Adds `projects/*` to the Forge repository's workspaces (once). */
async function registerWorkspace(repo: string, root: string, out: Out) {
  const file = join(repo, "package.json");
  const pkg = await Bun.file(file).json();
  const folder = relative(repo, dirname(root)).split("\\").join("/");
  const glob = `${folder}/*`;
  const list: string[] = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages;
  if (list.includes(glob)) return;
  list.push(glob);
  await Bun.write(file, JSON.stringify(pkg, null, 2) + "\n");
  out.ui.file("change", `${relative(process.cwd(), file) || "package.json"} (workspaces: ${glob})`);
}

export async function writeProject(plan: ProjectPlan, out: Out): Promise<void> {
  if (existsSync(plan.root) && (await readdir(plan.root)).length > 0) {
    throw new ForgeError("FORGE_NEW", `${plan.root} already exists and is not empty`);
  }
  for (const [path, content] of Object.entries(plan.files)) {
    await mkdir(dirname(join(plan.root, path)), { recursive: true });
    await Bun.write(join(plan.root, path), content);
  }
  if (plan.repo) await registerWorkspace(plan.repo, plan.root, out);
}
