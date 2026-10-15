import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { ForgeEnvError, loadEnv } from "../src/index.ts";

const config = {
  private: {
    DATABASE_URL: z.url(),
    MAX_CONN: z.coerce.number().int().default(10),
  },
  public: {
    PUBLIC_SITE_NAME: z.string(),
    PUBLIC_DEBUG: z.stringbool().optional(),
  },
};

describe("loadEnv", () => {
  test("validates, coerces and separates private and public values", () => {
    const env = loadEnv(config, {
      DATABASE_URL: "postgres://u:p@localhost/db",
      PUBLIC_SITE_NAME: "Forge",
      PUBLIC_DEBUG: "true",
      UNDECLARED_SECRET: "nope",
    });
    expect(env.private).toEqual({ DATABASE_URL: "postgres://u:p@localhost/db", MAX_CONN: 10 });
    expect(env.public).toEqual({ PUBLIC_SITE_NAME: "Forge", PUBLIC_DEBUG: true });
    // Types are inferred from the schemas.
    const max: number = env.private.MAX_CONN;
    expect(max).toBe(10);
    expect(Object.isFrozen(env.public)).toBe(true);
  });

  test("undeclared variables are never exposed", () => {
    const env = loadEnv({ public: { A: z.string() } }, { A: "a", SECRET: "s" });
    expect(Object.keys(env.public)).toEqual(["A"]);
    expect(env.private).toEqual({});
  });

  test("reports every problem at once, without leaking values", () => {
    try {
      loadEnv(config, { DATABASE_URL: "super-secret-not-a-url", PUBLIC_SITE_NAME: "" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ForgeEnvError);
      const err = e as ForgeEnvError;
      expect(err.issues.map((i) => i.path)).toEqual(["DATABASE_URL", "PUBLIC_SITE_NAME"]);
      expect(err.issues[1]?.message).toBe("missing");
      expect(err.message).not.toContain("super-secret");
    }
  });

  test("reads Bun.env by default", () => {
    process.env.FORGE_TEST_VAR = "42";
    const env = loadEnv({ private: { FORGE_TEST_VAR: z.coerce.number() } });
    expect(env.private.FORGE_TEST_VAR).toBe(42);
    delete process.env.FORGE_TEST_VAR;
  });
});
