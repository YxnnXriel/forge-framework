import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { ForgeError } from "@forge/core/errors";
import type { ResolvedConfig } from "@forge/core";
import type { Out } from "../util.ts";
import { appName, namesOf, type AppNames } from "./names.ts";

const models = (n: AppNames) => `// Models of the "${n.app}" app: each class is a database table.
// Forge generates the Prisma schema from them; \`bun forge db migrate\` then
// creates and applies the migration (named automatically).
//
// Every model has an \`id\` (uuid). Fields: model.string, text, int, float,
// decimal, boolean, dateTime, json, enum([...]). Relations:
// model.foreignKey(Other), model.oneToOne(Other), model.manyToMany(Other).
import { Model, model } from "forge/models";

export class ${n.model} extends Model {
  static override model = {
    title: model.string({ maxLength: 200 }),
  };
  // Adds createdAt, updatedAt and deletedAt.
  static override timestamps = true;
}
`;

const schemas = (n: AppNames, db: boolean) => `// Validation of the "${n.app}" app: what comes in (input) and what goes out
// (output). Only the keys declared in an output schema leave the server.
import { z } from "forge";

export const ${n.model}Id = z.object({ id: z.string() });

export const ${n.model}Input = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
});

export const ${n.model}Output = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.date(),
});
${db ? "" : `
export type ${n.model} = z.infer<typeof ${n.model}Output>;
`}`;

function repository(n: AppNames, db: boolean, auth: boolean): string {
  const access = auth
    ? `    // Uncomment to require a signed-in user (403 otherwise):
    // access: authenticated,
`
    : "";
  const imports = [
    ...(auth ? ['// import { authenticated } from "forge/auth";'] : []),
    'import { defineRepository, error, z } from "forge/server";',
    `import { ${n.model}Id, ${n.model}Input, ${n.model}Output${db ? "" : `, type ${n.model}`} } from "./schemas.ts";`,
  ];
  const header = `// Endpoints of the "${n.app}" app, mounted on /api/${n.path} in src/urls.ts.
// \`remote: true\` also makes a function callable from Svelte pages:
//   import { forge } from "forge:router";  const items = await forge.${n.app}.list();
${imports.join("\n")}
`;
  if (db) {
    return `${header}
export const ${n.app} = defineRepository(({ get, post, put, del }) => ({
  // GET /api/${n.path}
  list: get("/", {
    output: z.array(${n.model}Output),
    remote: true,
    handler: ({ db }) => db.${n.delegate}.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" } }),
  }),

  // GET /api/${n.path}/:id
  detail: get("/:id", {
    input: ${n.model}Id,
    output: ${n.model}Output,
    remote: true,
    handler: async ({ input, db }) =>
      (await db.${n.delegate}.findFirst({ where: { id: input.id, deletedAt: null } })) ?? error(404, "${n.model} not found"),
  }),

  // POST /api/${n.path}
  create: post("/", {
    input: ${n.model}Input,
    output: ${n.model}Output,
    status: 201,
    remote: true,
${access}    handler: ({ input, db }) => db.${n.delegate}.create({ data: input }),
  }),

  // PUT /api/${n.path}/:id (replaces the editable fields)
  update: put("/:id", {
    input: ${n.model}Id.extend(${n.model}Input.shape),
    output: ${n.model}Output,
    remote: true,
    handler: async ({ input: { id, ...data }, db }) => {
      const found = await db.${n.delegate}.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
      if (!found) error(404, "${n.model} not found");
      return db.${n.delegate}.update({ where: { id }, data });
    },
  }),

  // DELETE /api/${n.path}/:id (soft delete: sets deletedAt)
  remove: del("/:id", {
    input: ${n.model}Id,
    remote: true,
    handler: async ({ input, db }) => {
      const { count } = await db.${n.delegate}.updateMany({ where: { id: input.id, deletedAt: null }, data: { deletedAt: new Date() } });
      if (!count) error(404, "${n.model} not found");
    },
  }),
}));
`;
  }
  return `${header}
// In-memory store (no database in this project): emptied on restart.
const items = new Map<string, ${n.model}>();

export const ${n.app} = defineRepository(({ get, post, put, del }) => ({
  // GET /api/${n.path}
  list: get("/", {
    output: z.array(${n.model}Output),
    remote: true,
    handler: () => [...items.values()].reverse(),
  }),

  // GET /api/${n.path}/:id
  detail: get("/:id", {
    input: ${n.model}Id,
    output: ${n.model}Output,
    remote: true,
    handler: ({ input }) => items.get(input.id) ?? error(404, "${n.model} not found"),
  }),

  // POST /api/${n.path}
  create: post("/", {
    input: ${n.model}Input,
    output: ${n.model}Output,
    status: 201,
    remote: true,
${access}    handler: ({ input }) => {
      const item = { id: crypto.randomUUID(), createdAt: new Date(), ...input };
      items.set(item.id, item);
      return item;
    },
  }),

  // PUT /api/${n.path}/:id (replaces the editable fields)
  update: put("/:id", {
    input: ${n.model}Id.extend(${n.model}Input.shape),
    output: ${n.model}Output,
    remote: true,
    handler: ({ input: { id, ...data } }) => {
      const item = items.get(id) ?? error(404, "${n.model} not found");
      Object.assign(item, data);
      return item;
    },
  }),

  // DELETE /api/${n.path}/:id
  remove: del("/:id", {
    input: ${n.model}Id,
    remote: true,
    handler: ({ input }) => {
      if (!items.delete(input.id)) error(404, "${n.model} not found");
    },
  }),
}));
`;
}

