import { loadConfig } from "@forge/core";
import { EXAMPLES } from "../scaffold/examples/todo.ts";
import { assertBun, refreshTypes, type Out } from "../util.ts";
import { report } from "./startapp.ts";

/** `forge example <name>`: adds a complete example to the current project. */
export async function example(root: string, name: string | undefined, out: Out): Promise<number> {
  assertBun();
  const { ui } = out;
  const found = name ? EXAMPLES[name as keyof typeof EXAMPLES] : undefined;
  if (!found) {
    if (name) ui.fail(`Unknown example "${name}"`);
    ui.header("example");
    ui.table(Object.values(EXAMPLES).map((e) => [e.name, ui.p.dim(e.description)]));
    ui.next(["bun forge example todo"]);
    return name ? 1 : 0;
  }
  ui.header("example", found.name);
  const config = await loadConfig(root);
  const result = await found.write(root, config);
  report(out, result);
  out.log("");
  if (config.db) {
    const { generate } = await import("./db.ts");
    if ((await generate(root, out, { ifNeeded: true })) !== 0) return 1;
  }
  await ui.step("Types", () => refreshTypes(root, out));
  ui.next([...(config.db ? ["bun forge db migrate"] : []), "bun dev", config.web ? "open http://localhost:3000/todos" : "curl localhost:3000/api/todos"]);
  return 0;
}
