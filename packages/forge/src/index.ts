import type { ForgeConfig as CoreConfig } from "@forge/core";
import type { ForgeAuthOptions } from "@forge/auth";

export * from "@forge/core";
export { z } from "zod";
export {
  createApp,
  startApp,
  defineApp,
  assertBunVersion,
  BUN_RANGE,
  MAIN_FILE,
  type App,
  type AppOptions,
  type AppDefinition,
} from "./app.ts";

/** forge.config.ts, with Better Auth's native options typed under `auth`. */
export interface ForgeConfig extends Omit<CoreConfig, "auth"> {
  auth?: ForgeAuthOptions | false;
}

export function defineConfig<const C extends ForgeConfig>(config: C): C {
  return config;
}
