import { defineUrls } from "forge/server";
import { router as posts } from "./apps/posts/urls.ts";

export default defineUrls({
  "/api/posts": posts,
});
