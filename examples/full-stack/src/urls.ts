import { defineUrls } from "forge/server";
import { account } from "./apps/account/repository.ts";
import { posts } from "./apps/posts/repository.ts";

export default defineUrls({
  "/api/posts": posts,
  "/api/account": account,
});
