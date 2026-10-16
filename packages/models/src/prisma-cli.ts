import { ForgeError } from "@forge/core";

/**
 * Runs the Prisma CLI installed in the project (never a downloaded one:
 * `bunx prisma` outside a project fetches the latest major).
 */
export function resolvePrismaCli(root: string): string {
  try {
    return Bun.resolveSync("prisma/build/index.js", root);
  } catch {
    throw new ForgeError("FORGE_DB_PRISMA", "The Prisma CLI is not installed in this project: run `bun add -d prisma@7`");
  }
}

export interface PrismaRun {
  code: number;
  output: string;
}

export async function runPrisma(
  root: string,
  args: string[],
  options: { env?: Record<string, string | undefined>; inherit?: boolean } = {},
): Promise<PrismaRun> {
  const proc = Bun.spawn([process.execPath, resolvePrismaCli(root), ...args], {
    cwd: root,
    env: { ...Bun.env, PRISMA_HIDE_UPDATE_MESSAGE: "1", ...options.env },
    stdin: options.inherit ? "inherit" : "ignore",
    stdout: options.inherit ? "inherit" : "pipe",
    stderr: options.inherit ? "inherit" : "pipe",
  });
  if (options.inherit) return { code: await proc.exited, output: "" };
  const [code, out, err] = await Promise.all([
    proc.exited,
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
  ]);
  return { code, output: out + err };
}
