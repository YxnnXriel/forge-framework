import { ForgeError } from "@forge/core";
import { Model, modelsFromTables, type ModelClass, type Provider, type TableSchema } from "@forge/models";
import { betterAuth, type Auth, type BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { getAuthTables } from "better-auth/db";
import type { Context, Hono } from "hono";

/**
 * Better Auth options as written in forge.config.ts (`auth: { ... }`): the
 * native options, unchanged. Forge provides `database` (Prisma adapter on the
 * project's client) and `secret` (BETTER_AUTH_SECRET).
 */
export type ForgeAuthOptions = Omit<BetterAuthOptions, "database" | "secret">;

/** The Better Auth instance: every native API stays available (`auth.api.*`, plugins...). */
export type AuthInstance<O extends ForgeAuthOptions = ForgeAuthOptions> = Auth<O & { database: ReturnType<typeof prismaAdapter> }>;

export type SessionOf<O extends ForgeAuthOptions> = AuthInstance<O>["$Infer"]["Session"];

/**
 * Placeholder for Better Auth's user table, to relate your models to users:
 *   author: model.foreignKey(AuthUser)
 * It resolves to the `User` model Forge generates from Better Auth's schema.
 */
export class AuthUser extends Model {
  static override key = "auth:user";
}

/** Forge models for Better Auth's tables (core, plugins, additionalFields). */
export function authModels(options: ForgeAuthOptions, provider: Provider): ModelClass[] {
  const tables = getAuthTables(options as BetterAuthOptions) as unknown as Record<string, TableSchema>;
  return modelsFromTables(tables, provider, "auth");
}

export interface CreateAuthOptions {
  db: unknown;
  provider: Provider;
  secret: string;
  baseURL?: string | undefined;
}

export function createAuth<O extends ForgeAuthOptions>(options: O, runtime: CreateAuthOptions): AuthInstance<O> {
  if (!runtime.db) throw new ForgeError("FORGE_AUTH_DB", "Better Auth needs the database: enable `db` in forge.config.ts");
  return betterAuth({
    ...options,
    secret: runtime.secret,
    ...(runtime.baseURL ? { baseURL: runtime.baseURL } : {}),
    database: prismaAdapter(runtime.db as never, { provider: runtime.provider }),
  } as BetterAuthOptions) as unknown as AuthInstance<O>;
}

/** Mounts Better Auth's routes (`<basePath>/*`, default /api/auth) on the app. */
export function mountAuth(app: Hono<any, any, any>, auth: { handler: (request: Request) => Promise<Response> }, basePath = "/api/auth") {
  app.on(["GET", "POST"], `${basePath}/*`, (c) => auth.handler(c.req.raw));
}

export type SessionGetter<S> = () => Promise<S | null>;

/**
 * Per-request dependencies: `session()` reads the session lazily (cookie,
 * then Better Auth's cookie cache or database) the first time it is called,
 * and returns the same promise afterwards. Requests that never ask for the
 * session pay nothing.
 */
export function sessionDeps(auth: { api: { getSession: (o: { headers: Headers }) => Promise<unknown> } }) {
  return (c: Context) => {
    let pending: Promise<unknown> | undefined;
    return { session: () => (pending ??= auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null)) };
  };
}

/** Access rule: the caller must be signed in. `access: authenticated` */
export async function authenticated(ctx: { session: () => Promise<unknown> }): Promise<boolean> {
  return (await ctx.session()) !== null;
}
