import { startApp } from "forge";
import { createStore, demoUser } from "./deps.ts";

await startApp({
  root: `${import.meta.dir}/..`,
  deps: { store: createStore(), user: null },
  requestDeps: demoUser,
});
