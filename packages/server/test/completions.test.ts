/**
 * Editor experience regression test: runs the TypeScript language service
 * (what VS Code uses) and checks that `input.` is completed with the keys of
 * the input schema in every way of declaring an endpoint, including while the
 * handler is still incomplete and does not type-check yet.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import ts from "typescript";

const src = join(import.meta.dir, "../src/index.ts");
const file = join(import.meta.dir, "__completion_probe__.ts");

function completionsAfter(body: string): string[] {
  const text = `import { createRouter, defineRepository, defineView, get } from ${JSON.stringify(src)};
import { z } from "zod";
const Id = z.object({ id: z.coerce.number() });
const Out = z.object({ id: z.number(), title: z.string() });
export const probe = ${body};
`;
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    noEmit: true,
    types: ["bun"],
    exactOptionalPropertyTypes: true,
  };
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [file],
    getScriptVersion: () => "1",
    getScriptSnapshot: (f) =>
      f === file ? ts.ScriptSnapshot.fromString(text) : ts.sys.fileExists(f) ? ts.ScriptSnapshot.fromString(ts.sys.readFile(f)!) : undefined,
    getCurrentDirectory: () => import.meta.dir,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => f === file || ts.sys.fileExists(f),
    readFile: (f) => (f === file ? text : ts.sys.readFile(f)),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  const marker = "input.";
  const pos = text.lastIndexOf(marker) + marker.length;
  const result = ts.createLanguageService(host).getCompletionsAtPosition(file, pos, {});
  return (result?.entries ?? []).map((e) => e.name);
}

describe("editor completions for `input.`", () => {
  const incomplete = "({ input }) => { input. }";

  test.each([
    ["repository + input + output (incomplete handler)", `defineRepository(({ get }) => ({ d: get("/:id", { input: Id, output: Out, handler: ${incomplete} }) }))`],
    ["repository + input", `defineRepository(({ get }) => ({ d: get("/:id", { input: Id, handler: ${incomplete} }) }))`],
    ["defineView + output", `defineView({ input: Id, output: Out, handler: ${incomplete} })`],
    ["router + output", `createRouter().post("/:id", { input: Id, output: Out, handler: ${incomplete} })`],
    ["simple function (path params)", `createRouter().get("/:id", ${incomplete})`],
    ["simple function via get", `get("/:id", ${incomplete})`],
  ])("%s", (_name, body) => {
    expect(completionsAfter(body)).toContain("id");
  }, 30_000);
});
