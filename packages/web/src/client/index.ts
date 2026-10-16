import { hydrate, settled, type Component } from "svelte";
import Root from "../runtime/Root.svelte";
import { ROOT_ID, STATE_ID } from "../shared/constants.ts";
import { listen, setRoutes, type ClientRoute } from "./navigation.ts";
import { nav } from "./state.svelte.ts";

export { RemoteError } from "../shared/errors.ts";
export type { ClientRoute };

interface InitialState {
  route: string;
  params: Record<string, string>;
  status: number;
  error: { message: string } | null;
  /** Error page rendered inside the root layout. */
  errorWithLayout: boolean;
}

type Modules = Promise<Array<{ default: Component<any> }>>;

/** Entry point of the browser bundle (called by the generated entry). */
export async function start(routes: ClientRoute[], loadError: (withLayout: boolean) => Modules): Promise<void> {
  setRoutes(routes);
  const initial = JSON.parse(document.getElementById(STATE_ID)!.textContent!) as InitialState;

  const route = routes.find((r) => r.id === initial.route);
  const modules = initial.error || !route ? await loadError(initial.errorWithLayout) : await route.load();

  nav.url = new URL(location.href);
  nav.params = initial.params;
  nav.route = initial.route;
  nav.status = initial.status;
  nav.error = initial.error;
  nav.components = modules.map((m) => m.default);
  nav.key = location.pathname + location.search;
  nav.hydrating = true;
  // After hydration, an error inside the app (e.g. a failed remote call after a
  // client navigation) reloads the URL so the server renders it with the right status.
  nav.onerror = (error) => {
    console.error(error);
    if (!nav.hydrating) location.reload();
  };

  hydrate(Root, { target: document.getElementById(ROOT_ID)!, props: { state: nav } });
  await settled();
  nav.hydrating = false;
  listen();
  document.documentElement.dataset.forgeHydrated = "true";
}
