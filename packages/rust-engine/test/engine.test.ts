import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engine, hashFiles, nativeRouter } from "../src/index.ts";

const hasNative = engine() !== null;
if (!hasNative) console.warn("[rust-engine] native library not built: `bun run --filter @forge/rust-engine build`");

describe("hashFiles (native or fallback)", () => {
  test("stable for same content, different for different content, 0 for missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forge-hash-"));
    await writeFile(join(dir, "a"), "hello");
    await writeFile(join(dir, "b"), "hello");
    await writeFile(join(dir, "c"), "hellp");
    await writeFile(join(dir, "e"), "");
    const [a, b, c, missing, empty] = await hashFiles(["a", "b", "c", "nope", "e"].map((f) => join(dir, f)));
    expect(a).toBe(b!);
    expect(a).not.toBe(c!);
    expect(missing).toBe(0n);
    expect(empty).not.toBe(0n);
  });
});

describe.skipIf(!hasNative)("native router", () => {
  test("same semantics as the TypeScript router", () => {
    const ids = ["/", "/posts/latest/edit", "/posts/[id]", "/posts/[slug]/comments", "/[org]/[repo]"];
    const r = nativeRouter(ids)!;
    const m = (p: string) => {
      const res = r.match(p);
      if (!res) return null;
      const params: string[] = [];
      for (let k = 0; k < 2 && res.spans[k * 2 + 1]! > 0; k++) params.push(p.slice(res.spans[k * 2]!, res.spans[k * 2 + 1]!));
      return [ids[res.index], params];
    };
    expect(m("/")).toEqual(["/", []]);
    expect(m("/posts/latest")).toEqual(["/posts/[id]", ["latest"]]);
    expect(m("/posts/latest/edit")?.[0]).toBe("/posts/latest/edit");
    expect(m("/posts/hello/comments")?.[0]).toBe("/posts/[slug]/comments");
    expect(m("/a/b")).toEqual(["/[org]/[repo]", ["a", "b"]]);
    expect(m("/a/b/c")).toBeNull();
    r.free();
  });
});
