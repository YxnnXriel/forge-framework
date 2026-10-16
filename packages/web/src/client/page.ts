import { nav } from "./state.svelte.ts";

/** Browser implementation of `page` from "forge:web" (reactive). */
export const page = {
  get url(): URL {
    return nav.url;
  },
  get params(): Record<string, string> {
    return nav.params;
  },
  get route(): string {
    return nav.route;
  },
  get status(): number {
    return nav.status;
  },
  get error(): { message: string } | null {
    return nav.error;
  },
};

export { goto } from "./navigation.ts";
