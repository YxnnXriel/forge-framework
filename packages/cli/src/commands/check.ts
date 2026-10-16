import { existsSync } from "node:fs";
import { join } from "node:path";
import { ForgeError, loadConfig } from "@forge/core";
import { schemaStatus } from "@forge/models";
import { assertBun, extraModels, refreshTypes, resolveBin, type DbConfig, type Out } from "../util.ts";

/**
 * `forge check`: what can be verified without running the app.
 * Config, models/schema sync, then types (svelte-check when there are pages:
 * it checks .ts files too; tsc otherwise), with the project's own tools.
 */
export async function check(root: string, out: Out): Promise<number> {
  assertBun();
  const { ui } = out;
  ui.header("check");
  let failed = false;
  const config = await loadConfig(root);
  ui.ok("forge.config.ts");

  if (config.db) {
    const status = await schemaStatus(root, config.apps, config.db.provider, await extraModels(config as DbConfig));
    if (status === "in-sync") ui.ok("Prisma schema in sync with the models");
    else {
      failed = true;
      ui.fail(`Prisma schema ${status === "missing" ? "not generated" : "out of date"}: run \`bun forge db generate\``);
    }
  }

  // Types of remote functions and dependencies, as the app would generate them.
  await refreshTypes(root, out);

  const tsconfig = join(root, "tsconfig.json");
  if (!existsSync(tsconfig)) throw new ForgeError("FORGE_CHECK", "No tsconfig.json in the project");
  const tool = config.web
    ? { pkg: "svelte-check", bin: "svelte-check", args: ["--tsconfig", tsconfig, "--threshold", "error", "--output", "human"] }
    : { pkg: "typescript", bin: "tsc", args: ["--noEmit", "-p", tsconfig] };
  const bin = resolveBin(root, tool.pkg, tool.bin);
  if (!bin) {
    ui.fail(`${tool.pkg} is not installed in the project: bun add -d ${tool.pkg}`);
    return 1;
  }
  // Output shown only when something is wrong.
  const typed = await ui
    .step(`Types (${tool.bin})`, async () => {
      const proc = Bun.spawn(["bun", bin, ...tool.args], { cwd: root, stdout: "pipe", stderr: "pipe" });
      const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      if (code !== 0) throw new Error((stdout + stderr).trim());
    })
    .then(() => true)
    .catch((err: Error) => {
      out.error(err.message.split("\n").map((l) => `    ${l}`).join("\n"));
      return false;
    });
  if (!typed) failed = true;
  out.log("");
  return failed ? 1 : 0;
}
