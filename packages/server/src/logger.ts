import { duration, palette, type Palette } from "@forge/core/term";
import { RPC_PREFIX } from "./remote.ts";

type Fetch = (request: Request, server: Bun.Server<undefined>) => Response | Promise<Response> | undefined | Promise<Response | undefined>;

export interface RequestLogOptions {
  /** Colored, aligned lines (terminal) or plain lines with an ISO timestamp (log collectors). */
  color?: boolean;
  /** Paths never logged (assets, dev events). */
  skip?: (pathname: string) => boolean;
  write?: (line: string) => void;
}

const METHOD_WIDTH = 6;

function pathOf(url: string): string {
  const start = url.indexOf("/", url.indexOf("//") + 2);
  const query = url.indexOf("?", start);
  return start < 0 ? "/" : query < 0 ? url.slice(start) : url.slice(start, query);
}

function methodColor(p: Palette, method: string): (s: string) => string {
  switch (method) {
    case "GET":
      return p.cyan;
    case "POST":
      return p.green;
    case "PUT":
    case "PATCH":
      return p.yellow;
    case "DELETE":
      return p.red;
    case "RPC":
      return p.brand;
    default:
      return p.gray;
  }
}

function statusColor(p: Palette, status: number): (s: number) => string {
  if (status >= 500) return p.red;
  if (status >= 400) return p.yellow;
  if (status >= 300) return p.cyan;
  return p.green;
}

/**
 * Wraps a fetch handler with one log line per request:
 *   14:02:11  GET    /todos                 200  3.1 ms
 *   14:02:13  RPC    todos.create           201  4.0 ms
 * Remote function calls are shown by name. Measures the whole handler,
 * including SSR; the response body is not buffered.
 */
export function withRequestLog(fetch: Fetch, options: RequestLogOptions = {}): Fetch {
  const p = palette(options.color ?? false);
  const write = options.write ?? ((line: string) => console.log(line));
  const skip = options.skip ?? (() => false);

  const log = (request: Request, status: number, start: number) => {
    const path = pathOf(request.url);
    if (skip(path)) return;
    const ms = performance.now() - start;
    const rpc = path.startsWith(RPC_PREFIX);
    const method = rpc ? "RPC" : request.method;
    const target = rpc ? path.slice(RPC_PREFIX.length) : decodeURI(path);
    if (!p.on) {
      write(`${new Date().toISOString()} ${method} ${target} ${status} ${duration(ms)}`);
      return;
    }
    const time = new Date().toTimeString().slice(0, 8);
    const took = duration(ms);
    write(
      `  ${p.gray(time)}  ${methodColor(p, method)(method.padEnd(METHOD_WIDTH))} ${target.padEnd(28)} ` +
        `${statusColor(p, status)(status)}  ${ms > 500 ? p.yellow(took) : p.dim(took)}`,
    );
  };

  return (request, server) => {
    const start = performance.now();
    let result: ReturnType<Fetch>;
    try {
      result = fetch(request, server);
    } catch (err) {
      log(request, 500, start);
      throw err;
    }
    if (result instanceof Promise) {
      return result.then(
        (res) => {
          if (res) log(request, res.status, start);
          return res;
        },
        (err: unknown) => {
          log(request, 500, start);
          throw err;
        },
      );
    }
    if (result) log(request, result.status, start);
    return result;
  };
}
