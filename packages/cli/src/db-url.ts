import { isAbsolute, resolve } from "node:path";

/**
 * SQLite paths are resolved from the project root, so the CLI (Prisma) and the
 * server use the same file whatever the current directory is.
 */
export function databaseUrl(root: string, provider: "postgresql" | "sqlite", url: string): string {
  if (provider !== "sqlite" || !url.startsWith("file:")) return url;
  const path = url.slice("file:".length);
  return isAbsolute(path) ? url : `file:${resolve(root, path)}`;
}
