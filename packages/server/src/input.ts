import type { Context } from "hono";
import { HttpError } from "./errors.ts";

const NO_BODY = new Set(["GET", "HEAD", "OPTIONS"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function readBody(c: Context): Promise<Record<string, unknown>> {
  if (NO_BODY.has(c.req.method)) return {};
  const type = c.req.header("content-type") ?? "";

  if (type.includes("application/json")) {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new HttpError(400, "Malformed JSON body");
    }
    if (body === null || body === undefined) return {};
    if (!isPlainObject(body)) throw new HttpError(400, "JSON body must be an object");
    return body;
  }

  if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
    return (await c.req.parseBody({ all: true })) as Record<string, unknown>;
  }

  return {};
}

/**
 * Builds the single `input` object of an HTTP call by merging path params,
 * query string and body. A key present in two sources is rejected rather
 * than silently overridden.
 */
/** Synchronous when there is no body to read (GET/HEAD/OPTIONS). */
export function readInput(c: Context): Record<string, unknown> | Promise<Record<string, unknown>> {
  const params = c.req.param() as Record<string, string>;
  const hasQuery = c.req.url.indexOf("?") >= 0;
  const hasBody = !NO_BODY.has(c.req.method);
  // Fast path (most GET requests): path params only.
  if (!hasQuery && !hasBody) return { ...params };
  return readFull(c, params, hasQuery, hasBody);
}

async function readFull(
  c: Context,
  params: Record<string, string>,
  hasQuery: boolean,
  hasBody: boolean,
): Promise<Record<string, unknown>> {
  const input: Record<string, unknown> = {};
  const origin: Record<string, string> = {};
  const add = (source: string, values: Record<string, unknown>) => {
    for (const key in values) {
      const previous = origin[key];
      if (previous) throw new HttpError(400, `"${key}" is provided both in ${previous} and ${source}`);
      origin[key] = source;
      input[key] = values[key];
    }
  };

  add("path", params);
  if (hasQuery) {
    const query: Record<string, unknown> = {};
    const all = c.req.queries();
    for (const key in all) {
      const values = all[key]!;
      query[key] = values.length === 1 ? values[0] : values;
    }
    add("query", query);
  }
  if (hasBody) add("body", await readBody(c));
  return input;
}
