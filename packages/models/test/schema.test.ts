import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSchema, Model, model, plural, readSchemaHash, resolvePrismaCli, type Provider } from "../src/index.ts";
import { Category, Post, Profile, Tag, User } from "./fixtures.ts";

const all = [User, Post, Tag, Profile, Category];

/** Runs `prisma validate` on the generated schema (the real Prisma parser). */
async function prismaValidate(content: string, provider: Provider) {
  const dir = await mkdtemp(join(tmpdir(), "forge-schema-"));
  await mkdir(join(dir, "schema"));
  await writeFile(
    join(dir, "schema", "schema.prisma"),
    `generator client {\n  provider = "prisma-client"\n  output = "../generated"\n}\ndatasource db {\n  provider = "${provider}"\n}\n`,
  );
  await writeFile(join(dir, "schema", "forge.generated.prisma"), content);
  await writeFile(
    join(dir, "prisma.config.ts"),
    `export default { schema: "schema", datasource: { url: "${provider === "sqlite" ? "file:./x.db" : "postgresql://u:p@localhost/db"}" } };`,
  );
  // The project's Prisma 7 CLI, resolved from this package, run in the temp dir.
  const proc = Bun.spawn([process.execPath, resolvePrismaCli(import.meta.dir), "validate"], {
    cwd: dir,
    env: { ...Bun.env, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code, output: out + err };
}

describe("generateSchema", () => {
  const pg = generateSchema(all, "postgresql");
  const lite = generateSchema(all, "sqlite");

  test("implicit uuid id, overridable", () => {
    expect(pg.content).toMatch(/model User \{\n\s+id\s+String\s+@id @default\(uuid\(\)\) @db\.Uuid/);
    expect(lite.content).toMatch(/model User \{\n\s+id\s+String\s+@id @default\(uuid\(\)\)\n/);
    expect(pg.content).toMatch(/model Tag \{\n\s+id\s+Int\s+@id @default\(autoincrement\(\)\)/);
    expect(pg.content).toContain("@id @default(uuid(7)) @db.Uuid");
  });

  test("timestamps are opt-in and add createdAt, updatedAt, deletedAt", () => {
    const user = /model User \{[^}]+\}/.exec(pg.content)![0];
    expect(user).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(user).toMatch(/updatedAt\s+DateTime\s+@updatedAt/);
    expect(user).toMatch(/deletedAt\s+DateTime\?/);
    expect(/model Tag \{[^}]+\}/.exec(pg.content)![0]).not.toContain("createdAt");
  });

  test("foreign keys follow the target id type and get a back relation", () => {
    expect(pg.content).toMatch(/authorId\s+String\s+@db\.Uuid/);
    expect(pg.content).toMatch(/author\s+User\s+@relation\("Post_author", fields: \[authorId\], references: \[id\], onDelete: Cascade\)/);
    expect(pg.content).toMatch(/posts\s+Post\[\]\s+@relation\("Post_author"\)/);
    expect(pg.content).toMatch(/editedPosts\s+Post\[\]\s+@relation\("Post_editor"\)/);
    expect(pg.content).toMatch(/editorId\s+String\?\s+@db\.Uuid/);
  });

  test("many-to-many, one-to-one and self relations", () => {
    expect(pg.content).toMatch(/tags\s+Tag\[\]\s+@relation\("Post_tags"\)/);
    expect(pg.content).toMatch(/posts\s+Post\[\]\s+@relation\("Post_tags"\)/);
    expect(pg.content).toMatch(/userId\s+String\s+@unique @db\.Uuid/);
    expect(pg.content).toMatch(/profile\s+Profile\?\s+@relation\("Profile_user"\)/);
    expect(pg.content).toMatch(/children\s+Category\[\]\s+@relation\("Category_parent"\)/);
  });

  test("native types only for postgres; enums, indexes, maps", () => {
    expect(pg.content).toContain("@db.VarChar(200)");
    expect(pg.content).toContain("@db.Decimal(10, 2)");
    expect(lite.content).not.toContain("@db.");
    expect(pg.content).toContain("enum UserRole {\n  USER\n  ADMIN\n}");
    expect(pg.content).toMatch(/role\s+UserRole\s+@default\(USER\)/);
    expect(pg.content).toContain("@@index([published, createdAt])");
    expect(pg.content).toContain("@@unique([authorId, slug])");
    expect(pg.content).toContain('@@map("posts")');
    expect(pg.content).toContain('@map("tag_label")');
  });

  test("deterministic, with a hash in the header", () => {
    expect(generateSchema([...all].reverse(), "postgresql").content).toBe(pg.content);
    expect(readSchemaHash(pg.content)).toBe(pg.hash);
    expect(pg.hash).not.toBe(lite.hash);
  });

  test.each(["postgresql", "sqlite"] as const)("accepted by `prisma validate` (%s)", async (provider) => {
    const { code, output } = await prismaValidate(generateSchema(all, provider).content, provider);
    expect(output).toMatch(/schemas? at .* (is|are) valid/);
    expect(code).toBe(0);
  }, 60_000);
});

describe("errors", () => {
  test("relation to a model that is not discovered", () => {
    class Orphan extends Model {}
    class A extends Model {
      static override model = { o: model.foreignKey(() => Orphan) };
    }
    expect(() => generateSchema([A], "sqlite")).toThrow("not exported from any src/apps/*/models.ts");
  });

  test("back relation name clash asks for `related`", () => {
    class U extends Model {}
    class P extends Model {
      static override model = { a: model.foreignKey(() => U), b: model.foreignKey(() => U) };
    }
    expect(() => generateSchema([U, P], "sqlite")).toThrow('Set `related: "<name>"`');
  });

  test("timestamps fields cannot be redeclared", () => {
    class T extends Model {
      static override model = { createdAt: model.dateTime() };
      static override timestamps = true;
    }
    expect(() => generateSchema([T], "sqlite")).toThrow("static timestamps = true");
  });

  test("unknown index field, bad enum default, duplicate names", () => {
    class I extends Model {
      static override indexes = [model.index(["nope"])];
    }
    expect(() => generateSchema([I], "sqlite")).toThrow('unknown or list field "nope"');
    class E extends Model {
      static override model = { s: model.enum(["A"], { default: "B" as "A" }) };
    }
    expect(() => generateSchema([E], "sqlite")).toThrow("not one of the enum values");
  });
});

test("plural", () => {
  expect(["post", "category", "box", "match", "day"].map(plural)).toEqual(["posts", "categories", "boxes", "matches", "days"]);
});
