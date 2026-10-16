import { expect, test } from "bun:test";
import { assertBunVersion } from "../src/app.ts";

test("Forge refuses Bun versions older than 1.4 with an actionable message", () => {
  expect(() => assertBunVersion("1.3.13")).toThrow("bun upgrade");
  expect(() => assertBunVersion("1.4.0")).not.toThrow();
  expect(() => assertBunVersion("1.5.2")).not.toThrow();
});
