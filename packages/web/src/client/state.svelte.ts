import type { Component } from "svelte";

/** Reactive navigation state of the browser runtime (Svelte runes). */
class NavigationState {
  url = $state.raw(new URL(location.href));
  params = $state.raw<Record<string, string>>({});
  route = $state.raw("");
  status = $state.raw(200);
  error = $state.raw<{ message: string } | null>(null);
  components = $state.raw<Component<any>[]>([]);
  key = $state.raw("");

  /** True until the first render is hydrated: remote calls reuse SSR results. */
  hydrating = false;
  onerror: ((error: unknown) => void) | undefined = undefined;
}

export const nav = new NavigationState();
