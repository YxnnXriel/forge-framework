import { parseArgs } from "node:util";
import { ForgeError } from "@forge/core/errors";
import { colorEnabled, palette, symbols } from "@forge/core/term";
import { createUi } from "./ui.ts";
import type { Out } from "./util.ts";

// Commands are imported on demand: `forge start` never loads the bundler,
// `forge db` never loads Svelte.

const COMMANDS: [string, string][][] = [
  [
    ["new <name>", "New project (--template full|api|web, --db sqlite|postgresql|none, --no-auth)"],
    ["startapp <name>", "New app in src/apps: commented skeleton, wired into src/urls.ts"],
    ["example <name>", "Adds a complete example to the project (todo)"],
  ],
  [
    ["dev", "Run from source, restart on change, reload open pages"],
    ["build", "Production build in .forge/build (--compile: one executable, --target vercel)"],
    ["start", "Run the production build (--migrate: apply migrations first)"],
    ["check", "Config, models/schema sync, types"],
  ],
  [
    ["db generate", "Models -> Prisma schema, then Prisma Client"],
    ["db migrate", "Create and apply a migration (named automatically, -n to name it)"],
    ["db deploy", "Apply pending migrations (production, CI; no Prisma engine)"],
    ["db status", "Models/schema sync + migration status"],
  ],
  [["setup docker|vercel", "Deployment files (Dockerfile for Dokploy/Railway, vercel.json)"]],
];

function help(color: boolean): string {
  const p = palette(color);
  const titles = ["Project", "Develop & ship", "Database", "Deploy"];
  const lines = [`\n  ${p.brand(p.bold(`${symbols.logo} forge`))}  ${p.dim("the full-stack framework for Bun")}\n`, `  ${p.bold("Usage")}  ${p.cyan("bun forge <command>")}\n`];
  COMMANDS.forEach((group, i) => {
    lines.push(`  ${p.accent(titles[i]!)}`);
    for (const [cmd, text] of group) lines.push(`    ${p.cyan(cmd.padEnd(20))} ${p.dim(text)}`);
    lines.push("");
  });
  return lines.join("\n");
}

export async function run(argv: string[], options: { root?: string; out?: Partial<Out> } = {}): Promise<number> {
  const root = options.root ?? process.cwd();
  const base = { log: options.out?.log ?? console.log, error: options.out?.error ?? console.error };
  // Colors only when writing to the terminal ourselves (captured output stays plain).
  const color = !options.out && colorEnabled();
  const out: Out = { ...base, ui: createUi(base, color) };
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
      dir: { type: "string" },
    },
  });
  const [command, sub] = positionals;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

  try {
    if (values.help || !command) {
      out.log(help(color));
      return 0;
    }
    switch (command) {
      case "new":
        return await (await import("./commands/new.ts")).newProject(
          root,
          {
            name: sub,
            install: values["no-install"] !== true,
            ...(str(values.template) ? { template: str(values.template)! } : {}),
            ...(str(values.db) ? { db: str(values.db)! } : {}),
            ...(values["no-auth"] ? { auth: false } : values.auth ? { auth: true } : {}),
            ...(str(values.dir) ? { dir: str(values.dir)! } : {}),
          },
          out,
        );
      case "startapp":
        return await (await import("./commands/startapp.ts")).startapp(root, sub, out);
      case "example":
        return await (await import("./commands/example.ts")).example(root, sub, out);
      case "dev":
        return await (await import("./commands/dev.ts")).dev(root, out);
      case "build": {
        const target = str(values.target);
        if (target !== undefined && target !== "bun" && target !== "vercel") {
          out.ui.fail(`Unknown target "${target}" (bun, vercel)`);
          return 1;
        }
        return await (await import("./commands/build.ts")).build(root, { compile: values.compile === true, ...(target ? { target } : {}) }, out);
      }
      case "start":
        return await (await import("./commands/start.ts")).start(root, values.migrate ? ["start", "--migrate"] : ["start"], out);
      case "check":
        return await (await import("./commands/check.ts")).check(root, out);
      case "setup":
        return await (await import("./commands/setup.ts")).setup(root, sub, values.force === true, out);
      case "db":
        return await (await import("./commands/db.ts")).db(root, sub, { ...(str(values.name) ? { name: str(values.name)! } : {}) }, out);
    }
    out.ui.fail(`Unknown command: ${positionals.join(" ")}`);
    out.log(help(color));
    return 1;
  } catch (err) {
    if (err instanceof ForgeError) {
      out.ui.fail(err.message);
      return 1;
    }
    throw err;
  }
}
