import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { ForgeError } from "@forge/core/errors";
import type { ResolvedConfig } from "@forge/core";
import { appName, namesOf, type AppNames } from "./names.ts";

/* ------------------------------- Skeleton ------------------------------- */
// `forge startapp` writes commented skeletons only: the structure and the
// conventions, nothing implemented. Complete examples: `forge example`.

const models = (n: AppNames) => `// Models of the "${n.app}" app: each class exported here is a database table.
// Discovered automatically (nothing to register). After a change:
//   bun forge db migrate     -> Prisma schema + migration (named for you) + client
//
// Every model gets an \`id\` (uuid). Field builders:
//   model.string({ maxLength, unique, default })   model.text()   model.int()
//   model.float()   model.decimal()   model.boolean({ default })   model.dateTime()
//   model.json()   model.enum(["a", "b"])   model.uuid()
// Relations (pass the class itself):
//   model.foreignKey(Other, { onDelete: "Cascade" })   model.oneToOne(Other)
//   model.manyToMany(Other)
// Options:
//   static override timestamps = true;                 createdAt, updatedAt, deletedAt
//   static override indexes = [model.index(["field"])];
import { Model, model } from "forge/models";

// export class ${n.model} extends Model {
//   static override model = {
//     title: model.string({ maxLength: 200 }),
//   };
//   static override timestamps = true;
// }
`;

const schemas = (n: AppNames) => `// Validation schemas of the "${n.app}" app (Zod).
//   input:  what a request may contain (params + query + body, merged). Invalid -> 400.
//   output: what leaves the server. With z.object, undeclared keys are stripped:
//           a password hash in the database never reaches the client.
import { z } from "forge";

// export const ${n.model}Input = z.object({
//   title: z.string().trim().min(1).max(200),
// });
//
// export const ${n.model}Output = z.object({
//   id: z.string(),
//   title: z.string(),
// });
`;

const repository = (n: AppNames, config: ResolvedConfig) => `// Endpoints of the "${n.app}" app.
${config.api ? `// Mounted by urls.ts (this app's routes), itself mounted on /api/${n.path} in src/urls.ts.\n` : ""}//
// Each entry is one endpoint: verb("/path", definition).
//   get, post, put, patch, del         HTTP verbs; ":id" in the path -> input.id
//   input / output                     Zod schemas (see schemas.ts)
//   handler: ({ input${config.db ? ", db" : ""}${config.auth ? ", session" : ""} }) => ...   dependencies arrive in the context${
  config.db ? "\n//   db                                 Prisma Client (db.<model>.findMany(), ...)" : ""
}${config.auth ? "\n//   session()                          current Better Auth session, or null" : ""}
//   remote: true                       callable from Svelte pages:
//                                        import { forge } from "forge:router";
//                                        await forge.${n.app}.list();
${config.auth ? "//   access: authenticated              403 without a signed-in user (from \"forge/auth\")\n" : ""}//   error(404, "Not found")            stops the handler with an HTTP error
//
// Callable in-process too (scripts, tests): await ${n.app}.list().
import { defineRepository } from "forge/server";

export const ${n.app} = defineRepository(({ get, post, put, del }) => ({
  // list: get("/", {
  //   output: z.array(${n.model}Output),
  //   remote: true,
  //   handler: (${config.db ? `{ db }) => db.${n.delegate}.findMany()` : "() => []"},
  // }),
}));
`;

const views = (n: AppNames, config: ResolvedConfig) => `// Views of the "${n.app}" app: one endpoint each, for what does not belong to
// the repository (aggregates, webhooks, health checks...). Mounted in urls.ts:
//   createRouter().get("/stats", stats)
//
// defineView takes the same options as a repository entry
// (input, output, remote, access, handler) and stays callable in-process.
import { defineView } from "forge/server";

