import { relative } from "node:path";
import { ForgeError } from "@forge/core/errors";
import { planProject, writeProject, type DbChoice, type Template } from "../scaffold/project.ts";
import { assertBun, refreshTypes, type Out } from "../util.ts";

export interface NewArgs {
  name: string | undefined;
  template?: string;
  db?: string;
  auth?: boolean;
  install: boolean;
  dir?: string;
}

const TEMPLATES = ["full", "api", "web"] as const;
const DBS = ["sqlite", "postgresql", "none"] as const;

/** `forge new <name>`: a ready-to-run project (like `django-admin startproject`). */
export async function newProject(cwd: string, args: NewArgs, out: Out): Promise<number> {
  assertBun();
  if (!args.name) {
    out.error("Usage: forge new <name> [--template full|api|web] [--db sqlite|postgresql|none] [--no-auth]");
    return 1;
  }
  const template = (args.template ?? "full") as Template;
  if (!TEMPLATES.includes(template)) throw new ForgeError("FORGE_NEW", `Unknown template "${template}" (full, api, web)`);
  const db = (args.db ?? (template === "web" ? "none" : "sqlite")) as DbChoice;
  if (!DBS.includes(db)) throw new ForgeError("FORGE_NEW", `Unknown database "${db}" (sqlite, postgresql, none)`);
  const auth = args.auth ?? (template === "full" && db !== "none");

  const plan = planProject({ name: args.name, template, db, auth, ...(args.dir ? { dir: args.dir } : {}) }, cwd);
  await writeProject(plan, out);
  const where = relative(cwd, plan.root) || ".";
  out.log(`Created ${where} (${template}${db !== "none" ? `, ${db}` : ""}${auth ? ", Better Auth" : ""})`);
  for (const file of Object.keys(plan.files).sort()) out.log(`  ${file}`);

  if (args.install) {
    // Inside the Forge repository the project is a workspace member: install from the repo root.
    const installDir = plan.repo ?? plan.root;
    out.log(`\nbun install (${relative(cwd, installDir) || "."})`);
    const install = Bun.spawn(["bun", "install"], { cwd: installDir, stdio: ["inherit", "inherit", "inherit"] });
    if ((await install.exited) !== 0) {
      out.error("bun install failed: fix it, then run `bun install` again");
      return 1;
    }
    if (db !== "none") {
      const { generate } = await import("./db.ts");
      await generate(plan.root, out).catch((e: unknown) => out.error(`warning: ${e instanceof Error ? e.message : e}`));
    }
    await refreshTypes(plan.root, out);
  }

  out.log(`
Next:
  cd ${where}
  bun forge startapp todos${db !== "none" ? "\n  bun forge db migrate" : ""}
  bun dev`);
  return 0;
}
