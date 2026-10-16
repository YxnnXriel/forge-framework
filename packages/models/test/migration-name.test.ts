import { expect, test } from "bun:test";
import { generateSchema, migrationName, Model, model } from "../src/index.ts";

class Tag extends Model {
  static override model = { label: model.string() };
}

function schemaOf(postModel: object, withTag = true, indexes: ReturnType<typeof model.index>[] = []) {
  class Post extends Model {
    static override model = postModel as never;
    static override indexes = indexes;
  }
  return generateSchema(withTag ? [Post, Tag] : [Post], "sqlite").content;
}

const base = schemaOf({ title: model.string() });

test("Django-like automatic names", () => {
  expect(migrationName(null, base, true)).toBe("initial");
  expect(migrationName(base, schemaOf({ title: model.string(), likes: model.int({ default: 0 }) }), false)).toBe("post_likes");
  expect(migrationName(base, schemaOf({}), false)).toBe("remove_post_title");
  expect(migrationName(base, schemaOf({ title: model.string({ maxLength: 10, unique: true }) }), false)).toBe("alter_post_title");
  expect(migrationName(base, schemaOf({ title: model.string() }, false), false)).toBe("delete_tag");
  expect(migrationName(schemaOf({ title: model.string() }, false), base, false)).toBe("create_tag");
  expect(migrationName(base, schemaOf({ title: model.string() }, true, [model.index(["title"])]), false)).toBe("post_indexes");
  expect(migrationName(base, schemaOf({ subtitle: model.string(), likes: model.int() }), false)).toBe("post_subtitle_and_more");
  expect(migrationName(base, base, false)).toBe("auto");
});
