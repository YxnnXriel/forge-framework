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
  let failed = false;
  const config = await loadConfig(root);
  out.log("✓ forge.config.ts");

  if (config.db) {
    const status = await schemaStatus(root, config.apps, config.db.provider, await extraModels(config as DbConfig));
    if (status === "in-sync") out.log("✓ Prisma schema in sync with the models");
    else {
      failed = true;
      out.error(`✗ Prisma schema ${status === "missing" ? "not generated" : "out of date"}: run \`forge db generate\``);
    }
  }

  // Types of remote functions and dependencies, as the app would generate them.
  await refreshTypes(root, out);

  const tsconfig = join(root, "tsconfig.json");
  if (!existsSync(tsconfig)) throw new ForgeError("FORGE_CHECK", "No tsconfig.json in the project");
  const tool = config.web
    ? { pkg: "svelte-check", bin: "svelte-check", args: ["--tsconfig", tsconfig, "--threshold", "error"] }
    : { pkg: "typescript", bin: "tsc", args: ["--noEmit", "-p", tsconfig] };
  const bin = resolveBin(root, tool.pkg, tool.bin);
  if (!bin) {
    out.error(`✗ ${tool.pkg} is not installed in the project: bun add -d ${tool.pkg}`);
    return 1;
  }
  const proc = Bun.spawn(["bun", bin, ...tool.args], { cwd: root, stdio: ["inherit", "inherit", "inherit"] });
  if ((await proc.exited) !== 0) failed = true;
  else out.log(`✓ types (${tool.bin})`);
  return failed ? 1 : 0;
}
