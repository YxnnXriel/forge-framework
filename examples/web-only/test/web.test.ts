import { expect, test } from "bun:test";
import { join } from "node:path";
import { createApp } from "forge";

const { app, config, apps } = await createApp({ root: join(import.meta.dir, "..") });

test("web-only: no backend module is required", () => {
  expect(config.api).toBeNull();
  expect(apps).toEqual([]);
});

test("pages render on the server with params", async () => {
  const res = await app.request("/blog/bonjour-forge");
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("<h1>bonjour forge</h1>");
  expect(html).toContain("<code>/blog/[slug]</code>");
  expect(html).toContain("Panier : 0");
});

test("unknown pages are 404", async () => {
  expect((await app.request("/missing")).status).toBe(404);
});
