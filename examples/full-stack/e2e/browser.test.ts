/**
 * Browser tests (real Chromium through playwright-core).
 * Needs a Chromium: `bunx playwright-core install chromium`, or set
 * FORGE_CHROMIUM to an existing executable.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright-core";
import { dbReady, freshApp, root, startBuiltServer } from "../test/setup.ts";

// Browser tests need a Chromium: FORGE_CHROMIUM=/path/to/chromium, or one
// installed for playwright-core. Skipped (with a notice) when none is found.
const executablePath = Bun.env.FORGE_CHROMIUM ?? chromium.executablePath();
const hasBrowser = Boolean(executablePath && existsSync(executablePath));
if (!hasBrowser) console.warn("[e2e] Chromium not found, browser tests skipped. Set FORGE_CHROMIUM=/path/to/chromium.");

// Same scenarios against the app from source and against the production build
// (`forge build`: bundled server, prebuilt pages, precompressed assets).
for (const mode of ["source", "build"] as const)
describe.skipIf(!hasBrowser || !dbReady)(`browser (${mode})`, () => {
  let browser: Browser;
  let base: string;
  let stop: () => void | Promise<void>;

  beforeAll(async () => {
    const { app } = await freshApp();
    if (mode === "source") {
      const server = Bun.serve({ port: 0, fetch: app.fetch });
      base = server.url.href.replace(/\/$/, "");
      stop = () => server.stop(true);
    } else {
      // Same seeded database (DATABASE_URL set by freshApp), served by the build.
      ({ base, stop } = await startBuiltServer(root));
    }
    browser = await chromium.launch({ executablePath });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await stop?.();
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

  describe("Better Auth", () => {
    test("sign up in the browser, then create a post as the signed-in user", async () => {
      const { page, errors } = await open("/dashboard");
      expect(await text(page, ".me")).toBe("invité");
      await page.fill("input[name=name]", "Nina");
      await page.fill("input[name=email]", "nina@example.com");
      await page.fill("input[name=password]", "very-secret-password");
      await page.click("button.sign-up");
      await until(() => text(page, "h1"), "Bonjour Nina");
      expect(await text(page, ".me")).toBe("Nina");

      await page.fill("input[name=title]", "Depuis le navigateur");
      await page.click(".create button[type=submit]");
      await until(() => text(page, ".message"), "Créé : depuis-le-navigateur");

      await page.click("button.sign-out");
      await until(() => text(page, ".me"), "invité");
      expect(errors).toEqual([]);
      await page.close();
    });
  });
});
