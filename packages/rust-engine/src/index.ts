import { dlopen, FFIType, ptr, suffix, type Pointer } from "bun:ffi";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Forge's native engine (Rust, loaded with bun:ffi). Optional by design:
 * every function falls back to TypeScript when the library is not built,
 * or when FORGE_ENGINE=off. Results are identical either way.
 */

const ABI = 1;
/** Library built in place by `cargo build --release`. */
export const ENGINE_LIBRARY = join(import.meta.dir, "..", "native", "target", "release", `libforge_engine.${suffix}`);
let LIB = ENGINE_LIBRARY;

/**
 * Uses another copy of the library (production build: embedded in the
 * executable or copied next to the bundle). Must run before the first use.
 */
export function useEngineLibrary(path: string): void {
  LIB = path;
  native = undefined;
}

const symbols = {
  forge_abi_version: { args: [], returns: FFIType.u32 },
  forge_router_new: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.ptr },
  forge_router_match: { args: [FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  forge_router_free: { args: [FFIType.ptr], returns: FFIType.void },
  forge_hash_files: { args: [FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.u32 },
} as const;

type Native = ReturnType<typeof dlopen<typeof symbols>>["symbols"];

let native: Native | null | undefined;

/** The loaded native library, or null (not built, wrong ABI, or disabled). */
export function engine(): Native | null {
  if (native !== undefined) return native;
  native = null;
  if (Bun.env.FORGE_ENGINE === "off" || !existsSync(LIB)) return native;
  try {
    const lib = dlopen(LIB, symbols);
    if (lib.symbols.forge_abi_version() === ABI) native = lib.symbols;
  } catch {
    native = null;
  }
  return native;
}

export const engineStatus = () => (engine() ? `native (${LIB})` : "typescript fallback");

/* --------------------------------- Hashing -------------------------------- */

/**
 * Content hash of many files at once (incremental caches). Native: all cores,
 * in one call. Fallback: concurrent reads + Bun.hash. 0n = unreadable file.
 * Hashes from the two implementations differ: callers prefix keys with
 * `hashFlavor()` so switching engine only causes cache misses.
 */
export async function hashFiles(paths: readonly string[]): Promise<bigint[]> {
  if (paths.length === 0) return [];
  const lib = engine();
  if (lib) {
    const input = Buffer.from(paths.join("\n"));
    const out = new BigUint64Array(paths.length);
    lib.forge_hash_files(ptr(input), input.length, ptr(out));
    return [...out];
  }
  return Promise.all(
    paths.map(async (p) => {
      try {
        return BigInt(Bun.hash(await Bun.file(p).bytes())) | 1n;
      } catch {
        return 0n;
      }
    }),
  );
}

export const hashFlavor = () => (engine() ? "rs1" : "ts1");

/* --------------------------------- Router --------------------------------- */

export interface NativeRouter {
  /** Route index and param spans `[start, end]` in the raw path, or null. */
  match(path: string): { index: number; spans: Uint32Array; count: number } | null;
  free(): void;
}

const MAX_PARAMS = 16;

/** Segment-tree router over route ids (`/posts/[id]`), or null without the engine. */
export function nativeRouter(ids: readonly string[]): NativeRouter | null {
  const lib = engine();
  if (!lib) return null;
  const patterns = Buffer.from(ids.join("\n"));
  let handle: Pointer | null = lib.forge_router_new(ptr(patterns), patterns.length) as Pointer | null;
  const out = new Uint32Array(MAX_PARAMS * 2);
  const outPtr = ptr(out);
  const scratch = new Uint8Array(8192);
  const scratchPtr = ptr(scratch);
  const encoder = new TextEncoder();
  return {
    match(path) {
      if (!handle) throw new Error("router freed");
      const { written, read } = encoder.encodeInto(path, scratch);
      if (read < path.length) return null; // path longer than the scratch buffer
      const index = lib.forge_router_match(handle, scratchPtr, written, outPtr, MAX_PARAMS);
      return index < 0 ? null : { index, spans: out, count: MAX_PARAMS };
    },
    free() {
      if (handle) lib.forge_router_free(handle);
      handle = null;
    },
  };
}
