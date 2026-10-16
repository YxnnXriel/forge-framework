import { nativeRouter } from "@forge/rust-engine";
import { matchRoute, type RoutePattern } from "../shared/match.ts";

export type Matcher<R extends RoutePattern> = (pathname: string) => { route: R; params: Record<string, string> } | null;

/**
 * Server-side page matcher: the Rust engine when it is built (measured ~1.7x
 * faster, see `bun run bench`), the TypeScript segment tree otherwise. Same
 * semantics; the browser always uses the TypeScript one.
 */
export function createMatcher<R extends RoutePattern>(routes: readonly R[]): Matcher<R> {
  const native = nativeRouter(routes.map((r) => r.id));
  if (!native) return (pathname) => matchRoute(routes, pathname);

  return (pathname) => {
    // Spans are byte offsets: only valid for ASCII paths (URL pathnames are
    // percent-encoded, so this is the normal case).
    for (let i = 0; i < pathname.length; i++) {
      if (pathname.charCodeAt(i) > 127) return matchRoute(routes, pathname);
    }
    const m = native.match(pathname);
    if (!m) return null;
    const route = routes[m.index]!;
    const params: Record<string, string> = {};
    let k = 0;
    try {
      for (const seg of route.segments) {
        if (seg.kind !== "param") continue;
        const raw = pathname.slice(m.spans[k * 2]!, m.spans[k * 2 + 1]!);
        params[seg.name] = raw.indexOf("%") < 0 ? raw : decodeURIComponent(raw);
        k++;
      }
    } catch {
      return null; // malformed percent-encoding
    }
    return { route, params };
  };
}
