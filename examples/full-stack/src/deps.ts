import type { Context } from "forge/server";
import { PostStore } from "./store.ts";

export function createStore() {
  return new PostStore([
    { title: "Bienvenue sur Forge", body: "SSR, hydratation et appels distants.", published: true, authorEmail: "a@x.io", likes: 3, createdAt: new Date("2026-10-01T10:00:00Z") },
    { title: "Layouts imbriqués", body: "Le layout racine reste monté pendant la navigation.", published: true, authorEmail: "a@x.io", likes: 1, createdAt: new Date("2026-10-10T10:00:00Z") },
    { title: "Brouillon", body: "Invisible dans la liste.", published: false, authorEmail: "a@x.io", likes: 0, createdAt: new Date("2026-10-12T10:00:00Z") },
  ]);
}

/** Demo session from a cookie, until Better Auth is integrated. */
export function demoUser(c: Context) {
  const name = /(?:^|;\s*)demo_user=([^;]+)/.exec(c.req.header("cookie") ?? "")?.[1];
  return { user: name ? { name: decodeURIComponent(name) } : null };
}
