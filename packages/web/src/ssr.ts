import { HttpError, Redirect, ValidationError, inRequestScope } from "@forge/server";
import type { Context } from "hono";
import type { Component } from "svelte";
import { render } from "svelte/server";
import type { ClientAssets } from "./assets.ts";
import { ERROR_COMPONENT, ROOT_COMPONENT } from "./paths.ts";
import type { WebManifest, WebRoute } from "./routes.ts";
import type { Matcher } from "./server/matcher.ts";
import { pageScope, type PageState } from "./server/page.ts";
import { ROOT_ID, STATE_ID } from "./shared/constants.ts";

export interface SsrOptions {
  manifest: WebManifest;
  match: Matcher<WebRoute>;
  assets: ClientAssets;
  lang: string;
  onUnexpectedError: (error: unknown) => void;
  /** Loads a compiled component by source path (or ROOT_COMPONENT / ERROR_COMPONENT). */
  load: ModuleLoader;
  /** Extra markup at the end of <body> (dev live reload). */
  bodyEnd?: string;
}

export type ModuleLoader = (key: string) => Promise<{ default: Component<any> }>;

async function load(options: SsrOptions, files: string[]): Promise<Component<any>[]> {
  return (await Promise.all(files.map((f) => options.load(f)))).map((m) => m.default);
}

function escapeJson(value: unknown): string {
  // Safe inside <script>: no "</script>", no JS line terminators.
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function document(options: SsrOptions, parts: { head: string; body: string; route: WebRoute | null; state: object }) {
  const preloads = options.assets
    .preloads(parts.route)
    .map((href) => `<link rel="modulepreload" href="${href}">`)
    .join("");
  return `<!doctype html>
<html lang="${options.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${parts.head}
<link rel="modulepreload" href="${options.assets.entry}">${preloads}
</head>
<body>
<div id="${ROOT_ID}">${parts.body}</div>
<script type="application/json" id="${STATE_ID}">${escapeJson(parts.state)}</script>
<script type="module" src="${options.assets.entry}"></script>${options.bodyEnd ?? ""}
</body>
</html>`;
}

async function renderTree(Root: Component<any>, components: Component<any>[], state: PageState) {
  // `render()` is lazy: it must be awaited inside the scope, or `page` and
  // remote calls would lose the request state.
  return inRequestScope(state.http!, () => pageScope.run(state, async () => {
    const { head, body } = await render(Root, {
      props: { state: { components, key: state.url.pathname + state.url.search } },
    });
    return { head, body };
  }));
}

/** Renders the error page, inside the root layout when it renders, alone otherwise. */
async function renderError(c: Context, options: SsrOptions, url: URL, status: number, message: string) {
  const [Root, ErrorPage] = await load(options, [ROOT_COMPONENT, options.manifest.errorPage ?? ERROR_COMPONENT]);
  const rootLayout = options.manifest.rootLayout;
  const state: PageState = { url, params: {}, route: "", status, error: { message }, http: c };

  for (const withLayout of rootLayout ? [true, false] : [false]) {
    try {
      const components = withLayout ? [...(await load(options, [rootLayout!])), ErrorPage!] : [ErrorPage!];
      const out = await renderTree(Root!, components, state);
      const html = document(options, {
        ...out,
        route: null,
        state: { route: "", params: {}, status, error: { message }, errorWithLayout: withLayout },
      });
      return c.html(html, status as never);
    } catch (err) {
      if (!withLayout) options.onUnexpectedError(err);
    }
  }
  return c.text(`${status} ${message}`, status as never);
}

/** SSR of a page request: route -> layouts + page -> HTML with serialized data. */
export async function renderPage(c: Context, options: SsrOptions): Promise<Response> {
  const url = new URL(c.req.url);
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    return c.redirect(url.pathname.replace(/\/+$/, "") + url.search, 308);
  }

  const match = options.match(url.pathname);
  if (!match) return renderError(c, options, url, 404, "Not Found");

  const state: PageState = { url, params: match.params, route: match.route.id, status: 200, error: null, http: c };
  try {
    const [Root, ...components] = await load(options, [ROOT_COMPONENT, ...match.route.layouts, match.route.page]);
    const out = await renderTree(Root!, components, state);
    const html = document(options, {
      ...out,
      route: match.route,
      state: { route: match.route.id, params: match.params, status: 200, error: null, errorWithLayout: false },
    });
    return c.html(html);
  } catch (err) {
    if (err instanceof Redirect) return c.redirect(err.location, err.status);
    if (err instanceof HttpError) return renderError(c, options, url, err.status, err.message);
    if (err instanceof ValidationError) return renderError(c, options, url, 400, "Bad Request");
    options.onUnexpectedError(err);
    return renderError(c, options, url, 500, "Internal Error");
  }
}
