import { startApp } from "forge/server";
import { PostStore } from "./store.ts";

const store = new PostStore([
  { title: "Bienvenue sur Forge", body: "Premier post.", published: true, authorEmail: "ariel@example.com" },
  { title: "Brouillon", body: "Pas encore publié.", published: false, authorEmail: "ariel@example.com" },
]);

await startApp({ root: import.meta.dir + "/..", deps: { store } });