const page = (n: AppNames) => `<!-- Page "/${n.path}": lists the ${n.app} and creates new ones through the
     app's remote functions (src/apps/${n.app}/repository.ts). -->
<script lang="ts">
  import { forge } from "forge:router";
  import { RemoteError } from "forge/web";

  // Rendered on the server; the browser reuses the data (no second call).
  let items = $state(await forge.${n.app}.list());
  let title = $state("");
  let message = $state("");

  async function create(event: SubmitEvent) {
    event.preventDefault();
    try {
      const item = await forge.${n.app}.create({ title });
      items = [item, ...items];
      title = "";
      message = "";
    } catch (e) {
      message = e instanceof RemoteError ? e.message : "Unexpected error";
    }
  }

  async function remove(id: string) {
    await forge.${n.app}.remove({ id });
    items = items.filter((item) => item.id !== id);
  }
</script>

<svelte:head><title>${n.label}</title></svelte:head>

<h1>${n.label}</h1>

<form onsubmit={create}>
  <input bind:value={title} placeholder="Title" />
  <button type="submit">Add</button>
</form>
{#if message}<p class="error">{message}</p>{/if}

<ul>
  {#each items as item (item.id)}
    <li>
      {item.title}
      <button onclick={() => remove(item.id)} aria-label="Delete">×</button>
    </li>
  {:else}
    <li>Nothing yet.</li>
  {/each}
</ul>
`;

/** Inserts `import` + `"/api/<path>": <app>,` into the project's urls file. */
export function addToUrls(source: string, n: AppNames, importPath: string): string | null {
  const call = source.indexOf("defineUrls({");
  if (call < 0) return null;
  const end = source.indexOf("\n})", call);
  const inline = source.indexOf("defineUrls({})");
  const entry = `  "/api/${n.path}": ${n.app},\n`;
  let next: string;
  if (inline >= 0) next = source.replace("defineUrls({})", `defineUrls({\n${entry}})`);
  else if (end >= 0) next = source.slice(0, end + 1) + entry + source.slice(end + 1);
  else return null;
  const line = `import { ${n.app} } from ${JSON.stringify(importPath)};\n`;
  const imports = [...next.matchAll(/^import .*;\n/gm)];
  const at = imports.length ? imports.at(-1)!.index! + imports.at(-1)![0].length : 0;
  return next.slice(0, at) + line + next.slice(at);
}

/** Adds a link before the `<!-- forge:nav -->` marker of the root layout. */
export function addToNav(source: string, n: AppNames): string | null {
  const marker = /^([ \t]*)<!-- forge:nav/m.exec(source);
  if (!marker) return null;
  const link = `${marker[1]}<a href="/${n.path}" aria-current={page.route.startsWith("/${n.path}") ? "page" : undefined}>${n.label}</a>\n`;
  return source.slice(0, marker.index) + link + source.slice(marker.index);
}

export interface StartAppResult {
  names: AppNames;
  created: string[];
  updated: string[];
  manual: string[];
}

/** `forge startapp <name>`: a new app in src/apps, wired into the project. */
export async function startApp(root: string, config: ResolvedConfig, input: string, options: { page: boolean }, out: Out): Promise<StartAppResult> {
  const names = namesOf(appName(input));
  const dir = join(config.apps, names.app);
  if (existsSync(dir)) throw new ForgeError("FORGE_APP_EXISTS", `App "${names.app}" already exists (${relative(root, dir)})`);
  const db = config.db !== null;
  const auth = config.auth !== null;

  const files: Record<string, string> = {
    [join(dir, "schemas.ts")]: schemas(names, db),
    [join(dir, "repository.ts")]: repository(names, db, auth),
  };
  if (db) files[join(dir, "models.ts")] = models(names);
  const webPage = config.web && options.page ? join(config.web.dir, names.path, "+page.svelte") : null;
  if (webPage) {
    if (existsSync(webPage)) out.error(`warning: ${relative(root, webPage)} exists, not overwritten`);
    else files[webPage] = page(names);
  }

  const result: StartAppResult = { names, created: [], updated: [], manual: [] };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, content);
    result.created.push(relative(root, path));
  }

  if (config.api) {
    const urls = config.api.urls;
    const importPath = `./${relative(dirname(urls), join(dir, "repository.ts")).split("\\").join("/")}`;
    const next = existsSync(urls) ? addToUrls(await Bun.file(urls).text(), names, importPath) : null;
    if (next) {
      await Bun.write(urls, next);
      result.updated.push(relative(root, urls));
    } else {
      result.manual.push(`${relative(root, urls)}: import { ${names.app} } from "${importPath}" and add "/api/${names.path}": ${names.app}`);
    }
  }
  if (webPage && config.web) {
    const layoutFile = join(config.web.dir, "+layout.svelte");
    const next = existsSync(layoutFile) ? addToNav(await Bun.file(layoutFile).text(), names) : null;
    if (next) {
      await Bun.write(layoutFile, next);
      result.updated.push(relative(root, layoutFile));
    }
  }
  return result;
}
