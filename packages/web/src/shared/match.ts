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

interface Node<R> {
  statics: Map<string, Node<R>>;
  param: { name: string; node: Node<R> } | null;
  route: R | null;
}

const node = <R>(): Node<R> => ({ statics: new Map(), param: null, route: null });

/**
 * Segment tree: matching costs O(URL depth), not O(number of routes).
 * Static children are tried before the param child, with backtracking, which
 * gives the same result as the ordered list (static segments win).
 */
function build<R extends RoutePattern>(routes: readonly R[]): Node<R> {
  const root = node<R>();
  for (const route of routes) {
    let current = root;
    for (const seg of route.segments) {
      if (seg.kind === "static") {
        let next = current.statics.get(seg.value);
        if (!next) current.statics.set(seg.value, (next = node()));
        current = next;
      } else {
        // Param names may differ between routes sharing a prefix (/[id] vs /[slug]/edit).
        current.param ??= { name: seg.name, node: node() };
        current = current.param.node;
      }
    }
    current.route ??= route;
  }
  return root;
}

/**
 * Walks the path string directly: no split/filter/map arrays, and
 * decodeURIComponent only for segments containing "%". Param values are
 * collected in `values` (backtracking pops them).
 */
function walk<R>(n: Node<R>, path: string, i: number, values: string[]): R | null {
  while (i < path.length && path.charCodeAt(i) === 47 /* / */) i++;
  if (i >= path.length) return n.route;
  let end = path.indexOf("/", i);
  if (end < 0) end = path.length;
  const raw = path.slice(i, end);
  const seg = raw.indexOf("%") < 0 ? raw : decodeURIComponent(raw);
  const next = n.statics.get(seg);
  if (next) {
    const found = walk(next, path, end, values);
    if (found) return found;
  }
  if (n.param) {
    values.push(seg);
    const found = walk(n.param.node, path, end, values);
    if (found) return found;
    values.pop();
  }
  return null;
}

const trees = new WeakMap<readonly RoutePattern[], Node<RoutePattern>>();

export function matchRoute<R extends RoutePattern>(
  routes: readonly R[],
  pathname: string,
): { route: R; params: Record<string, string> } | null {
  let tree = trees.get(routes) as Node<R> | undefined;
  if (!tree) trees.set(routes, (tree = build(routes)) as Node<RoutePattern>);

  const values: string[] = [];
  let route: R | null;
  try {
    route = walk(tree, pathname, 0, values);
  } catch {
    return null; // malformed percent-encoding
  }
  if (!route) return null;
  // Names come from the matched route itself (not from the shared tree nodes).
  const params: Record<string, string> = {};
  let v = 0;
  for (const seg of route.segments) if (seg.kind === "param") params[seg.name] = values[v++]!;
  return { route, params };
}
