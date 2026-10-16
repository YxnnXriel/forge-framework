import { parseArgs } from "node:util";
import { ForgeError } from "@forge/core/errors";
import type { Out } from "./util.ts";

// Commands are imported on demand: `forge start` never loads the bundler,
// `forge db` never loads Svelte.

const HELP = `forge <command>

  forge new <name>             New project (in projects/ inside the Forge repository)
        [--template full|api|web] [--db sqlite|postgresql|none] [--no-auth] [--no-install]
  forge startapp <name>        New app in src/apps (models, schemas, repository, page),
        [--no-page]            wired into src/urls.ts and the layout
  forge dev                    Run from source, restart on change, reload open pages
  forge build [--compile]      Production build in .forge/build (server.js, or one executable)
              [--target vercel] also .vercel/output (automatic when VERCEL is set)
  forge start [--migrate]      Run the production build (--migrate: apply migrations first)
  forge check                  Config, models/schema sync, types
  forge setup docker|vercel    Deployment files (Dockerfile for Dokploy/Railway, vercel.json)

Database (needs \`db\` in forge.config.ts):
  forge db generate            Models -> Prisma schema, then Prisma Client
  forge db migrate [-n name]   Create and apply a migration (development, named automatically)
  forge db deploy              Apply pending migrations (production, CI; no Prisma engine needed)
  forge db status              Models/schema sync + migration status
`;

export async function run(argv: string[], options: { root?: string; out?: Out } = {}): Promise<number> {
  const root = options.root ?? process.cwd();
  const out = options.out ?? { log: console.log, error: console.error };
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      name: { type: "string", short: "n" },
      help: { type: "boolean", short: "h" },
      compile: { type: "boolean" },
      target: { type: "string" },
      template: { type: "string", short: "t" },
      migrate: { type: "boolean" },
      force: { type: "boolean" },
      db: { type: "string" },
      auth: { type: "boolean" },
      "no-auth": { type: "boolean" },
      "no-install": { type: "boolean" },
      "no-page": { type: "boolean" },
      dir: { type: "string" },
    },
  });
  const [command, sub] = positionals;

  try {
    if (values.help || !command) {
      out.log(HELP);
      return 0;
    }
    switch (command) {
      case "dev":
        return await (await import("./commands/dev.ts")).dev(root, out);
      case "build": {
        const target = values.target;
        if (target !== undefined && target !== "bun" && target !== "vercel") {
          out.error(`Unknown target "${String(target)}" (bun, vercel)`);
          return 1;
        }
        return await (await import("./commands/build.ts")).build(root, { compile: values.compile === true, ...(target ? { target } : {}) }, out);
      }
      case "start":
        return await (await import("./commands/start.ts")).start(root, values.migrate ? ["start", "--migrate"] : ["start"], out);
      case "check":
        return await (await import("./commands/check.ts")).check(root, out);
      case "new": {
        const str = (v: unknown) => (typeof v === "string" ? v : undefined);
        const target = str(values.target) ?? str(values.template);
        return await (await import("./commands/new.ts")).newProject(
          root,
          {
            name: sub,
            install: values["no-install"] !== true,
            ...(target ? { template: target } : {}),
            ...(str(values.db) ? { db: str(values.db)! } : {}),
            ...(values["no-auth"] ? { auth: false } : values.auth ? { auth: true } : {}),
            ...(str(values.dir) ? { dir: str(values.dir)! } : {}),
          },
          out,
        );
      }
      case "startapp":
        return await (await import("./commands/startapp.ts")).startapp(root, sub, { page: values["no-page"] !== true }, out);
      case "setup":
        return await (await import("./commands/setup.ts")).setup(root, sub, values.force === true, out);
      case "db":
        return await (await import("./commands/db.ts")).db(root, sub, { ...(typeof values.name === "string" ? { name: values.name } : {}) }, out);
    }
    out.error(`Unknown command: ${positionals.join(" ")}\n\n${HELP}`);
    return 1;
  } catch (err) {
    if (err instanceof ForgeError) {
      out.error(err.message);
      return 1;
    }
    throw err;
  }
}
