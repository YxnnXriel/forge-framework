import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { ForgeError } from "@forge/core";
import { isModelClass, type ModelClass } from "./model.ts";
import { ForgeModelError, generateSchema, readSchemaHash, type Provider } from "./schema.ts";

/** Paths used by Forge's Prisma integration, relative to the project root. */
export const PRISMA_PATHS = {
  schemaDir: "prisma/schema",
  mainSchema: "prisma/schema/schema.prisma",
  generatedSchema: "prisma/schema/forge.generated.prisma",
  migrations: "prisma/schema/migrations",
  /** Copy of the generated schema at the last migration (names the next one). Not a .prisma file. */
  snapshot: "prisma/schema/migrations/forge.snapshot",
  client: "generated/prisma/client.ts",
  config: "prisma.config.ts",
} as const;

export interface DiscoveredModel {
  model: ModelClass;
  /** App folder name. */
  app: string;
  file: string;
}

/** Imports `<appsDir>/<app>/models.ts` and collects the exported Model classes. */
export async function discoverModels(appsDir: string): Promise<DiscoveredModel[]> {
  if (!existsSync(appsDir)) return [];
  const found: DiscoveredModel[] = [];
  for await (const rel of new Bun.Glob("*/models.{ts,js}").scan({ cwd: appsDir, onlyFiles: true })) {
    const file = join(appsDir, rel);
    const mod: Record<string, unknown> = await import(file);
    for (const value of Object.values(mod)) {
      if (isModelClass(value)) found.push({ model: value, app: basename(dirname(file)), file });
    }
  }
  return found.sort((a, b) => a.model.name.localeCompare(b.model.name));
}

const MAIN_SCHEMA = (provider: Provider) => `// Prisma entry point, created by Forge. You own this file.
// Models declared in src/apps/*/models.ts are generated into forge.generated.prisma;
// models you write by hand go in other .prisma files of this folder.

generator client {
  provider = "prisma-client"
  output   = "../../generated/prisma"
}

datasource db {
  provider = "${provider}"
}
`;

const PRISMA_CONFIG = `// Prisma CLI configuration, created by Forge. You own this file.
// Prefer \`bun run forge db <command>\`: it loads .env and keeps the schema in sync.
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "${PRISMA_PATHS.schemaDir}",
  migrations: { path: "${PRISMA_PATHS.migrations}" },
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
`;

/** Model and enum names declared in hand-written .prisma files of the folder. */
async function manualDeclarations(schemaDir: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!existsSync(schemaDir)) return names;
  for (const entry of await readdir(schemaDir, { recursive: true })) {
    const file = join(schemaDir, String(entry));
    if (!file.endsWith(".prisma") || file.endsWith("forge.generated.prisma")) continue;
    const text = await Bun.file(file).text();
    for (const m of text.matchAll(/^\s*(?:model|enum|view|type)\s+([A-Za-z]\w*)\s*\{/gm)) names.set(m[1]!, file);
  }
  return names;
}

export interface SyncResult {
  written: string[];
  models: string[];
}

/**
 * Writes `forge.generated.prisma` from the models, and creates the files the
 * user owns (`schema.prisma`, `prisma.config.ts`) only when they are missing.
 * Never touches hand-written schema files; fails on name conflicts with them.
 */
export async function syncSchema(root: string, appsDir: string, provider: Provider): Promise<SyncResult> {
  const models = await discoverModels(appsDir);
  const generated = generateSchema(models.map((m) => m.model), provider);
  const schemaDir = join(root, PRISMA_PATHS.schemaDir);
  const written: string[] = [];

  const manual = await manualDeclarations(schemaDir);
  for (const name of generated.models) {
    const file = manual.get(name);
    if (file) {
      throw new ForgeModelError(`"${name}" is both a Forge model and declared in ${relative(root, file)}; keep only one`);
    }
  }

  await mkdir(schemaDir, { recursive: true });
  const main = join(root, PRISMA_PATHS.mainSchema);
  if (!existsSync(main)) {
    await Bun.write(main, MAIN_SCHEMA(provider));
    written.push(PRISMA_PATHS.mainSchema);
  } else {
    const declared = /datasource\s+\w+\s*\{[^}]*provider\s*=\s*"(\w+)"/s.exec(await Bun.file(main).text())?.[1];
    if (declared && declared !== provider) {
      throw new ForgeError(
        "FORGE_DB_PROVIDER",
        `${PRISMA_PATHS.mainSchema} uses provider "${declared}" but forge.config.ts says "${provider}"`,
      );
    }
  }
  const config = join(root, PRISMA_PATHS.config);
  if (!existsSync(config)) {
    await Bun.write(config, PRISMA_CONFIG);
    written.push(PRISMA_PATHS.config);
  }

  const target = join(root, PRISMA_PATHS.generatedSchema);
  const previous = existsSync(target) ? await Bun.file(target).text() : null;
  if (previous !== generated.content) {
    await Bun.write(target, generated.content);
    written.push(PRISMA_PATHS.generatedSchema);
  }
  return { written, models: generated.models };
}

export type SchemaStatus = "in-sync" | "outdated" | "missing";

/** Compares the models with the generated schema file (no write). */
export async function schemaStatus(root: string, appsDir: string, provider: Provider): Promise<SchemaStatus> {
  const target = join(root, PRISMA_PATHS.generatedSchema);
  if (!existsSync(target)) return "missing";
  const models = await discoverModels(appsDir);
  const expected = generateSchema(models.map((m) => m.model), provider).hash;
  return readSchemaHash(await Bun.file(target).text()) === expected ? "in-sync" : "outdated";
}
