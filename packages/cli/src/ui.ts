import { duration, palette, pad, symbols, type Palette } from "@forge/core/term";

export interface Ui {
  readonly p: Palette;
  /** `◆ forge <command>` title. */
  header(command: string, detail?: string): void;
  ok(message: string, detail?: string): void;
  warn(message: string): void;
  fail(message: string): void;
  /** Indented secondary line. */
  note(message: string): void;
  file(kind: "add" | "change", path: string): void;
  /** Aligned key/value rows. */
  table(rows: [string, string][]): void;
  /** Runs `fn` behind a spinner (terminal), then prints ✓/✗ with the time taken. */
  step<T>(label: string, fn: () => Promise<T>, detail?: (result: T) => string | undefined): Promise<T>;
  /** "Next steps" block with commands. */
  next(commands: string[]): void;
  blank(): void;
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function createUi(out: { log: (m: string) => void; error: (m: string) => void }, color: boolean): Ui {
  const p = palette(color);
  const spinner = color && process.stdout.isTTY === true;
  return {
    p,
    header(command, detail) {
      out.log(`\n  ${p.brand(p.bold(`${symbols.logo} forge`))} ${p.bold(command)}${detail ? `  ${p.dim(detail)}` : ""}\n`);
    },
    ok(message, detail) {
      out.log(`  ${p.green(symbols.ok)} ${message}${detail ? `  ${p.dim(detail)}` : ""}`);
    },
    warn(message) {
      out.error(`  ${p.yellow(symbols.warn)} ${p.yellow(message)}`);
    },
    fail(message) {
      out.error(`  ${p.red(symbols.fail)} ${p.red(message.split("\n")[0]!)}${message.includes("\n") ? "\n" + message.split("\n").slice(1).map((l) => `    ${l}`).join("\n") : ""}`);
    },
    note(message) {
      out.log(`    ${p.dim(message)}`);
    },
    file(kind, path) {
      out.log(`    ${kind === "add" ? p.green(symbols.add) : p.yellow(symbols.change)} ${kind === "add" ? path : p.yellow(path)}`);
    },
    table(rows) {
      const size = Math.max(...rows.map(([k]) => k.length)) + 2;
      for (const [k, v] of rows) out.log(`    ${p.dim(pad(k, size))}${v}`);
    },
    async step(label, fn, detail) {
      const start = performance.now();
      let timer: Timer | undefined;
      if (spinner) {
        let i = 0;
        const draw = () => process.stdout.write(`\r\x1b[2K  ${p.brand(FRAMES[i++ % FRAMES.length]!)} ${label}${p.dim("…")}`);
        draw();
        timer = setInterval(draw, 80);
      }
      const clear = () => {
        if (timer) clearInterval(timer);
        if (spinner) process.stdout.write("\r\x1b[2K");
      };
      try {
        const result = await fn();
        clear();
        const extra = detail?.(result);
        out.log(`  ${p.green(symbols.ok)} ${label}${extra ? `  ${p.accent(extra)}` : ""}  ${p.dim(duration(performance.now() - start))}`);
        return result;
      } catch (err) {
        clear();
        out.error(`  ${p.red(symbols.fail)} ${label}`);
        throw err;
      }
    },
    next(commands) {
      out.log(`\n  ${p.bold("Next")}`);
      for (const c of commands) out.log(`    ${p.brand(symbols.arrow)} ${p.cyan(c)}`);
      out.log("");
    },
    blank() {
      out.log("");
    },
  };
}

export const time = (start: number) => duration(performance.now() - start);
