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

/** Runs a command quietly (its output is shown only if it fails). */
async function quiet(cmd: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if (code !== 0) throw new ForgeError("FORGE_NEW", `${cmd.join(" ")} failed:\n${(stdout + stderr).trim()}`);
}

/** `forge new <name>`: a ready-to-run, commented project skeleton. */
export async function newProject(cwd: string, args: NewArgs, out: Out): Promise<number> {
  assertBun();
  const { ui } = out;
  if (!args.name) {
    ui.fail("Usage: bun forge new <name> [--template full|api|web] [--db sqlite|postgresql|none] [--no-auth]");
    return 1;
  }
  const template = (args.template ?? "full") as Template;
  if (!TEMPLATES.includes(template)) throw new ForgeError("FORGE_NEW", `Unknown template "${template}" (full, api, web)`);
  const db = (args.db ?? (template === "web" ? "none" : "sqlite")) as DbChoice;
  if (!DBS.includes(db)) throw new ForgeError("FORGE_NEW", `Unknown database "${db}" (sqlite, postgresql, none)`);
  const auth = args.auth ?? (template === "full" && db !== "none");

  const plan = planProject({ name: args.name, template, db, auth, ...(args.dir ? { dir: args.dir } : {}) }, cwd);
  const where = relative(cwd, plan.root) || ".";
  ui.header("new", args.name);
  ui.table([
    ["template", ui.p.accent(template)],
    ["database", db === "none" ? ui.p.dim("none") : ui.p.accent(db)],
    ["auth", auth ? ui.p.accent("Better Auth") : ui.p.dim("none")],
    ["folder", where],
  ]);
  out.log("");
  await writeProject(plan, out);
  for (const file of Object.keys(plan.files).sort()) ui.file("add", file);
  out.log("");

  if (args.install) {
    // Inside the Forge repository the project is a workspace member: install from the repo root.
    await ui.step("Dependencies", () => quiet(["bun", "install"], plan.repo ?? plan.root));
    if (db !== "none") {
      const { generate } = await import("./db.ts");
      await generate(plan.root, out);
    }
    await ui.step("Types", () => refreshTypes(plan.root, out));
  }

  ui.next([
    `cd ${where}`,
    ...(args.install ? [] : ["bun install"]),
    "bun forge startapp <name>     an app skeleton",
    "bun forge example todo        or a complete example",
    ...(db !== "none" ? ["bun forge db migrate"] : []),
    "bun dev",
  ]);
  return 0;
}
