// Terminal styling shared by the CLI, the dev server banner and request logs.
// Colors only on a terminal (or FORCE_COLOR), never with NO_COLOR.

type Stream = { isTTY?: boolean };

export function colorEnabled(stream: Stream = process.stdout): boolean {
  if (Bun.env.NO_COLOR !== undefined && Bun.env.NO_COLOR !== "") return false;
  if (Bun.env.FORCE_COLOR !== undefined) return Bun.env.FORCE_COLOR !== "0";
  return stream.isTTY === true;
}

const truecolor = () => Bun.env.COLORTERM === "truecolor" || Bun.env.COLORTERM === "24bit";

export interface Palette {
  readonly on: boolean;
  bold(s: string | number): string;
  dim(s: string | number): string;
  italic(s: string | number): string;
  /** Forge's purple. */
  brand(s: string | number): string;
  /** Lighter purple, for secondary accents. */
  accent(s: string | number): string;
  green(s: string | number): string;
  red(s: string | number): string;
  yellow(s: string | number): string;
  cyan(s: string | number): string;
  blue(s: string | number): string;
  magenta(s: string | number): string;
  gray(s: string | number): string;
}

/** ANSI styles (Bun.color picks the right escape for brand colors). */
export function palette(on: boolean = colorEnabled()): Palette {
  const wrap = (open: string, close: string) => (s: string | number) => (on ? `${open}${s}${close}` : String(s));
  const hex = (color: string) => Bun.color(color, truecolor() ? "ansi-16m" : "ansi-256") ?? "";
  return {
    on,
    bold: wrap("\x1b[1m", "\x1b[22m"),
    dim: wrap("\x1b[2m", "\x1b[22m"),
    italic: wrap("\x1b[3m", "\x1b[23m"),
    brand: wrap(hex("#8b5cf6"), "\x1b[39m"),
    accent: wrap(hex("#c4b5fd"), "\x1b[39m"),
    green: wrap("\x1b[32m", "\x1b[39m"),
    red: wrap("\x1b[31m", "\x1b[39m"),
    yellow: wrap("\x1b[33m", "\x1b[39m"),
    cyan: wrap("\x1b[36m", "\x1b[39m"),
    blue: wrap("\x1b[34m", "\x1b[39m"),
    magenta: wrap("\x1b[35m", "\x1b[39m"),
    gray: wrap("\x1b[90m", "\x1b[39m"),
  };
}

export const symbols = {
  logo: "◆",
  ok: "✓",
  fail: "✗",
  warn: "▲",
  arrow: "➜",
  dot: "·",
  add: "+",
  change: "~",
  restart: "↻",
} as const;

/** Visible width (ANSI escapes excluded), for alignment. */
export const width = (s: string) => Bun.stringWidth(s);

export function pad(s: string, size: number): string {
  return s + " ".repeat(Math.max(0, size - width(s)));
}

/** 0.42 ms, 12.3 ms, 1.24 s */
export function duration(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 1 : 0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** 812 B, 4.2 kB, 5.7 MB */
export function bytes(n: number): string {
  if (n < 1000) return `${n} B`;
  if (n < 1e6) return `${(n / 1e3).toFixed(1)} kB`;
  return `${(n / 1e6).toFixed(1)} MB`;
}
