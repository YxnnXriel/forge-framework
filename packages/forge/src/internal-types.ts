import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "@forge/core";
import { PRISMA_PATHS } from "@forge/models";
import { clearRemotes, discoverRemotes } from "@forge/server";
import { writeTypes } from "./types.ts";

/**
 * Regenerates `.forge/types.d.ts` without starting the app (used by the CLI
 * after `forge new`, `forge startapp` and before `forge check`).
 */
export async function refreshTypes(root: string): Promise<void> {
  const config = await loadConfig(root);
  if (!config.web && !config.db) return;
  clearRemotes();
  const apps = existsSync(config.apps) ? await discoverRemotes(config.apps) : [];
  await writeTypes(root, { apps, db: config.db !== null, auth: config.auth !== null, clientFile: join(root, PRISMA_PATHS.client) });
}
