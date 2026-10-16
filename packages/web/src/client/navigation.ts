import type { Component } from "svelte";
import { matchRoute, type RoutePattern } from "../shared/match.ts";
import { nav } from "./state.svelte.ts";

export interface ClientRoute extends RoutePattern {
  /** Loads layouts (root first) then the page. */
  load: () => Promise<Array<{ default: Component<any> }>>;
}

let routes: readonly ClientRoute[] = [];

export function setRoutes(list: readonly ClientRoute[]): void {
  routes = list;
}

function fullLoad(url: URL): void {
  location.href = url.href;
}

/**
 * Client-side navigation: loads the target page's modules, keeps the shared
 * layouts mounted, re-creates the page (its `await`s run as remote calls).
 * Anything unexpected falls back to a full page load, rendered by the server.
 */
export async function navigate(url: URL, options: { replace?: boolean; pop?: boolean } = {}): Promise<void> {
  if (url.origin !== location.origin) return fullLoad(url);
  const match = matchRoute(routes, url.pathname);
  if (!match) return fullLoad(url);

  let components: Component<any>[];
  try {
    components = (await match.route.load()).map((m) => m.default);
  } catch {
    return fullLoad(url);
  }

  if (!options.pop) history[options.replace ? "replaceState" : "pushState"]({}, "", url.href);

  nav.url = url;
  nav.params = match.params;
  nav.route = match.route.id;
  nav.status = 200;
  nav.error = null;
  nav.components = components;
  nav.key = url.pathname + url.search;

  if (!options.pop) {
    const target = url.hash ? document.getElementById(decodeURIComponent(url.hash.slice(1))) : null;
    if (target) target.scrollIntoView();
    else scrollTo(0, 0);
  }
}

/** Programmatic navigation, from "forge:web". */
export function goto(href: string, options: { replace?: boolean } = {}): Promise<void> {
  return navigate(new URL(href, location.href), options);
}

function onClick(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  const anchor = (event.target as Element | null)?.closest?.("a");
  if (!anchor || !anchor.href) return;
  if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
  if (anchor.dataset.forgeReload !== undefined || anchor.getAttribute("rel")?.includes("external")) return;

  const url = new URL(anchor.href);
  if (url.origin !== location.origin) return;
  // Same document, only the hash changes: let the browser scroll.
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return;

  event.preventDefault();
  void navigate(url);
}

export function listen(): void {
  addEventListener("click", onClick);
  addEventListener("popstate", () => void navigate(new URL(location.href), { pop: true }));
}
