// Types of Forge's virtual modules (same API on the server and in the browser).

declare module "forge:router" {
  /**
   * One entry per app exposing remote functions. Filled by the generated
   * `.forge/types.d.ts` (interface augmentation).
   */
  export interface Remote {}
  /** `forge.<app>.<function>(input)`: functions marked `remote: true`. */
  export const forge: Remote;
}

declare module "forge:web" {
  export const page: {
    /** Current URL. */
    readonly url: URL;
    /** Dynamic segments of the current route: `[id]` -> `params.id`. */
    readonly params: Record<string, string>;
    /** Route id, e.g. `/posts/[id]`. */
    readonly route: string;
    /** HTTP status of the current page (200, or the error status on an error page). */
    readonly status: number;
    /** Set on error pages. */
    readonly error: { message: string } | null;
  };
  /** Client-side navigation (browser only). */
  export function goto(href: string, options?: { replace?: boolean }): Promise<void>;
}
