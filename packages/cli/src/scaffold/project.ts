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
        forge: "forge",
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

function layout(title: string, auth: boolean): string {
  return `<!-- Root layout: wraps every page. Kept across client-side navigations. -->
<script lang="ts">
${auth ? '  import { forge } from "forge:router";\n' : ""}  import { page } from "forge:web";
  let { children } = $props();
${auth ? "\n  // Signed-in user (Better Auth session), or null.\n  const me = await forge.account.me();\n" : ""}</script>

<header>
  <a href="/" class="brand">${title}</a>
  <nav>
    <a href="/" aria-current={page.route === "/" ? "page" : undefined}>Home</a>
    <!-- forge:nav (bun forge startapp adds links above) -->
  </nav>${auth ? '\n  <a href="/login" class="me">{me ? me.name : "Sign in"}</a>' : ""}
</header>

<main>
  {@render children()}
</main>

<style>
  :global(body) { margin: 0; font-family: system-ui, sans-serif; color: #1f1d2b; }
  header { display: flex; gap: 1.5rem; align-items: center; padding: 1rem 2rem; border-bottom: 1px solid #e4e2ee; }
  .brand { font-weight: 700; color: #6d28d9; text-decoration: none; }
  nav { display: flex; gap: 1rem; flex: 1; }
  nav a { color: inherit; }
  main { padding: 2rem; max-width: 48rem; }
</style>
`;
}

const HOME = (title: string) => `<!-- Page "/": the home page. -->
<svelte:head><title>${title}</title></svelte:head>

<h1>${title}</h1>
<p>Create your first app: <code>bun forge startapp todos</code></p>
`;

const ACCOUNT_REPOSITORY = `// "account" app: who is signed in. Better Auth itself is mounted on /api/auth.
import { defineRepository, z } from "forge/server";

export const account = defineRepository(({ get }) => ({
  // GET /api/account/me, and \`forge.account.me()\` in pages.
  me: get("/me", {
    output: z.object({ id: z.string(), name: z.string(), email: z.string() }).nullable(),
    remote: true,
    handler: async ({ session }) => {
      const current = await session();
      return current ? { id: current.user.id, name: current.user.name, email: current.user.email } : null;
    },
  }),
}));
`;

const AUTH_CLIENT = `// Better Auth's Svelte client (sign up, sign in, sign out), created on first use.
import { createAuthClient } from "forge/auth/client";

let client: ReturnType<typeof createAuthClient> | undefined;
export function authClient() {
  return (client ??= createAuthClient());
}
`;

const LOGIN = `<!-- Page "/login": sign up, sign in and sign out with Better Auth. -->
<script lang="ts">
  import { forge } from "forge:router";
  import { authClient } from "../../lib/auth-client.ts";

  const me = await forge.account.me();
  let name = $state("");
  let email = $state("");
  let password = $state("");
  let message = $state("");

  // The session changed: reload so every layout reads the new user.
  const reload = () => location.assign("/");

  async function signUp(event: SubmitEvent) {
    event.preventDefault();
    const { error } = await authClient().signUp.email({ name, email, password });
    if (error) message = error.message ?? "Sign up failed";
    else reload();
  }

  async function signIn() {
    const { error } = await authClient().signIn.email({ email, password });
    if (error) message = error.message ?? "Sign in failed";
    else reload();
  }

  async function signOut() {
    await authClient().signOut();
    reload();
  }
</script>

<svelte:head><title>Account</title></svelte:head>

{#if me}
  <h1>Hello {me.name}</h1>
  <button onclick={signOut}>Sign out</button>
{:else}
  <h1>Sign in</h1>
  <form onsubmit={signUp}>
    <input bind:value={name} placeholder="Name (sign up)" />
    <input type="email" bind:value={email} placeholder="Email" required />
    <input type="password" bind:value={password} placeholder="Password" required />
    <button type="submit">Create an account</button>
    <button type="button" onclick={signIn}>Sign in</button>
  </form>
  <p>{message}</p>
{/if}
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
    files["src/web/+layout.svelte"] = layout(title, o.auth);
    files["src/web/+page.svelte"] = HOME(title);
  }
  if (o.auth) {
    files["src/apps/account/repository.ts"] = ACCOUNT_REPOSITORY;
    if (web) {
      files["src/lib/auth-client.ts"] = AUTH_CLIENT;
      files["src/web/login/+page.svelte"] = LOGIN;
    }
  }
  if (api && o.auth) {
    files["src/urls.ts"] = URLS.replace(
      'import { defineUrls } from "forge/server";\n',
      'import { defineUrls } from "forge/server";\nimport { account } from "./apps/account/repository.ts";\n',
    ).replace("defineUrls({\n", 'defineUrls({\n  "/api/account": account,\n');
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
  out.log(`  added "${glob}" to the workspaces of ${relative(process.cwd(), file) || "package.json"}`);
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
