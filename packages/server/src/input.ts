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
export async function readInput(c: Context): Promise<Record<string, unknown>> {
  const input: Record<string, unknown> = {};
  const origin = new Map<string, string>();

  const add = (source: string, values: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(values)) {
      const previous = origin.get(key);
      if (previous) throw new HttpError(400, `"${key}" is provided both in ${previous} and ${source}`);
      origin.set(key, source);
      input[key] = value;
    }
  };

  add("path", c.req.param() as Record<string, string>);

  const query: Record<string, unknown> = {};
  for (const [key, values] of Object.entries(c.req.queries())) {
    query[key] = values.length === 1 ? values[0] : values;
  }
  add("query", query);
  add("body", await readBody(c));

  return input;
}
