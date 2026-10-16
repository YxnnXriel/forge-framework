import { startApp } from "forge";
import { demoUser } from "./deps.ts";

await startApp({
  root: `${import.meta.dir}/..`,
  deps: { user: null },
  requestDeps: demoUser,
});
