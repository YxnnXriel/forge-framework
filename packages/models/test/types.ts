import { Model, model } from "../src/index.ts";
// Compile-time checks: direct references, self relations, and the lazy form
// for models that reference each other.
export class A extends Model {
  static override model = { b: model.foreignKey(() => B), parent: model.foreignKey(A, { nullable: true, related: "kids" }) };
}
export class B extends Model {
  static override model = { a: model.manyToMany(A), profile: model.oneToOne(() => C, { nullable: true }) };
}
export class C extends Model {
  static override model = { owner: model.foreignKey(A) };
}