// export const stats = defineView({
//   output: z.object({ total: z.number() }),
//   handler: async (${config.db ? `{ db }) => ({ total: await db.${n.delegate}.count() })` : "() => ({ total: 0 })"},
// });
`;

/** The app's routes: what src/urls.ts mounts on /api/<app>. */
export const appUrls = (n: AppNames, config: ResolvedConfig, hasViews: boolean) => `// Routes of the "${n.app}" app${config.api ? `, mounted on /api/${n.path} by src/urls.ts` : ""}.
// Three ways to declare endpoints, combined freely (first match wins):
//   .get("/health", () => ({ ok: true }))    a simple function
//   .get("/stats", stats)                    a view (views.ts)
//   .mount(${n.app})${" ".repeat(Math.max(1, 33 - n.app.length))}every endpoint of the repository
// Hono middleware for these routes only: .use(...)
import { createRouter } from "forge/server";
import { ${n.app} } from "./repository.ts";
${hasViews ? `// import { stats } from "./views.ts";
` : ""}
export const router = createRouter().mount(${n.app});
`;

/* -------------------------------- Wiring -------------------------------- */

/** Inserts the app router's import + `"/api/<path>": <app>,` into the project's urls file. */
export function addToUrls(source: string, n: AppNames, importPath: string): string | null {
  if (source.includes(`as ${n.app} } from`) || source.includes(`import { ${n.app} } from`)) return source;
  const call = source.indexOf("defineUrls({");
  if (call < 0) return null;
  const end = source.indexOf("\n})", call);
  const inline = source.indexOf("defineUrls({})");
  const entry = `  "/api/${n.path}": ${n.app},\n`;
  let next: string;
  if (inline >= 0) next = source.replace("defineUrls({})", `defineUrls({\n${entry}})`);
  else if (end >= 0) next = source.slice(0, end + 1) + entry + source.slice(end + 1);
  else return null;
  const line = `import { router as ${n.app} } from ${JSON.stringify(importPath)};\n`;
  const imports = [...next.matchAll(/^import .*;\n/gm)];
  const at = imports.length ? imports.at(-1)!.index! + imports.at(-1)![0].length : 0;
  return next.slice(0, at) + line + next.slice(at);
}

/** Adds a link before the `<!-- forge:nav -->` marker of the root layout. */
export function addToNav(source: string, href: string, label: string): string | null {
  if (source.includes(`href="${href}"`)) return source;
  const marker = /^([ \t]*)<!-- forge:nav/m.exec(source);
  if (!marker) return null;
  const current = href === "/" ? 'page.route === "/"' : `page.route.startsWith(${JSON.stringify(href)})`;
  const link = `${marker[1]}<a href="${href}" aria-current={${current} ? "page" : undefined}>${label}</a>\n`;
  return source.slice(0, marker.index) + link + source.slice(marker.index);
}

export interface WriteResult {
  created: string[];
  updated: string[];
  skipped: string[];
  manual: string[];
}

export const emptyResult = (): WriteResult => ({ created: [], updated: [], skipped: [], manual: [] });

/** Writes new files (never overwrites: existing ones are reported as skipped). */
export async function writeFiles(root: string, files: Record<string, string>, result: WriteResult): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    if (existsSync(path)) {
      result.skipped.push(relative(root, path));
      continue;
    }
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, content);
    result.created.push(relative(root, path));
  }
}

/** Registers an app's repository in src/urls.ts (when the project has an API). */
export async function wireUrls(root: string, config: ResolvedConfig, n: AppNames, result: WriteResult): Promise<void> {
  if (!config.api) return;
  const urls = config.api.urls;
  const importPath = `./${relative(dirname(urls), join(config.apps, n.app, "urls.ts")).split("\\").join("/")}`;
  const source = existsSync(urls) ? await Bun.file(urls).text() : null;
  const next = source !== null ? addToUrls(source, n, importPath) : null;
  if (next === null) {
    result.manual.push(`${relative(root, urls)}: import { router as ${n.app} } from "${importPath}" and add "/api/${n.path}": ${n.app}`);
  } else if (next !== source) {
    await Bun.write(urls, next);
    result.updated.push(relative(root, urls));
  }
}

/** Adds a nav link to the root layout (pages). */
export async function wireNav(root: string, config: ResolvedConfig, href: string, label: string, result: WriteResult): Promise<void> {
  if (!config.web) return;
  const layout = join(config.web.dir, "+layout.svelte");
  const source = existsSync(layout) ? await Bun.file(layout).text() : null;
  const next = source !== null ? addToNav(source, href, label) : null;
  if (next === null) result.manual.push(`${relative(root, layout)}: add a link to ${href}`);
  else if (next !== source) {
    await Bun.write(layout, next);
    result.updated.push(relative(root, layout));
  }
}

/** `forge startapp <name>`: commented skeleton in src/apps/<name> (models, schemas, repository, views, urls), registered in src/urls.ts. */
export async function startApp(root: string, config: ResolvedConfig, input: string): Promise<{ names: AppNames } & WriteResult> {
  const names = namesOf(appName(input));
  const dir = join(config.apps, names.app);
  if (existsSync(dir)) throw new ForgeError("FORGE_APP_EXISTS", `App "${names.app}" already exists (${relative(root, dir)})`);
  const files: Record<string, string> = {};
  if (config.db) files[join(dir, "models.ts")] = models(names);
  files[join(dir, "schemas.ts")] = schemas(names);
  files[join(dir, "repository.ts")] = repository(names, config);
  files[join(dir, "views.ts")] = views(names, config);
  files[join(dir, "urls.ts")] = appUrls(names, config, true);
  const result = emptyResult();
  await writeFiles(root, files, result);
  await wireUrls(root, config, names, result);
  return { names, ...result };
}
