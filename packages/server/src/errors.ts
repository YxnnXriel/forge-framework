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
