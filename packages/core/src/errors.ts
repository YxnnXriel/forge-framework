/**
 * Base error for every failure raised by Forge itself.
 * `code` is stable and machine-readable; `message` is for humans.
 * Errors coming from underlying engines (Hono, Prisma, Better Auth...)
 * are never wrapped silently: they are attached as `cause`.
 */
export class ForgeError extends Error {
  override readonly name: string = "ForgeError";
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

export interface ForgeIssue {
  /** Dotted path to the offending value, e.g. `web.dir` or `env.private.DATABASE_URL`. */
  path: string;
  message: string;
}

export class ForgeConfigError extends ForgeError {
  override readonly name = "ForgeConfigError";
  readonly issues: readonly ForgeIssue[];

  constructor(issues: readonly ForgeIssue[], file?: string) {
    const where = file ? ` (${file})` : "";
    const lines = issues.map((i) => `  - ${i.path || "<root>"}: ${i.message}`);
    super("FORGE_CONFIG_INVALID", `Invalid Forge configuration${where}:\n${lines.join("\n")}`);
    this.issues = issues;
  }
}
