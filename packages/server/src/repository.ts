import { ForgeError } from "@forge/core";
import { del, get, isEndpoint, patch, post, put, type Endpoint } from "./view.ts";

const REPOSITORY = Symbol.for("forge.repository");

export const verbs = { get, post, put, patch, del, delete: del } as const;
export type Verbs = typeof verbs;

export type Repository<T extends Record<string, unknown> = Record<string, unknown>> = Readonly<T> & {
  readonly [REPOSITORY]: true;
};

/**
 * Groups the functions of one domain. Entries created with a verb
 * (`get("/:id", ...)`) become HTTP endpoints once the repository is mounted
 * and stay directly callable server-side: `await posts.detail({ id: 1 })`.
 * Any other entry (plain function, constant) is kept as-is and never exposed.
 */
export function defineRepository<const T extends Record<string, unknown>>(
  definition: T | ((verbs: Verbs) => T),
): Repository<T> {
  const entries = typeof definition === "function" ? definition(verbs) : definition;

  const seen = new Map<string, string>();
  for (const [name, value] of Object.entries(entries)) {
    if (!isEndpoint(value)) continue;
    const key = `${value.method} ${value.path}`;
    const other = seen.get(key);
    if (other) {
      throw new ForgeError("FORGE_ROUTE_CONFLICT", `Route "${key}" is declared twice: "${other}" and "${name}"`);
    }
    seen.set(key, name);
  }

  return Object.freeze(Object.assign(Object.create(null), entries, { [REPOSITORY]: true })) as Repository<T>;
}

export function isRepository(value: unknown): value is Repository {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[REPOSITORY] === true;
}

/** 0 = static segment, 1 = param, 2 = optional param, 3 = wildcard. */
function segmentRank(segment: string): number {
  if (segment === "*" || segment.startsWith("*")) return 3;
  if (segment.startsWith(":")) return segment.endsWith("?") ? 2 : 1;
  return 0;
}

/** Negative when `a` is more specific than `b` (`/me` before `/:id`). */
export function compareSpecificity(a: string, b: string): number {
  const sa = a.split("/").filter(Boolean);
  const sb = b.split("/").filter(Boolean);
  // Lexicographic order on segment ranks, then length: a total order, so sorting is consistent.
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    const diff = segmentRank(sa[i]!) - segmentRank(sb[i]!);
    if (diff !== 0) return diff;
  }
  return sa.length - sb.length;
}

/**
 * Endpoints of a repository, most specific paths first, so `get("/me")`
 * is never shadowed by `get("/:id")` whatever the declaration order.
 * Equally specific routes keep their declaration order.
 */
export function endpointsOf(repository: Repository): Array<[name: string, endpoint: Endpoint]> {
  return Object.entries(repository)
    .filter((e): e is [string, Endpoint] => isEndpoint(e[1]))
    .sort((a, b) => compareSpecificity(a[1].path, b[1].path));
}
