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

function walk<R>(n: Node<R>, parts: string[], i: number, values: string[]): R | null {
  if (i === parts.length) return n.route;
  const next = n.statics.get(parts[i]!);
  if (next) {
    const found = walk(next, parts, i + 1, values);
    if (found) return found;
  }
  if (n.param) {
    values.push(parts[i]!);
    const found = walk(n.param.node, parts, i + 1, values);
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
  let parts: string[];
  try {
    parts = splitPath(pathname).map(decodeURIComponent);
  } catch {
    return null;
  }
  let tree = trees.get(routes) as Node<R> | undefined;
  if (!tree) trees.set(routes, (tree = build(routes)) as Node<RoutePattern>);

  const values: string[] = [];
  const route = walk(tree, parts, 0, values);
  if (!route) return null;
  // Names come from the matched route itself (not from the shared tree nodes).
  const params: Record<string, string> = {};
  let v = 0;
  for (const seg of route.segments) if (seg.kind === "param") params[seg.name] = values[v++]!;
  return { route, params };
}
