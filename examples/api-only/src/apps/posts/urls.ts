import { createRouter } from "forge/server";
import { posts } from "./repository.ts";
import { stats } from "./views.ts";

export const router = createRouter()
  .get("/health", () => ({ ok: true })) // 1. simple function
  .get("/stats", stats) // 2. defineView
  .mount(posts); // 3. defineRepository
