import { defineUrls } from "forge/server";
import { posts } from "./apps/posts/repository.ts";

export default defineUrls({
  "/api/posts": posts,
});
