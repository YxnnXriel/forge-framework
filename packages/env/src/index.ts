import { ForgeError, type EnvConfig, type EnvShape, type ForgeIssue } from "@forge/core";
import type { z } from "zod";

/**
 * File loading is delegated to Bun, which reads, in increasing priority:
 *   .env  ->  .env.{development|production|test} (from NODE_ENV)  ->  .env.local
 * (.env.local is skipped when NODE_ENV=test), then real process
 * environment variables win over all files.
 * Forge only validates and types the result.
 */
export type EnvSource = Record<string, string | undefined>;

export type InferEnv<S extends EnvShape | undefined> = S extends EnvShape
  ? { readonly [K in keyof S]: z.output<S[K]> }
  : {};

export interface LoadedEnv<C extends EnvConfig> {
  private: InferEnv<C["private"]>;
  public: InferEnv<C["public"]>;
}

export class ForgeEnvError extends ForgeError {
  override readonly name = "ForgeEnvError";
  readonly issues: readonly ForgeIssue[];

  constructor(issues: readonly ForgeIssue[]) {
    // Never include values: they may be secrets.
    const lines = issues.map((i) => `  - ${i.path}: ${i.message}`);
    super("FORGE_ENV_INVALID", `Invalid environment variables:\n${lines.join("\n")}`);
    this.issues = issues;
  }
}

function parseShape(shape: EnvShape | undefined, source: EnvSource, issues: ForgeIssue[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!shape) return out;
  for (const [name, schema] of Object.entries(shape)) {
    const raw = source[name];
    // Empty strings are treated as missing, like most deployment platforms do.
    const result = schema.safeParse(raw === "" ? undefined : raw);
    if (result.success) {
      if (result.data !== undefined) out[name] = result.data;
    } else {
      const message = raw === undefined || raw === "" ? "missing" : (result.error.issues[0]?.message ?? "invalid");
      issues.push({ path: name, message });
    }
  }
  return out;
}

/**
 * Validates declared variables against `source` (default: `Bun.env`)
 * and reports every problem at once. Undeclared variables are not exposed.
 */
export function loadEnv<const C extends EnvConfig>(config: C, source: EnvSource = Bun.env): LoadedEnv<C> {
  const issues: ForgeIssue[] = [];
  const priv = parseShape(config.private, source, issues);
  const pub = parseShape(config.public, source, issues);
  if (issues.length > 0) throw new ForgeEnvError(issues);
  return {
    private: Object.freeze(priv),
    public: Object.freeze(pub),
  } as LoadedEnv<C>;
}
