// Browser-safe and server-safe: importable from any component.

/** Error thrown when a remote call fails (status and message from the server). */
export class RemoteError extends Error {
  override readonly name = "RemoteError";
  readonly status: number;
  readonly issues: unknown;

  constructor(status: number, message: string, issues?: unknown) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}
