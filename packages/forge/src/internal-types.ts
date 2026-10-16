import { join } from "node:path";
import { loadConfig } from "@forge/core";
import { PRISMA_PATHS } from "@forge/models";
import { scanApps, writeTypes } from "./types.ts";

/**
 * Regenerates `.forge/types.d.ts` without starting the app (used by the CLI
 * after `forge new`, `forge startapp` and before `forge check`).
 */
export async function refreshTypes(root: string): Promise<void> {
  const config = await loadConfig(root);
  if (!config.web && !config.db) return;
  await writeTypes(root, { apps: await scanApps(config.apps), db: config.db !== null, auth: config.auth !== null, clientFile: join(root, PRISMA_PATHS.client) });
}
