//! Parallel file hashing for incremental caches: reads and hashes many files
//! on all cores. The hash is Forge's own 64-bit hash (stable across releases).

use std::thread;

const P1: u64 = 0x9E37_79B1_85EB_CA87;
const P2: u64 = 0xC2B2_AE3D_27D4_EB4F;
const P3: u64 = 0x1656_67B1_9E37_79F9;

#[inline]
fn mix(acc: u64, v: u64) -> u64 {
    (acc ^ v.wrapping_mul(P2)).rotate_left(31).wrapping_mul(P1)
}

/// Fast, deterministic 64-bit hash (xxhash-style mixing, 8 bytes per step).
pub fn hash64(data: &[u8]) -> u64 {
    let mut acc = P3 ^ (data.len() as u64).wrapping_mul(P1);
    let mut chunks = data.chunks_exact(8);
    for c in &mut chunks {
        acc = mix(acc, u64::from_le_bytes(c.try_into().unwrap()));
    }
    let mut tail = [0u8; 8];
    let rest = chunks.remainder();
    tail[..rest.len()].copy_from_slice(rest);
    acc = mix(acc, u64::from_le_bytes(tail) ^ rest.len() as u64);
    acc ^= acc >> 33;
    acc = acc.wrapping_mul(P2);
    acc ^= acc >> 29;
    acc = acc.wrapping_mul(P3);
    acc ^ (acc >> 32)
}

/// `paths`: UTF-8 file paths separated by `\n`. Writes one u64 per path into
/// `out` (0 for unreadable files). Returns the number of files hashed.
///
/// # Safety
/// `ptr`/`len` readable; `out` has room for one u64 per path.
#[no_mangle]
pub unsafe extern "C" fn forge_hash_files(ptr: *const u8, len: usize, out: *mut u64) -> u32 {
    let data = std::slice::from_raw_parts(ptr, len);
    let paths: Vec<&str> = std::str::from_utf8(data).unwrap_or("").split('\n').collect();
    let n = paths.len();
    let results = std::slice::from_raw_parts_mut(out, n);
    let workers = thread::available_parallelism().map(|p| p.get()).unwrap_or(4).min(n.max(1));
    let chunk = n.div_ceil(workers);

    thread::scope(|scope| {
        for (paths, results) in paths.chunks(chunk).zip(results.chunks_mut(chunk)) {
            scope.spawn(move || {
                for (path, slot) in paths.iter().zip(results.iter_mut()) {
                    *slot = std::fs::read(path).map(|b| hash64(&b) | 1).unwrap_or(0);
                }
            });
        }
    });
    n as u32
}
