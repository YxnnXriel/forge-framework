// Pure route matching, shared by the server and the browser bundle.

export type Segment = { kind: "static"; value: string } | { kind: "param"; name: string };

export interface RoutePattern {
  /** e.g. `/posts/[id]` */
  id: string;
  segments: Segment[];
}

export function splitPath(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

/** Static segments before params, then fewer segments first: a total order. */
export function compareRoutes(a: RoutePattern, b: RoutePattern): number {
  for (let i = 0; i < Math.min(a.segments.length, b.segments.length); i++) {
    const ka = a.segments[i]!.kind === "static" ? 0 : 1;
    const kb = b.segments[i]!.kind === "static" ? 0 : 1;
    if (ka !== kb) return ka - kb;
  }
  return a.segments.length - b.segments.length;
}

export function matchRoute<R extends RoutePattern>(
  routes: readonly R[],
  pathname: string,
): { route: R; params: Record<string, string> } | null {
  let parts: string[];
  try {
    parts = splitPath(pathname).map(decodeURIComponent);
  } catch {
    return null;
  }
  outer: for (const route of routes) {
    if (route.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    for (let i = 0; i < parts.length; i++) {
      const seg = route.segments[i]!;
      if (seg.kind === "static") {
        if (seg.value !== parts[i]) continue outer;
      } else {
        params[seg.name] = parts[i]!;
      }
    }
    return { route, params };
  }
  return null;
}
