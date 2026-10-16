import { Model, model } from "forge/models";
import { Tag } from "../tags/models.ts";
import { User } from "../users/models.ts";

export class Post extends Model {
  static override model = {
    slug: model.string({ unique: true, maxLength: 200 }),
    title: model.string({ maxLength: 200 }),
    body: model.text({ default: "" }),
    published: model.boolean({ default: true }),
    likes: model.int({ default: 0 }),
    author: model.foreignKey(User, { onDelete: "Cascade" }),
    tags: model.manyToMany(Tag),
  };
  static override indexes = [model.index(["published", "createdAt"])];
  static override timestamps = true;
}
