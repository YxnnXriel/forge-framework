/**
 * Declarative description of the business models. Forge turns it into a
 * Prisma schema; queries always go through the generated Prisma Client.
 */

export type DefaultFn = { readonly kind: "fn"; readonly fn: "now" | "uuid" | "uuid7" | "autoincrement" };

interface CommonOptions<T> {
  /** `NULL` allowed (Prisma `?`). */
  nullable?: boolean;
  unique?: boolean;
  default?: T | DefaultFn;
  /** Database column name (`@map`). */
  column?: string;
}

export type ScalarType = "String" | "Int" | "BigInt" | "Float" | "Decimal" | "Boolean" | "DateTime" | "Json" | "Bytes";

export interface ScalarField {
  readonly kind: "scalar";
  readonly type: ScalarType;
  readonly options: CommonOptions<unknown> & {
    maxLength?: number;
    text?: boolean;
    precision?: number;
    scale?: number;
    uuid?: boolean;
    updatedAt?: boolean;
    /** Scalar list (`String[]`), Postgres only. */
    list?: boolean;
  };
}

export interface EnumField {
  readonly kind: "enum";
  readonly values: readonly string[];
  readonly options: CommonOptions<string> & { name?: string };
}

export type ReferentialAction = "Cascade" | "Restrict" | "NoAction" | "SetNull" | "SetDefault";

export interface RelationField {
  readonly kind: "relation";
  readonly relation: "foreignKey" | "oneToOne" | "manyToMany";
  /** Resolves the target lazily (direct references are wrapped at declaration). */
  readonly target: () => ModelRef;
  readonly options: {
    nullable?: boolean;
    onDelete?: ReferentialAction;
    onUpdate?: ReferentialAction;
    /** Name of the field generated on the other model (default: plural of this model). */
    related?: string;
    /** FK column name for foreignKey / oneToOne (default: `<field>Id`). */
    column?: string;
  };
}

export type FieldDef = ScalarField | EnumField | RelationField;
export type ModelShape = Record<string, FieldDef>;

export interface IndexDef {
  readonly kind: "index" | "unique";
  readonly fields: readonly string[];
  readonly name?: string;
}

/** Base class of every Forge model. The class name is the Prisma model name. */
export abstract class Model {
  /** Fields of the model. `id` is implicit (uuid) unless declared. */
  static model: ModelShape = {};
  static indexes: readonly IndexDef[] = [];
  /** Adds `createdAt`, `updatedAt` and `deletedAt` (nullable). Off by default. */
  static timestamps = false;
  /** Table name (`@@map`). Default: the model name. */
  static table: string | undefined = undefined;
  /**
   * Identity shared by a placeholder and the real model it stands for (e.g.
   * `AuthUser` from forge/auth and the user table generated from Better Auth).
   * Relations to a placeholder resolve to the model with the same key.
   */
  static key: string | undefined = undefined;
}

export type ModelClass = typeof Model;

/**
 * What a relation thunk returns. Only the instance side is checked: comparing
 * the static side (`static model`) would make mutually referencing models
 * (and self relations) circular for TypeScript.
 */
export type ModelRef = abstract new () => Model;

/**
 * A related model: `User`, or `() => User` when two models import each other
 * (circular imports: the direct form would hit "Cannot access 'User' before
 * initialization", the arrow form defers the lookup).
 */
export type Target = ModelRef | (() => ModelRef);

function lazy(target: Target): () => ModelRef {
  if (typeof target === "function" && target.prototype instanceof Model) return () => target as ModelRef;
  return target as () => ModelRef;
}

const scalar = (type: ScalarType, options: ScalarField["options"] = {}): ScalarField => ({ kind: "scalar", type, options });

const fn = (name: DefaultFn["fn"]): DefaultFn => ({ kind: "fn", fn: name });

/** Field builders: `model.string()`, `model.foreignKey(() => User)`, `model.index([...])`... */
export const model = {
  string: (o: CommonOptions<string> & { maxLength?: number } = {}) => scalar("String", o),
  text: (o: CommonOptions<string> = {}) => scalar("String", { ...o, text: true }),
  int: (o: CommonOptions<number> = {}) => scalar("Int", o),
  bigint: (o: CommonOptions<bigint | number> = {}) => scalar("BigInt", o),
  float: (o: CommonOptions<number> = {}) => scalar("Float", o),
  decimal: (o: CommonOptions<number | string> & { precision?: number; scale?: number } = {}) => scalar("Decimal", o),
  boolean: (o: CommonOptions<boolean> = {}) => scalar("Boolean", o),
  dateTime: (o: CommonOptions<Date> & { updatedAt?: boolean } = {}) => scalar("DateTime", o),
  json: (o: CommonOptions<unknown> = {}) => scalar("Json", o),
  bytes: (o: Omit<CommonOptions<never>, "default"> = {}) => scalar("Bytes", o),
  /** String with a generated UUID (v4, or v7 for index-friendly ordering). */
  uuid: (o: Omit<CommonOptions<string>, "default"> & { version?: 4 | 7; generated?: boolean } = {}) => {
    const { version = 4, generated = true, ...rest } = o;
    return scalar("String", { ...rest, uuid: true, ...(generated ? { default: fn(version === 7 ? "uuid7" : "uuid") } : {}) });
  },
  /** Auto-incremented integer (use as `id: model.autoIncrement()`). */
  autoIncrement: () => scalar("Int", { default: fn("autoincrement") }),
  enum: <const V extends readonly string[]>(values: V, o: CommonOptions<V[number]> & { name?: string } = {}): EnumField => ({
    kind: "enum",
    values,
    options: o,
  }),

  /** Many-to-one: adds `<field>Id` here and a list on the target. */
  foreignKey: (target: Target, o: RelationField["options"] = {}): RelationField => ({
    kind: "relation",
    relation: "foreignKey",
    target: lazy(target),
    options: o,
  }),
  /** One-to-one: unique `<field>Id` here and an optional single field on the target. */
  oneToOne: (target: Target, o: RelationField["options"] = {}): RelationField => ({
    kind: "relation",
    relation: "oneToOne",
    target: lazy(target),
    options: o,
  }),
  /** Many-to-many through an implicit join table. */
  manyToMany: (target: Target, o: Pick<RelationField["options"], "related"> = {}): RelationField => ({
    kind: "relation",
    relation: "manyToMany",
    target: lazy(target),
    options: o,
  }),

  index: (fields: readonly string[], o: { name?: string } = {}): IndexDef => ({ kind: "index", fields, ...o }),
  unique: (fields: readonly string[], o: { name?: string } = {}): IndexDef => ({ kind: "unique", fields, ...o }),

  /** Default value helpers. */
  now: () => fn("now"),
} as const;

export function isModelClass(value: unknown): value is ModelClass {
  return typeof value === "function" && value.prototype instanceof Model;
}
