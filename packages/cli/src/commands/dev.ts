import { readFileSync, readdirSync, watch, type FSWatcher } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Subprocess } from "bun";
import { assertBun, type Out } from "../util.ts";

/** Paths that never restart the server (outputs, dependencies, databases). */
const IGNORED = /(^|[\\/])(node_modules|\.forge|\.git|\.vercel|generated|dist)([\\/]|$)|\.(db|db-journal|db-wal|db-shm|log)$|~$/;
const MODELS = /(^|[\\/])models\.ts$/;

/** Variables of the project's .env files, as Bun loaded them into this process. */
function dotenvValues(root: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const name of readdirSync(root)) {
    if (!/^\.env(\..+)?$/.test(name) || name === ".env.example") continue;
    for (const line of readFileSync(join(root, name), "utf8").split("\n")) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][\w.]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) values.set(m[1]!, m[2]!.replace(/^(["'`])(.*)\1$/, "$2"));
    }
  }
  return values;
}

/**
 * Environment for the app process, without what came from .env files (the
 * child loads them again, so editing .env applies on the next restart). A
 * variable set in the shell to another value still wins.
 */
function childEnv(fromDotenv: Map<string, string>): Record<string, string | undefined> {
  const env = { ...Bun.env };
  for (const [key, value] of fromDotenv) if (env[key] === value) delete env[key];
  return env;
}

/**
 * `forge dev`: runs the app from source and restarts it on change. The
 * watcher lives in this parent process, so every file counts (pages not yet
 * rendered, client-only modules, .env); open pages reload by themselves once
 * the new server answers. Changed models regenerate the Prisma schema and
 * client before the restart.
 */
export async function dev(root: string, out: Out): Promise<number> {
  assertBun();
  let entry: string;
  try {
    // The project's own `forge` package (the CLI cannot depend on it).
    entry = Bun.resolveSync("forge/internal/dev", root);
  } catch {
    out.error("The `forge` package is not installed in this project");
    return 1;
  }
  const fromDotenv = dotenvValues(root);
  let child: Subprocess | null = null;
  let changed = new Set<string>();
  let timer: Timer | null = null;
  let restarting = false;

  const spawn = () => {
    child = Bun.spawn(["bun", entry, root], {
      cwd: root,
      stdio: ["inherit", "inherit", "inherit"],
      env: { ...childEnv(fromDotenv), NODE_ENV: "development" },
    });
  };

  const restart = async () => {
    if (restarting) return;
    restarting = true;
    const files = [...changed];
    changed = new Set();
    out.log(`\n[forge] ${files.slice(0, 3).join(", ")}${files.length > 3 ? ` +${files.length - 3}` : ""} changed, restarting`);
    if (files.some((f) => MODELS.test(f))) {
      const { generate } = await import("./db.ts");
      const { loadConfig } = await import("@forge/core");
      // Fresh import: the config may itself have changed.
      if ((await loadConfig(root)).db) await generate(root, out, { ifNeeded: true }).catch((e) => out.error(String(e)));
    }
    const previous = child as Subprocess | null;
    if (previous) {
      previous.kill("SIGTERM");
      await previous.exited;
    }
    spawn();
    restarting = false;
    if (changed.size) schedule();
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void restart(), 60);
  };

  let watcher: FSWatcher;
  try {
    watcher = watch(root, { recursive: true }, (_event, name) => {
      if (!name) return;
      const rel = String(name).split(sep).join("/");
      if (IGNORED.test(rel) || relative(root, join(root, rel)).startsWith("..")) return;
      changed.add(rel);
      schedule();
    });
  } catch (err) {
    out.error(`Cannot watch ${root}: ${(err as Error).message}`);
    return 1;
  }

  spawn();
  const stop = () => {
    watcher.close();
    (child as Subprocess | null)?.kill("SIGTERM");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise(() => {}); // runs until interrupted
  return 0;
}
