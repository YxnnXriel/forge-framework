import { existsSync } from "node:fs";
import { join } from "node:path";
import { ForgeError } from "@forge/core";
import { PRISMA_PATHS } from "./project.ts";
import type { Provider } from "./schema.ts";

/** Driver adapter package per provider (installed by the project). */
export const ADAPTERS: Record<Provider, { pkg: string; export: string }> = {
  postgresql: { pkg: "@prisma/adapter-pg", export: "PrismaPg" },
  sqlite: { pkg: "prisma-adapter-bun-sqlite", export: "PrismaBunSqlite" },
};

/**
 * Instantiates the project's generated Prisma Client with the driver adapter
 * of the configured provider. Returns the native client: every Prisma
 * feature (relations, transactions, raw queries, $extends) stays available.
 */
export async function createPrismaClient(root: string, provider: Provider, url: string): Promise<unknown> {
  const clientFile = join(root, PRISMA_PATHS.client);
  if (!existsSync(clientFile)) {
    throw new ForgeError("FORGE_DB_CLIENT", "Prisma Client is not generated yet: run `bun run forge db generate`");
  }

  const { pkg } = ADAPTERS[provider];
  let adapterModule: Record<string, unknown>;
  try {
    adapterModule = await import(Bun.resolveSync(pkg, root));
  } catch {
    throw new ForgeError("FORGE_DB_ADAPTER", `Database provider "${provider}" needs ${pkg}: run \`bun add ${pkg}\``);
  }
  const client = (await import(clientFile)) as PrismaModule;
  return prismaClientFrom(client, adapterModule, provider, url);
}

export type PrismaModule = { PrismaClient: new (options: object) => unknown };

/** Same, from already-imported modules (production build: everything is bundled). */
export function prismaClientFrom(
  client: PrismaModule,
  adapterModule: Record<string, unknown>,
  provider: Provider,
  url: string,
): unknown {
  const Adapter = adapterModule[ADAPTERS[provider].export] as new (options: object) => unknown;
  const adapter = provider === "postgresql" ? new Adapter({ connectionString: url }) : new Adapter({ url });
  return new client.PrismaClient({ adapter });
}
