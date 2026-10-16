import { Model, model } from "../src/index.ts";

// Mutual references across "apps": thunks make import order irrelevant.
export class User extends Model {
  static override model = {
    email: model.string({ unique: true, maxLength: 320 }),
    name: model.string({ nullable: true }),
    role: model.enum(["USER", "ADMIN"], { default: "USER" }),
  };
  static override timestamps = true;
}

export class Post extends Model {
  static override model = {
    title: model.string({ maxLength: 200 }),
    slug: model.string({ unique: true }),
    body: model.text({ default: "" }),
    published: model.boolean({ default: false }),
    views: model.int({ default: 0 }),
    price: model.decimal({ precision: 10, scale: 2, nullable: true }),
    author: model.foreignKey(User, { onDelete: "Cascade" }),
    editor: model.foreignKey(User, { nullable: true, related: "editedPosts" }),
    tags: model.manyToMany(() => Tag) // Tag is declared below: lazy form,
  };
  static override indexes = [model.index(["published", "createdAt"]), model.unique(["author", "slug"])];
  static override timestamps = true;
  static override table = "posts";
}

export class Tag extends Model {
  static override model = {
    id: model.autoIncrement(),
    label: model.string({ unique: true, column: "tag_label" }),
  };
}

export class Profile extends Model {
  static override model = {
    id: model.uuid({ version: 7 }),
    user: model.oneToOne(User),
    bio: model.text({ nullable: true }),
  };
}

export class Category extends Model {
  static override model = {
    name: model.string(),
    parent: model.foreignKey(Category, { nullable: true, related: "children" }),
  };
}
