import { join } from "node:path";

const here = import.meta.dir;

/** Framework files compiled with the project's pages. */
export const runtimeFiles = {
  root: join(here, "runtime/Root.svelte"),
  errorPage: join(here, "runtime/ErrorPage.svelte"),
  serverRouter: join(here, "server/router.ts"),
  serverPage: join(here, "server/page.ts"),
  clientRouter: join(here, "client/router.ts"),
  clientPage: join(here, "client/page.ts"),
};

/** Module keys of the framework components (resolved by the module loader). */
export const ROOT_COMPONENT = "forge:root";
export const ERROR_COMPONENT = "forge:error";
