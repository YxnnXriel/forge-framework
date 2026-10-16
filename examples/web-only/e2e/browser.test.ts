import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "forge";
import { chromium, type Browser } from "playwright-core";

// Browser tests need a Chromium: FORGE_CHROMIUM=/path/to/chromium, or one
// installed for playwright-core. Skipped (with a notice) when none is found.
const executablePath = Bun.env.FORGE_CHROMIUM ?? chromium.executablePath();
const hasBrowser = Boolean(executablePath && existsSync(executablePath));
if (!hasBrowser) console.warn("[e2e] Chromium not found, browser tests skipped. Set FORGE_CHROMIUM=/path/to/chromium.");

describe.skipIf(!hasBrowser)("browser", () => {
  let browser: Browser;
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    const { app } = await createApp({ root: join(import.meta.dir, "..") });
    server = Bun.serve({ port: 0, fetch: app.fetch });
    browser = await chromium.launch({ executablePath });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    server?.stop(true);
  });

  test("state from a .svelte.ts module is shared and survives client navigation", async () => {
    const page = await browser.newPage();
    const documents: string[] = [];
    page.on("request", (r) => r.resourceType() === "document" && documents.push(new URL(r.url()).pathname));
    await page.goto(server.url.href);
    await page.waitForFunction(() => document.documentElement.dataset.forgeHydrated === "true");
    await page.click("button.add");
    await page.click("button.add");
    await page.click('a[href="/blog/bonjour-forge"]');
    await page.waitForFunction(() => document.querySelector("h1")?.textContent === "bonjour forge");
    expect(await page.textContent(".cart")).toBe("Panier : 2");
    expect(documents).toEqual(["/"]);
    await page.close();
  });
});
