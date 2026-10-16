import { networkInterfaces } from "node:os";
import type { ResolvedConfig } from "@forge/core";
import { duration, palette, symbols } from "@forge/core/term";
import { engine } from "@forge/rust-engine";

function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) if (net.family === "IPv4" && !net.internal) return net.address;
  }
  return null;
}

/**
 * Startup message. On a terminal: a framed summary (URLs, modules, runtime);
 * elsewhere (Docker, CI, tests): one parseable line.
 */
export function readyMessage(config: ResolvedConfig, url: URL, options: { dev: boolean; color: boolean; restart: boolean }): string {
  const p = palette(options.color);
  const took = duration(performance.now());
  const mode = options.dev ? "development" : "production";
  if (!p.on) return `Forge ready on ${url.href} (${mode}, ${took})`;
  if (options.restart) {
    return `  ${p.green(symbols.ok)} ${p.dim("ready in")} ${p.bold(took)}  ${p.dim(symbols.dot)}  ${p.cyan(url.href)}`;
  }

  const modules = [
    config.api && "api",
    config.web && "web",
    config.db && config.db.provider,
    config.auth && "auth",
  ].filter(Boolean) as string[];
  const lan = url.hostname === "localhost" || url.hostname === "0.0.0.0" ? lanAddress() : null;
  const label = (s: string) => p.dim(s.padEnd(9));
  const lines = [
    "",
    `  ${p.brand(p.bold(`${symbols.logo} Forge`))}  ${options.dev ? p.accent(mode) : p.green(mode)}  ${p.dim(symbols.dot)}  ${p.dim("ready in")} ${p.bold(took)}`,
    "",
    `  ${p.brand(symbols.arrow)}  ${label("Local")} ${p.cyan(url.href)}`,
  ];
  if (lan) lines.push(`  ${p.brand(symbols.arrow)}  ${label("Network")} ${p.cyan(url.href.replace(url.hostname, lan))}`);
  lines.push(
    `     ${label("Modules")} ${modules.length ? modules.map((m) => p.accent(m)).join(p.dim(` ${symbols.dot} `)) : p.dim("none")}`,
    `     ${label("Runtime")} ${p.dim(`Bun ${Bun.version} ${symbols.dot} engine`)} ${engine() ? p.green("Rust") : p.yellow("TypeScript")}`,
    "",
  );
  return lines.join("\n");
}
