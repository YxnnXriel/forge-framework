import { loadConfig } from "@forge/core";
import { startApp } from "../scaffold/app.ts";
import { assertBun, refreshTypes, type Out } from "../util.ts";

/** `forge startapp <name>`: a new app in src/apps, wired into urls.ts and the layout. */
export async function startapp(root: string, name: string | undefined, options: { page: boolean }, out: Out): Promise<number> {
  assertBun();
  if (!name) {
    out.error("Usage: forge startapp <name> [--no-page]   (e.g. forge startapp todos)");
    return 1;
  }
  const config = await loadConfig(root);
  const result = await startApp(root, config, name, options, out);
  out.log(`App "${result.names.app}" (model ${result.names.model}${config.db ? "" : ", in memory"})`);
  for (const file of result.created) out.log(`  created ${file}`);
  for (const file of result.updated) out.log(`  updated ${file}`);
  for (const todo of result.manual) out.error(`  to do by hand: ${todo}`);

  if (config.db) {
    // Schema + Prisma Client now, so `db.${result.names.delegate}` is typed right away.
    const { generate } = await import("./db.ts");
    if ((await generate(root, out, { ifNeeded: true })) !== 0) return 1;
  }
  await refreshTypes(root, out);
  out.log(config.db ? "\nNext: bun forge db migrate   (creates the table), then bun dev" : "\nNext: bun dev");
  return 0;
}
