/**
 * Browser tests (real Chromium through playwright-core).
 * Needs a Chromium: `bunx playwright-core install chromium`, or set
 * FORGE_CHROMIUM to an existing executable.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright-core";
import { dbReady, freshApp } from "../test/setup.ts";

// Browser tests need a Chromium: FORGE_CHROMIUM=/path/to/chromium, or one
// installed for playwright-core. Skipped (with a notice) when none is found.
const executablePath = Bun.env.FORGE_CHROMIUM ?? chromium.executablePath();
const hasBrowser = Boolean(executablePath && existsSync(executablePath));
if (!hasBrowser) console.warn("[e2e] Chromium not found, browser tests skipped. Set FORGE_CHROMIUM=/path/to/chromium.");

describe.skipIf(!hasBrowser || !dbReady)("browser", () => {
  let browser: Browser;
  let server: ReturnType<typeof Bun.serve>;
  let base: string;

  beforeAll(async () => {
    const { app } = await freshApp();
    server = Bun.serve({ port: 0, fetch: app.fetch });
    base = server.url.href.replace(/\/$/, "");
      browser = await chromium.launch({ executablePath });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    server?.stop(true);
  });

  async function open(path: string) {
    const page = await browser.newPage();
    const rpc: string[] = [];
    const documents: string[] = [];
    const errors: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/__forge/rpc/")) rpc.push(new URL(r.url()).pathname.split("/").pop()!);
      if (r.resourceType() === "document") documents.push(new URL(r.url()).pathname);
    });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(base + path);
    await page.waitForFunction(() => document.documentElement.dataset.forgeHydrated === "true");
    return { page, rpc, documents, errors };
  }

  const text = (page: Page, selector: string) => page.locator(selector).first().textContent();

  /** Retries until `read()` returns `expected` (or fails with the last value). */
  async function until<T>(read: () => Promise<T>, expected: T, timeout = 5_000): Promise<void> {
    const end = Date.now() + timeout;
    let last: T = await read();
    while (last !== expected && Date.now() < end) {
      await Bun.sleep(50);
      last = await read();
    }
    expect(last).toBe(expected);
  }

  describe("SSR + hydration", () => {
    test("hydration reuses SSR data: no remote call, Date preserved, page interactive", async () => {
      const { page, rpc, errors } = await open("/posts/bienvenue-sur-forge");
      expect(await text(page, "h1")).toBe("Bienvenue sur Forge");
      expect(rpc).toEqual([]);
      expect(await page.locator("time").getAttribute("datetime")).toBe("2026-10-01T10:00:00.000Z");
      await page.click("button.like");
      await until(() => text(page, "button.like"), "♥ 4");
      expect(rpc).toEqual(["posts.like"]);
      expect(errors).toEqual([]);
      await page.close();
    });
  });

  describe("client navigation", () => {
    test("links navigate without reloading, layout state survives, data comes from remote calls", async () => {
      const { page, rpc, documents, errors } = await open("/");
      await page.click("button.layout-counter");
      await page.click("button.layout-counter");
      expect(await text(page, "button.layout-counter")).toBe("layout : 2");

      await page.click('nav a[href="/posts"]');
      await until(() => text(page, "h1"), "Articles");
      await page.click('a[href="/posts/layouts-imbriques"]');
      await until(() => text(page, "h1"), "Layouts imbriqués");

      expect(page.url()).toBe(`${base}/posts/layouts-imbriques`);
      expect(documents).toEqual(["/"]); // only the first load hit the server for HTML
      expect(rpc).toEqual(["posts.list", "posts.detail"]);
      expect(await text(page, "button.layout-counter")).toBe("layout : 2");

      await page.goBack();
      await until(() => text(page, "h1"), "Articles");
      expect(await text(page, "button.layout-counter")).toBe("layout : 2");
      expect(errors).toEqual([]);
      await page.close();
    });

    test("nested layout appears when entering the dashboard", async () => {
      const { page } = await open("/posts");
      await page.click('nav a[href="/dashboard"]');
      await until(() => text(page, "aside"), "Dashboard");
      await page.close();
    });

    test("a failing page after navigation is rendered by the server with its status", async () => {
      const { page } = await open("/posts");
      await page.evaluate(() => {
        const a = document.createElement("a");
        a.href = "/posts/nope";
        a.id = "missing";
        a.textContent = "missing";
        document.body.append(a);
      });
      const response = page.waitForResponse((r) => r.url().endsWith("/posts/nope") && r.request().resourceType() === "document");
      await page.click("#missing");
      expect((await response).status()).toBe(404);
      await until(() => text(page, "h1"), "404");
      await page.close();
    });
  });

  describe("remote calls and access control", () => {
    test("access rule rejects anonymous users and accepts a session", async () => {
      const { page } = await open("/dashboard");
      await page.fill("input[name=title]", "Depuis le navigateur");
      await page.click("button[type=submit]");
      await until(() => text(page, ".message"), "Erreur 403 : Forbidden");

      await page.context().addCookies([{ name: "demo_user", value: "ariel", url: base }]);
      await page.click("button[type=submit]");
      await until(() => text(page, ".message"), "Créé : depuis-le-navigateur");
      await page.close();
    });
  });
});
