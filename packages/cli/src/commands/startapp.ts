import { loadConfig } from "@forge/core";
import { startApp, type WriteResult } from "../scaffold/app.ts";
import { assertBun, refreshTypes, type Out } from "../util.ts";

export function report(out: Out, result: WriteResult) {
  for (const file of result.created) out.ui.file("add", file);
  for (const file of new Set(result.updated)) out.ui.file("change", file);
  for (const file of result.skipped) out.ui.note(`${file} exists, kept`);
  for (const todo of result.manual) out.ui.warn(`to do by hand: ${todo}`);
}

/** `forge startapp <name>`: commented skeleton in src/apps/<name>, registered in src/urls.ts. */
export async function startapp(root: string, name: string | undefined, out: Out): Promise<number> {
  assertBun();
  const { ui } = out;
  if (!name) {
    ui.fail("Usage: bun forge startapp <name>   (e.g. bun forge startapp todos)");
    return 1;
  }
  ui.header("startapp", name);
  const config = await loadConfig(root);
  const result = await startApp(root, config, name);
  report(out, result);
  out.log("");
  await ui.step("Types", () => refreshTypes(root, out));
  ui.next([
    `edit src/apps/${result.names.app}/${config.db ? "models.ts" : "repository.ts"}`,
    ...(config.db ? ["bun forge db migrate"] : []),
    "bun dev",
  ]);
  return 0;
}
