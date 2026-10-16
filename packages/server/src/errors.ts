import { ForgeError, type ForgeIssue } from "@forge/core";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** An error meant to reach the client as-is (status + message). */
export class HttpError extends ForgeError {
  override readonly name = "HttpError";
  readonly status: ContentfulStatusCode;
  readonly details: unknown;

  constructor(status: ContentfulStatusCode, message: string, details?: unknown) {
    super("FORGE_HTTP", message);
    this.status = status;
    this.details = details;
  }
}

/** Throws an `HttpError`. Usable in any handler: `if (!post) error(404, "Post not found")`. */
export function error(status: ContentfulStatusCode, message: string, details?: unknown): never {
  throw new HttpError(status, message, details);
}

/** Input did not match the view's schema. Serialized as a 400 with the list of issues. */
export class ValidationError extends ForgeError {
  override readonly name = "ValidationError";
  readonly issues: readonly ForgeIssue[];

  constructor(issues: readonly ForgeIssue[]) {
    super("FORGE_VALIDATION", "Invalid input");
    this.issues = issues;
  }
}

export type RedirectStatus = 301 | 302 | 303 | 307 | 308;

/** Thrown by `redirect()`. Turned into a 3xx response over HTTP, a client navigation in the browser. */
export class Redirect extends ForgeError {
  override readonly name = "Redirect";
  readonly status: RedirectStatus;
  readonly location: string;

  constructor(status: RedirectStatus, location: string) {
    super("FORGE_REDIRECT", `Redirect to ${location}`);
    this.status = status;
    this.location = location;
  }
}

/** `redirect(303, "/login")`: usable in handlers, access rules and pages. */
export function redirect(status: RedirectStatus, location: string): never {
  throw new Redirect(status, location);
}
